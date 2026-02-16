"""Docker container operations: client, lookup, readiness detection."""

import logging
from typing import Dict, Optional

import docker
from docker.errors import NotFound as DockerNotFound

from .state import OrchestratorError

log = logging.getLogger(__name__)


def docker_client() -> docker.DockerClient:
    """Create a Docker client from the environment."""
    try:
        return docker.from_env()
    except Exception as exc:
        raise OrchestratorError(f"Docker client error: {exc}") from exc


def get_container(instance: Dict):
    """Look up the Docker container for an instance. Returns None if not found."""
    client = docker_client()
    try:
        return client.containers.get(instance["container_name"])
    except DockerNotFound:
        return None


def container_ready(container) -> bool:
    """
    Return True if server logs show the typical 'Done (...)! For help, type "help"' line.
    Covers vanilla / Forge / Fabric / ModernFix startup messages.
    """
    try:
        raw = container.logs(tail=200).decode("utf-8", errors="ignore").lower()
    except Exception:
        return False
    if "done (" in raw and 'for help, type "help"' in raw:
        return True
    if "dedicated server took" in raw and "seconds to load" in raw:
        return True
    return False


def send_container_command(container, command: str) -> None:
    """Send a command to the server process via stdin."""
    client = docker_client()
    exec_id = client.api.exec_create(
        container.id,
        cmd=["/bin/sh", "-c", f"printf '{command}\\n' > /proc/1/fd/0"],
        stdin=False,
        tty=False,
    )
    client.api.exec_start(exec_id)
