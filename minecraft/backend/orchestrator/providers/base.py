from __future__ import annotations

import abc
from pathlib import Path
from typing import Dict, List, Optional, Tuple

class ModpackProvider(abc.ABC):
    """
    Abstract base class for modpack providers (Modrinth, CurseForge, FTB, etc.).
    """

    def __init__(self, instance_id: str, data_dir: Path):
        self.instance_id = instance_id
        self.data_dir = data_dir
        # Derived classes can store whatever else they need

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
        instance_dir: Path,
        extract_dir: Path,
    ) -> Tuple[Path, Optional[str]]:
        """
        Download and hydrate the server pack.
        Returns (extract_root_path, detected_minecraft_version).
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
