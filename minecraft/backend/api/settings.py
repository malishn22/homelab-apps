"""API endpoints for global settings."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request

from orchestrator.server_defaults import (
    DEFAULT_OPS_CONTENT,
    DEFAULT_TEMPLATE_CONTENT,
    DEFAULT_WHITELIST_CONTENT,
    get_defaults_path,
    get_ops_defaults_path,
    get_whitelist_defaults_path,
)

router = APIRouter(
    prefix="/settings",
    tags=["settings"],
)

logger = logging.getLogger(__name__)


@router.get("/server-defaults")
def api_get_server_defaults() -> Dict[str, Any]:
    """
    GET /api/settings/server-defaults
    Returns the raw content of the server-defaults template file.
    If file does not exist, returns default content without creating.
    """
    path = get_defaults_path()
    if path.exists() and path.is_file():
        content = path.read_text(encoding="utf-8", errors="replace")
        return {"content": content}
    return {"content": DEFAULT_TEMPLATE_CONTENT}


@router.put("/server-defaults")
async def api_put_server_defaults(request: Request) -> Dict[str, str]:
    """
    PUT /api/settings/server-defaults
    Body: raw text. Saves to the template file.
    """
    path = get_defaults_path()
    if path.exists() and path.is_dir():
        raise HTTPException(
            status_code=404,
            detail="Defaults path is a directory (mount may have failed). Expected a file.",
        )
    try:
        body = (await request.body()).decode("utf-8", errors="replace")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return {"ok": "saved"}
    except OSError as exc:
        logger.exception("Failed to write server-defaults")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/whitelist-defaults")
def api_get_whitelist_defaults() -> Dict[str, Any]:
    """
    GET /api/settings/whitelist-defaults
    Returns the raw content of the whitelist-defaults template file.
    If file does not exist, returns empty array.
    """
    path = get_whitelist_defaults_path()
    if path.exists() and path.is_file():
        content = path.read_text(encoding="utf-8", errors="replace")
        return {"content": content}
    return {"content": DEFAULT_WHITELIST_CONTENT}


@router.put("/whitelist-defaults")
async def api_put_whitelist_defaults(request: Request) -> Dict[str, str]:
    """
    PUT /api/settings/whitelist-defaults
    Body: raw JSON array. Saves to the template file.
    """
    path = get_whitelist_defaults_path()
    if path.exists() and path.is_dir():
        raise HTTPException(
            status_code=404,
            detail="Whitelist defaults path is a directory (mount may have failed). Expected a file.",
        )
    try:
        body = (await request.body()).decode("utf-8", errors="replace")
        data = json.loads(body)
        if not isinstance(data, list):
            raise HTTPException(status_code=400, detail="Whitelist must be a JSON array")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return {"ok": "saved"}
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    except OSError as exc:
        logger.exception("Failed to write whitelist-defaults")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/ops-defaults")
def api_get_ops_defaults() -> Dict[str, Any]:
    """
    GET /api/settings/ops-defaults
    Returns the raw content of the ops-defaults template file.
    If file does not exist, returns empty array.
    """
    path = get_ops_defaults_path()
    if path.exists() and path.is_file():
        content = path.read_text(encoding="utf-8", errors="replace")
        return {"content": content}
    return {"content": DEFAULT_OPS_CONTENT}


@router.put("/ops-defaults")
async def api_put_ops_defaults(request: Request) -> Dict[str, str]:
    """
    PUT /api/settings/ops-defaults
    Body: raw JSON array. Saves to the template file.
    """
    path = get_ops_defaults_path()
    if path.exists() and path.is_dir():
        raise HTTPException(
            status_code=404,
            detail="Ops defaults path is a directory (mount may have failed). Expected a file.",
        )
    try:
        body = (await request.body()).decode("utf-8", errors="replace")
        data = json.loads(body)
        if not isinstance(data, list):
            raise HTTPException(status_code=400, detail="Ops must be a JSON array")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return {"ok": "saved"}
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    except OSError as exc:
        logger.exception("Failed to write ops-defaults")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
