
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import requests
from fastapi import APIRouter, HTTPException, Query

# Import config, DB, and Modrinth client in a way that works both
# as a package (backend.api.modpacks) and flat layout (/app)
try:
    from ..config import MODRINTH_BASE_URL, MODRINTH_USER_AGENT
    from ..db import (
        fetch_modpacks,
        save_modpacks,
        count_modpacks,
        get_last_refresh,
        fetch_modpack_by_id,
    )
    from ..modrinth_client import (
        get_top_modpacks,
        get_modpack_detail,
        get_modpack_versions,
    )
except ImportError:
    import sys

    BASE_DIR = Path(__file__).resolve().parent.parent  # /app
    if str(BASE_DIR) not in sys.path:
        sys.path.append(str(BASE_DIR))

    from config import MODRINTH_BASE_URL, MODRINTH_USER_AGENT  # type: ignore
    from db import (  # type: ignore
        fetch_modpacks,
        save_modpacks,
        count_modpacks,
        get_last_refresh,
        fetch_modpack_by_id,
    )
    from modrinth_client import (  # type: ignore
        get_top_modpacks,
        get_modpack_detail,
        get_modpack_versions,
    )


router = APIRouter(
    prefix="/modpacks",  # final path: /api/modpacks/...
    tags=["modpacks"],
)

BASE_URL = MODRINTH_BASE_URL
USER_AGENT = MODRINTH_USER_AGENT


def _refresh_modpack_cache(limit: int) -> Dict[str, object]:
    """
    Fetch top modpacks from Modrinth and persist them into the local database.
    Simple version: no extra enrichment, so we don't break basic flows.
    """
    items = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
    refreshed_at = datetime.now(timezone.utc).isoformat()
    save_modpacks(items, refreshed_at)
    return {"items": items, "refreshed_at": refreshed_at}


@router.get("/top")
def api_get_top_modpacks(
    limit: int = Query(5, ge=1, le=100),
) -> Dict[str, object]:
    """
    GET /api/modpacks/top?limit=100
    Used by the frontend for the modpack list.
    """
    try:
        items = fetch_modpacks(limit)
        refreshed_at = get_last_refresh()

        # First boot: DB empty -> hit Modrinth and cache
        if not items and count_modpacks() == 0:
            refreshed = _refresh_modpack_cache(limit)
            items = refreshed["items"]  # type: ignore[assignment]
            refreshed_at = refreshed["refreshed_at"]  # type: ignore[assignment]

        return {
            "items": items,
            "count": len(items),
            "refreshed_at": refreshed_at,
        }
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.api_route("/refresh", methods=["POST", "GET"])
def api_refresh_modpacks(
    limit: int = Query(25, ge=1, le=100),
) -> Dict[str, object]:
    """
    POST /api/modpacks/refresh  (or GET for convenience)
    Forces a re-fetch from Modrinth and updates the DB.
    """
    try:
        refreshed = _refresh_modpack_cache(limit)
        items = fetch_modpacks(limit)
        return {
            "items": items,
            "count": len(items),
            "refreshed_at": refreshed["refreshed_at"],
        }
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}")
def api_get_modpack_detail(project_id: str) -> Dict:
    """
    GET /api/modpacks/{project_id}
    Pass-through to Modrinth for individual project details.
    """
    try:
        data = get_modpack_detail(
            base_url=BASE_URL,
            user_agent=USER_AGENT,
            project_id=project_id,
        )
        return data
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/server-files")
def api_get_modpack_server_files(project_id: str) -> Dict:
    """
    GET /api/modpacks/{project_id}/server-files
    Used when creating a server so we can resolve a server-capable file.
    This version is defensive: always returns a JSON object and never throws
    unhandled exceptions; if nothing is found we just say "available: false".
    """
    try:
        cached = fetch_modpack_by_id(project_id)
        if cached and isinstance(cached.get("server_versions"), list):
            version_entries: List[Dict] = cached["server_versions"]
            available = any(v.get("server_supported") for v in version_entries)
            return {"available": available, "versions": version_entries}

        # Fallback: live fetch from Modrinth
        project_detail = get_modpack_detail(
            base_url=BASE_URL,
            user_agent=USER_AGENT,
            project_id=project_id,
        )
        project_server_side = (project_detail.get("server_side") or "").lower()
        versions = get_modpack_versions(
            base_url=BASE_URL,
            user_agent=USER_AGENT,
            project_id=project_id,
        )

        version_entries: List[Dict] = []
        for ver in versions or []:
            server_side = (ver.get("server_side") or "").lower()
            files = ver.get("files", []) or []

            server_files = [
                {
                    "filename": f.get("filename"),
                    "url": f.get("url"),
                }
                for f in files
                if (f.get("env", {}).get("server") or "").lower() != "unsupported"
                and ("server" in (f.get("filename", "").lower()) or f.get("primary"))
            ]

            server_supported = (
                project_server_side != "unsupported"
                and server_side != "unsupported"
                and len(server_files) > 0
            )

            version_entries.append(
                {
                    "id": ver.get("id") or ver.get("version_id"),
                    "version_number": ver.get("version_number"),
                    "game_versions": ver.get("game_versions") or [],
                    "loaders": ver.get("loaders") or [],
                    "date_published": ver.get("date_published")
                    or ver.get("date_created"),
                    "server_supported": server_supported,
                    "files": server_files,
                }
            )

        available = any(v.get("server_supported") for v in version_entries)
        return {"available": available, "versions": version_entries}
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

