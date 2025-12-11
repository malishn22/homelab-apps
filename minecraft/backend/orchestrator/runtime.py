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
from .files import (
    prepare_instance_files,
    _detect_start_command,
    _strip_client_only_mods,
)

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
    *, name: str, project_id: str, version_id: str, version_number: Optional[str], loader: Optional[str], port: int, ram_gb: int, file_url: str
) -> Dict:
    instance_id = f"srv-{uuid.uuid4().hex[:8]}"
    instance = {
        "id": instance_id,
        "name": name,
        "project_id": project_id,
        "version_id": version_id,
        "version_number": version_number,
        "loader": loader,
        "port": port,
        "ram_gb": ram_gb,
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
                prepared = prepare_instance_files(project_id, version_id, file_url, ram_gb, instance_id)
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
    return "done (" in raw and 'for help, type "help"' in raw


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

    # Re-run client-only strip in case patterns were updated after initial hydration
    _strip_client_only_mods(extract_dir, instance_id=instance_id)
    _sync_extract_to_server(extract_dir, server_dir_container)

    # Auto-accept EULA right before start if it's missing
    eula_file = server_dir_container / "eula.txt"
    if not eula_file.exists():
        eula_file.write_text("eula=true\n")

    ram_gb = instance.get("ram_gb", 4)

    try:
        cmd, entry_target = _detect_start_command(
            server_dir_container, ram_gb, instance_id=instance_id
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
        "INIT_MEMORY": f"{ram_gb}G",
        "MAX_MEMORY": f"{ram_gb}G",
    }

    _log_line(instance_id, "[INFO] Starting server container…")
    try:
        container = client.containers.run(
            image="eclipse-temurin:17-jre",
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
            "stats": {"ramUsage": 0, "ramTotal": 0, "cpuLoad": 0.0, "tps": 0.0},
        }

    status = instance.get("status", "OFFLINE")
    stats = {
        "ramUsage": 0,
        "ramTotal": instance.get("ram_gb", 0),
        "cpuLoad": 0.0,
        "tps": 0.0,
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
        stats["ramUsage"] = round(mem_usage / (1024 ** 3), 2)
        stats["ramTotal"] = round(mem_limit / (1024 ** 3), 2)
        stats["cpuLoad"] = round(cpu_percent, 2)
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to read stats for %s: %s", instance_id, exc)

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
            try:
                raw_logs = container.logs(tail=200).decode("utf-8", errors="ignore").lower()
                if "done (" in raw_logs:
                    status = "ONLINE"
                else:
                    status = "STARTING"
            except Exception as exc:  # pragma: no cover
                log.warning("Failed to check logs for %s: %s", instance_id, exc)
                status = "STARTING"
        elif status in {"OFFLINE", "PREPARING"}:
            # Container somehow started without us marking STARTING -> treat as ONLINE
            status = "ONLINE"
        # If status is already ONLINE or ERROR, leave it as-is.

    # TPS: only 20 when fully ONLINE and running
    stats["tps"] = 20.0 if running and status == "ONLINE" else 0.0

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
            container_lines = raw.splitlines()
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
