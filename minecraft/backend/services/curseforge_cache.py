"""CurseForge cache backed by generic TTLCache."""

import os
from typing import Any, Tuple

from .ttl_cache import TTLCache

CacheKey = Tuple[str, int, int, str]
DetailCacheKey = int
FilesCacheKey = int
FileDetailCacheKey = int
ServerPackCacheKey = int

TTL_SECONDS = int(os.environ.get("MODPACK_MEMORY_CACHE_TTL_SECONDS", "43200"))

_cache: TTLCache[CacheKey, Any] = TTLCache(ttl_seconds=TTL_SECONDS)
_detail_cache: TTLCache[DetailCacheKey, Any] = TTLCache(ttl_seconds=TTL_SECONDS)
_files_cache: TTLCache[FilesCacheKey, Any] = TTLCache(ttl_seconds=TTL_SECONDS)
_file_detail_cache: TTLCache[FileDetailCacheKey, Any] = TTLCache(ttl_seconds=TTL_SECONDS)
_server_pack_cache: TTLCache[ServerPackCacheKey, bool] = TTLCache(ttl_seconds=TTL_SECONDS)


def get_cached(key: CacheKey):
    return _cache.get(key)


def set_cached(key: CacheKey, value: Any):
    _cache.set(key, value)


def clear_cached(key: CacheKey) -> None:
    _cache.delete(key)


def get_cached_detail(key: DetailCacheKey):
    return _detail_cache.get(key)


def set_cached_detail(key: DetailCacheKey, value: Any):
    _detail_cache.set(key, value)


def clear_cached_detail(key: DetailCacheKey) -> None:
    _detail_cache.delete(key)


def get_cached_files(key: FilesCacheKey):
    return _files_cache.get(key)


def set_cached_files(key: FilesCacheKey, value: Any):
    _files_cache.set(key, value)


def clear_cached_files(key: FilesCacheKey) -> None:
    _files_cache.delete(key)


def get_cached_file_detail(key: FileDetailCacheKey):
    return _file_detail_cache.get(key)


def set_cached_file_detail(key: FileDetailCacheKey, value: Any):
    _file_detail_cache.set(key, value)


def clear_cached_file_detail(key: FileDetailCacheKey) -> None:
    _file_detail_cache.delete(key)


def get_cached_server_pack(key: ServerPackCacheKey):
    return _server_pack_cache.get(key)


def set_cached_server_pack(key: ServerPackCacheKey, value: bool):
    _server_pack_cache.set(key, value)


def clear_cached_server_pack(key: ServerPackCacheKey) -> None:
    _server_pack_cache.delete(key)


def clear_all() -> None:
    _cache.clear()
    _detail_cache.clear()
    _files_cache.clear()
    _file_detail_cache.clear()
    _server_pack_cache.clear()
