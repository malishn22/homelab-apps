"""
Modpack search, detail, and server-files business logic.
Used by api/modpacks.py; keeps HTTP and FastAPI concerns out of this layer.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List

import requests

from config import (
    CURSEFORGE_API_KEY,
    CURSEFORGE_BASE_URL,
    MODRINTH_BASE_URL,
    MODRINTH_USER_AGENT,
)
from services.memory_cache import (
    clear_search_cache,
    get_curseforge_server_pack_cache,
    get_search_cache,
    set_curseforge_server_pack_cache,
    set_search_cache,
)
from modrinth_client import get_modpack_detail as modrinth_get_modpack_detail
from modrinth_client import get_modpack_versions
from services.curseforge_cache import (
    clear_cached as clear_curseforge_cached,
    clear_cached_detail as clear_curseforge_cached_detail,
    get_cached as get_curseforge_cached,
    get_cached_detail as get_curseforge_cached_detail,
    get_cached_file_detail as get_curseforge_cached_file_detail,
    get_cached_server_pack as get_curseforge_cached_server_pack,
    set_cached as set_curseforge_cached,
    set_cached_detail as set_curseforge_cached_detail,
    set_cached_file_detail as set_curseforge_cached_file_detail,
    set_cached_server_pack as set_curseforge_cached_server_pack,
)
from services.modrinth_cache import (
    clear_cached as clear_modrinth_cached,
    get_cached as get_modrinth_cached,
    set_cached as set_modrinth_cached,
)

CURSEFORGE_GAME_ID = 432
CURSEFORGE_CLASS_ID = 4471
CURSEFORGE_SORT_FIELDS = {
    "downloads": 6,
    "updated": 3,
    "relevance": 2,
    "follows": 2,
}
SEARCH_CACHE_TTL_SECONDS = int(os.environ.get("MODPACK_SEARCH_CACHE_TTL_SECONDS", "43200"))
CURSEFORGE_SERVER_PACK_TTL_SECONDS = int(os.environ.get("CURSEFORGE_SERVER_PACK_TTL_SECONDS", "43200"))


def parse_sources(raw: str) -> List[str]:
    allowed = {"modrinth", "curseforge"}
    sources = [src.strip().lower() for src in (raw or "").split(",") if src.strip()]
    filtered = [src for src in sources if src in allowed]
    return filtered or ["modrinth"]


def _coerce_mod_id(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_curseforge_server_pack_name(name: str) -> bool:
    if not name:
        return False
    normalized = name.replace("_", " ").replace("-", " ")
    if "serverpack" in normalized or "server pack" in normalized:
        return True
    if "serverfiles" in normalized or "server files" in normalized:
        return True
    if "dedicated server" in normalized:
        return True
    if "server" in normalized and "pack" in normalized:
        return True
    if "server" in normalized and "files" in normalized:
        return True
    return False


def _fetch_modrinth_search(
    query: str, page: int, limit: int, sort: str, force: bool = False
) -> Dict[str, Any]:
    key = (query, page, limit, sort)
    if force:
        clear_modrinth_cached(key)
    else:
        cached = get_modrinth_cached(key)
        if cached:
            return cached

    params = {
        "query": query,
        "offset": page * limit,
        "limit": limit,
        "index": sort,
        "facets": '[["project_type:modpack"]]',
    }
    resp = requests.get(
        f"{MODRINTH_BASE_URL}/search",
        headers={"User-Agent": MODRINTH_USER_AGENT},
        params=params,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    set_modrinth_cached(key, data)
    return data


def _fetch_curseforge_search(
    query: str, page: int, limit: int, sort: str, force: bool = False
) -> Dict[str, Any]:
    if not CURSEFORGE_BASE_URL or not CURSEFORGE_API_KEY:
        raise ValueError(
            "CurseForge API is not configured. Set CURSEFORGE_BASE_URL and CURSEFORGE_API_KEY."
        )

    key = (query, page, limit, sort)
    if force:
        clear_curseforge_cached(key)
    else:
        cached = get_curseforge_cached(key)
        if cached:
            return cached

    params: Dict[str, Any] = {
        "gameId": CURSEFORGE_GAME_ID,
        "classId": CURSEFORGE_CLASS_ID,
        "index": page * limit,
        "pageSize": limit,
    }
    if query:
        params["searchFilter"] = query
    sort_field = CURSEFORGE_SORT_FIELDS.get(sort)
    if sort_field is not None:
        params["sortField"] = sort_field
        params["sortOrder"] = "desc"

    resp = requests.get(
        f"{CURSEFORGE_BASE_URL}/mods/search",
        headers={"x-api-key": CURSEFORGE_API_KEY},
        params=params,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    set_curseforge_cached(key, data)
    return data


def _fetch_curseforge_mod_detail(mod_id: int, force: bool = False) -> Dict[str, Any]:
    if force:
        clear_curseforge_cached_detail(mod_id)
    else:
        cached = get_curseforge_cached_detail(mod_id)
        if cached:
            return cached

    resp = requests.get(
        f"{CURSEFORGE_BASE_URL}/mods/{mod_id}",
        headers={"x-api-key": CURSEFORGE_API_KEY},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    detail = data.get("data") or {}
    set_curseforge_cached_detail(mod_id, detail)
    return detail


def _fetch_curseforge_mod_details(
    mod_ids: List[int], force: bool = False
) -> Dict[int, Dict[str, Any]]:
    details: Dict[int, Dict[str, Any]] = {}
    missing: List[int] = []

    for mod_id in mod_ids:
        if force:
            clear_curseforge_cached_detail(mod_id)
            missing.append(mod_id)
            continue
        cached = get_curseforge_cached_detail(mod_id)
        if cached:
            details[mod_id] = cached
        else:
            missing.append(mod_id)

    if not missing:
        return details

    resp = requests.post(
        f"{CURSEFORGE_BASE_URL}/mods",
        headers={"x-api-key": CURSEFORGE_API_KEY},
        json={"modIds": missing},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    for item in data.get("data") or []:
        mid = item.get("id")
        if mid is None:
            continue
        mid = int(mid)
        details[mid] = item
        set_curseforge_cached_detail(mid, item)
    return details


def _fetch_curseforge_file_detail(mod_id: int, file_id: int) -> Dict[str, Any]:
    cached = get_curseforge_cached_file_detail(file_id)
    if cached:
        return cached
    resp = requests.get(
        f"{CURSEFORGE_BASE_URL}/mods/{mod_id}/files/{file_id}",
        headers={"x-api-key": CURSEFORGE_API_KEY},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    detail = data.get("data") or {}
    set_curseforge_cached_file_detail(file_id, detail)
    return detail


def _extract_additional_payloads(payload: Dict[str, Any]) -> List[Any]:
    candidates: List[Any] = []
    for key in (
        "additionalFiles",
        "fileRelations",
        "additional_files",
        "file_relations",
        "relations",
    ):
        if key in payload:
            candidates.append(payload[key])
    return candidates


def _collect_related_file_ids(payloads: List[Any]) -> List[int]:
    ids: List[int] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                key_lower = key.lower()
                if "file" in key_lower and key_lower.endswith("id"):
                    fid = _coerce_mod_id(value)
                    if fid is not None:
                        ids.append(fid)
                if isinstance(value, (dict, list)):
                    walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    for payload in payloads:
        walk(payload)
    return list({item for item in ids})


def _find_additional_server_files(
    mod_id: int, file_entry: Dict[str, Any]
) -> tuple[bool, List[Dict[str, Any]]]:
    file_id = _coerce_mod_id(file_entry.get("id"))
    if file_id is None:
        return False, []

    try:
        detail = _fetch_curseforge_file_detail(mod_id, file_id)
    except Exception:
        return False, []

    found_files: List[Dict[str, Any]] = []
    has_server_pack = False
    detail_name = (detail.get("fileName") or detail.get("displayName") or "").lower()
    if detail.get("isServerPack") is True or _is_curseforge_server_pack_name(detail_name):
        found_files.append(detail)
        has_server_pack = True

    server_pack_id = _coerce_mod_id(detail.get("serverPackFileId"))
    if server_pack_id and server_pack_id != file_id:
        try:
            server_detail = _fetch_curseforge_file_detail(mod_id, server_pack_id)
            server_name = (
                server_detail.get("fileName") or server_detail.get("displayName") or ""
            ).lower()
            if server_detail.get("isServerPack") is True or _is_curseforge_server_pack_name(
                server_name
            ):
                found_files.append(server_detail)
                has_server_pack = True
        except Exception:
            pass

    related_payloads = _extract_additional_payloads(detail)
    related_ids = _collect_related_file_ids(related_payloads)
    for related_id in related_ids:
        if related_id == file_id:
            continue
        try:
            related_detail = _fetch_curseforge_file_detail(mod_id, related_id)
        except Exception:
            continue
        related_name = (
            related_detail.get("fileName") or related_detail.get("displayName") or ""
        ).lower()
        if related_detail.get("isServerPack") is True or _is_curseforge_server_pack_name(
            related_name
        ):
            found_files.append(related_detail)
            has_server_pack = True
    return has_server_pack, found_files


def _collect_curseforge_server_pack_entries(
    mod_id: int,
    page_size: int = 200,
    max_pages: int | None = 20,
    additional_scan_limit: int | None = 10,
    stop_after_first: bool = False,
) -> List[Dict[str, Any]]:
    entries: Dict[int, Dict[str, Any]] = {}
    index = 0
    pages = 0
    scanned_additional = 0

    while True:
        if max_pages is not None and pages >= max_pages:
            break
        resp = requests.get(
            f"{CURSEFORGE_BASE_URL}/mods/{mod_id}/files",
            headers={"x-api-key": CURSEFORGE_API_KEY},
            params={"pageSize": page_size, "index": index},
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("data") or []

        for entry in batch:
            entry_id = _coerce_mod_id(entry.get("id"))
            name = (entry.get("fileName") or entry.get("displayName") or "").lower()
            if entry.get("isServerPack") is True or _is_curseforge_server_pack_name(name):
                if entry_id is not None:
                    entries[entry_id] = entry
                if stop_after_first:
                    return list(entries.values())
            if additional_scan_limit is None or scanned_additional < additional_scan_limit:
                found, extra_files = _find_additional_server_files(mod_id, entry)
                for extra in extra_files:
                    extra_id = _coerce_mod_id(extra.get("id"))
                    if extra_id is not None:
                        entries[extra_id] = extra
                scanned_additional += 1
                if found and stop_after_first:
                    return list(entries.values())

        if len(batch) < page_size:
            break
        index += page_size
        pages += 1
    return list(entries.values())


def _quick_check_curseforge_server_pack(mod_id: int, max_entries: int = 3) -> bool:
    """
    Lightweight check for server pack: fetch first page of files, inspect only
    the first max_entries (latest versions). Mark as client-only if not found.
    Used for search results; full scan still used for server-files endpoint.
    """
    cached_db = get_curseforge_server_pack_cache(
        mod_id, CURSEFORGE_SERVER_PACK_TTL_SECONDS
    )
    if cached_db is not None:
        return bool(cached_db.get("has_server_pack"))
    cached = get_curseforge_cached_server_pack(mod_id)
    if cached is not None:
        return cached
    try:
        resp = requests.get(
            f"{CURSEFORGE_BASE_URL}/mods/{mod_id}/files",
            headers={"x-api-key": CURSEFORGE_API_KEY},
            params={"pageSize": max(3, max_entries), "index": 0},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("data") or []
        for entry in batch[:max_entries]:
            name = (entry.get("fileName") or entry.get("displayName") or "").lower()
            if entry.get("isServerPack") is True or _is_curseforge_server_pack_name(name):
                set_curseforge_server_pack_cache(mod_id, True, None)
                set_curseforge_cached_server_pack(mod_id, True)
                return True
        for entry in batch[:2]:
            found, _ = _find_additional_server_files(mod_id, entry)
            if found:
                set_curseforge_server_pack_cache(mod_id, True, None)
                set_curseforge_cached_server_pack(mod_id, True)
                return True
        has_server_pack = False
        set_curseforge_server_pack_cache(mod_id, has_server_pack, None)
        set_curseforge_cached_server_pack(mod_id, has_server_pack)
        return has_server_pack
    except Exception:
        return False


def _scan_curseforge_files_for_server_pack(
    mod_id: int, page_size: int = 200, max_pages: int = 20
) -> bool:
    cached_db = get_curseforge_server_pack_cache(
        mod_id, CURSEFORGE_SERVER_PACK_TTL_SECONDS
    )
    if cached_db is not None:
        return bool(cached_db.get("has_server_pack"))
    cached = get_curseforge_cached_server_pack(mod_id)
    if cached is not None:
        return cached
    entries = _collect_curseforge_server_pack_entries(
        mod_id, page_size=page_size, max_pages=max_pages, stop_after_first=True
    )
    has_server_pack = len(entries) > 0
    set_curseforge_server_pack_cache(mod_id, has_server_pack, None)
    set_curseforge_cached_server_pack(mod_id, has_server_pack)
    return has_server_pack


def _extract_curseforge_game_versions(item: Dict[str, Any]) -> List[str]:
    versions = set()
    for entry in item.get("latestFilesIndexes") or []:
        gv = entry.get("gameVersion")
        if gv:
            versions.add(gv)
    for entry in item.get("latestFiles") or []:
        for gv in entry.get("gameVersions") or []:
            if gv:
                versions.add(gv)
    for entry in item.get("gameVersionLatestFiles") or []:
        gv = entry.get("gameVersion")
        if gv:
            versions.add(gv)
    return sorted(versions)


def _normalize_curseforge_loader(value: Any) -> str | None:
    if value is None:
        return None
    loader_map = {
        1: "forge", 2: "cauldron", 3: "liteloader", 4: "fabric",
        5: "quilt", 6: "neoforge",
    }
    if isinstance(value, int):
        return loader_map.get(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if not text:
            return None
        if text.isdigit():
            return loader_map.get(int(text))
        if text in {"forge", "fabric", "quilt", "neoforge", "liteloader", "cauldron"}:
            return text
    return None


def _extract_curseforge_loaders(item: Dict[str, Any]) -> List[str]:
    loaders = set()
    for entry in item.get("latestFiles") or []:
        for key in ("modLoader", "modLoaderType"):
            loader = _normalize_curseforge_loader(entry.get(key))
            if loader:
                loaders.add(loader)
    for entry in item.get("latestFilesIndexes") or []:
        loader = _normalize_curseforge_loader(entry.get("modLoader"))
        if loader:
            loaders.add(loader)
    return sorted(loaders)


def _extract_curseforge_loaders_from_versions(game_versions: List[str]) -> List[str]:
    loaders = []
    for version in game_versions or []:
        value = version.strip().lower()
        if value in {"forge", "fabric", "quilt", "neoforge"}:
            loaders.append(value)
    return sorted(set(loaders))


def _has_curseforge_server_pack(payload: Dict[str, Any]) -> bool:
    if payload.get("serverPackFileId") or payload.get("server_pack_file_id"):
        return True
    for entry in payload.get("latestFiles") or []:
        if entry.get("isServerPack") is True:
            return True
        name = (entry.get("fileName") or entry.get("displayName") or "").lower()
        if _is_curseforge_server_pack_name(name):
            return True
    return False


def _curseforge_has_server_pack(
    item: Dict[str, Any], detail: Dict[str, Any] | None = None
) -> bool:
    if _has_curseforge_server_pack(item):
        return True
    mod_id = item.get("id")
    if not mod_id:
        return False
    detail_payload = detail or None
    if detail_payload is None:
        try:
            detail_payload = _fetch_curseforge_mod_detail(int(mod_id))
        except Exception:
            return False
    if detail_payload and _has_curseforge_server_pack(detail_payload):
        return True
    try:
        return _quick_check_curseforge_server_pack(int(mod_id))
    except Exception:
        return False


def _map_curseforge_hit(
    item: Dict[str, Any], detail: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    authors = item.get("authors") or []
    author_name = authors[0].get("name") if authors else None
    categories = [c.get("name") for c in item.get("categories") or [] if c.get("name")]
    logo = item.get("logo") or {}
    game_versions = _extract_curseforge_game_versions(item)
    loaders = _extract_curseforge_loaders(item)
    loaders.extend(_extract_curseforge_loaders_from_versions(game_versions))
    loaders = sorted(set(loaders))
    has_server_pack = _curseforge_has_server_pack(item, detail)
    return {
        "project_id": str(item.get("id") or ""),
        "slug": item.get("slug") or str(item.get("id") or ""),
        "title": item.get("name") or "Untitled",
        "description": item.get("summary") or "No description available.",
        "author": author_name or "Unknown",
        "downloads": item.get("downloadCount") or 0,
        "followers": item.get("thumbsUpCount") or None,
        "updated": item.get("dateModified"),
        "date_modified": item.get("dateModified"),
        "date_created": item.get("dateCreated"),
        "categories": categories,
        "game_versions": game_versions,
        "loaders": loaders,
        "server_side": "required" if has_server_pack else "unsupported",
        "icon_url": logo.get("url"),
        "source": "curseforge",
    }


def _parse_timestamp(value: Any) -> int:
    if not value or not isinstance(value, str):
        return 0
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return int(datetime.fromisoformat(text).timestamp())
    except ValueError:
        return 0


def _sort_hits(hits: List[Dict[str, Any]], sort: str) -> List[Dict[str, Any]]:
    if sort == "downloads":
        return sorted(hits, key=lambda hit: hit.get("downloads", 0), reverse=True)
    if sort == "updated":
        return sorted(
            hits,
            key=lambda hit: _parse_timestamp(
                hit.get("updated") or hit.get("date_modified") or hit.get("date_created")
            ),
            reverse=True,
        )
    if sort == "follows":
        return sorted(
            hits,
            key=lambda hit: hit.get("followers") if hit.get("followers") is not None else hit.get("follows", 0),
            reverse=True,
        )
    return hits


def _build_curseforge_server_files(mod_id: int, force: bool = False) -> Dict[str, Any]:
    if not force:
        cached = get_curseforge_server_pack_cache(
            mod_id, CURSEFORGE_SERVER_PACK_TTL_SECONDS
        )
        if cached:
            cached_files = cached.get("server_files") or []
            if cached_files or not cached.get("has_server_pack"):
                return {
                    "available": bool(cached.get("has_server_pack")),
                    "versions": cached_files,
                }

    entries = _collect_curseforge_server_pack_entries(
        mod_id, max_pages=1, additional_scan_limit=3
    )
    versions: List[Dict[str, Any]] = []
    for entry in entries:
        file_id = _coerce_mod_id(entry.get("id"))
        if file_id is None:
            continue
        game_versions = entry.get("gameVersions") or []
        loaders = _extract_curseforge_loaders_from_versions(game_versions)
        versions.append({
            "id": str(file_id),
            "version_number": entry.get("displayName") or entry.get("fileName"),
            "game_versions": game_versions,
            "loaders": loaders,
            "date_published": entry.get("fileDate") or entry.get("dateCreated"),
            "server_supported": True,
            "files": [{"filename": entry.get("fileName"), "url": entry.get("downloadUrl")}],
        })
    versions.sort(key=lambda v: _parse_timestamp(v.get("date_published")), reverse=True)
    versions = versions[:10]
    available = len(versions) > 0
    set_curseforge_server_pack_cache(mod_id, available, versions)
    return {"available": available, "versions": versions}


# --- Public API for api/modpacks.py ---


def search_modpacks(
    query: str = "",
    page: int = 0,
    limit: int = 20,
    sort: str = "relevance",
    sources: str = "modrinth",
    force: bool = False,
) -> Dict[str, Any]:
    """
    Aggregate search across Modrinth/CurseForge with caching.
    Returns dict with hits, limit, offset, total_hits, sources, errors.
    Raises requests.HTTPError or ValueError (e.g. CurseForge not configured).
    """
    source_list = parse_sources(sources)
    cache_key = f"search:{','.join(source_list)}:{query}:{page}:{limit}:{sort}"
    if force:
        clear_search_cache(cache_key)
    else:
        cached = get_search_cache(cache_key, SEARCH_CACHE_TTL_SECONDS)
        if cached:
            return cached

    per_source = max(1, limit // len(source_list))
    remainder = max(0, limit - (per_source * len(source_list)))
    hits: List[Dict[str, Any]] = []
    total_hits = 0
    errors: List[Dict[str, Any]] = []

    for idx, source in enumerate(source_list):
        source_limit = per_source + (1 if idx < remainder else 0)
        if source_limit <= 0:
            continue
        try:
            if source == "modrinth":
                data = _fetch_modrinth_search(query, page, source_limit, sort, force=force)
                mod_hits = [{**hit, "source": "modrinth"} for hit in (data.get("hits") or [])]
                hits.extend(mod_hits)
                total_hits += data.get("total_hits", len(mod_hits))
            elif source == "curseforge":
                data = _fetch_curseforge_search(query, page, source_limit, sort, force=force)
                items = data.get("data") or []
                detail_map: Dict[int, Dict[str, Any]] = {}
                if items:
                    try:
                        ids = [_coerce_mod_id(item.get("id")) for item in items]
                        ids = [i for i in ids if i is not None]
                        if ids:
                            detail_map = _fetch_curseforge_mod_details(ids, force=force)
                    except requests.HTTPError as exc:
                        errors.append({
                            "source": "curseforge-detail",
                            "status": exc.response.status_code if exc.response else 502,
                            "detail": exc.response.text if exc.response else str(exc),
                        })
                    except Exception as exc:
                        errors.append({"source": "curseforge-detail", "status": 500, "detail": str(exc)})
                mapped_hits = []
                for item in items:
                    mid = _coerce_mod_id(item.get("id"))
                    detail = detail_map.get(mid) if mid is not None else None
                    mapped_hits.append(_map_curseforge_hit(item, detail))
                hits.extend(mapped_hits)
                pagination = data.get("pagination") or {}
                total_hits += pagination.get("totalCount", len(mapped_hits))
        except requests.HTTPError as exc:
            errors.append({
                "source": source,
                "status": exc.response.status_code if exc.response else 502,
                "detail": exc.response.text if exc.response else str(exc),
            })
        except ValueError as exc:
            errors.append({"source": source, "status": 500, "detail": str(exc)})
        except Exception as exc:
            errors.append({"source": source, "status": 500, "detail": str(exc)})

    hits = _sort_hits(hits, sort)
    response = {
        "hits": hits,
        "limit": limit,
        "offset": page * limit,
        "total_hits": total_hits,
        "sources": source_list,
        "errors": errors,
    }
    if not hits and errors:
        # Do not cache failure; API layer will raise 502 with this response
        return response
    set_search_cache(cache_key, response)
    return response


def get_modpack_detail_cached(project_id: str) -> Dict[str, Any]:
    """
    Modrinth project detail with small TTL cache.
    Raises requests.HTTPError on API failure.
    """
    key = (f"detail:{project_id}", 0, 0, "")
    cached = get_modrinth_cached(key)
    if cached:
        return cached
    data = modrinth_get_modpack_detail(
        base_url=MODRINTH_BASE_URL,
        user_agent=MODRINTH_USER_AGENT,
        project_id=project_id,
    )
    set_modrinth_cached(key, data)
    return data


def get_modpack_server_files(
    project_id: str, source: str = "modrinth", force: bool = False
) -> Dict[str, Any]:
    """
    Returns {"available": bool, "versions": [...]} for server-files endpoint.
    CurseForge path if source is curseforge or project_id is numeric.
    """
    source_key = (source or "").strip().lower()
    if source_key == "curseforge" or project_id.isdigit():
        return _build_curseforge_server_files(int(project_id), force=force)

    project_detail = modrinth_get_modpack_detail(
        base_url=MODRINTH_BASE_URL,
        user_agent=MODRINTH_USER_AGENT,
        project_id=project_id,
    )
    project_server_side = (project_detail.get("server_side") or "").lower()
    versions = get_modpack_versions(
        base_url=MODRINTH_BASE_URL,
        user_agent=MODRINTH_USER_AGENT,
        project_id=project_id,
    )
    version_entries: List[Dict[str, Any]] = []
    for ver in versions or []:
        server_side = (ver.get("server_side") or "").lower()
        files = ver.get("files", []) or []
        server_files = [
            {"filename": f.get("filename"), "url": f.get("url")}
            for f in files
            if (f.get("env", {}).get("server") or "").lower() != "unsupported"
            and ("server" in (f.get("filename", "").lower()) or f.get("primary"))
        ]
        server_supported = (
            project_server_side != "unsupported"
            and server_side != "unsupported"
            and len(server_files) > 0
        )
        version_entries.append({
            "id": ver.get("id") or ver.get("version_id"),
            "version_number": ver.get("version_number"),
            "game_versions": ver.get("game_versions") or [],
            "loaders": ver.get("loaders") or [],
            "date_published": ver.get("date_published") or ver.get("date_created"),
            "server_supported": server_supported,
            "files": server_files,
        })
    available = any(v.get("server_supported") for v in version_entries)
    # Sort by date (newest first) and limit to last 10 server files
    version_entries.sort(
        key=lambda v: _parse_timestamp(v.get("date_published")), reverse=True
    )
    version_entries = version_entries[:10]
    return {"available": available, "versions": version_entries}
