"""Generic in-memory TTL cache used across all services."""

from __future__ import annotations

import time
from typing import Generic, Hashable, Optional, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    """
    Simple in-memory cache with per-entry TTL expiration.

    Usage:
        cache = TTLCache[str, dict](ttl_seconds=300)
        cache.set("key", {"data": 1})
        val = cache.get("key")  # returns {"data": 1} or None if expired
    """

    def __init__(self, ttl_seconds: int = 300):
        self._ttl = ttl_seconds
        self._store: dict[K, tuple[float, V]] = {}

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def get(self, key: K) -> Optional[V]:
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.time() - ts > self._ttl:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: K, value: V) -> None:
        self._store[key] = (time.time(), value)

    def delete(self, key: K) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __contains__(self, key: K) -> bool:
        return self.get(key) is not None

    def __len__(self) -> int:
        return len(self._store)
