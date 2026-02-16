"""High-level server lifecycle: create, start, stop, restart, update, delete, send_command."""

import logging
import os
import shutil
import threading
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .state import (
    OrchestratorError,
    load_instances,
    save_instances,
    upsert_instance,
    get_instance,
    _log_line,
    _log_buffers,
    _log_lock,
    _hydrate_semaphore,
    _state_lock,
)
from .files import prepare_instance_files
from .providers.factory import get_provider
from .server_defaults import apply_server_defaults, apply_whitelist_defaults, apply_ops_defaults
from .enums import ServerStatus
from .java import is_legacy_jvm_args, select_java_image, wrap_command_for_java
from .container import docker_client, get_container
from .monitor import read_max_players_from_properties

log = logging.getLogger(__name__)

# Per-instance cancel flags
_cancel_lock = threading.Lock()
_cancel_flags: Dict[str, bool] = {}

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_INSTANCES_ROOT = CONTAINER_DATA_ROOT / "instances"
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"
HOST_SERVERS_ROOT = Path(os.environ.get("HOST_SERVERS_ROOT", "/data/servers"))
DATA_DIR = CONTAINER_INSTANCES_ROOT


def _server_run_dirs(instance_id: str) -> Tuple[Path, Path]:
    return CONTAINER_SERVERS_ROOT / instance_id, HOST_SERVERS_ROOT / instance_id


def _set_status(instance: Dict, status: str) -> Dict:
    instance["status"] = status
    upsert_instance(instance)
    return instance


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
    """Create a new server instance and begin async file hydration."""
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
        "status": ServerStatus.PREPARING,
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
                    project_id, version_id, file_url, ram_mb, instance_id, source=source,
                )
                instance.update(prepared)
                _set_status(instance, ServerStatus.OFFLINE)
                _log_line(instance_id, "[SUCCESS] Completed. Ready to start.")
            except Exception as exc:
                _set_status(instance, ServerStatus.ERROR)
                _log_line(instance_id, f"[PREP] Failed: {exc}")

    threading.Thread(target=_hydrate_task, daemon=True).start()
    return instance


def start_instance(instance_id: str) -> Dict:
    """Start the Docker container for an instance."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    client = docker_client()
    container = get_container(instance)
    if container and container.status == "running":
        return {"status": ServerStatus.ONLINE}

    server_dir_container, server_dir_host = _server_run_dirs(instance_id)
    source_key = (instance.get("source") or "").strip().lower()
    mod_id = instance.get("project_id")
    file_id = instance.get("version_id")
    version_hint = instance.get("version_number")

    # Migration: one-time copy from old extract_dir to server_dir
    extract_dir_from_state = instance.get("extract_dir")
    if extract_dir_from_state:
        extract_path = Path(extract_dir_from_state)
        if extract_path != server_dir_container and extract_path.exists():
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

    eula_file = server_dir_container / "eula.txt"
    if not eula_file.exists():
        eula_file.write_text("eula=true\n")

    ram_mb = instance.get("ram_mb", 4096)

    jvm_args = server_dir_container / "user_jvm_args.txt"
    if source_key == "curseforge":
        if jvm_args.exists():
            try:
                if is_legacy_jvm_args(jvm_args.read_text()):
                    jvm_args.write_text("")
                    _log_line(instance_id, "[PREP] Cleared user_jvm_args.txt defaults")
            except Exception:
                pass
        else:
            jvm_args.write_text("")
            _log_line(instance_id, "[PREP] Created user_jvm_args.txt")

    try:
        provider = get_provider(source_key, instance_id, server_dir_container)
        cmd, entry_target = provider.generate_start_command(
            server_dir_container, ram_mb,
            project_id=mod_id, version_id=file_id, version_hint=version_hint,
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
    image = select_java_image(instance, server_dir_container, source_key, instance_id)
    cmd = wrap_command_for_java(cmd)

    with _cancel_lock:
        if _cancel_flags.pop(instance_id, False):
            _log_line(instance_id, "[INFO] Start cancelled by user.")
            raise OrchestratorError("Start cancelled")

    _log_line(instance_id, "[INFO] Starting server container...")
    try:
        client.images.pull(image)
    except Exception as exc:
        log.warning("Failed to pull image %s: %s", image, exc)
        raise OrchestratorError(f"Failed to pull Java image {image}: {exc}") from exc

    with _cancel_lock:
        if _cancel_flags.pop(instance_id, False):
            _log_line(instance_id, "[INFO] Start cancelled by user.")
            raise OrchestratorError("Start cancelled")

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

    _set_status(instance, ServerStatus.STARTING)
    return {"status": ServerStatus.STARTING, "container_id": container.id}


def stop_instance(instance_id: str) -> Dict:
    """Stop the Docker container for an instance."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    was_restarting = instance.get("status") == ServerStatus.RESTARTING

    with _cancel_lock:
        _cancel_flags[instance_id] = True

    container = get_container(instance)
    if container:
        try:
            _set_status(instance, ServerStatus.STOPPING)
            container.stop(timeout=20)
            container.remove()
        except Exception as exc:
            log.warning("Failed to stop container %s: %s", instance_id, exc)
        with _cancel_lock:
            _cancel_flags.pop(instance_id, None)

    if was_restarting:
        _set_status(instance, ServerStatus.RESTARTING)
        return {"status": ServerStatus.RESTARTING}
    _set_status(instance, ServerStatus.OFFLINE)
    return {"status": ServerStatus.OFFLINE}


def restart_instance(instance_id: str) -> Dict:
    """Stop then start an instance."""
    instance = get_instance(instance_id)
    if instance:
        _set_status(instance, ServerStatus.RESTARTING)
    stop_instance(instance_id)
    with _cancel_lock:
        _cancel_flags.pop(instance_id, None)
    return start_instance(instance_id)


def _patch_server_properties_max_players(server_dir: Path, max_players: int) -> None:
    """Update or add max-players in server.properties."""
    props_path = server_dir / "server.properties"
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
    """Update instance fields (name, port, max_players, ram_mb)."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    ram_mb_new = payload.get("ram_mb")
    ram_mb_current = instance.get("ram_mb")
    if ram_mb_new is not None and ram_mb_new != ram_mb_current:
        container = get_container(instance)
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


def send_command(instance_id: str, command: str) -> Dict:
    """Send a console command to a running server."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")
    container = get_container(instance)
    if not container:
        raise OrchestratorError("Container is not running")

    client = docker_client()
    exec_id = client.api.exec_create(
        container.id,
        cmd=["/bin/sh", "-c", f"printf '{command}\\n' > /proc/1/fd/0"],
        stdin=False,
        tty=False,
    )
    client.api.exec_start(exec_id)
    return {"sent": True, "command": command}


def delete_instance(instance_id: str) -> None:
    """Delete an instance, its container, and all files."""
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
    with _state_lock:
        remaining = [i for i in load_instances() if i.get("id") != instance_id]
        save_instances(remaining)
