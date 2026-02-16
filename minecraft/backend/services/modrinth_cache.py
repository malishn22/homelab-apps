"""Modrinth search result cache backed by generic TTLCache."""

import os
from typing import Any, Tuple

from .ttl_cache import TTLCache

CacheKey = Tuple[str, int, int, str]

TTL_SECONDS = int(os.environ.get("MODPACK_MEMORY_CACHE_TTL_SECONDS", "43200"))

_cache: TTLCache[CacheKey, Any] = TTLCache(ttl_seconds=TTL_SECONDS)


def get_cached(key: CacheKey):
    return _cache.get(key)


def set_cached(key: CacheKey, value: Any):
    _cache.set(key, value)


def clear_cached(key: CacheKey) -> None:
    _cache.delete(key)


def clear_all() -> None:
    _cache.clear()
