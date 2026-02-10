from __future__ import annotations

from typing import Dict

import requests
from fastapi import APIRouter, HTTPException

from services.modpack_search import (
    get_modpack_detail_cached,
    get_modpack_server_files,
    search_modpacks,
)

router = APIRouter(
    prefix="/modpacks",
    tags=["modpacks"],
)


@router.get("/search")
def api_search_modpacks(
    query: str = "",
    page: int = 0,
    limit: int = 20,
    sort: str = "relevance",
    sources: str = "modrinth",
    force: bool = False,
) -> Dict:
    """
    Proxy to modpack sources with small TTL caching.
    Only fetches modpacks (project_type=modpack / classId=modpacks).
    """
    try:
        response = search_modpacks(
            query=query,
            page=page,
            limit=limit,
            sort=sort,
            sources=sources,
            force=force,
        )
        if not response.get("hits") and response.get("errors"):
            raise HTTPException(
                status_code=502,
                detail={"message": "All sources failed.", "errors": response["errors"]},
            )
        return response
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modpack search error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}")
def api_get_modpack_detail(project_id: str) -> Dict:
    """Modrinth project detail with small TTL cache."""
    try:
        return get_modpack_detail_cached(project_id)
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/server-files")
def api_get_modpack_server_files(
    project_id: str, source: str = "modrinth", force: bool = False
) -> Dict:
    """
    GET /api/modpacks/{project_id}/server-files
    Used when creating a server to resolve a server-capable file.
    Returns {"available": bool, "versions": [...]}; defensive, never unhandled exceptions.
    """
    try:
        return get_modpack_server_files(
            project_id=project_id,
            source=source,
            force=force,
        )
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
