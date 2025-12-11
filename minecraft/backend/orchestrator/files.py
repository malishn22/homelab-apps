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


def _detect_start_command(root: Path, ram_gb: int, instance_id: Optional[str] = None) -> Tuple[List[str], Optional[str]]:
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
        command = ["/bin/bash", "-c", f"{cd_prefix}java @user_jvm_args.txt @{rel_args.as_posix()} nogui"]
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
            run_cmd = (
                f"{cd_prefix}java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui"
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
            run_cmd = (
                f"{cd_prefix}java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui"
            )
        else:
            run_cmd = f"{cd_prefix}java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui"
        if instance_id:
            _log_line(instance_id, "[PREP] Forge installer fetched, running install+launch")
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    scripts_found = [p.as_posix() for p in root.rglob("*") if p.suffix.lower() in {".sh", ".bat", ".cmd"}]
    jars_found = [p.as_posix() for p in root.rglob("*.jar")]
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
    project_id: str, version_id: str, file_url: str, ram_gb: int, instance_id: str
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
    log.info(
        "Preparing instance %s from %s (suffix=%s)",
        instance_id,
        archive_path.name,
        archive_path.suffix,
    )
    _download(file_url, archive_path)
    _extract_archive(archive_path, extract_dir)

    if archive_path.suffix.lower() == ".mrpack":
        _hydrate_mrpack(extract_dir, instance_id=instance_id)
    else:
        _strip_client_only_mods(extract_dir, instance_id=instance_id)

    command, entry_target = _detect_start_command(extract_dir, ram_gb, instance_id=instance_id)
    return {
        "instance_dir": str(instance_dir),
        "extract_dir": str(extract_dir),
        "archive_path": str(archive_path),
        "entry_target": entry_target,
        "start_command": command,
    }
