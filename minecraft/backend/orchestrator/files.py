import logging
import os
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .state import OrchestratorError, _log_line
from .providers.factory import get_provider

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
    """
    instance_dir = DATA_DIR / instance_id
    extract_dir = instance_dir / "server"
    
    # Provider handles hydration
    provider = get_provider(source, instance_id, instance_dir)
    server_root, mc_version = provider.install_server_pack(
        project_id,
        version_id,
        file_url,
        instance_dir,
        extract_dir
    )
    
    # Provider detects start command
    try:
        command, entry_target = provider.generate_start_command(
            server_root,
            ram_mb,
            project_id=project_id,
            version_id=version_id,
            version_hint=None # We could parse hint from file_url if needed
        )
    except Exception as exc:
        log.warning("Start command detection failed for %s: %s", instance_id, exc)
        _log_line(instance_id, f"[FAIL] Could not detect start command: {exc}")
        # Fallback to manual start? Or just error out?
        # Original code raised, so we keep raising
        raise OrchestratorError(f"Could not detect start command: {exc}") from exc

    return {
        "instance_dir": str(instance_dir),
        "extract_dir": str(server_root),
        "archive_path": "", # Deprecated/handled by provider
        "entry_target": entry_target,
        "start_command": command,
        "minecraft_version": mc_version,
    }

# Retain helper for legacy external imports if needed, though they shouldn't be used
def _strip_client_only_mods(root: Path, instance_id: Optional[str] = None) -> None:
    # Moved to ModrinthProvider but keeping for compatibility if any other module imports it
    pass 
