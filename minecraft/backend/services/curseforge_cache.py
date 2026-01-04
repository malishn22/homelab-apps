import os
import time
from typing import Any, Dict, Tuple

# Cache key: (query, page, limit, sort)
CacheKey = Tuple[str, int, int, str]
DetailCacheKey = int
FilesCacheKey = int
FileDetailCacheKey = int
ServerPackCacheKey = int

_CACHE: Dict[CacheKey, Tuple[float, Any]] = {}
_DETAIL_CACHE: Dict[DetailCacheKey, Tuple[float, Any]] = {}
_FILES_CACHE: Dict[FilesCacheKey, Tuple[float, Any]] = {}
_FILE_DETAIL_CACHE: Dict[FileDetailCacheKey, Tuple[float, Any]] = {}
_SERVER_PACK_CACHE: Dict[ServerPackCacheKey, Tuple[float, Any]] = {}
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


def get_cached_detail(key: DetailCacheKey):
    now = time.time()
    entry = _DETAIL_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if now - ts > TTL_SECONDS:
        _DETAIL_CACHE.pop(key, None)
        return None
    return value


def set_cached_detail(key: DetailCacheKey, value: Any):
    _DETAIL_CACHE[key] = (time.time(), value)

def clear_cached_detail(key: DetailCacheKey) -> None:
    _DETAIL_CACHE.pop(key, None)


def get_cached_files(key: FilesCacheKey):
    now = time.time()
    entry = _FILES_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if now - ts > TTL_SECONDS:
        _FILES_CACHE.pop(key, None)
        return None
    return value


def set_cached_files(key: FilesCacheKey, value: Any):
    _FILES_CACHE[key] = (time.time(), value)

def clear_cached_files(key: FilesCacheKey) -> None:
    _FILES_CACHE.pop(key, None)


def get_cached_file_detail(key: FileDetailCacheKey):
    now = time.time()
    entry = _FILE_DETAIL_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if now - ts > TTL_SECONDS:
        _FILE_DETAIL_CACHE.pop(key, None)
        return None
    return value


def set_cached_file_detail(key: FileDetailCacheKey, value: Any):
    _FILE_DETAIL_CACHE[key] = (time.time(), value)

def clear_cached_file_detail(key: FileDetailCacheKey) -> None:
    _FILE_DETAIL_CACHE.pop(key, None)


def get_cached_server_pack(key: ServerPackCacheKey):
    now = time.time()
    entry = _SERVER_PACK_CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if now - ts > TTL_SECONDS:
        _SERVER_PACK_CACHE.pop(key, None)
        return None
    return value


def set_cached_server_pack(key: ServerPackCacheKey, value: bool):
    _SERVER_PACK_CACHE[key] = (time.time(), value)

def clear_cached_server_pack(key: ServerPackCacheKey) -> None:
    _SERVER_PACK_CACHE.pop(key, None)

def clear_all() -> None:
    _CACHE.clear()
    _DETAIL_CACHE.clear()
    _FILES_CACHE.clear()
    _FILE_DETAIL_CACHE.clear()
    _SERVER_PACK_CACHE.clear()
