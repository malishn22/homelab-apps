import json
import logging
import re
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from urllib.parse import unquote

import requests

from .base import ModpackProvider
from ..state import _log_line, OrchestratorError

# We need to import the helper functions or copy them.
# For now, to keep it clean, I'll copy the necessary logic or import if it was shared.
# But since we are refactoring, I will transplant the logic here.

log = logging.getLogger(__name__)

STATUS_PREPARING = "PREPARING"

class ModrinthProvider(ModpackProvider):
    def resolve_server_pack(self, project_id: str, version_id: str) -> str:
        # In the current implementation, file_url is passed directly to prepare_instance_files
        # The caller (services/servers.py) calls resolve_server_file_url first.
        # We can keep that separation for now, or move it here.
        # For this refactor, let's assume valid file_url is passed to install_server_pack.
        return "" 

    def install_server_pack(
        self,
        project_id: str,
        version_id: str,
        file_url: str,
        instance_dir: Path,
        extract_dir: Path,
    ) -> Tuple[Path, Optional[str]]:
        
        pack_path = instance_dir / "serverpack"
        pack_path.mkdir(parents=True, exist_ok=True)
        
        archive_path = pack_path / Path(file_url).name
        version_hint = unquote(archive_path.name)
        
        _log_line(self.instance_id, f"[PREP] Downloading server pack {archive_path.name}")
        self._download(file_url, archive_path)
        
        _log_line(self.instance_id, f"[PREP] Extracting {archive_path.name}")
        self._extract_archive(archive_path, extract_dir)
        
        mc_version = None
        
        # Hydrate based on file type
        if archive_path.suffix.lower() == ".mrpack":
            self._hydrate_mrpack(extract_dir)
            
        # Always strip client-only mods, as metadata is often incorrect
        self._strip_client_only_mods(extract_dir)
        mc_version = self._detect_minecraft_version_from_root(extract_dir)
            
        return extract_dir, mc_version

    def generate_start_command(
        self,
        root: Path,
        ram_mb: int,
        project_id: str,
        version_id: str,
        version_hint: Optional[str] = None
    ) -> Tuple[List[str], Optional[str]]:
        
        from ..utils import detect_generic_start_command
        
        # Try generic detection
        cmd, entry = detect_generic_start_command(root, ram_mb, instance_id=self.instance_id)
        if cmd:
            return cmd, entry

        # Fallback: Check if we need to download a Forge installer based on modrinth.index.json
        installer = self._maybe_fetch_forge_installer(root)
        if installer and installer.exists():
             rel_installer = installer.relative_to(root)
             rel_dir = rel_installer.parent.as_posix()
             cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
             
             # Basic install + run command for Forge
             install_cmd = f"{cd_prefix}java -jar {rel_installer.name} --installServer"
             
             # Attempt to guess run command after install
             # Use M suffix for MB
             run_cmd = f"{cd_prefix}java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {rel_installer.name} nogui" 
             
             forge_version = ""
             name = rel_installer.name
             if "forge-" in name and "-installer" in name:
                # e.g. forge-1.20.1-47.1.0-installer.jar -> 1.20.1-47.1.0
                forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
             
             if forge_version:
                 run_cmd = (
                    f"{cd_prefix}if [ -f libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt ]; then "
                    f"if [ ! -f user_jvm_args.txt ]; then "
                    f": > user_jvm_args.txt; fi; "
                    f"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui; "
                    f"else java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui; fi"
                )

             return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()
            
        raise OrchestratorError("Could not detect start command in server pack")

    def _maybe_fetch_forge_installer(self, root: Path) -> Optional[Path]:
        index_path = root / "modrinth.index.json"
        if not index_path.exists():
            return None
        
        try:
            manifest = json.loads(index_path.read_text())
        except Exception:
            return None
            
        deps = manifest.get("dependencies") or {}
        mc_version = deps.get("minecraft")
        forge_version = deps.get("forge") or deps.get("neoforge")
        
        if not mc_version or not forge_version:
            return None
            
        version_str = f"{mc_version}-{forge_version}"
        installer_name = f"forge-{version_str}-installer.jar"
        installer = root / installer_name
        
        if installer.exists():
            return installer
            
        url = f"https://maven.minecraftforge.net/net/minecraftforge/forge/{version_str}/{installer_name}"
        
        try:
            _log_line(self.instance_id, f"[PREP] Downloading Forge installer {installer_name}")
            self._download(url, installer)
            return installer
        except Exception as exc:
            _log_line(self.instance_id, f"[PREP] Failed to download Forge installer: {exc}")
            return None

    # --- Helpers ---

    def _download(self, url: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        fh.write(chunk)

    def _extract_archive(self, archive_path: Path, dest_dir: Path) -> None:
        import tarfile
        import zipfile
        dest_dir.mkdir(parents=True, exist_ok=True)
        suffix = archive_path.suffix.lower()
        if suffix in [".zip", ".mrpack"]:
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(dest_dir)
            return

        if tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, "r:*") as tf:
                tf.extractall(dest_dir)
            return
        raise OrchestratorError(f"Unsupported archive format: {archive_path.name}")

    def _hydrate_mrpack(self, root: Path) -> None:
        index_path = root / "modrinth.index.json"
        if not index_path.exists():
            return
        try:
            manifest = json.loads(index_path.read_text())
        except Exception as exc:
            _log_line(self.instance_id, f"[PREP] Failed to parse modrinth.index.json: {exc}")
            return
            
        files = manifest.get("files") or []
        for entry in files:
            env_server = (entry.get("env", {}).get("server") or "").lower()
            if env_server == "unsupported":
                continue
            path = entry.get("path")
            downloads = entry.get("downloads") or []
            if not path or not downloads:
                continue
            url = downloads[0]
            dest = root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                # Optimized: We could use _download here multiple times
                # For refactor, we just call self._download
                _log_line(self.instance_id, f"[PREP] Downloading {path}")
                self._download(url, dest)
            except Exception as exc:
                _log_line(self.instance_id, f"[PREP] Failed to download {path}: {exc}")
        
        self._copy_overrides(root) # mrpack also has overrides

    def _copy_overrides(self, root: Path) -> None:
        import shutil
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

    def _strip_client_only_mods(self, root: Path) -> None:
        mods_dir = root / "mods"
        if not mods_dir.exists():
            _log_line(self.instance_id, "[PREP] No mods directory found to strip")
            return
        
        # Patterns should be in lowercase and usually use underscores or specific keywords
        CLIENT_ONLY_PATTERNS = [
            "legendarytooltips", "xaeros", "xaero",
            "journeymap", "fancymenu", "tooltipfix",
            "imblocker", "fast-ip-ping", "skinlayers", "3dskinlayers",
            "entity_texture_features", "etf", "entity_model_features", "emf",
            "sound_physics", "dynamicsounds", "dynamiclights",
            "oculus", "iris", "better-selection", "chat_heads",
            "controlling", "catalogue", "appleskin", "inventoryhud",
            "toastcontrol", "mouse-tweaks", "screenshot",
            "okzoomer", "zoomify", "wi_zoom",
            "shutupexperimentalsettings",
            "configured", "defaultoptions",
            "drippyloadingscreen", "notenoughanimations",
            "betterthirdperson", "waveycapes", "ambientenvironment",
            "smoothscroll", "zume", "citresewn", "jecharacters",
            "hide_key_binding", "badoptimizations", "ears", "interactic"
        ]
        
        removed_dir = mods_dir / "__client_only_removed"
        removed_dir.mkdir(parents=True, exist_ok=True)
        
        files = list(mods_dir.glob("*.jar"))
        _log_line(self.instance_id, f"[PREP] Scanning {len(files)} mods for client-only files")
        
        for jar in files:
            # Normalize filename: lowercase and replace hyphens with underscores
            # This ensures "hide-key-binding" matches "hide_key_binding"
            name_normalized = jar.name.lower().replace("-", "_")
            
            if any(pattern in name_normalized for pattern in CLIENT_ONLY_PATTERNS):
                target = removed_dir / jar.name
                try:
                    # Check if target exists (e.g. from previous run), if so delete it first
                    if target.exists():
                        target.unlink()
                    jar.rename(target)
                    _log_line(self.instance_id, f"[PREP] Removed client-only mod: {jar.name}")
                except Exception as exc:
                    _log_line(self.instance_id, f"[PREP] Failed to remove {jar.name}: {exc}")

    def _detect_minecraft_version_from_root(self, root: Path) -> Optional[str]:
        from ..utils import detect_minecraft_version_from_root
        return detect_minecraft_version_from_root(root)
