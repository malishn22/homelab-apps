import json
import logging
import os
import shutil
import tarfile
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import threading
import time
import re

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
TPS_POLL_SECONDS = int(os.environ.get("MINECRAFT_TPS_POLL_SECONDS", "30"))

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
        mc_version = _parse_minecraft_version(instance.get("version_number"))
    if not mc_version:
        mc_version = detect_minecraft_version_from_root(server_dir, source=source)
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


def _parse_tps_from_logs(raw: str) -> Optional[float]:
    lines = raw.splitlines()
    tps_from_re = re.compile(r"tps from last[^:]*:\s*([0-9]+(?:\.[0-9]+)?)", re.I)
    tps_re = re.compile(r"tps:\s*([0-9]+(?:\.[0-9]+)?)", re.I)

    for line in reversed(lines):
        match = tps_from_re.search(line)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
        match = tps_re.search(line)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
    return None


def _parse_tick_time_from_logs(raw: str) -> Optional[float]:
    lines = raw.splitlines()
    overall_re = re.compile(r"overall\s*:\s*mean tick time:\s*([0-9]+(?:\.[0-9]+)?)\s*ms", re.I)
    generic_re = re.compile(r"mean tick time:\s*([0-9]+(?:\.[0-9]+)?)\s*ms", re.I)
    best: Optional[float] = None

    for line in reversed(lines):
        match = overall_re.search(line)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
        match = generic_re.search(line)
        if match and best is None:
            try:
                best = float(match.group(1))
            except ValueError:
                continue
    return best


def _should_hide_perf_line(line: str) -> bool:
    lower = line.lower()
    return "mean tick time" in lower and "mean tps" in lower


def _should_poll_tps(instance: Dict, server_dir: Path) -> bool:
    loader = (instance.get("loader") or "").lower()
    if "forge" in loader or "neoforge" in loader:
        return True
    if (server_dir / "libraries" / "net" / "minecraftforge" / "forge").exists():
        return True
    if any(server_dir.glob("forge-*.jar")):
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


def _sync_extract_to_server(extract_dir: Path, server_dir: Path) -> None:
    if server_dir.exists():
        shutil.rmtree(server_dir)
    shutil.copytree(extract_dir, server_dir)


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
        "instance_dir": str(DATA_DIR / instance_id),
        "extract_dir": str((DATA_DIR / instance_id) / "server"),
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

    extract_dir = Path(instance["extract_dir"])
    server_dir_container, server_dir_host = _server_run_dirs(instance_id)

    source_key = (instance.get("source") or "").strip().lower()
    mod_id = instance.get("project_id")
    file_id = instance.get("version_id")
    version_hint = instance.get("version_number")
    try:
        mod_id_int = int(mod_id) if mod_id is not None else None
    except (TypeError, ValueError):
        mod_id_int = None
    try:
        file_id_int = int(file_id) if file_id is not None else None
    except (TypeError, ValueError):
        file_id_int = None
    _sync_extract_to_server(extract_dir, server_dir_container)

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
    }
    image = _select_java_image(instance, server_dir_container, source_key, instance_id)

    _log_line(instance_id, "[INFO] Starting server container…")
    try:
        container = client.containers.run(
            image=image,
            name=instance["container_name"],
            command=cmd,
            working_dir="/data",
            environment=env,
            ports={"25565/tcp": port},
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
                "tps": None,
                "tickTimeMs": None,
            },
        }

    status = instance.get("status", "OFFLINE")
    stats = {
        "ramUsage": 0,
        "ramTotal": round((instance.get("ram_mb", 0) or 0) / 1024, 2),
        "cpuLoad": 0.0,
        "tps": None,
        "tickTimeMs": None,
    }
    server_dir_container, _ = _server_run_dirs(instance_id)

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

    # TPS (optional): poll via console command and parse logs
    try:
        now = time.time()
        last_tps_at = instance.get("last_tps_at", 0) or 0
        last_request_at = instance.get("last_tps_request_at", 0) or 0
        last_tick_at = instance.get("last_tick_time_at", 0) or 0
        if running and status in {"ONLINE", "STARTING"} and _should_poll_tps(instance, server_dir_container):
            if now - last_request_at >= TPS_POLL_SECONDS:
                tps_cmd = "forge tps" if "forge" in (instance.get("loader") or "").lower() else "tps"
                _send_container_command(container, tps_cmd)
                instance["last_tps_request_at"] = now
                upsert_instance(instance)
            raw_logs = container.logs(tail=200).decode("utf-8", errors="ignore")
            parsed_tps = _parse_tps_from_logs(raw_logs)
            parsed_tick = _parse_tick_time_from_logs(raw_logs)
            if parsed_tps is not None:
                instance["last_tps"] = parsed_tps
                instance["last_tps_at"] = now
                upsert_instance(instance)
            if parsed_tick is not None:
                instance["last_tick_time_ms"] = parsed_tick
                instance["last_tick_time_at"] = now
                upsert_instance(instance)
        stats["tps"] = instance.get("last_tps")
        stats["tickTimeMs"] = instance.get("last_tick_time_ms")
        if last_tps_at and now - last_tps_at > max(TPS_POLL_SECONDS * 2, 120):
            stats["tps"] = None
        if last_tick_at and now - last_tick_at > max(TPS_POLL_SECONDS * 2, 120):
            stats["tickTimeMs"] = None
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to read TPS for %s: %s", instance_id, exc)

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

    # TPS: only 20 when fully ONLINE and running
    if stats.get("tps") is None:
        stats["tps"] = None

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
