import logging
import os
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .state import OrchestratorError, _log_line
from .providers.factory import get_provider
from .server_defaults import apply_server_defaults, apply_whitelist_defaults, apply_ops_defaults

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_INSTANCES_ROOT = CONTAINER_DATA_ROOT / "instances"
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"

DATA_DIR = CONTAINER_INSTANCES_ROOT

def prepare_instance_files(
    project_id: str,
    version_id: str,
    file_url: str,
    ram_mb: int,
    instance_id: str,
    source: Optional[str] = None,
) -> Dict:
    """
    Download and extract the server pack for an instance, delegating to the appropriate Provider.
    Extracts directly into server_dir (single directory for extract + runtime).
    """
    server_dir = CONTAINER_SERVERS_ROOT / instance_id
    server_dir.mkdir(parents=True, exist_ok=True)

    provider = get_provider(source, instance_id, server_dir)
    server_root, mc_version = provider.install_server_pack(
        project_id,
        version_id,
        file_url,
        server_dir,
    )
    apply_server_defaults(server_root, instance_id)
    apply_whitelist_defaults(server_root, instance_id)
    apply_ops_defaults(server_root, instance_id)

    try:
        command, entry_target = provider.generate_start_command(
            server_root,
            ram_mb,
            project_id=project_id,
            version_id=version_id,
            version_hint=None,
        )
    except Exception as exc:
        log.warning("Start command detection failed for %s: %s", instance_id, exc)
        _log_line(instance_id, f"[FAIL] Could not detect start command: {exc}")
        raise OrchestratorError(f"Could not detect start command: {exc}") from exc

    return {
        "instance_dir": str(server_dir),
        "extract_dir": str(server_dir),
        "archive_path": "",
        "entry_target": entry_target,
        "start_command": command,
        "minecraft_version": mc_version,
    }
