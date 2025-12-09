import json
import requests


def get_top_modpacks(base_url: str, user_agent: str, limit: int = 5):
    url = f"{base_url}/search"
    headers = {"User-Agent": user_agent}
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


def get_modpack_detail(base_url: str, user_agent: str, project_id: str):
    """
    Fetch a modpack's detail payload from Modrinth by project id or slug.
    """
    url = f"{base_url}/project/{project_id}"
    headers = {"User-Agent": user_agent}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_modpack_versions(base_url: str, user_agent: str, project_id: str):
    """
    Fetch versions for a modpack (project) from Modrinth.
    """
    url = f"{base_url}/project/{project_id}/version"
    headers = {"User-Agent": user_agent}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    return resp.json()
