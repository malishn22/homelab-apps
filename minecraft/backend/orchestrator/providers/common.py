"""Shared utility functions used by both Modrinth and CurseForge providers."""

import logging
import shutil
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

import requests

from ..state import _log_line

log = logging.getLogger(__name__)


def download_file(url: str, dest: Path) -> None:
    """Stream-download a file from url to dest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    fh.write(chunk)


def extract_archive(archive_path: Path, dest_dir: Path) -> None:
    """Extract a .zip, .mrpack, or tar archive into dest_dir."""
    from ..state import OrchestratorError

    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = archive_path.suffix.lower()

    if suffix in (".zip", ".mrpack"):
        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(dest_dir)
        return

    if tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path, "r:*") as tf:
            tf.extractall(dest_dir)
        return

    raise OrchestratorError(f"Unsupported archive format: {archive_path.name}")


def copy_overrides(root: Path) -> None:
    """Copy the 'overrides' directory contents into the server root."""
    overrides = root / "overrides"
    if not overrides.exists():
        return
    for item in overrides.rglob("*"):
        if item.is_dir():
            continue
        rel = item.relative_to(overrides)
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


def strip_loader_mismatch_mods(
    instance_id: str, root: Path, loader: Optional[str]
) -> None:
    """
    Strip mods incompatible with the detected loader.
    - forge/None: strip NeoForge mods
    - neoforge: strip Forge mods
    """
    mods_dir = root / "mods"
    if not mods_dir.exists():
        return
    removed_dir = mods_dir / "__loader_mismatch_removed"
    removed_dir.mkdir(parents=True, exist_ok=True)
    for jar in mods_dir.rglob("*.jar"):
        if "__loader_mismatch_removed" in jar.parts:
            continue
        name_lower = jar.name.lower()
        should_remove = False
        reason = ""
        if loader in ("forge", None):
            if "neoforge" in name_lower and "forge" not in name_lower.replace("neoforge", ""):
                should_remove = True
                reason = "NeoForge mod (incompatible with Forge)"
        elif loader == "neoforge":
            if "forge" in name_lower and "neoforge" not in name_lower:
                should_remove = True
                reason = "Forge mod (incompatible with NeoForge)"

        if should_remove:
            try:
                target = removed_dir / jar.name
                if target.exists():
                    target.unlink()
                jar.rename(target)
                _log_line(instance_id, f"[PREP] Removed {reason}: {jar.name}")
            except Exception as exc:
                _log_line(instance_id, f"[PREP] Failed to remove {jar.name}: {exc}")
