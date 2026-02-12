from __future__ import annotations

from typing import Optional, List, Dict

import requests

from config import (
    CURSEFORGE_API_KEY,
    CURSEFORGE_BASE_URL,
    MODRINTH_BASE_URL,
    MODRINTH_USER_AGENT,
)
from modrinth_client import get_modpack_versions


BASE_URL = MODRINTH_BASE_URL
USER_AGENT = MODRINTH_USER_AGENT


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
