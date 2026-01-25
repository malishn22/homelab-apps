from pathlib import Path
from typing import Optional

from .base import ModpackProvider
from .modrinth import ModrinthProvider
from .curseforge import CurseForgeProvider

def get_provider(
    source: Optional[str],
    instance_id: str,
    data_dir: Path
) -> ModpackProvider:
    """
    Factory function to return the correct provider.
    """
    source_key = (source or "").strip().lower()
    
    if source_key == "curseforge":
        return CurseForgeProvider(instance_id, data_dir)
    
    # Default to Modrinth provider which also handles generic cases
    return ModrinthProvider(instance_id, data_dir)
