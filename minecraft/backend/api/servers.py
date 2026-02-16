from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from schemas import CreateServerRequest, CommandRequest, UpdateServerRequest
from services.servers import (
    OrchestratorError,
    create_server_instance,
    delete_instance,
    instance_status,
    list_server_instances,
    restart_instance,
    send_command,
    start_instance,
    stop_instance,
    tail_logs,
    update_server_instance,
)

router = APIRouter(
    prefix="/servers",  # final path: /api/servers/...
    tags=["servers"],
)

logger = logging.getLogger(__name__)


@router.get("")
def api_list_servers() -> Dict:
    """
    GET /api/servers
    Returns list of all instances and their statuses.
    """
    return list_server_instances()


@router.post("")
def api_create_server(req: CreateServerRequest) -> Dict:
    """
    POST /api/servers
    Body: CreateServerRequest
    Creates a new server instance and kicks off PREP (download mods, etc.)
    """
    try:
        instance = create_server_instance(req)
        return instance
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to create server instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{instance_id}")
def api_instance_status(instance_id: str) -> Dict:
    """
    GET /api/servers/{instance_id}
    Used by UI to poll instance status.
    """
    try:
        return instance_status(instance_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to get instance status")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{instance_id}/status")
def api_instance_status_alias(instance_id: str) -> Dict:
    """
    GET /api/servers/{instance_id}/status
    Alias for the main status endpoint to match the frontend's URL.
    """
    return api_instance_status(instance_id)


@router.delete("/{instance_id}")
def api_delete_instance(instance_id: str) -> Dict:
    """
    DELETE /api/servers/{instance_id}
    Delete instance directory + container.

    Idempotent by design:
    - If the instance is missing, still return {"ok": True}
    - UI should treat deletion as success even if it was already gone.
    """
    try:
        delete_instance(instance_id)
        return {"ok": True}
    except FileNotFoundError:
        # Already gone -> treat as success
        return {"ok": True}
    except OrchestratorError:
        # Also treat orchestrator "not found" etc. as success, to keep it idempotent
        return {"ok": True}
    except Exception as exc:
        logger.exception("Failed to delete instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{instance_id}/delete")
def api_delete_instance_alias(instance_id: str) -> Dict:
    """
    POST /api/servers/{instance_id}/delete
    Alias for delete to match frontend if it uses POST instead of DELETE.
    """
    return api_delete_instance(instance_id)


@router.patch("/{instance_id}")
@router.put("/{instance_id}")
def api_update_instance(instance_id: str, req: UpdateServerRequest) -> Dict:
    """
    PATCH/PUT /api/servers/{instance_id}
    Update instance settings (name, port, max_players, ram_mb).
    If ram_mb changes and server is running, it is stopped first.
    """
    try:
        return update_server_instance(instance_id, req)
    except OrchestratorError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to update instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{instance_id}/start")
def api_start_instance(instance_id: str) -> Dict:
    """
    POST /api/servers/{instance_id}/start
    """
    try:
        return start_instance(instance_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to start instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{instance_id}/stop")
def api_stop_instance(instance_id: str) -> Dict:
    """
    POST /api/servers/{instance_id}/stop
    """
    try:
        return stop_instance(instance_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to stop instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{instance_id}/restart")
def api_restart_instance(instance_id: str) -> Dict:
    """
    POST /api/servers/{instance_id}/restart
    Stop the instance, then start it. Atomic restart operation.
    """
    try:
        return restart_instance(instance_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to restart instance")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{instance_id}/command")
def api_send_command(instance_id: str, req: CommandRequest) -> Dict:
    """
    POST /api/servers/{instance_id}/command
    Body: CommandRequest { command: str }
    """
    try:
        return send_command(instance_id, req.command)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to send command")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{instance_id}/logs")
def api_tail_logs(
    instance_id: str,
    lines: int = Query(200, ge=1, le=2000),
) -> Dict:
    """
    GET /api/servers/{instance_id}/logs?lines=200
    Returns the last N lines from console.log. If the file doesn't exist
    yet (PREP phase), just return an empty list so the UI doesn't explode.
    """
    try:
        content = tail_logs(instance_id, lines)
        return {"lines": content}
    except FileNotFoundError:
        return {"lines": []}
    except OrchestratorError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to tail logs")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{instance_id}/events")
async def api_server_events(instance_id: str, request: Request):
    """
    GET /api/servers/{instance_id}/events
    Server-Sent Events (SSE) endpoint that pushes status, stats, and log
    updates every 2-3 seconds. The client uses EventSource to subscribe.

    Event types:
      - "status"  : { status, stats }
      - "logs"    : { lines: string[] }
    """

    async def event_generator():
        last_log_count = 0
        last_status = None

        while True:
            if await request.is_disconnected():
                break

            try:
                status_data = instance_status(instance_id)
                current_status = status_data.get("status")

                if current_status != last_status:
                    yield f"event: status\ndata: {json.dumps(status_data)}\n\n"
                    last_status = current_status
                else:
                    yield f"event: status\ndata: {json.dumps(status_data)}\n\n"

                log_lines = tail_logs(instance_id, 200)
                if len(log_lines) != last_log_count:
                    new_lines = log_lines[last_log_count:] if last_log_count < len(log_lines) else log_lines[-50:]
                    yield f"event: logs\ndata: {json.dumps({'lines': new_lines})}\n\n"
                    last_log_count = len(log_lines)

            except Exception as exc:
                logger.warning("SSE error for %s: %s", instance_id, exc)
                yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"

            await asyncio.sleep(2.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
