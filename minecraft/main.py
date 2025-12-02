import requests
import json

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

    # facets = [["project_type:modpack"]]  => only modpacks :contentReference[oaicite:1]{index=1}
    facets = [["project_type:modpack"]]

    params = {
        "facets": json.dumps(facets),
        "index": "downloads",  # sort by most downloaded modpacks :contentReference[oaicite:2]{index=2}
        "limit": limit,
    }

    resp = requests.get(url, headers=headers, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return data.get("hits", [])

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

if __name__ == "__main__":
    search_modrinth("sodium")
    print("\n---\n")
    show_latest_version("sodium")

    print("\n=== TOP MODPACKS ===\n")
    print_top_modpacks(5)
