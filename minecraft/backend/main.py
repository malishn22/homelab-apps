import json
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

BASE_URL = "https://api.modrinth.com/v2"
USER_AGENT = "malishn22/homelab-apps/minecraft/0.1"

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

def get_top_modpacks(limit: int = 5):
    url = f"{BASE_URL}/search"
    headers = {"User-Agent": USER_AGENT}
    facets = [["project_type:modpack"]]

    params = {
        "facets": json.dumps(facets),
        "index": "downloads",  # sort by most downloaded modpacks
        "limit": limit,
    }

    resp = requests.get(url, headers=headers, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return data.get("hits", [])


def get_modpack_detail(project_id: str):
    """
    Fetch a modpack's detail payload from Modrinth by project id or slug.
    """
    url = f"{BASE_URL}/project/{project_id}"
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    return resp.json()


def print_top_modpacks(limit: int = 5):
    packs = get_top_modpacks(limit)
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


@app.get("/api/modpacks/top")
def api_get_top_modpacks(limit: int = Query(5, ge=1, le=50)) -> dict:
    """
    Return the top Modrinth modpacks by downloads.
    """
    try:
        items = get_top_modpacks(limit)
        return {"items": items, "count": len(items)}
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
        data = get_modpack_detail(project_id)
        return data
    except requests.HTTPError as exc:
        raise HTTPException(
            status_code=exc.response.status_code if exc.response else 502,
            detail=f"Modrinth error: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    # Start a dev server with: python apps/minecraft/main.py
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
