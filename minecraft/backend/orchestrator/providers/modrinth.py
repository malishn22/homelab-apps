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
        server_dir: Path,
    ) -> Tuple[Path, Optional[str]]:
        pack_path = server_dir / ".serverpack"
        pack_path.mkdir(parents=True, exist_ok=True)

        archive_path = pack_path / Path(file_url).name
        version_hint = unquote(archive_path.name)

        _log_line(self.instance_id, f"[PREP] Downloading server pack {archive_path.name}")
        self._download(file_url, archive_path)

        _log_line(self.instance_id, f"[PREP] Extracting {archive_path.name}")
        self._extract_archive(archive_path, server_dir)

        mc_version = None

        # Hydrate based on file type
        if archive_path.suffix.lower() == ".mrpack":
            self._hydrate_mrpack(server_dir)

        # Always strip client-only mods, as metadata is often incorrect
        self._strip_client_only_mods(server_dir)
        # Loader-aware strip: strip opposite loader mods
        loader = self._detect_loader_from_index(server_dir)
        self._strip_loader_mismatch_mods(server_dir, loader)
        mc_version = self._detect_minecraft_version_from_root(server_dir)

        return server_dir, mc_version

    def generate_start_command(
        self,
        root: Path,
        ram_mb: int,
        project_id: str,
        version_id: str,
        version_hint: Optional[str] = None
    ) -> Tuple[List[str], Optional[str]]:
        
        from ..utils import detect_generic_start_command, _find_unix_args_path

        # When index explicitly specifies forge/neoforge, prefer our installer to ensure correct loader
        # (generic scripts may install the wrong loader and cause mod mismatch crashes)
        installer, loader = self._maybe_fetch_forge_or_neoforge_installer(root)
        if installer and installer.exists():
             rel_installer = installer.relative_to(root)
             rel_dir = rel_installer.parent.as_posix()
             cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
             
             # Basic install + run command
             install_cmd = f"{cd_prefix}java -jar {rel_installer.name} --installServer"
             
             name = rel_installer.name
             run_cmd = f"{cd_prefix}java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui"
             
             if "neoforge-" in name and "-installer" in name:
                unix_args_path = _find_unix_args_path(root)
                if unix_args_path:
                    run_cmd = (
                        f"{cd_prefix}if [ -f {unix_args_path} ]; then "
                        f"if [ ! -f user_jvm_args.txt ]; then : > user_jvm_args.txt; fi; "
                        f"java @user_jvm_args.txt @{unix_args_path} nogui; "
                        f"else java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui; fi"
                    )
                else:
                    # e.g. neoforge-21.1.168-installer.jar -> 21.1.168
                    neoforge_version = name.split("neoforge-", 1)[1].rsplit("-installer", 1)[0]
                    neoforge_jar = f"neoforge-{neoforge_version}.jar"
                    run_cmd = (
                        f"{cd_prefix}if [ -f libraries/net/neoforged/neoforge/{neoforge_version}/unix_args.txt ]; then "
                        f"if [ ! -f user_jvm_args.txt ]; then : > user_jvm_args.txt; fi; "
                        f"java @user_jvm_args.txt @libraries/net/neoforged/neoforge/{neoforge_version}/unix_args.txt nogui; "
                        f"elif [ -f {neoforge_jar} ]; then "
                        f"java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {neoforge_jar} nogui; "
                        f"else java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui; fi"
                    )
             elif "forge-" in name and "-installer" in name:
                unix_args_path = _find_unix_args_path(root)
                if unix_args_path:
                    run_cmd = (
                        f"{cd_prefix}if [ -f {unix_args_path} ]; then "
                        f"if [ ! -f user_jvm_args.txt ]; then : > user_jvm_args.txt; fi; "
                        f"java @user_jvm_args.txt @{unix_args_path} nogui; "
                        f"else java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui; fi"
                    )
                else:
                    # e.g. forge-1.20.1-47.1.0-installer.jar -> 1.20.1-47.1.0
                    forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
                    forge_jar = f"forge-{forge_version}.jar"
                    forge_universal = f"forge-{forge_version}-universal.jar"
                    run_cmd = (
                        f"{cd_prefix}if [ -f libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt ]; then "
                        f"if [ ! -f user_jvm_args.txt ]; then : > user_jvm_args.txt; fi; "
                        f"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui; "
                        f"elif [ -f {forge_jar} ]; then "
                        f"java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {forge_jar} nogui; "
                        f"elif [ -f {forge_universal} ]; then "
                        f"java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {forge_universal} nogui; "
                        f"else java -Xms{ram_mb}M -Xmx{ram_mb}M -jar {name} nogui; fi"
                    )

             return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

        # Fallback: generic detection (scripts, jars, etc.)
        cmd, entry = detect_generic_start_command(root, ram_mb, instance_id=self.instance_id)
        if cmd:
            return cmd, entry

        raise OrchestratorError("Could not detect start command in server pack")

    def _detect_loader_from_index(self, root: Path) -> Optional[str]:
        """Return 'forge', 'neoforge', or None based on modrinth.index.json dependencies."""
        index_path = root / "modrinth.index.json"
        if not index_path.exists():
            return None
        try:
            manifest = json.loads(index_path.read_text())
        except Exception:
            return None
        deps = manifest.get("dependencies") or {}
        if deps.get("neoforge"):
            return "neoforge"
        if deps.get("forge"):
            return "forge"
        return None

    def _maybe_fetch_forge_or_neoforge_installer(self, root: Path) -> Tuple[Optional[Path], Optional[str]]:
        """Return (installer_path, loader) with loader in ('forge','neoforge')."""
        index_path = root / "modrinth.index.json"
        if not index_path.exists():
            return None, None
        try:
            manifest = json.loads(index_path.read_text())
        except Exception:
            return None, None
        deps = manifest.get("dependencies") or {}
        mc_version = deps.get("minecraft")

        # NeoForge first
        neoforge_version = deps.get("neoforge")
        if neoforge_version:
            version_str = neoforge_version  # e.g. 21.1.168
            installer_name = f"neoforge-{version_str}-installer.jar"
            installer = root / installer_name
            if installer.exists():
                return installer, "neoforge"
            url = f"https://maven.neoforged.net/releases/net/neoforged/neoforge/{version_str}/{installer_name}"
            try:
                _log_line(self.instance_id, f"[PREP] Downloading NeoForge installer {installer_name}")
                self._download(url, installer)
                return installer, "neoforge"
            except Exception as exc:
                _log_line(self.instance_id, f"[PREP] Failed to download NeoForge installer: {exc}")
                return None, "neoforge"

        # Forge second
        forge_version = deps.get("forge")
        if mc_version and forge_version:
            version_str = f"{mc_version}-{forge_version}"
            installer_name = f"forge-{version_str}-installer.jar"
            installer = root / installer_name
            if installer.exists():
                return installer, "forge"
            url = f"https://maven.minecraftforge.net/net/minecraftforge/forge/{version_str}/{installer_name}"
            try:
                _log_line(self.instance_id, f"[PREP] Downloading Forge installer {installer_name}")
                self._download(url, installer)
                return installer, "forge"
            except Exception as exc:
                _log_line(self.instance_id, f"[PREP] Failed to download Forge installer: {exc}")
                return None, "forge"

        return None, None

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

    def _strip_loader_mismatch_mods(self, root: Path, loader: Optional[str]) -> None:
        """
        Strip mods incompatible with the detected loader.
        - forge: strip NeoForge mods (neoforge in name, not forge)
        - neoforge: strip Forge mods (forge in name, not neoforge)
        - None: strip NeoForge mods defensively (packs often end up with Forge from generic scripts)
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
            if loader in ("forge", None):
                # Strip NeoForge mods (when None, assume Forge - generic scripts often install Forge)
                if "neoforge" in name_lower and "forge" not in name_lower.replace("neoforge", ""):
                    try:
                        target = removed_dir / jar.name
                        if target.exists():
                            target.unlink()
                        jar.rename(target)
                        _log_line(self.instance_id, f"[PREP] Removed NeoForge mod (incompatible with Forge): {jar.name}")
                    except Exception as exc:
                        _log_line(self.instance_id, f"[PREP] Failed to remove {jar.name}: {exc}")
            elif loader == "neoforge":
                # Strip Forge mods (forge in name but not neoforge)
                if "forge" in name_lower and "neoforge" not in name_lower:
                    try:
                        target = removed_dir / jar.name
                        if target.exists():
                            target.unlink()
                        jar.rename(target)
                        _log_line(self.instance_id, f"[PREP] Removed Forge mod (incompatible with NeoForge): {jar.name}")
                    except Exception as exc:
                        _log_line(self.instance_id, f"[PREP] Failed to remove {jar.name}: {exc}")

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
