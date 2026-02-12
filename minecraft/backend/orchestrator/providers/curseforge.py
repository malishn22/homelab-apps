import json
import logging
import os
import re
import requests
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from urllib.parse import unquote, urlparse

from .base import ModpackProvider
from ..state import _log_line, OrchestratorError

log = logging.getLogger(__name__)

class CurseForgeProvider(ModpackProvider):
    
    # --- Helpers specific to CurseForge ---
    def _curseforge_base_url(self) -> str:
        return os.environ.get("CURSEFORGE_BASE_URL", "https://api.curseforge.com/v1").rstrip("/")

    def _curseforge_api_key(self) -> str:
        key = os.environ.get("CURSEFORGE_API_KEY")
        if not key:
            raise OrchestratorError("CURSEFORGE_API_KEY is not configured.")
        return key

    def _curseforge_download_url(self, project_id: int, file_id: int) -> str:
        resp = requests.get(
            f"{self._curseforge_base_url()}/mods/{project_id}/files/{file_id}/download-url",
            headers={"x-api-key": self._curseforge_api_key()},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        url = data.get("data")
        if not url:
            raise OrchestratorError("CurseForge did not return a download URL.")
        return url

    def _filename_from_url(self, url: str, fallback: str) -> str:
        path = urlparse(url).path
        name = Path(path).name
        if name:
            return unquote(name)
        return fallback

    def _download(self, url: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        fh.write(chunk)

    def _extract_archive(self, archive_path: Path, dest_dir: Path) -> None:
        import zipfile
        dest_dir.mkdir(parents=True, exist_ok=True)
        if archive_path.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(dest_dir)
            return
        # CurseForge mostly uses zip
        raise OrchestratorError(f"Unsupported archive format: {archive_path.name}")
    
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

    # --- Implementation ---

    def resolve_server_pack(self, project_id: str, version_id: str) -> str:
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
        
        _log_line(self.instance_id, f"[PREP] Downloading server pack {archive_path.name}")
        self._download(file_url, archive_path)
        
        _log_line(self.instance_id, f"[PREP] Extracting {archive_path.name}")
        self._extract_archive(archive_path, extract_dir)
        
        # Logic from _hydrate_curseforge_pack
        manifest, pack_root = self._find_curseforge_manifest(extract_dir)
        if not manifest or not pack_root:
            _log_line(self.instance_id, "[PREP] CurseForge manifest not found; using archive contents only")
            return extract_dir, None

        mc_version = None
        minecraft = manifest.get("minecraft") or {}
        version = minecraft.get("version")
        if isinstance(version, str) and version.strip():
            mc_version = version.strip()

        _log_line(self.instance_id, f"[PREP] CurseForge manifest found at {pack_root.relative_to(extract_dir) if pack_root != extract_dir else '.'}")

        files = manifest.get("files") or []
        mods_dir = pack_root / "mods"
        mods_dir.mkdir(parents=True, exist_ok=True)
        existing_mods = any(mods_dir.rglob("*.jar"))

        if existing_mods:
             _log_line(self.instance_id, "[PREP] Using mods bundled with the server pack")
        else:
            total = len([entry for entry in files if entry.get("required") is not False])
            _log_line(self.instance_id, f"[PREP] Downloading {total} CurseForge files")
            downloaded = 0
            for entry in files:
                if entry.get("required") is False:
                    continue
                p_id = entry.get("projectID") or entry.get("projectId")
                f_id = entry.get("fileID") or entry.get("fileId")
                if not p_id or not f_id:
                    continue
                try:
                    url = self._curseforge_download_url(int(p_id), int(f_id))
                    filename = self._filename_from_url(url, f"{f_id}.jar")
                    dest = mods_dir / filename
                    if dest.exists():
                        continue
                    if False: # Too spammy to log every file
                        _log_line(self.instance_id, f"[PREP] Downloading {filename}")
                    self._download(url, dest)
                    downloaded += 1
                except Exception as exc:
                    log.warning("Failed to download CurseForge file %s: %s", f_id, exc)
                    _log_line(self.instance_id, f"[PREP] Failed to download file {f_id}: {exc}")
            
            _log_line(self.instance_id, f"[PREP] Downloaded {downloaded} CurseForge files")

        self._copy_overrides(pack_root)
        loader = self._detect_loader_from_manifest(manifest)
        self._strip_loader_mismatch_mods(pack_root, loader)

        return pack_root, mc_version

    def _detect_loader_from_manifest(self, manifest: Dict) -> Optional[str]:
        """Return 'forge', 'neoforge', or None based on manifest modLoaders."""
        minecraft = manifest.get("minecraft") or {}
        loaders = minecraft.get("modLoaders") or []
        loader_entry = next((entry for entry in loaders if entry.get("primary")), None)
        if not loader_entry and loaders:
            loader_entry = loaders[0]
        loader_id = (loader_entry or {}).get("id") or ""
        loader_id = loader_id.lower()
        if loader_id.startswith("neoforge-"):
            return "neoforge"
        if loader_id.startswith("forge-"):
            return "forge"
        return None

    def _strip_loader_mismatch_mods(self, root: Path, loader: Optional[str]) -> None:
        """
        Strip mods incompatible with the detected loader.
        - forge: strip NeoForge mods (neoforge in name, not forge)
        - neoforge: strip Forge mods (forge in name, not neoforge)
        - None: strip NeoForge mods defensively (packs often end up with Forge)
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
                if "forge" in name_lower and "neoforge" not in name_lower:
                    try:
                        target = removed_dir / jar.name
                        if target.exists():
                            target.unlink()
                        jar.rename(target)
                        _log_line(self.instance_id, f"[PREP] Removed Forge mod (incompatible with NeoForge): {jar.name}")
                    except Exception as exc:
                        _log_line(self.instance_id, f"[PREP] Failed to remove {jar.name}: {exc}")

    def generate_start_command(
        self,
        root: Path,
        ram_mb: int,
        project_id: str,
        version_id: str,
        version_hint: Optional[str] = None
    ) -> Tuple[List[str], Optional[str]]:
        
        from ..utils import _find_unix_args_path, detect_generic_start_command

        # 1. Try generic script detection first (some packs bundle them)
        # Often CurseForge packs might have a 'start.bat' or simple jar that is preferable
        cmd, entry = detect_generic_start_command(root, ram_mb, instance_id=self.instance_id)
        if cmd:
            _log_line(self.instance_id, f"[PREP] Detected generic start command: {entry}")
            return cmd, entry

        # 2. Try Forge Installer (Maven)
        installer = self._maybe_fetch_curseforge_installer(root)
        if not installer:
             # Try falling back to API lookups if no manifest
             try:
                 pid = int(project_id) if project_id and project_id.isdigit() else None
                 vid = int(version_id) if version_id and version_id.isdigit() else None
                 if pid and vid:
                     installer = self._maybe_fetch_curseforge_installer_from_api(pid, vid, root, version_hint)
             except Exception as exc:
                 _log_line(self.instance_id, f"[PREP] DEBUG: API fallback failed: {exc}")
        
        if installer and installer.exists():
            rel_installer = installer.relative_to(root)
            rel_dir = rel_installer.parent.as_posix()
            cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
            name = rel_installer.name
            install_cmd = f"{cd_prefix}java -jar {name} --installServer"
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
            _log_line(self.instance_id, "[PREP] Forge/NeoForge installer fetched, running install+launch")
            return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

        # 3. Last resort: error
        files_found = list(root.rglob("*"))
        raise OrchestratorError(f"Could not detect CurseForge start command. Root: {root}, Files: {len(files_found)}, ID: {self.instance_id}, Sample: {[f.name for f in files_found[:5]]}")

    def _find_curseforge_manifest(self, root: Path) -> Tuple[Optional[Dict], Optional[Path]]:
        candidates = [root / "manifest.json"]
        for child in root.iterdir():
            if child.is_dir():
                candidates.append(child / "manifest.json")
        for candidate in candidates:
            if not candidate.exists():
                continue
            try:
                payload = json.loads(candidate.read_text())
            except Exception:
                continue
            if isinstance(payload, dict) and isinstance(payload.get("files"), list):
                return payload, candidate.parent
        return None, None

    def _maybe_fetch_curseforge_installer(self, root: Path) -> Optional[Path]:
        manifest_path = None
        # Reuse logic from _find_curseforge_manifest but just path
        for cand in [root / "manifest.json"] + [d / "manifest.json" for d in root.iterdir() if d.is_dir()]:
            if cand.exists():
                manifest_path = cand
                break
        
        if not manifest_path:
            return None

        try:
            manifest = json.loads(manifest_path.read_text())
        except Exception:
            return None

        minecraft = manifest.get("minecraft") or {}
        mc_version = minecraft.get("version")
        loaders = minecraft.get("modLoaders") or []
        loader_entry = next((entry for entry in loaders if entry.get("primary")), None)
        if not loader_entry and loaders:
            loader_entry = loaders[0]
        
        loader_id = (loader_entry or {}).get("id") or ""
        if not mc_version or not loader_id:
            return None
        
        loader_id = loader_id.lower()
        if loader_id.startswith("neoforge-"):
            neoforge_version = loader_id.split("neoforge-", 1)[1]
            installer_name = f"neoforge-{neoforge_version}-installer.jar"
            installer = manifest_path.parent / installer_name
            if installer.exists():
                return installer
            url = f"https://maven.neoforged.net/releases/net/neoforged/neoforge/{neoforge_version}/{installer_name}"
            try:
                _log_line(self.instance_id, f"[PREP] Downloading NeoForge installer {installer_name}")
                self._download(url, installer)
                return installer
            except Exception as exc:
                _log_line(self.instance_id, f"[PREP] Failed to download NeoForge installer: {exc}")
                return None
        if not loader_id.startswith("forge-"):
            return None
        forge_version = loader_id.split("forge-", 1)[1]
        version_str = f"{mc_version}-{forge_version}"
        installer = manifest_path.parent / f"forge-{version_str}-installer.jar"
        if installer.exists():
            return installer
        url = f"https://maven.minecraftforge.net/net/minecraftforge/forge/{version_str}/forge-{version_str}-installer.jar"
        try:
            _log_line(self.instance_id, f"[PREP] Downloading Forge installer {installer.name}")
            self._download(url, installer)
            return installer
        except Exception as exc:
            _log_line(self.instance_id, f"[PREP] Failed to download Forge installer: {exc}")
            return None

    def _curseforge_find_game_version(self, mod_id: int, file_id: int, hint: str = None) -> Optional[str]:
        # Minimal impl of original _curseforge_find_game_version
        headers = {"x-api-key": self._curseforge_api_key()}
        try:
            resp = requests.get(f"{self._curseforge_base_url()}/mods/{mod_id}/files/{file_id}", headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json().get("data") or {}
            versions = data.get("gameVersions") or []
            # Filtering logic omitted for brevity, assuming first valid
            for v in versions:
                 if re.match(r"^\d+\.\d+(\.\d+)?$", v):
                     return v
        except Exception:
            pass
        return None

    def _curseforge_pick_forge_modloaders(self, mc_version: str) -> List[Dict]:
        headers = {"x-api-key": self._curseforge_api_key()}
        resp = requests.get(
            f"{self._curseforge_base_url()}/minecraft/modloader",
            headers=headers,
            params={"gameVersion": mc_version},
            timeout=30,
        )
        resp.raise_for_status()
        items = resp.json().get("data") or []
        forge_items = [
            item
            for item in items
            if isinstance(item.get("name"), str)
            and item.get("name", "").lower().startswith("forge")
        ]
        forge_items = [
            item
            for item in forge_items
            if not item.get("gameVersion") or item.get("gameVersion") == mc_version
        ]
        if not forge_items:
            return []

        recommended = [item for item in forge_items if item.get("recommended")]
        latest = [item for item in forge_items if item.get("latest")]

        def version_key(item: Dict) -> Tuple[int, ...]:
            name = item.get("name") or ""
            base = name.lower().replace("forge-", "")
            parts = []
            for part in base.split("."):
                try:
                    parts.append(int(part))
                except ValueError:
                    continue
            return tuple(parts)

        seen = set()
        ordered: List[Dict] = []
        for group in (recommended, latest):
            for item in group:
                key = item.get("name")
                if key and key not in seen:
                    ordered.append(item)
                    seen.add(key)

        remaining = [item for item in forge_items if item.get("name") not in seen]

        if mc_version.startswith("1.12.2"):
            preferred = [item for item in remaining if (item.get("name") or "").startswith("forge-14.23.5.")]
            if preferred:
                remaining = preferred

        remaining.sort(key=version_key, reverse=True)
        ordered.extend(remaining)
        return ordered

    def _download_forge_installer(
        self,
        mc_version: str,
        forge_name: str,
        download_url: Optional[str],
        dest_dir: Path,
    ) -> Optional[Path]:
        forge_name = forge_name.lower().replace("forge-", "")
        forge_version = forge_name
        installer_name = f"forge-{mc_version}-{forge_version}-installer.jar"
        installer = dest_dir / installer_name
        if installer.exists():
            return installer
        
        candidate_urls: List[str] = []
        if download_url and forge_version in download_url:
            candidate_urls.append(download_url)
        candidate_urls.append(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/"
            f"{mc_version}-{forge_version}/forge-{mc_version}-{forge_version}-installer.jar"
        )
        
        for url in candidate_urls:
            try:
                _log_line(self.instance_id, f"[PREP] Downloading Forge installer {installer.name}")
                self._download(url, installer)
                return installer
            except Exception as exc:
                if False: # avoid spam
                   log.warning("Failed to fetch Forge installer %s: %s", url, exc)
                _log_line(self.instance_id, f"[PREP] Failed to download Forge installer from {url}: {exc}")
        return None

    def _maybe_fetch_curseforge_installer_from_api(
         self, mod_id: int, file_id: int, root: Path, version_hint: str = None
    ) -> Optional[Path]:
         mc_version = self._curseforge_find_game_version(mod_id, file_id, version_hint)
         if not mc_version:
             _log_line(self.instance_id, "[PREP] Could not determine Minecraft version for Forge install")
             return None
         
         try:
             loaders = self._curseforge_pick_forge_modloaders(mc_version)
         except Exception as exc:
             _log_line(self.instance_id, f"[PREP] Failed to query CurseForge modloader: {exc}")
             loaders = []
             
         if not loaders:
             _log_line(self.instance_id, "[PREP] Could not determine Forge modloader version")
             return None

         _log_line(self.instance_id, f"[PREP] Detected Minecraft version {mc_version} for Forge install")

         max_attempts = 8
         for loader in loaders[:max_attempts]:
             name = loader.get("name") or ""
             if name:
                 _log_line(self.instance_id, f"[PREP] Trying Forge modloader {name}")
             
             installer = self._download_forge_installer(
                 mc_version,
                 name,
                 loader.get("downloadUrl"),
                 root,
             )
             if installer:
                 return installer

         return None
