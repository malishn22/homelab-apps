from __future__ import annotations

from typing import Dict

from schemas import CreateServerRequest, UpdateServerRequest
from orchestrator import (
    OrchestratorError,
    create_instance,
    delete_instance,
    instance_status,
    load_instances,
    restart_instance,
    send_command,
    start_instance,
    stop_instance,
    tail_logs,
    update_instance,
)
from services.modpacks import resolve_server_file_url


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
        ram_mb=req.ram_mb,
        file_url=file_url,
    )
    return instance


def update_server_instance(instance_id: str, req: UpdateServerRequest) -> Dict:
    payload = req.model_dump(exclude_none=True)
    return update_instance(instance_id, payload)


__all__ = [
    "OrchestratorError",
    "create_server_instance",
    "delete_instance",
    "instance_status",
    "list_server_instances",
    "restart_instance",
    "send_command",
    "start_instance",
    "stop_instance",
    "tail_logs",
    "update_server_instance",
]
