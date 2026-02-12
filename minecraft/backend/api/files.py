"""API endpoints for instance file list/read/write."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request

from orchestrator.files_api import (
    OrchestratorError,
    delete_instance_file_or_dir,
    get_instance_files_or_content,
    write_instance_file,
)

router = APIRouter(
    prefix="/servers",
    tags=["servers"],
)

logger = logging.getLogger(__name__)


@router.get("/{instance_id}/files")
def api_get_files(
    instance_id: str,
    path: str = Query("", description="Relative path: '' for root, or 'server.properties' etc."),
) -> Dict[str, Any]:
    """
    GET /api/servers/{instance_id}/files?path=
    If path is a directory: returns {"files": [...], "dirs": [...]}.
    If path is a file: returns {"content": "..."}.
    """
    try:
        return get_instance_files_or_content(instance_id, path)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to get files for %s", instance_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/{instance_id}/files")
async def api_put_file(
    instance_id: str,
    request: Request,
    path: str = Query(..., description="Relative path to file, e.g. server.properties"),
) -> Dict[str, str]:
    """
    PUT /api/servers/{instance_id}/files?path=...
    Body: raw text content. Writes the file.
    """
    try:
        body = (await request.body()).decode("utf-8", errors="replace")
        write_instance_file(instance_id, path, body)
        return {"ok": "saved"}
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to write file for %s", instance_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{instance_id}/files")
def api_delete_file(
    instance_id: str,
    path: str = Query(..., description="Relative path to file or directory"),
) -> Dict[str, str]:
    """
    DELETE /api/servers/{instance_id}/files?path=...
    Deletes the file or directory at the given path.
    """
    try:
        delete_instance_file_or_dir(instance_id, path)
        return {"ok": "deleted"}
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to delete file for %s", instance_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
