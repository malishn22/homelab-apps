import os
import time
from typing import Any, Dict, Tuple

# Cache key: (query, page, limit, sort)
CacheKey = Tuple[str, int, int, str]

_CACHE: Dict[CacheKey, Tuple[float, Any]] = {}
TTL_SECONDS = int(os.environ.get("MODPACK_MEMORY_CACHE_TTL_SECONDS", "43200"))

def get_cached(key: CacheKey):
    now = time.time()
    entry = _CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if now - ts > TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value

def set_cached(key: CacheKey, value: Any):
    _CACHE[key] = (time.time(), value)

def clear_cached(key: CacheKey) -> None:
    _CACHE.pop(key, None)

def clear_all() -> None:
    _CACHE.clear()
