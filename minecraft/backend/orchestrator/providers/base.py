from __future__ import annotations

import abc
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .common import (
    download_file,
    extract_archive,
    copy_overrides,
    strip_loader_mismatch_mods,
)


class ModpackProvider(abc.ABC):
    """
    Abstract base class for modpack providers (Modrinth, CurseForge, FTB, etc.).

    Provides concrete implementations for common operations (download, extract,
    overrides, mod stripping) via the `common` module.
    """

    def __init__(self, instance_id: str, data_dir: Path):
        self.instance_id = instance_id
        self.data_dir = data_dir

    # --- Concrete shared helpers (delegate to common module) ---

    def _download(self, url: str, dest: Path) -> None:
        download_file(url, dest)

    def _extract_archive(self, archive_path: Path, dest_dir: Path) -> None:
        extract_archive(archive_path, dest_dir)

    def _copy_overrides(self, root: Path) -> None:
        copy_overrides(root)

    def _strip_loader_mismatch_mods(self, root: Path, loader: Optional[str]) -> None:
        strip_loader_mismatch_mods(self.instance_id, root, loader)

    # --- Abstract methods for provider-specific logic ---

    @abc.abstractmethod
    def resolve_server_pack(self, project_id: str, version_id: str) -> str:
        """
        Return the direct URL to the server pack (or equivalent) for downloading.
        """
        pass

    @abc.abstractmethod
    def install_server_pack(
        self,
        project_id: str,
        version_id: str,
        file_url: str,
        server_dir: Path,
    ) -> Tuple[Path, Optional[str]]:
        """
        Download and hydrate the server pack into server_dir.
        Returns (server_root_path, detected_minecraft_version).
        """
        pass

    @abc.abstractmethod
    def generate_start_command(
        self,
        root: Path,
        ram_mb: int,
        project_id: str,
        version_id: str,
        version_hint: Optional[str] = None
    ) -> Tuple[List[str], Optional[str]]:
        """
        Detect or generate the start command for the server.
        Returns (command_list, path_to_entry_script_relative_to_root).
        """
        pass
