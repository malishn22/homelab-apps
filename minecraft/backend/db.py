import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote_plus

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json


def _build_conninfo() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]

    host = os.environ.get("MINECRAFT_DB_HOST", "localhost")
    port = os.environ.get("MINECRAFT_DB_PORT", "5432")
    name = os.environ.get("MINECRAFT_DB_NAME", "minecraft")
    user = os.environ.get("MINECRAFT_DB_USER", "minecraft")
    password = os.environ.get("MINECRAFT_DB_PASSWORD", "minecraft")

    return f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{name}"


CONNINFO = _build_conninfo()


def get_connection() -> psycopg.Connection:
    return psycopg.connect(CONNINFO, row_factory=dict_row)


def init_db() -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS modpacks (
                project_id TEXT PRIMARY KEY,
                slug TEXT,
                title TEXT NOT NULL,
                icon_url TEXT,
                downloads BIGINT,
                followers BIGINT,
                updated TEXT,
                date_modified TEXT,
                date_created TEXT,
                description TEXT,
                author TEXT,
                categories JSONB DEFAULT '[]'::jsonb,
                game_versions JSONB DEFAULT '[]'::jsonb,
                versions JSONB DEFAULT '[]'::jsonb,
                loaders JSONB DEFAULT '[]'::jsonb,
                server_side TEXT,
                server_versions JSONB DEFAULT '[]'::jsonb,
                refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_modpacks_downloads ON modpacks (downloads DESC);
            """
        )
        cur.execute(
            """
            ALTER TABLE modpacks
            ADD COLUMN IF NOT EXISTS server_side TEXT;
            """
        )
        cur.execute(
            """
            ALTER TABLE modpacks
            ADD COLUMN IF NOT EXISTS server_versions JSONB DEFAULT '[]'::jsonb;
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS modpack_search_cache (
                cache_key TEXT PRIMARY KEY,
                payload JSONB NOT NULL,
                cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS curseforge_server_pack_cache (
                mod_id BIGINT PRIMARY KEY,
                has_server_pack BOOLEAN NOT NULL,
                server_files JSONB,
                cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_modpack_search_cached_at
            ON modpack_search_cache (cached_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_curseforge_server_pack_cached_at
            ON curseforge_server_pack_cache (cached_at DESC);
            """
        )


def _coerce_list(value: Optional[Iterable[str]]) -> List[str]:
    if not value:
        return []
    return [str(item) for item in value]


def save_modpacks(modpacks: Iterable[Dict[str, Any]], refreshed_at: str) -> int:
    rows = []
    for item in modpacks:
        project_id = item.get("project_id") or item.get("slug")
        if not project_id:
            continue
        rows.append(
            (
                project_id,
                item.get("slug"),
                item.get("title") or "Untitled",
                item.get("icon_url"),
                item.get("downloads"),
                item.get("followers"),
                item.get("updated"),
                item.get("date_modified"),
                item.get("date_created"),
                item.get("description"),
                item.get("author"),
                Json(_coerce_list(item.get("categories"))),
                Json(_coerce_list(item.get("game_versions"))),
                Json(_coerce_list(item.get("versions"))),
                Json(_coerce_list(item.get("loaders"))),
                item.get("server_side"),
                Json(item.get("server_versions") or []),
                refreshed_at,
            )
        )

    if not rows:
        return 0

    with get_connection() as conn, conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO modpacks (
                project_id, slug, title, icon_url, downloads, followers,
                updated, date_modified, date_created, description, author,
                categories, game_versions, versions, loaders, server_side, server_versions, refreshed_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id) DO UPDATE SET
                slug = EXCLUDED.slug,
                title = EXCLUDED.title,
                icon_url = EXCLUDED.icon_url,
                downloads = EXCLUDED.downloads,
                followers = EXCLUDED.followers,
                updated = EXCLUDED.updated,
                date_modified = EXCLUDED.date_modified,
                date_created = EXCLUDED.date_created,
                description = EXCLUDED.description,
                author = EXCLUDED.author,
                categories = EXCLUDED.categories,
                game_versions = EXCLUDED.game_versions,
                versions = EXCLUDED.versions,
                loaders = EXCLUDED.loaders,
                server_side = EXCLUDED.server_side,
                server_versions = EXCLUDED.server_versions,
                refreshed_at = EXCLUDED.refreshed_at;
            """,
            rows,
        )
        return len(rows)


def fetch_modpacks(limit: int) -> List[Dict[str, Any]]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                project_id, slug, title, icon_url, downloads, followers,
                updated, date_modified, date_created, description, author,
                categories, game_versions, versions, loaders, server_side, server_versions, refreshed_at
            FROM modpacks
            ORDER BY downloads DESC NULLS LAST, title ASC
            LIMIT %s;
            """,
            (limit,),
        )
        rows = cur.fetchall()

    result: List[Dict[str, Any]] = []
    for row in rows:
        refreshed_at_value = row.get("refreshed_at")
        result.append(
            {
                "project_id": row.get("project_id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "icon_url": row.get("icon_url"),
                "downloads": row.get("downloads"),
                "followers": row.get("followers"),
                "updated": row.get("updated"),
                "date_modified": row.get("date_modified"),
                "date_created": row.get("date_created"),
                "description": row.get("description"),
                "author": row.get("author"),
                "categories": row.get("categories") or [],
                "game_versions": row.get("game_versions") or [],
                "versions": row.get("versions") or [],
                "loaders": row.get("loaders") or [],
                "server_side": row.get("server_side"),
                "server_versions": row.get("server_versions") or [],
                "refreshed_at": refreshed_at_value.isoformat() if refreshed_at_value else None,
            }
        )

    return result


def count_modpacks() -> int:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM modpacks;")
        row = cur.fetchone()
    return int(row["count"] if row and row.get("count") is not None else 0)


def get_last_refresh() -> Optional[str]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT MAX(refreshed_at) AS refreshed_at FROM modpacks;")
        row = cur.fetchone()
    refreshed_at_value = row.get("refreshed_at") if row else None
    if refreshed_at_value:
        return refreshed_at_value.isoformat()
    return None


def fetch_modpack_by_id(project_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                project_id, slug, title, icon_url, downloads, followers,
                updated, date_modified, date_created, description, author,
                categories, game_versions, versions, loaders, server_versions, refreshed_at
            FROM modpacks
            WHERE project_id = %s;
            """,
            (project_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    refreshed_at_value = row.get("refreshed_at")
    return {
        "project_id": row.get("project_id"),
        "slug": row.get("slug"),
        "title": row.get("title"),
        "icon_url": row.get("icon_url"),
        "downloads": row.get("downloads"),
        "followers": row.get("followers"),
        "updated": row.get("updated"),
        "date_modified": row.get("date_modified"),
        "date_created": row.get("date_created"),
        "description": row.get("description"),
        "author": row.get("author"),
        "categories": row.get("categories") or [],
        "game_versions": row.get("game_versions") or [],
        "versions": row.get("versions") or [],
        "loaders": row.get("loaders") or [],
        "server_versions": row.get("server_versions") or [],
        "refreshed_at": refreshed_at_value.isoformat() if refreshed_at_value else None,
    }


def get_search_cache(cache_key: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT payload, cached_at
            FROM modpack_search_cache
            WHERE cache_key = %s;
            """,
            (cache_key,),
        )
        row = cur.fetchone()

    if not row:
        return None
    cached_at = row.get("cached_at")
    if not cached_at:
        return None
    now = datetime.now(timezone.utc)
    if now - cached_at > timedelta(seconds=ttl_seconds):
        return None
    return row.get("payload")


def set_search_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO modpack_search_cache (cache_key, payload, cached_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (cache_key) DO UPDATE SET
                payload = EXCLUDED.payload,
                cached_at = EXCLUDED.cached_at;
            """,
            (cache_key, Json(payload)),
        )


def clear_search_cache(cache_key: str) -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM modpack_search_cache
            WHERE cache_key = %s;
            """,
            (cache_key,),
        )


def get_curseforge_server_pack_cache(
    mod_id: int, ttl_seconds: int
) -> Optional[Dict[str, Any]]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT has_server_pack, server_files, cached_at
            FROM curseforge_server_pack_cache
            WHERE mod_id = %s;
            """,
            (mod_id,),
        )
        row = cur.fetchone()

    if not row:
        return None
    cached_at = row.get("cached_at")
    if not cached_at:
        return None
    now = datetime.now(timezone.utc)
    if now - cached_at > timedelta(seconds=ttl_seconds):
        return None
    return {
        "has_server_pack": bool(row.get("has_server_pack")),
        "server_files": row.get("server_files"),
    }


def set_curseforge_server_pack_cache(
    mod_id: int, has_server_pack: bool, server_files: Optional[List[Dict[str, Any]]] = None
) -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO curseforge_server_pack_cache (
                mod_id, has_server_pack, server_files, cached_at
            )
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (mod_id) DO UPDATE SET
                has_server_pack = EXCLUDED.has_server_pack,
                server_files = EXCLUDED.server_files,
                cached_at = EXCLUDED.cached_at;
            """,
            (mod_id, has_server_pack, Json(server_files) if server_files is not None else None),
        )
