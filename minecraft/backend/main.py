import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

try:
    from .modrinth_client import get_top_modpacks, get_modpack_detail, get_modpack_versions
    from .db import init_db, save_modpacks, fetch_modpacks, count_modpacks, get_last_refresh, fetch_modpack_by_id
    from .orchestrator import (
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
except ImportError:  # script execution (python backend/main.py)
    import sys
    sys.path.append(str(Path(__file__).resolve().parent))
    from modrinth_client import get_top_modpacks, get_modpack_detail, get_modpack_versions
    from db import init_db, save_modpacks, fetch_modpacks, count_modpacks, get_last_refresh, fetch_modpack_by_id
    from orchestrator import (
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


def load_local_env() -> None:
    """
    Load environment variables from a local .env file if present without
    overriding variables that are already set.
    """
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key and key not in os.environ:
            os.environ[key.strip()] = value.strip().strip("'").strip('"')


load_local_env()

BASE_URL = os.environ.get("MODRINTH_BASE_URL")
USER_AGENT = os.environ.get("MODRINTH_USER_AGENT")

if not BASE_URL or not USER_AGENT:
    raise RuntimeError(
        "Missing required environment variables: MODRINTH_BASE_URL and "
        "MODRINTH_USER_AGENT. Set them in backend/.env"
    )


class CreateServerRequest(BaseModel):
    name: str = Field(..., example="My Modded Server")
    project_id: str
    version_id: str
    version_number: Optional[str] = None
    loader: Optional[str] = None
    port: int = Field(25565, ge=1, le=65535)
    ram_gb: int = Field(4, ge=1, le=32)


class CommandRequest(BaseModel):
    command: str


def refresh_modpack_cache(limit: int):
    """
    Fetch top modpacks from Modrinth and persist them into the local database.
    """
    items = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
    enriched_items = []
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
            server_versions = []
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
                    and (
                        "server" in (f.get("filename", "").lower())
                        or f.get("primary")
                    )
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
                        "date_published": ver.get("date_published") or ver.get("date_created"),
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

def search_modrinth(query: str, limit: int = 5):
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

def show_latest_version(slug: str):
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

def print_top_modpacks(limit: int = 5):
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


def resolve_server_file_url(project_id: str, version_id: str) -> str:
    """
    Find a server-capable file URL for the given project/version. Prefers files
    with "server" in the filename or marked primary.
    """
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
        raise HTTPException(status_code=404, detail="Version not found for modpack")

    server_side = (match.get("server_side") or "").lower()
    if server_side == "unsupported":
        raise HTTPException(status_code=404, detail="No server pack file available for this version")

    files = match.get("files", []) or []
    server_capable = []
    for f in files:
        env_server = (f.get("env", {}).get("server") or "").lower()
        if env_server == "unsupported":
            continue
        server_capable.append(f)

    def sort_key(f: dict):
        name = (f.get("filename") or "").lower()
        ext = name.split(".")[-1] if "." in name else ""
        return (
            0 if "server" in name else 1,
            0 if ext not in {"mrpack"} else 1,  # prefer non-mrpack server files
            0 if f.get("primary") else 1,
        )

    server_capable_sorted = sorted(server_capable, key=sort_key)
    target = server_capable_sorted[0] if server_capable_sorted else None
    if not target or not target.get("url"):
        raise HTTPException(status_code=404, detail="No server pack file available for this version")
    return target["url"]


# --- HTTP API (FastAPI) ---

app = FastAPI(title="Craft Control API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/modpacks/top")
def api_get_top_modpacks(limit: int = Query(5, ge=1, le=100)) -> dict:
    """
    Return the top modpacks from the cached database, refreshing from Modrinth
    if the cache is empty.
    """
    try:
        items = fetch_modpacks(limit)
        refreshed_at = get_last_refresh()

        if not items and count_modpacks() == 0:
            _, refreshed_at = refresh_modpack_cache(limit)
            items = fetch_modpacks(limit)

        return {"items": items, "count": len(items), "refreshed_at": refreshed_at}
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.api_route("/api/modpacks/refresh", methods=["POST", "GET"])
def api_refresh_modpacks(limit: int = Query(25, ge=1, le=100)) -> dict:
    """
    Force-refresh the modpack cache from Modrinth.
    """
    try:
        _, refreshed_at = refresh_modpack_cache(limit)
        items = fetch_modpacks(limit)
        return {"items": items, "count": len(items), "refreshed_at": refreshed_at}
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/modpacks/{project_id}")
def api_get_modpack_detail(project_id: str) -> dict:
    """
    Return detail for a single modpack.
    """
    try:
        data = get_modpack_detail(
            base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
        )
        return data
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/modpacks/{project_id}/server-files")
def api_get_modpack_server_files(project_id: str) -> dict:
    """
    Check for server-capable version files for a modpack and return available versions.
    Includes per-version server_supported flag so client-only versions can be shown but disabled.
    """
    try:
        cached = fetch_modpack_by_id(project_id)
        if cached and isinstance(cached.get("server_versions"), list) and cached["server_versions"]:
            version_entries = cached["server_versions"]
            available = any(v.get("server_supported") for v in version_entries)
            return {"available": available, "versions": version_entries}

        project_detail = get_modpack_detail(
            base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
        )
        project_server_side = (project_detail.get("server_side") or "").lower()
        versions = get_modpack_versions(
            base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
        )

        version_entries = []
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
                and (
                    "server" in (f.get("filename", "").lower())
                    or f.get("primary")
                )
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
                    "date_published": ver.get("date_published") or ver.get("date_created"),
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
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/servers")
def api_list_servers() -> dict:
    return {"items": load_instances()}


@app.post("/api/servers")
def api_create_server(req: CreateServerRequest) -> dict:
    try:
        file_url = resolve_server_file_url(req.project_id, req.version_id)
        instance = create_instance(
            name=req.name,
            project_id=req.project_id,
            version_id=req.version_id,
            version_number=req.version_number,
            loader=req.loader,
            port=req.port,
            ram_gb=req.ram_gb,
            file_url=file_url,
        )
        return instance
    except HTTPException:
        raise
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/servers/{server_id}/start")
def api_start_server(server_id: str) -> dict:
    try:
        return start_instance(server_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/servers/{server_id}/stop")
def api_stop_server(server_id: str) -> dict:
    try:
        return stop_instance(server_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/servers/{server_id}/status")
def api_server_status(server_id: str) -> dict:
    try:
        return instance_status(server_id)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/servers/{server_id}/logs")
def api_server_logs(server_id: str, tail: int = Query(200, ge=1, le=2000)) -> dict:
    try:
        return {"lines": tail_logs(server_id, tail=tail)}
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/servers/{server_id}/command")
def api_server_command(server_id: str, body: CommandRequest) -> dict:
    try:
        return send_command(server_id, body.command)
    except OrchestratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/api/servers/{server_id}")
def api_delete_server(server_id: str) -> dict:
    try:
        delete_instance(server_id)
        return {"deleted": True}
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    # Start a dev server with: python apps/minecraft/backend/main.py
    host = os.environ.get("UVICORN_HOST", "0.0.0.0")
    port = int(os.environ.get("UVICORN_PORT", "8000"))
    reload_enabled = os.environ.get("UVICORN_RELOAD", "true").lower() == "true"
    # Uvicorn reload requires an import string target
    target = "main:app" if reload_enabled else app
    uvicorn.run(target, host=host, port=port, reload=reload_enabled)
