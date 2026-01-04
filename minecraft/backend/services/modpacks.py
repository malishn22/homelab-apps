from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Tuple

import requests

try:
    # Package import
    from ..config import (
        CURSEFORGE_API_KEY,
        CURSEFORGE_BASE_URL,
        MODRINTH_BASE_URL,
        MODRINTH_USER_AGENT,
    )
    from ..db import (
        init_db,
        save_modpacks,
        fetch_modpacks,
        count_modpacks,
        get_last_refresh,
        fetch_modpack_by_id,
    )
    from ..modrinth_client import (
        get_top_modpacks,
        get_modpack_detail,
        get_modpack_versions,
    )
except ImportError:  # script execution (python backend/services/modpacks.py)
    import sys

    CURRENT_DIR = Path(__file__).resolve().parent.parent
    sys.path.append(str(CURRENT_DIR))
    from config import (  # type: ignore
        CURSEFORGE_API_KEY,
        CURSEFORGE_BASE_URL,
        MODRINTH_BASE_URL,
        MODRINTH_USER_AGENT,
    )
    from db import (  # type: ignore
        init_db,
        save_modpacks,
        fetch_modpacks,
        count_modpacks,
        get_last_refresh,
        fetch_modpack_by_id,
    )
    from modrinth_client import (  # type: ignore
        get_top_modpacks,
        get_modpack_detail,
        get_modpack_versions,
    )


BASE_URL = MODRINTH_BASE_URL
USER_AGENT = MODRINTH_USER_AGENT


def refresh_modpack_cache(limit: int) -> Tuple[List[Dict], str]:
    """
    Fetch top modpacks from Modrinth and persist them into the local database.
    Returns (items, refreshed_at_iso).
    """
    items = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
    enriched_items: List[Dict] = []

    for item in items:
        project_id = item.get("project_id") or item.get("slug")
        if not project_id:
            continue
        try:
            detail = get_modpack_detail(
                base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
            )
            project_server_side = (detail.get("server_side") or "").lower()
            versions = get_modpack_versions(
                base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
            )
            server_versions: List[Dict] = []
            for ver in versions or []:
                ver_server_side = (ver.get("server_side") or "").lower()
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
                    and ver_server_side != "unsupported"
                    and len(server_files) > 0
                )
                server_versions.append(
                    {
                        "id": ver.get("id") or ver.get("version_id"),
                        "version_number": ver.get("version_number"),
                        "game_versions": ver.get("game_versions") or [],
                        "loaders": ver.get("loaders") or [],
                        "date_published": ver.get("date_published")
                        or ver.get("date_created"),
                        "server_supported": server_supported,
                        "files": server_files,
                        "server_side": ver_server_side,
                    }
                )
            item["server_versions"] = server_versions
            item["server_side"] = project_server_side
        except Exception:
            # If enrichment fails, fall back to original item
            item["server_versions"] = []
        enriched_items.append(item)

    items = enriched_items
    refreshed_at = datetime.now(timezone.utc).isoformat()
    save_modpacks(items, refreshed_at)
    return items, refreshed_at


def search_modrinth(query: str, limit: int = 5) -> None:
    url = f"{BASE_URL}/search"
    headers = {"User-Agent": USER_AGENT}
    params = {"query": query}
    resp = requests.get(url, headers=headers, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    print(f"Found {data.get('total_hits', 0)} results for '{query}':")
    for hit in data.get("hits", [])[:limit]:
        print(
            "-",
            hit.get("title"),
            "| slug:",
            hit.get("slug"),
            "| id:",
            hit.get("project_id"),
        )


def get_versions(slug: str):
    url = f"{BASE_URL}/project/{slug}/version"
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    return resp.json()


def show_latest_version(slug: str) -> None:
    versions = get_versions(slug)
    if not versions:
        print("No versions found for", slug)
        return

    latest = versions[0]  # Modrinth returns newest first
    version_number = latest.get("version_number")
    files = latest.get("files", [])
    download_url = files[0]["url"] if files else None

    print(f"Latest version for {slug}: {version_number}")
    print("Download URL:", download_url)


def print_top_modpacks(limit: int = 5) -> None:
    packs = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
    print(f"Top {len(packs)} modpacks on Modrinth (by downloads):")
    for p in packs:
        print(
            "-",
            p.get("title"),
            "| slug:",
            p.get("slug"),
            "| id:",
            p.get("project_id"),
            "| downloads:",
            p.get("downloads"),
        )


def _choose_best_file(files: list[dict]) -> Optional[dict]:
    server_files = [
        f for f in files if (f.get("env", {}).get("server") or "").lower() != "unsupported"
    ]
    if not server_files:
        return None

    def key_fn(f: dict):
        name = (f.get("filename") or "").lower()
        ext = name.split(".")[-1] if "." in name else ""
        return (
            0 if "server" in name else 1,
            0 if ext not in {"mrpack"} else 1,  # prefer non-mrpack server archives
            0 if f.get("primary") else 1,
            len(name),
        )

    return sorted(server_files, key=key_fn)[0]


def _resolve_curseforge_server_file_url(project_id: str, version_id: str) -> str:
    if not CURSEFORGE_BASE_URL or not CURSEFORGE_API_KEY:
        raise ValueError("CurseForge API is not configured.")
    try:
        mod_id = int(project_id)
        file_id = int(version_id)
    except ValueError:
        raise ValueError("CurseForge requires numeric mod_id and file_id.")

    resp = requests.get(
        f"{CURSEFORGE_BASE_URL}/mods/{mod_id}/files/{file_id}/download-url",
        headers={"x-api-key": CURSEFORGE_API_KEY},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    url = data.get("data")
    if not url:
        raise ValueError("CurseForge did not return a download URL.")
    return url


def resolve_server_file_url(
    project_id: str, version_id: str, source: Optional[str] = None
) -> str:
    """
    Find a server-capable file URL for the given project/version. Prefers files
    with "server" in the filename, non-mrpack server archives, or marked primary.
    """
    source_key = (source or "").strip().lower()
    if source_key == "curseforge":
        return _resolve_curseforge_server_file_url(project_id, version_id)
    if project_id.isdigit() and source_key != "modrinth":
        return _resolve_curseforge_server_file_url(project_id, version_id)

    cached = fetch_modpack_by_id(project_id)
    if cached and isinstance(cached.get("server_versions"), list):
        ver_match = next(
            (
                ver
                for ver in cached["server_versions"]
                if ver.get("id") == version_id
                or ver.get("version_number") == version_id
                or ver.get("date_published") == version_id
            ),
            None,
        )
        if ver_match:
            best = _choose_best_file(ver_match.get("files") or [])
            if best and best.get("url"):
                return best["url"]

    versions = get_modpack_versions(
        base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
    )
    match = next(
        (
            ver
            for ver in versions or []
            if ver.get("id") == version_id
            or ver.get("version_id") == version_id
            or ver.get("version_number") == version_id
        ),
        None,
    )
    if not match:
        raise ValueError("Version not found for modpack")

    server_side = (match.get("server_side") or "").lower()
    if server_side == "unsupported":
        raise ValueError("No server pack file available for this version")

    files = match.get("files", []) or []
    target = _choose_best_file(files)
    if not target or not target.get("url"):
        raise ValueError("No server pack file available for this version")
    return target["url"]
