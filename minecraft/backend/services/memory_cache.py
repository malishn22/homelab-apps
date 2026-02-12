"""
In-memory cache for modpack search and CurseForge server pack data.
Replaces the former PostgreSQL-backed cache.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional


_SEARCH_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_CURSEFORGE_SERVER_PACK_CACHE: Dict[int, tuple[float, Dict[str, Any]]] = {}


def get_search_cache(cache_key: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    entry = _SEARCH_CACHE.get(cache_key)
    if not entry:
        return None
    ts, payload = entry
    if time.time() - ts > ttl_seconds:
        _SEARCH_CACHE.pop(cache_key, None)
        return None
    return payload


def set_search_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    _SEARCH_CACHE[cache_key] = (time.time(), payload)


def clear_search_cache(cache_key: str) -> None:
    _SEARCH_CACHE.pop(cache_key, None)


def get_curseforge_server_pack_cache(
    mod_id: int, ttl_seconds: int
) -> Optional[Dict[str, Any]]:
    entry = _CURSEFORGE_SERVER_PACK_CACHE.get(mod_id)
    if not entry:
        return None
    ts, data = entry
    if time.time() - ts > ttl_seconds:
        _CURSEFORGE_SERVER_PACK_CACHE.pop(mod_id, None)
        return None
    return data


def set_curseforge_server_pack_cache(
    mod_id: int, has_server_pack: bool, server_files: Optional[List[Dict[str, Any]]] = None
) -> None:
    _CURSEFORGE_SERVER_PACK_CACHE[mod_id] = (
        time.time(),
        {"has_server_pack": has_server_pack, "server_files": server_files},
    )
