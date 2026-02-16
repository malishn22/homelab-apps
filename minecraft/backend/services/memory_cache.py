"""
In-memory cache for modpack search and CurseForge server pack data.
Backed by the generic TTLCache.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .ttl_cache import TTLCache

_SEARCH_CACHE_TTL = int(os.environ.get("MODPACK_SEARCH_CACHE_TTL_SECONDS", "43200"))
_search_cache: TTLCache[str, Dict[str, Any]] = TTLCache(ttl_seconds=_SEARCH_CACHE_TTL)
_curseforge_server_pack_cache: TTLCache[int, Dict[str, Any]] = TTLCache(ttl_seconds=0)


def get_search_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    return _search_cache.get(cache_key)


def set_search_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    _search_cache.set(cache_key, payload)


def clear_search_cache(cache_key: str) -> None:
    _search_cache.delete(cache_key)


def get_curseforge_server_pack_cache(
    mod_id: int, ttl_seconds: int
) -> Optional[Dict[str, Any]]:
    _curseforge_server_pack_cache._ttl = ttl_seconds
    return _curseforge_server_pack_cache.get(mod_id)


def set_curseforge_server_pack_cache(
    mod_id: int, has_server_pack: bool, server_files: Optional[List[Dict[str, Any]]] = None
) -> None:
    _curseforge_server_pack_cache.set(
        mod_id, {"has_server_pack": has_server_pack, "server_files": server_files}
    )
