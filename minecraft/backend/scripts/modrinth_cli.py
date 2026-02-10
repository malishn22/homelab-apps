"""
Ad-hoc CLI helpers for Modrinth (search, versions, top modpacks).
Run from repo root with: PYTHONPATH=apps/minecraft/backend python -m scripts.modrinth_cli [args]
Or from backend dir: PYTHONPATH=. python -m scripts.modrinth_cli [args]
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running as script with backend on path
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config import MODRINTH_BASE_URL, MODRINTH_USER_AGENT
from modrinth_client import get_top_modpacks, get_modpack_versions

BASE_URL = MODRINTH_BASE_URL
USER_AGENT = MODRINTH_USER_AGENT


def search_modrinth(query: str, limit: int = 5) -> None:
    import requests
    url = f"{BASE_URL}/search"
    headers = {"User-Agent": USER_AGENT}
    params = {"query": query}
    resp = requests.get(url, headers=headers, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    print(f"Found {data.get('total_hits', 0)} results for '{query}':")
    for hit in data.get("hits", [])[:limit]:
        print("-", hit.get("title"), "| slug:", hit.get("slug"), "| id:", hit.get("project_id"))


def get_versions(slug: str):
    import requests
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
    latest = versions[0]
    version_number = latest.get("version_number")
    files = latest.get("files", [])
    download_url = files[0]["url"] if files else None
    print(f"Latest version for {slug}: {version_number}")
    print("Download URL:", download_url)


def print_top_modpacks(limit: int = 5) -> None:
    packs = get_top_modpacks(base_url=BASE_URL, user_agent=USER_AGENT, limit=limit)
    print(f"Top {len(packs)} modpacks on Modrinth (by downloads):")
    for p in packs:
        print("-", p.get("title"), "| slug:", p.get("slug"), "| id:", p.get("project_id"), "| downloads:", p.get("downloads"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.modrinth_cli search <query> [limit]")
        print("       python -m scripts.modrinth_cli versions <slug>")
        print("       python -m scripts.modrinth_cli latest <slug>")
        print("       python -m scripts.modrinth_cli top [limit]")
        sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        search_modrinth(query, limit=limit)
    elif cmd == "versions":
        slug = sys.argv[2] if len(sys.argv) > 2 else ""
        print(get_versions(slug))
    elif cmd == "latest":
        slug = sys.argv[2] if len(sys.argv) > 2 else ""
        show_latest_version(slug)
    elif cmd == "top":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        print_top_modpacks(limit=limit)
    else:
        print("Unknown command:", cmd)
        sys.exit(1)
