from __future__ import annotations

from pathlib import Path
from typing import Dict

try:
    from ..schemas import CreateServerRequest
    from ..orchestrator import (
        OrchestratorError,
        create_instance,
        delete_instance,
        instance_status,
        load_instances,
        send_command,
        start_instance,
        stop_instance,
        tail_logs,
    )
    from .modpacks import resolve_server_file_url
except ImportError:  # script execution
    import sys

    CURRENT_DIR = Path(__file__).resolve().parent.parent
    sys.path.append(str(CURRENT_DIR))
    from schemas import CreateServerRequest  # type: ignore
    from orchestrator import (  # type: ignore
        OrchestratorError,
        create_instance,
        delete_instance,
        instance_status,
        load_instances,
        send_command,
        start_instance,
        stop_instance,
        tail_logs,
    )
    from services.modpacks import resolve_server_file_url  # type: ignore


def list_server_instances() -> Dict:
    return {"items": load_instances()}


def create_server_instance(req: CreateServerRequest) -> Dict:
    source_key = (req.source or "").strip().lower()
    if not source_key and req.project_id.isdigit():
        source_key = "curseforge"
    file_url = resolve_server_file_url(req.project_id, req.version_id, source_key or None)
    instance = create_instance(
        name=req.name,
        project_id=req.project_id,
        version_id=req.version_id,
        version_number=req.version_number,
        loader=req.loader,
        source=source_key or None,
        port=req.port,
        ram_gb=req.ram_gb,
        file_url=file_url,
    )
    return instance


__all__ = [
    "OrchestratorError",
    "create_server_instance",
    "delete_instance",
    "instance_status",
    "send_command",
    "start_instance",
    "stop_instance",
    "tail_logs",
    "list_server_instances",
]
