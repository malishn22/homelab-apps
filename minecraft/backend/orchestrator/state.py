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

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_INSTANCES_ROOT = CONTAINER_DATA_ROOT / "instances"
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"

HOST_SERVERS_ROOT = Path(os.environ.get("HOST_SERVERS_ROOT", "/data/servers"))

DATA_DIR = CONTAINER_INSTANCES_ROOT
STATE_FILE = DATA_DIR / "instances.json"

_log_buffers: Dict[str, List[str]] = {}
_log_lock = threading.Lock()
_hydrate_semaphore = threading.Semaphore(2)  # limit concurrent hydrations to a reasonable level


class OrchestratorError(Exception):
    """Base error for orchestrator failures."""


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.touch(exist_ok=True)
    if not STATE_FILE.read_text().strip():
        STATE_FILE.write_text("[]")


def load_instances() -> List[Dict]:
    ensure_dirs()
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return []


def save_instances(instances: List[Dict]) -> None:
    ensure_dirs()
    STATE_FILE.write_text(json.dumps(instances, indent=2))


def upsert_instance(instance: Dict) -> Dict:
    instances = load_instances()
    filtered = [i for i in instances if i.get("id") != instance.get("id")]
    filtered.append(instance)
    save_instances(filtered)
    return instance


def get_instance(instance_id: str) -> Optional[Dict]:
    return next((i for i in load_instances() if i.get("id") == instance_id), None)


def _log_line(instance_id: str, message: str) -> None:
    with _log_lock:
        buf = _log_buffers.get(instance_id, [])
        buf.append(message)
        _log_buffers[instance_id] = buf[-2000:]
