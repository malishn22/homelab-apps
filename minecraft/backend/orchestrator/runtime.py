import json
import logging
import os
import shutil
import tarfile
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re
import threading

import docker
import requests
from docker.errors import NotFound as DockerNotFound

from .state import (
    OrchestratorError,
    ensure_dirs,
    load_instances,
    save_instances,
    upsert_instance,
    get_instance,
    _log_line,
    _log_buffers,
    _log_lock,
    _hydrate_semaphore,
)
from .files import prepare_instance_files
from .utils import (
    detect_minecraft_version_from_root,
    extract_minecraft_versions,
    pick_best_version,
)
from .providers.factory import get_provider
from .server_defaults import apply_server_defaults, apply_whitelist_defaults, apply_ops_defaults

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_INSTANCES_ROOT = CONTAINER_DATA_ROOT / "instances"
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"

HOST_SERVERS_ROOT = Path(os.environ.get("HOST_SERVERS_ROOT", "/data/servers"))

DATA_DIR = CONTAINER_INSTANCES_ROOT
STATE_FILE = DATA_DIR / "instances.json"

# --- Instance status values (single source of truth) ---

STATUS_PREPARING = "PREPARING"
STATUS_OFFLINE = "OFFLINE"
STATUS_STARTING = "STARTING"
STATUS_STOPPING = "STOPPING"
STATUS_ONLINE = "ONLINE"
STATUS_ERROR = "ERROR"
PING_HOST = os.environ.get("MINECRAFT_PING_HOST", "host.docker.internal")

LEGACY_JVM_ARGS_LINES = {
    "-XX:+UseG1GC",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-Dsun.rmi.dgc.server.gcInterval=2147483646",
    "-Dsun.rmi.dgc.client.gcInterval=2147483646",
}


def _is_legacy_jvm_args(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    non_mem = [line for line in lines if not line.startswith(("-Xms", "-Xmx"))]
    if set(non_mem) != LEGACY_JVM_ARGS_LINES:
        return False
    for line in lines:
        if line.startswith(("-Xms", "-Xmx")):
            continue
        if line not in LEGACY_JVM_ARGS_LINES:
            return False
    return True


def _default_jvm_args(_: int) -> str:
    return ""


def _parse_minecraft_version(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    versions = extract_minecraft_versions(value)
    return pick_best_version(versions)


def _java_major_for_mc(version: Optional[str]) -> int:
    if not version:
        return 17
    parts = [p for p in version.split(".") if p.isdigit()]
    if len(parts) >= 2 and parts[0] == "1":
        minor = int(parts[1])
        if minor >= 21: # 1.21+ needs Java 21
            return 21
        if minor >= 18: # 1.18+ needs Java 17
            return 17
        if minor == 17: # 1.17 needs Java 16 (or 17)
            return 17
        return 8
    # Fallback for unknown/parse failure
    return 17


def _select_java_image(
    instance: Dict, server_dir: Path, source: Optional[str], instance_id: str
) -> str:
    mc_version = instance.get("minecraft_version")
    if not mc_version:
        mc_version = detect_minecraft_version_from_root(server_dir, source=source)
    if not mc_version:
        mc_version = _parse_minecraft_version(instance.get("version_number"))
    if mc_version and mc_version != instance.get("minecraft_version"):
        instance["minecraft_version"] = mc_version
        upsert_instance(instance)
    if mc_version:
        # Check if we should override based on modern Forge cues
        if _java_major_for_mc(mc_version) == 8:
            # If we detect unix_args.txt, it CANNOT be Java 8. It must be 17+.
            if any(server_dir.rglob("unix_args.txt")):
                java_major = 21 # Safest modern default
                _log_line(instance_id, f"[PREP] Detected unix_args.txt with old MC version ({mc_version}). Forcing Java {java_major}.")
            else:
                 java_major = 8
        else:
            java_major = _java_major_for_mc(mc_version)
    else:
        # No version detected.
        # Check for unix_args.txt
        if any(server_dir.rglob("unix_args.txt")):
             java_major = 21
             _log_line(instance_id, "[PREP] No MC version detected, but found unix_args.txt. Defaulting to Java 21.")
        else:
            java_major = 21 # Default to modern for unknown
            
    if mc_version:
        _log_line(instance_id, f"[PREP] Using Java {java_major} for Minecraft {mc_version}")
    return f"eclipse-temurin:{java_major}-jre"


def _ping_server_players(host: str, port: int) -> Optional[Tuple[int, int, float]]:
    """Use Server List Ping (Java 1.7+) to get players and latency. Returns (online, max, latency_ms) or None."""
    try:
        from mcstatus import JavaServer
        server = JavaServer(host, port)
        status = server.status()
        return (status.players.online, status.players.max, status.latency)
    except Exception:
        return None


def _read_max_players_from_properties(server_dir: Path) -> Optional[int]:
    """Read max-players from server.properties. Returns None if not found or invalid."""
    props_path = server_dir / "server.properties"
    if not props_path.exists():
        return None
    try:
        text = props_path.read_text(errors="ignore")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key.strip().lower() == "max-players":
                v = val.strip()
                if v.isdigit():
                    return int(v)
                return None
    except Exception:
        pass
    return None


def _should_hide_perf_line(line: str) -> bool:
    """Hide TPS/dimension perf spam and neoforge/forge tps command errors from logs."""
    lower = line.lower()
    if "mean tick time" in lower and "mean tps" in lower:
        return True
    if "tps" in lower and "ms/tick" in lower:
        return True
    # Hide "Unknown or incomplete command... neoforge tps<--[HERE]" / "forge tps<--"
    if "unknown or incomplete command" in lower:
        if "neoforge tps" in lower or "forge tps" in lower:
            return True
    if "neoforge tps<--" in lower or "forge tps<--" in lower:
        return True
    return False


def _send_container_command(container, command: str) -> None:
    client = _docker_client()
    exec_id = client.api.exec_create(
        container.id,
        cmd=["/bin/sh", "-c", f"printf '{command}\\n' > /proc/1/fd/0"],
        stdin=False,
        tty=False,
    )
    client.api.exec_start(exec_id)


def _set_status(instance: Dict, status: str) -> Dict:
    """Update instance status and persist it."""
    instance["status"] = status
    upsert_instance(instance)
    return instance


def _server_run_dirs(instance_id: str) -> Tuple[Path, Path]:
    server_dir_container = CONTAINER_SERVERS_ROOT / instance_id
    server_dir_host = HOST_SERVERS_ROOT / instance_id
    return server_dir_container, server_dir_host


def _docker_client() -> docker.DockerClient:
    try:
        return docker.from_env()
    except Exception as exc:  # pragma: no cover - defensive
        raise OrchestratorError(f"Docker client error: {exc}") from exc


def create_instance(
    *,
    name: str,
    project_id: str,
    version_id: str,
    version_number: Optional[str],
    loader: Optional[str],
    source: Optional[str],
    port: int,
    ram_mb: int,
    file_url: str,
) -> Dict:
    instance_id = f"srv-{uuid.uuid4().hex[:8]}"
    server_dir_container, _ = _server_run_dirs(instance_id)
    instance = {
        "id": instance_id,
        "name": name,
        "project_id": project_id,
        "version_id": version_id,
        "version_number": version_number,
        "loader": loader,
        "source": source,
        "port": port,
        "ram_mb": ram_mb,
        "file_url": file_url,
        "status": STATUS_PREPARING,
        "container_name": f"mc-{instance_id}",
        "instance_dir": str(server_dir_container),
        "extract_dir": str(server_dir_container),
        "archive_path": "",
        "entry_target": None,
        "start_command": None,
    }
    upsert_instance(instance)

    def _hydrate_task():
        with _hydrate_semaphore:
            _log_line(instance_id, "[PREP] Starting download & extract")
            try:
                prepared = prepare_instance_files(
                    project_id,
                    version_id,
                    file_url,
                    ram_mb,
                    instance_id,
                    source=source,
                )
                instance.update(prepared)
                _set_status(instance, STATUS_OFFLINE)
                _log_line(instance_id, "[SUCCESS] Completed. Ready to start.")
            except Exception as exc:  # pragma: no cover
                _set_status(instance, STATUS_ERROR)
                _log_line(instance_id, f"[PREP] Failed: {exc}")

    threading.Thread(target=_hydrate_task, daemon=True).start()

    return instance


def _container_for(instance: Dict):
    client = _docker_client()
    try:
        return client.containers.get(instance["container_name"])
    except DockerNotFound:
        return None


def _wrap_command_for_java(cmd: List[str]) -> List[str]:
    """
    When the command runs a .sh script, prepend export JAVA_HOME and PATH
    so scripts use container Java instead of any bundled Java.
    """
    if len(cmd) < 2 or cmd[0] not in ("/bin/bash", "/bin/sh", "bash", "sh"):
        return cmd
    inner = cmd[-1]
    if not inner or ".sh" not in inner or "./" not in inner:
        return cmd
    java_prefix = "export JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && "
    return cmd[:-1] + [java_prefix + inner]


def _container_ready(container) -> bool:
    """
    Return True if server logs show the typical 'Done (...)! For help, type "help"' line.
    This covers vanilla / Forge / Fabric server startup.
    """
    try:
        raw = container.logs(tail=200).decode("utf-8", errors="ignore").lower()
    except Exception:
        return False
    # Standard "Done (X.Xs)! For help, type "help""
    if "done (" in raw and 'for help, type "help"' in raw:
        return True
    # ModernFix / some modpacks: "Dedicated server took 306.67 seconds to load"
    if "dedicated server took" in raw and "seconds to load" in raw:
        return True
    return False


def start_instance(instance_id: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    client = _docker_client()
    container = _container_for(instance)
    if container and container.status == "running":
        return {"status": STATUS_ONLINE}

    server_dir_container, server_dir_host = _server_run_dirs(instance_id)

    source_key = (instance.get("source") or "").strip().lower()
    mod_id = instance.get("project_id")
    file_id = instance.get("version_id")
    version_hint = instance.get("version_number")

    # Migration: existing instances may have pack in old extract_dir (instances/xxx/server).
    # One-time copy to server_dir if server_dir is empty but extract_dir has content.
    extract_dir_from_state = instance.get("extract_dir")
    if extract_dir_from_state:
        extract_path = Path(extract_dir_from_state)
        if extract_path != server_dir_container and extract_path.exists():
            # Check if server_dir is empty or missing but extract_dir has content
            if not server_dir_container.exists() or not any(server_dir_container.iterdir()):
                try:
                    if server_dir_container.exists():
                        shutil.rmtree(server_dir_container)
                    shutil.copytree(extract_path, server_dir_container)
                    log.info("Migrated instance %s from extract_dir to server_dir", instance_id)
                    instance["instance_dir"] = str(server_dir_container)
                    instance["extract_dir"] = str(server_dir_container)
                    upsert_instance(instance)
                except Exception as exc:
                    log.warning("Migration failed for %s: %s", instance_id, exc)

    apply_server_defaults(server_dir_container, instance_id)
    apply_whitelist_defaults(server_dir_container, instance_id)
    apply_ops_defaults(server_dir_container, instance_id)

    # Auto-accept EULA right before start if it's missing
    eula_file = server_dir_container / "eula.txt"
    if not eula_file.exists():
        eula_file.write_text("eula=true\n")

    ram_mb = instance.get("ram_mb", 4096)

    jvm_args = server_dir_container / "user_jvm_args.txt"
    if source_key == "curseforge":
        if jvm_args.exists():
            try:
                if _is_legacy_jvm_args(jvm_args.read_text()):
                    jvm_args.write_text("")
                    _log_line(instance_id, "[PREP] Cleared user_jvm_args.txt defaults")
            except Exception:
                pass
        else:
            # We don't need a default Xms/Xmx here if we pass it via cmd line, 
            # but legacy code wrote one. Let's write empty for now or adapt if needed.
            # Actually, CurseForge provider handles this.
            jvm_args.write_text("") 
            _log_line(instance_id, "[PREP] Created user_jvm_args.txt")

    try:
        # Use Provider to detect start command
        provider = get_provider(source_key, instance_id, server_dir_container)
        cmd, entry_target = provider.generate_start_command(
            server_dir_container,
            ram_mb,
            project_id=mod_id,
            version_id=file_id,
            version_hint=version_hint,
        )

        instance["start_command"] = cmd
        instance["entry_target"] = entry_target
        upsert_instance(instance)
    except OrchestratorError:
        raise
    except Exception as exc:
        log.exception("Start command detection failed for %s: %s", instance_id, exc)
        _log_line(instance_id, f"[FAIL] Could not detect start command: {exc}")
        raise OrchestratorError(f"Could not detect start command: {exc}") from exc

    port = instance.get("port", 25565)

    if container:
        try:
            container.remove(force=True)
        except Exception as exc:
            log.warning("Failed to remove existing container for %s: %s", instance_id, exc)

    env = {
        "EULA": "TRUE",
        "INIT_MEMORY": f"{ram_mb}M",
        "MAX_MEMORY": f"{ram_mb}M",
        "JAVA_HOME": "/opt/java/openjdk",
        "PATH": "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    }
    image = _select_java_image(instance, server_dir_container, source_key, instance_id)
    cmd = _wrap_command_for_java(cmd)

    _log_line(instance_id, "[INFO] Starting server container…")
    try:
        client.images.pull(image)
    except Exception as exc:
        log.warning("Failed to pull image %s: %s", image, exc)
        raise OrchestratorError(f"Failed to pull Java image {image}: {exc}") from exc
    try:
        container = client.containers.run(
            image=image,
            name=instance["container_name"],
            command=cmd,
            working_dir="/data",
            environment=env,
            ports={f"{port}/tcp": port},
            volumes={str(server_dir_host): {"bind": "/data", "mode": "rw"}},
            stdin_open=True,
            tty=False,
            detach=True,
        )
    except Exception as exc:
        log.exception("Failed to start container for %s: %s", instance_id, exc)
        _log_line(instance_id, f"[FAIL] Failed to start container: {exc}")
        raise OrchestratorError(f"Failed to start container: {exc}") from exc

    _set_status(instance, STATUS_STARTING)
    return {"status": STATUS_STARTING, "container_id": container.id}


def stop_instance(instance_id: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    container = _container_for(instance)
    if container:
        try:
            _set_status(instance, STATUS_STOPPING)
            container.stop(timeout=20)
            container.remove()
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to stop container %s: %s", instance_id, exc)

    _set_status(instance, STATUS_OFFLINE)
    return {"status": STATUS_OFFLINE}


def _patch_server_properties_max_players(server_dir: Path, max_players: int) -> None:
    """Update or add max-players in server.properties."""
    props_path = server_dir / "server.properties"
    content: str
    if props_path.exists():
        content = props_path.read_text(encoding="utf-8", errors="replace")
    else:
        content = ""

    lines: List[str] = []
    found = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, _, val = line.partition("=")
            if key.strip().lower() == "max-players":
                lines.append(f"max-players={max_players}\n")
                found = True
                continue
        lines.append(line + "\n" if not line.endswith("\n") else line)

    if not found:
        lines.append(f"max-players={max_players}\n")

    props_path.parent.mkdir(parents=True, exist_ok=True)
    props_path.write_text("".join(lines), encoding="utf-8")


def update_instance(instance_id: str, payload: Dict) -> Dict:
    """Update instance fields (name, port, max_players, ram_mb). If ram_mb changes and server is running, stop it first."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    ram_mb_new = payload.get("ram_mb")
    ram_mb_current = instance.get("ram_mb")
    if ram_mb_new is not None and ram_mb_new != ram_mb_current:
        container = _container_for(instance)
        if container and container.status == "running":
            stop_instance(instance_id)
            instance = get_instance(instance_id)
            if not instance:
                raise OrchestratorError("Instance not found")

    if "name" in payload and payload["name"] is not None:
        instance["name"] = payload["name"]
    if "port" in payload and payload["port"] is not None:
        instance["port"] = payload["port"]
    if "max_players" in payload and payload["max_players"] is not None:
        instance["max_players"] = payload["max_players"]
    if "ram_mb" in payload and payload["ram_mb"] is not None:
        instance["ram_mb"] = payload["ram_mb"]

    max_players = payload.get("max_players")
    if max_players is not None:
        _, server_dir_host = _server_run_dirs(instance_id)
        _patch_server_properties_max_players(server_dir_host, max_players)

    upsert_instance(instance)
    return instance


def restart_instance(instance_id: str) -> Dict:
    """Stop the instance, then start it. Atomic restart operation."""
    stop_instance(instance_id)
    return start_instance(instance_id)


def instance_status(instance_id: str) -> Dict:
    """
    Return current status + resource stats for an instance.

    State rules:
    - PREPARING: hydrate thread is downloading/extracting, no container yet.
      Never override PREPARING here, only the hydrate thread may set OFFLINE/ERROR.
    - STARTING: container is running but server is still booting.
      Only transition to ONLINE when server logs contain a 'Done (...)' line.
    - ONLINE: server is fully up.
    - OFFLINE: no container and not preparing.
    """
    instance = get_instance(instance_id)
    if not instance:
        return {
            "status": "OFFLINE",
            "stats": {
                "ramUsage": 0,
                "ramTotal": 0,
                "cpuLoad": 0.0,
                "latency": None,
                "players": 0,
                "maxPlayers": 20,
            },
        }

    status = instance.get("status", "OFFLINE")
    server_dir_container, server_dir_host = _server_run_dirs(instance_id)
    stats = {
        "ramUsage": 0,
        "ramTotal": round((instance.get("ram_mb", 0) or 0) / 1024, 2),
        "cpuLoad": 0.0,
        "latency": None,
        "players": 0,
        "maxPlayers": _read_max_players_from_properties(server_dir_host) or 20,
    }

    container = _container_for(instance)

    # ----------------------------------------------------------------------
    # NO CONTAINER
    # ----------------------------------------------------------------------
    if not container:
        # If we're PREPARING or ERROR, never override here.
        if status in {"PREPARING", "ERROR"}:
            return {"status": status, "stats": stats}

        # Anything else with no container is OFFLINE.
        if status != "OFFLINE":
            status = "OFFLINE"
            instance["status"] = status
            upsert_instance(instance)

        return {"status": status, "stats": stats}

    # ----------------------------------------------------------------------
    # CONTAINER EXISTS: collect stats + decide state
    # ----------------------------------------------------------------------
    try:
        container.reload()
        state = container.attrs.get("State", {})
        running = state.get("Running", False)
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to reload container for %s: %s", instance_id, exc)
        running = False

    # CPU / RAM stats
    try:
        raw_stats = container.stats(stream=False)
        mem_usage = raw_stats.get("memory_stats", {}).get("usage", 0)
        mem_limit = raw_stats.get("memory_stats", {}).get("limit", 1)
        cpu_delta = (
            raw_stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
            - raw_stats.get("precpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
        )
        system_delta = (
            raw_stats.get("cpu_stats", {}).get("system_cpu_usage", 0)
            - raw_stats.get("precpu_stats", {}).get("system_cpu_usage", 0)
        )
        cpu_percent = 0.0
        if system_delta > 0 and cpu_delta > 0:
            cpu_percent = (
                (cpu_delta / system_delta)
                * 100.0
                * len(
                    raw_stats.get("cpu_stats", {})
                    .get("cpu_usage", {})
                    .get("percpu_usage", [])
                    or [1]
                )
            )
        mem_usage_gb = round(mem_usage / (1024 ** 3), 2)
        mem_limit_gb = round(mem_limit / (1024 ** 3), 2)
        
        # ram_mb is the source of truth
        configured_mb = instance.get("ram_mb", 0) or 0
        configured_gb = round(configured_mb / 1024, 2)
        
        stats["ramTotal"] = configured_gb if configured_gb > 0 else mem_limit_gb
        stats["ramUsage"] = (
            min(mem_usage_gb, stats["ramTotal"]) if stats["ramTotal"] > 0 else mem_usage_gb
        )
        stats["cpuLoad"] = round(cpu_percent, 2)
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to read stats for %s: %s", instance_id, exc)

    # Players + latency from mcstatus Server List Ping
    max_from_props = _read_max_players_from_properties(server_dir_host)
    try:
        if running and status in {"ONLINE", "STARTING"}:
            ping_result = _ping_server_players(PING_HOST, instance.get("port", 25565))
            if ping_result is not None:
                stats["players"] = ping_result[0]
                stats["maxPlayers"] = ping_result[1]
                stats["latency"] = round(ping_result[2], 2)
            else:
                stats["players"] = 0
                stats["maxPlayers"] = max_from_props or 20
                stats["latency"] = None
        else:
            stats["players"] = 0
            stats["maxPlayers"] = max_from_props or 20
            stats["latency"] = None
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to ping server for %s: %s", instance_id, exc)

    # ----------------------------------------------------------------------
    # State transitions with a running / stopped container
    # ----------------------------------------------------------------------
    if not running:
        # Container exists but is not running -> OFFLINE (unless ERROR)
        if status != "ERROR":
            status = "OFFLINE"
    else:
        # Container is running
        if status == "STARTING":
            # Only promote to ONLINE once we see the Minecraft "Done (...)" line
            if _container_ready(container):
                status = "ONLINE"
            else:
                status = "STARTING"
        elif status in {"OFFLINE", "PREPARING"}:
            # Container somehow started without us marking STARTING -> treat as ONLINE
            status = "ONLINE"
        # If status is already ONLINE or ERROR, leave it as-is.

    instance["status"] = status
    upsert_instance(instance)
    return {"status": status, "stats": stats}


def tail_logs(instance_id: str, tail: int = 200) -> List[str]:
    instance = get_instance(instance_id)
    if not instance:
        return []
    # Always prefer buffered prep logs if present (covers PREPARING and early OFFLINE)
    with _log_lock:
        buf = _log_buffers.get(instance_id, [])
    logs: List[str] = list(buf)

    container = _container_for(instance)
    if container:
        try:
            raw = container.logs(tail=tail).decode("utf-8", errors="ignore")
            container_lines = [line for line in raw.splitlines() if not _should_hide_perf_line(line)]
            logs.extend(container_lines)
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to fetch logs for %s: %s", instance_id, exc)

    # Deduplicate consecutive duplicates and trim to requested tail size
    deduped: List[str] = []
    for line in logs:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    with _log_lock:
        _log_buffers[instance_id] = deduped[-2000:]

    return deduped[-tail:]


def send_command(instance_id: str, command: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")
    container = _container_for(instance)
    if not container:
        raise OrchestratorError("Container is not running")

    client = _docker_client()
    exec_id = client.api.exec_create(
        container.id,
        cmd=["/bin/sh", "-c", f"printf '{command}\\n' > /proc/1/fd/0"],
        stdin=False,
        tty=False,
    )
    client.api.exec_start(exec_id)
    return {"sent": True, "command": command}


def delete_instance(instance_id: str) -> None:
    instance = get_instance(instance_id)
    if not instance:
        return
    try:
        stop_instance(instance_id)
    except OrchestratorError:
        pass
    instance_dir = Path(instance.get("instance_dir", DATA_DIR / instance_id))
    server_dir_container, server_dir_host = _server_run_dirs(instance_id)
    for path in [instance_dir, server_dir_container, server_dir_host]:
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    with _log_lock:
        _log_buffers.pop(instance_id, None)
    remaining = [i for i in load_instances() if i.get("id") != instance_id]
    save_instances(remaining)
