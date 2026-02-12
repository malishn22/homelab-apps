"""File list/read/write for server instances."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from .runtime import _server_run_dirs
from .state import OrchestratorError, get_instance

log = logging.getLogger(__name__)

# Editable text file extensions
ALLOWED_EXTENSIONS = {".properties", ".txt", ".json", ".toml", ".yaml", ".yml", ".cfg"}
MAX_FILE_SIZE = 512 * 1024  # 512 KB


def _instance_root(instance_id: str) -> Path:
    """Return the instance server directory. Prefer runtime dir when it exists (used by container)."""
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    server_dir_container, _ = _server_run_dirs(instance_id)
    extract_dir = instance.get("extract_dir")
    extract_path = Path(extract_dir) if extract_dir else None

    # Prefer server_dir (runtime) when it exists - that's what the container uses
    if server_dir_container.exists():
        return server_dir_container
    if extract_path and extract_path.exists():
        return extract_path
    if extract_dir:
        return Path(extract_dir)
    return server_dir_container


def _resolve_path(instance_id: str, relative_path: str) -> Path:
    """Resolve relative path to absolute, ensuring it stays within instance root."""
    root = _instance_root(instance_id)
    # Normalize: remove leading slashes, resolve ".."
    path_str = relative_path.strip().lstrip("/")
    if not path_str:
        return root
    if ".." in path_str:
        raise OrchestratorError("Path traversal not allowed")
    resolved = (root / path_str).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise OrchestratorError("Path must be within instance directory") from None
    return resolved


def get_instance_files_or_content(instance_id: str, path: str = "") -> Dict[str, Any]:
    """
    If path is a directory: return {"files": [...], "dirs": [...]}.
    If path is a file: return {"content": "..."}.
    """
    base = _resolve_path(instance_id, path)
    if not base.exists():
        return {"files": [], "dirs": []}

    if base.is_file():
        content = read_instance_file(instance_id, path)
        return {"content": content}

    files: List[Dict[str, str]] = []
    dirs: List[Dict[str, str]] = []

    root = _instance_root(instance_id)
    for item in sorted(base.iterdir()):
        rel = item.relative_to(root)
        rel_str = rel.as_posix()
        entry = {"name": item.name, "path": rel_str}
        if item.is_dir():
            dirs.append(entry)
        else:
            suffix = item.suffix.lower()
            if suffix in ALLOWED_EXTENSIONS or suffix == "":
                files.append(entry)

    return {"files": files, "dirs": dirs}


def read_instance_file(instance_id: str, path: str) -> str:
    """Read file content as UTF-8 text."""
    fp = _resolve_path(instance_id, path)
    if not fp.exists():
        raise OrchestratorError("File not found")
    if fp.is_dir():
        raise OrchestratorError("Path is a directory, not a file")

    suffix = fp.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS and suffix != "":
        raise OrchestratorError(f"File type not allowed: {suffix}")

    size = fp.stat().st_size
    if size > MAX_FILE_SIZE:
        raise OrchestratorError(f"File too large (max {MAX_FILE_SIZE // 1024} KB)")

    return fp.read_text(encoding="utf-8", errors="replace")


def write_instance_file(instance_id: str, path: str, content: str) -> None:
    """Write file content (UTF-8). Creates parent dirs if needed."""
    fp = _resolve_path(instance_id, path)
    if fp.is_dir():
        raise OrchestratorError("Path is a directory, not a file")

    suffix = fp.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS and suffix != "":
        raise OrchestratorError(f"File type not allowed: {suffix}")

    if len(content.encode("utf-8")) > MAX_FILE_SIZE:
        raise OrchestratorError(f"Content too large (max {MAX_FILE_SIZE // 1024} KB)")

    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(content, encoding="utf-8")


def delete_instance_file_or_dir(instance_id: str, path: str) -> None:
    """Delete a file or directory. Path must be within instance root."""
    fp = _resolve_path(instance_id, path)
    if not fp.exists():
        raise OrchestratorError("Path not found")
    root = _instance_root(instance_id)
    if fp == root:
        raise OrchestratorError("Cannot delete instance root")
    try:
        fp.relative_to(root)
    except ValueError:
        raise OrchestratorError("Path must be within instance directory") from None
    if fp.is_file():
        fp.unlink()
    else:
        shutil.rmtree(fp)
