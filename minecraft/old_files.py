import json
import logging
import os
import shutil
import tarfile
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import threading
from urllib.parse import urlparse, unquote
import re

import docker
import requests
from docker.errors import NotFound as DockerNotFound

from .state import OrchestratorError, _log_line

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_INSTANCES_ROOT = CONTAINER_DATA_ROOT / "instances"
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"

HOST_SERVERS_ROOT = Path(os.environ.get("HOST_SERVERS_ROOT", "/data/servers"))

DATA_DIR = CONTAINER_INSTANCES_ROOT
STATE_FILE = DATA_DIR / "instances.json"

CLIENT_ONLY_MOD_PATTERNS = [
    "legendarytooltips",
    "xaeros_minimap",
    "xaerosworldmap",
    "journeymap",
    "fancymenu",
    "tooltipfix",
]


def _curseforge_base_url() -> str:
    return os.environ.get("CURSEFORGE_BASE_URL", "https://api.curseforge.com/v1").rstrip("/")


def _curseforge_api_key() -> str:
    key = os.environ.get("CURSEFORGE_API_KEY")
    if not key:
        raise OrchestratorError("CURSEFORGE_API_KEY is not configured.")
    return key


def _curseforge_download_url(project_id: int, file_id: int) -> str:
    resp = requests.get(
        f"{_curseforge_base_url()}/mods/{project_id}/files/{file_id}/download-url",
        headers={"x-api-key": _curseforge_api_key()},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    url = data.get("data")
    if not url:
        raise OrchestratorError("CurseForge did not return a download URL.")
    return url


def _coerce_int(value: Optional[str]) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _detect_minecraft_version_from_root(
    root: Path, source: Optional[str] = None
) -> Optional[str]:
    source_key = (source or "").strip().lower()
    if source_key == "curseforge":
        manifest, _ = _find_curseforge_manifest(root)
        if manifest:
            minecraft = manifest.get("minecraft") or {}
            version = minecraft.get("version")
            if isinstance(version, str) and version.strip():
                return version.strip()

    index_path = root / "modrinth.index.json"
    if index_path.exists():
        try:
            manifest = json.loads(index_path.read_text())
        except Exception:
            manifest = {}
        deps = manifest.get("dependencies") or {}
        version = deps.get("minecraft")
        if isinstance(version, str) and version.strip():
            return version.strip()

    return None


def _extract_minecraft_versions(text: str) -> List[str]:
    return re.findall(r"\b1\.\d+(?:\.\d+)?\b", text)


def _pick_best_version(versions: List[str]) -> Optional[str]:
    def key_fn(value: str) -> Tuple[int, ...]:
        return tuple(int(part) for part in value.split(".") if part.isdigit())

    candidates = [v for v in versions if v]
    if not candidates:
        return None
    return max(candidates, key=key_fn)


def _curseforge_find_game_version(
    mod_id: int, file_id: int, hint: Optional[str] = None
) -> Optional[str]:
    if hint:
        hinted = _pick_best_version(_extract_minecraft_versions(hint))
        if hinted:
            return hinted

    headers = {"x-api-key": _curseforge_api_key()}
    try:
        resp = requests.get(
            f"{_curseforge_base_url()}/mods/{mod_id}/files/{file_id}",
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or {}
        versions = data.get("gameVersions") or []
    except Exception:
        versions = []

    if not versions:
        try:
            resp = requests.get(
                f"{_curseforge_base_url()}/mods/{mod_id}",
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json().get("data") or {}
            versions = []
            for entry in data.get("latestFiles") or []:
                versions.extend(entry.get("gameVersions") or [])
        except Exception:
            versions = []

    filtered = [v for v in versions if isinstance(v, str) and re.match(r"^\d+\.\d+(\.\d+)?$", v)]
    return _pick_best_version(filtered)


def _curseforge_pick_forge_modloaders(mc_version: str) -> List[Dict]:
    headers = {"x-api-key": _curseforge_api_key()}
    resp = requests.get(
        f"{_curseforge_base_url()}/minecraft/modloader",
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
    mc_version: str,
    forge_name: str,
    download_url: Optional[str],
    dest_dir: Path,
    instance_id: Optional[str],
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
            if instance_id:
                _log_line(instance_id, f"[PREP] Downloading Forge installer {installer.name}")
            _download(url, installer)
            return installer
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to fetch Forge installer %s: %s", url, exc)
            if instance_id:
                _log_line(instance_id, f"[PREP] Failed to download Forge installer: {exc}")
    return None


def _filename_from_url(url: str, fallback: str) -> str:
    path = urlparse(url).path
    name = Path(path).name
    if name:
        return unquote(name)
    return fallback


def _find_curseforge_manifest(root: Path) -> Tuple[Optional[Dict], Optional[Path]]:
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
        if not isinstance(payload, dict):
            continue
        files = payload.get("files")
        if isinstance(files, list):
            return payload, candidate.parent
    return None, None


def _hydrate_curseforge_pack(
    root: Path, instance_id: Optional[str] = None
) -> Tuple[Optional[Path], Optional[str]]:
    manifest, pack_root = _find_curseforge_manifest(root)
    if not manifest or not pack_root:
        if instance_id:
            _log_line(instance_id, "[PREP] CurseForge manifest not found; using archive contents only")
        return None, None

    mc_version = None
    minecraft = manifest.get("minecraft") or {}
    version = minecraft.get("version")
    if isinstance(version, str) and version.strip():
        mc_version = version.strip()

    if instance_id:
        try:
            rel_root = pack_root.relative_to(root).as_posix()
        except ValueError:
            rel_root = pack_root.as_posix()
        _log_line(
            instance_id,
            f"[PREP] CurseForge manifest found at {rel_root or '.'}",
        )

    files = manifest.get("files") or []
    mods_dir = pack_root / "mods"
    mods_dir.mkdir(parents=True, exist_ok=True)
    existing_mods = any(mods_dir.rglob("*.jar"))

    if existing_mods:
        if instance_id:
            _log_line(instance_id, "[PREP] Using mods bundled with the server pack")
    else:
        total = len([entry for entry in files if entry.get("required") is not False])
        if instance_id:
            _log_line(instance_id, f"[PREP] Downloading {total} CurseForge files")
        downloaded = 0
        for entry in files:
            if entry.get("required") is False:
                continue
            project_id = entry.get("projectID") or entry.get("projectId")
            file_id = entry.get("fileID") or entry.get("fileId")
            if not project_id or not file_id:
                continue
            try:
                url = _curseforge_download_url(int(project_id), int(file_id))
                filename = _filename_from_url(url, f"{file_id}.jar")
                dest = mods_dir / filename
                if dest.exists():
                    continue
                if instance_id:
                    _log_line(instance_id, f"[PREP] Downloading {filename}")
                _download(url, dest)
                downloaded += 1
            except Exception as exc:  # pragma: no cover
                log.warning("Failed to download CurseForge file %s: %s", file_id, exc)
                if instance_id:
                    _log_line(instance_id, f"[PREP] Failed to download file {file_id}: {exc}")

    _copy_overrides(pack_root)
    if instance_id and not existing_mods:
        _log_line(instance_id, f"[PREP] Downloaded {downloaded} CurseForge files")
    return pack_root, mc_version


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    fh.write(chunk)


def _extract_archive(archive_path: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = archive_path.suffix.lower()
    if suffix in [".zip", ".mrpack"]:
        import zipfile

        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(dest_dir)
        return

    if tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path, "r:*") as tf:
            tf.extractall(dest_dir)
        return

    raise OrchestratorError(f"Unsupported archive format: {archive_path.name}")


def _maybe_fetch_forge_installer(root: Path, instance_id: Optional[str] = None) -> Optional[Path]:
    """Attempt to download a Forge installer if dependencies are present in modrinth.index.json."""
    manifest_path = root / "modrinth.index.json"
    if not manifest_path.exists():
        return None
    try:
        manifest = json.loads(manifest_path.read_text())
    except Exception as exc:  # pragma: no cover
        log.warning("Could not parse manifest for forge detection: %s", exc)
        return None

    deps = manifest.get("dependencies") or {}
    mc_version = deps.get("minecraft")
    forge_version = deps.get("forge") or deps.get("neoforge")
    if not mc_version or not forge_version:
        return None

    version_str = f"{mc_version}-{forge_version}"
    installer = root / f"forge-{version_str}-installer.jar"
    if installer.exists():
        return installer

    url = f"https://maven.minecraftforge.net/net/minecraftforge/forge/{version_str}/forge-{version_str}-installer.jar"
    try:
        if instance_id:
            _log_line(instance_id, f"[PREP] Downloading Forge installer {installer.name}")
        _download(url, installer)
        return installer
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to fetch forge installer %s: %s", url, exc)
        if instance_id:
            _log_line(instance_id, f"[PREP] Failed to download Forge installer: {exc}")
        return None


def _find_curseforge_manifest_path(root: Path) -> Optional[Path]:
    candidates = [root / "manifest.json"]
    for child in root.iterdir():
        if child.is_dir():
            candidates.append(child / "manifest.json")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _maybe_fetch_curseforge_installer(
    root: Path, instance_id: Optional[str] = None
) -> Optional[Path]:
    manifest_path = _find_curseforge_manifest_path(root)
    if not manifest_path:
        return None


def _maybe_fetch_curseforge_installer_from_api(
    mod_id: int,
    file_id: int,
    root: Path,
    instance_id: Optional[str] = None,
    version_hint: Optional[str] = None,
) -> Optional[Path]:
    mc_version = _curseforge_find_game_version(mod_id, file_id, hint=version_hint)
    if not mc_version:
        if instance_id:
            _log_line(instance_id, "[PREP] Could not determine Minecraft version for Forge install")
        return None
    try:
        loaders = _curseforge_pick_forge_modloaders(mc_version)
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to query CurseForge modloader: %s", exc)
        loaders = []
    if not loaders:
        if instance_id:
            _log_line(instance_id, "[PREP] Could not determine Forge modloader version")
        return None
    if instance_id:
        _log_line(instance_id, f"[PREP] Detected Minecraft version {mc_version} for Forge install")

    max_attempts = 8
    for loader in loaders[:max_attempts]:
        name = loader.get("name") or ""
        if instance_id and name:
            _log_line(instance_id, f"[PREP] Trying Forge modloader {name}")
        installer = _download_forge_installer(
            mc_version,
            name,
            loader.get("downloadUrl"),
            root,
            instance_id,
        )
        if installer:
            return installer

    return None
    try:
        manifest = json.loads(manifest_path.read_text())
    except Exception as exc:  # pragma: no cover
        log.warning("Could not parse CurseForge manifest: %s", exc)
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
    if not loader_id.startswith("forge-"):
        return None

    forge_version = loader_id.split("forge-", 1)[1]
    version_str = f"{mc_version}-{forge_version}"
    installer = root / f"forge-{version_str}-installer.jar"
    if installer.exists():
        return installer

    url = f"https://maven.minecraftforge.net/net/minecraftforge/forge/{version_str}/forge-{version_str}-installer.jar"
    try:
        if instance_id:
            _log_line(instance_id, f"[PREP] Downloading Forge installer {installer.name}")
        _download(url, installer)
        return installer
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to fetch Forge installer %s: %s", url, exc)
        if instance_id:
            _log_line(instance_id, f"[PREP] Failed to download Forge installer: {exc}")
        return None


def _detect_curseforge_start_command(
    root: Path,
    ram_gb: int,
    instance_id: Optional[str] = None,
    mod_id: Optional[int] = None,
    file_id: Optional[int] = None,
    version_hint: Optional[str] = None,
) -> Tuple[List[str], Optional[str]]:
    try:
        return _detect_start_command(root, ram_gb, instance_id=instance_id, log_failure=False)
    except OrchestratorError:
        pass

    installer = _maybe_fetch_curseforge_installer(root, instance_id=instance_id)
    if not installer and mod_id and file_id:
        installer = _maybe_fetch_curseforge_installer_from_api(
            mod_id, file_id, root, instance_id=instance_id, version_hint=version_hint
        )
    if installer and installer.exists():
        rel_installer = installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        name = rel_installer.name
        forge_version = ""
        if "forge-" in name and "-installer" in name:
            forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
        install_cmd = f"{cd_prefix}java -jar {name} --installServer"
        if forge_version:
            forge_jar = f"forge-{forge_version}.jar"
            forge_universal = f"forge-{forge_version}-universal.jar"
            run_cmd = (
                f"{cd_prefix}if [ -f libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt ]; then "
                f"if [ ! -f user_jvm_args.txt ]; then "
                f": > user_jvm_args.txt; fi; "
                f"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui; "
                f"elif [ -f {forge_jar} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_jar} nogui; "
                f"elif [ -f {forge_universal} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_universal} nogui; "
                f"else java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui; fi"
            )
        else:
            run_cmd = f"{cd_prefix}java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui"
        if instance_id:
            _log_line(instance_id, "[PREP] Forge installer fetched, running install+launch")
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    return _detect_start_command(root, ram_gb, instance_id=instance_id, log_failure=True)


def _detect_start_command(
    root: Path, ram_gb: int, instance_id: Optional[str] = None, log_failure: bool = True
) -> Tuple[List[str], Optional[str]]:
    """Return (command, entry_target) to start the server, searching scripts and jars recursively."""

    preferred_names = {
        "start.sh",
        "run.sh",
        "serverstart.sh",
        "startserver.sh",
        "launch.sh",
        "start.bat",
        "run.bat",
        "startserver.bat",
    }

    # Prefer already-installed Forge unix_args if present (avoids rerunning installer)
    unix_args = next((p for p in root.rglob("unix_args.txt")), None)
    if unix_args:
        rel_args = unix_args.relative_to(root)
        rel_dir = rel_args.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        command = [
            "/bin/bash",
            "-c",
            (
                f"{cd_prefix}if [ ! -f user_jvm_args.txt ]; then "
                f": > user_jvm_args.txt; fi; "
                f"java @user_jvm_args.txt @{rel_args.as_posix()} nogui"
            ),
        ]
        log.info("Detected unix_args.txt at %s, using direct run command", rel_args)
        return command, rel_args.as_posix()

    def pick_script() -> Optional[Path]:
        scripts = [p for p in root.rglob("*") if p.suffix.lower() in {".sh", ".bat", ".cmd"}]
        if not scripts:
            return None
        # Prefer known names, then shortest path
        scripts_sorted = sorted(
            scripts,
            key=lambda p: (
                0 if p.suffix.lower() == ".sh" else 1,  # prefer shell scripts on linux
                0 if p.name.lower() in preferred_names else 1,
                len(p.parts),
            ),
        )
        return scripts_sorted[0]

    script = pick_script()
    if script and script.suffix.lower() == ".sh":
        rel = script.relative_to(root)
        is_shell = script.suffix.lower() == ".sh"
        rel_posix = rel.as_posix()
        if is_shell:
            command = [
                "/bin/bash",
                "-c",
                f"cd /data && chmod +x {rel_posix} && ./{rel_posix}",
            ]
        else:
            # Be resilient if the script moved: prefer the detected path, fallback to search
            command = [
                "/bin/bash",
                "-lc",
                f"if [ -f '/data/{rel_posix}' ]; then bash '/data/{rel_posix}'; "
                "else target=\"$(find /data -maxdepth 3 \\( -iname 'startserver.bat' -o -iname 'startserver.cmd' -o -iname '*.bat' -o -iname '*.cmd' \\) | head -n1)\" && "
                "if [ -n \"$target\" ] && [ -f \"$target\" ]; then bash \"$target\"; "
                "else echo 'start script not found in /data'; exit 1; fi; fi",
            ]
        log.info("Detected start script %s", rel)
        return command, rel.as_posix()
    elif script:
        log.info("Skipping Windows batch script %s on linux; falling back to installer/jar", script.relative_to(root))

    # If a Fabric server launch jar is already present, run it directly
    fabric_launch = next((p for p in root.rglob("fabric-server-launch.jar")), None)
    if fabric_launch and fabric_launch.is_file():
        rel_launch = fabric_launch.relative_to(root)
        rel_dir = rel_launch.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_gb}G -Xmx{ram_gb}G"
        command = ["/bin/bash", "-c", f"{cd_prefix}java {jvm_opts} -jar {rel_launch.name} nogui"]
        log.info("Detected fabric-server-launch.jar at %s", rel_launch)
        return command, rel_launch.as_posix()

    # Try Fabric installer: fabric-installer-*.jar
    fabric_installer = next((p for p in root.rglob("*.jar") if "fabric-installer" in p.name.lower()), None)
    if fabric_installer and fabric_installer.is_file():
        rel_installer = fabric_installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_gb}G -Xmx{ram_gb}G"
        install_cmd = f"{cd_prefix}java -jar {rel_installer.name} server -downloadMinecraft"
        run_cmd = f"{cd_prefix}java {jvm_opts} -jar fabric-server-launch.jar nogui"
        log.info("Detected fabric installer %s, will install then run fabric-server-launch.jar", rel_installer)
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    # Try Forge installer next: forge-<mc>-<ver>-installer.jar
    installer = next((p for p in root.rglob("*.jar") if "installer" in p.name.lower()), None)
    if installer and installer.is_file():
        rel_installer = installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        name = rel_installer.name
        # Extract forge version segment between forge- and -installer
        forge_version = ""
        if "forge-" in name and "-installer" in name:
            forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
        install_cmd = f"{cd_prefix}java -jar {name} --installServer"
        if forge_version:
            forge_jar = f"forge-{forge_version}.jar"
            forge_universal = f"forge-{forge_version}-universal.jar"
            run_cmd = (
                f"{cd_prefix}if [ -f libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt ]; then "
                f"if [ ! -f user_jvm_args.txt ]; then "
                f": > user_jvm_args.txt; fi; "
                f"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui; "
                f"elif [ -f {forge_jar} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_jar} nogui; "
                f"elif [ -f {forge_universal} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_universal} nogui; "
                f"else java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui; fi"
            )
        else:
            run_cmd = f"{cd_prefix}java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui"
        log.info("Detected installer %s, using install+run command", rel_installer)
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    # Fallback to java -jar: pick a likely server jar, skip library directories
    jar_candidates = [
        p
        for p in root.rglob("*.jar")
        if not any(part in {"libraries", "mods", "plugins"} for part in p.parts)
    ]
    if jar_candidates:
        jar_sorted = sorted(
            jar_candidates,
            key=lambda p: (
                0 if "server" in p.name.lower() else 1,
                0 if "forge" in p.name.lower() or "fabric" in p.name.lower() else 1,
                len(p.parts),
            ),
        )
        jar = jar_sorted[0]
        rel = jar.relative_to(root)
        rel_dir = rel.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_gb}G -Xmx{ram_gb}G"
        command = ["/bin/bash", "-c", f"{cd_prefix}java {jvm_opts} -jar {rel.name} nogui"]
        return command, rel.as_posix()

    # Try fetching Forge installer based on manifest dependencies
    forge_installer = _maybe_fetch_forge_installer(root, instance_id=instance_id)
    if forge_installer and forge_installer.exists():
        rel_installer = forge_installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        name = rel_installer.name
        # Extract forge version segment between forge- and -installer
        forge_version = ""
        if "forge-" in name and "-installer" in name:
            forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
        install_cmd = f"{cd_prefix}java -jar {name} --installServer"
        if forge_version:
            forge_jar = f"forge-{forge_version}.jar"
            forge_universal = f"forge-{forge_version}-universal.jar"
            run_cmd = (
                f"{cd_prefix}if [ -f libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt ]; then "
                f"if [ ! -f user_jvm_args.txt ]; then "
                f": > user_jvm_args.txt; fi; "
                f"java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui; "
                f"elif [ -f {forge_jar} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_jar} nogui; "
                f"elif [ -f {forge_universal} ]; then "
                f"java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {forge_universal} nogui; "
                f"else java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui; fi"
            )
        else:
            run_cmd = f"{cd_prefix}java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui"
        if instance_id:
            _log_line(instance_id, "[PREP] Forge installer fetched, running install+launch")
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    scripts_found = [
        p.as_posix()
        for p in root.rglob("*")
        if p.suffix.lower() in {".sh", ".bat", ".cmd"}
    ]
    jars_found = [p.as_posix() for p in root.rglob("*.jar")]
    if instance_id and log_failure:
        sample_scripts = ", ".join(scripts_found[:3])
        sample_jars = ", ".join(jars_found[:3])
        _log_line(
            instance_id,
            f"[FAIL] No start command found. scripts={len(scripts_found)} jars={len(jars_found)}",
        )
        if sample_scripts:
            _log_line(instance_id, f"[FAIL] Script sample: {sample_scripts}")
        if sample_jars:
            _log_line(instance_id, f"[FAIL] Jar sample: {sample_jars}")
    log.warning(
        "No start command found. scripts=%d jars=%d root=%s",
        len(scripts_found),
        len(jars_found),
        root,
    )
    raise OrchestratorError("Could not detect start command in server pack")


def _copy_overrides(root: Path) -> None:
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


def _hydrate_mrpack(root: Path, instance_id: Optional[str] = None) -> None:
    """
    Download files listed in modrinth.index.json and merge overrides.
    """
    index_path = root / "modrinth.index.json"
    if not index_path.exists():
        return
    try:
        manifest = json.loads(index_path.read_text())
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to parse modrinth.index.json: %s", exc)
        if instance_id:
            _log_line(instance_id, f"[PREP] Failed to parse modrinth.index.json: {exc}")
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
            if instance_id:
                _log_line(instance_id, f"[PREP] Downloading {path}")
            _download(url, dest)
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to download %s: %s", url, exc)
            if instance_id:
                _log_line(instance_id, f"[PREP] Failed to download {path}: {exc}")
    _copy_overrides(root)
    _strip_client_only_mods(root, instance_id)


def _strip_client_only_mods(root: Path, instance_id: Optional[str] = None) -> None:
    mods_dir = root / "mods"
    if not mods_dir.exists():
        return
    removed_dir = mods_dir / "__client_only_removed"
    removed_dir.mkdir(parents=True, exist_ok=True)
    for jar in mods_dir.glob("*.jar"):
        name_lower = jar.name.lower()
        if any(pattern in name_lower for pattern in CLIENT_ONLY_MOD_PATTERNS):
            target = removed_dir / jar.name
            try:
                jar.replace(target)
                if instance_id:
                    _log_line(instance_id, f"[PREP] Removed client-only mod {jar.name}")
                log.info("Removed client-only mod %s", jar.name)
            except Exception as exc:  # pragma: no cover
                log.warning("Failed to move client-only mod %s: %s", jar, exc)


def prepare_instance_files(
    project_id: str,
    version_id: str,
    file_url: str,
    ram_gb: int,
    instance_id: str,
    source: Optional[str] = None,
) -> Dict:
    """
    Download and extract the server pack for an instance, returning metadata with
    paths and detected start command.
    """
    instance_dir = DATA_DIR / instance_id
    pack_path = instance_dir / "serverpack"
    extract_dir = instance_dir / "server"
    pack_path.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    archive_path = pack_path / Path(file_url).name
    version_hint = unquote(archive_path.name)
    log.info(
        "Preparing instance %s from %s (suffix=%s)",
        instance_id,
        archive_path.name,
        archive_path.suffix,
    )
    _log_line(instance_id, f"[PREP] Downloading server pack {archive_path.name}")
    _download(file_url, archive_path)
    _log_line(instance_id, f"[PREP] Extracting {archive_path.name}")
    _extract_archive(archive_path, extract_dir)
    _log_line(instance_id, "[PREP] Extraction complete")

    source_key = (source or "").strip().lower()
    server_root = extract_dir
    mod_id = _coerce_int(project_id)
    file_id = _coerce_int(version_id)
    mc_version: Optional[str] = None

    if source_key == "curseforge":
        pack_root, mc_version = _hydrate_curseforge_pack(extract_dir, instance_id=instance_id)
        if pack_root:
            server_root = pack_root
        if not mc_version and mod_id and file_id:
            mc_version = _curseforge_find_game_version(mod_id, file_id, hint=version_hint)
    elif archive_path.suffix.lower() == ".mrpack":
        _hydrate_mrpack(extract_dir, instance_id=instance_id)
        mc_version = _detect_minecraft_version_from_root(extract_dir, source=source_key)
    else:
        _strip_client_only_mods(extract_dir, instance_id=instance_id)
        mc_version = _detect_minecraft_version_from_root(extract_dir, source=source_key)

    if source_key == "curseforge":
        command, entry_target = _detect_curseforge_start_command(
            server_root,
            ram_gb,
            instance_id=instance_id,
            mod_id=mod_id,
            file_id=file_id,
            version_hint=version_hint,
        )
    else:
        command, entry_target = _detect_start_command(
            server_root, ram_gb, instance_id=instance_id
        )
    return {
        "instance_dir": str(instance_dir),
        "extract_dir": str(server_root),
        "archive_path": str(archive_path),
        "entry_target": entry_target,
        "start_command": command,
        "minecraft_version": mc_version,
    }
