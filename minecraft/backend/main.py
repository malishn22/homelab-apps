import os
from pathlib import Path
from datetime import datetime, timezone
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try:
    from .modrinth_client import get_top_modpacks, get_modpack_detail, get_modpack_versions
    from .db import init_db, save_modpacks, fetch_modpacks, count_modpacks, get_last_refresh
except ImportError:  # script execution (python backend/main.py)
    import sys
    sys.path.append(str(Path(__file__).resolve().parent))
    from modrinth_client import get_top_modpacks, get_modpack_detail, get_modpack_versions
    from db import init_db, save_modpacks, fetch_modpacks, count_modpacks, get_last_refresh


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


def refresh_modpack_cache(limit: int):
    """
    Fetch top modpacks from Modrinth and persist them into the local database.
    """
    items = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
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
def api_get_top_modpacks(limit: int = Query(5, ge=1, le=50)) -> dict:
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
    """
    try:
        versions = get_modpack_versions(
            base_url=BASE_URL, user_agent=USER_AGENT, project_id=project_id
        )
        server_candidates = []
        for ver in versions or []:
            files = ver.get("files", []) or []
            has_server_file = any(
                "server" in (f.get("filename", "").lower())
                or f.get("primary")
                for f in files
            )
            if not has_server_file:
                continue

            server_candidates.append(
                {
                    "id": ver.get("id") or ver.get("version_id"),
                    "version_number": ver.get("version_number"),
                    "game_versions": ver.get("game_versions") or [],
                    "loaders": ver.get("loaders") or [],
                    "date_published": ver.get("date_published") or ver.get("date_created"),
                    "files": [
                        {
                            "filename": f.get("filename"),
                            "url": f.get("url"),
                        }
                        for f in files
                        if "server" in (f.get("filename", "").lower()) or f.get("primary")
                    ],
                }
            )

        return {"available": len(server_candidates) > 0, "versions": server_candidates}
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    # Start a dev server with: python apps/minecraft/backend/main.py
    host = os.environ.get("UVICORN_HOST", "0.0.0.0")
    port = int(os.environ.get("UVICORN_PORT", "8000"))
    reload_enabled = os.environ.get("UVICORN_RELOAD", "true").lower() == "true"
    # Uvicorn reload requires an import string target
    target = "main:app" if reload_enabled else app
    uvicorn.run(target, host=host, port=port, reload=reload_enabled)
