import json
import re
from pathlib import Path
from typing import List, Optional, Tuple

def extract_minecraft_versions(text: str) -> List[str]:
    return re.findall(r"\b1\.\d+(?:\.\d+)?\b", text)

def pick_best_version(versions: List[str]) -> Optional[str]:
    def key_fn(value: str) -> Tuple[int, ...]:
        return tuple(int(part) for part in value.split(".") if part.isdigit())

    candidates = [v for v in versions if v]
    if not candidates:
        return None
    return max(candidates, key=key_fn)

def detect_minecraft_version_from_root(
    root: Path, source: Optional[str] = None
) -> Optional[str]:
    # 0. Modern Forge/NeoForge Heuristic: unix_args.txt implies 1.17+
    # If we see this, and we can't find a version, we should assume a modern one.
    has_unix_args = any(root.rglob("unix_args.txt"))
    
    # 1. Check metadata files (Modrinth/CurseForge)
    # ... (existing logic) ...
    source_key = (source or "").strip().lower()
    
    # Check CurseForge manifest
    if source_key == "curseforge":
        manifest_path = next((p for p in root.rglob("manifest.json") if p.name == "manifest.json"), None)
        if manifest_path:
            try:
                manifest = json.loads(manifest_path.read_text())
                minecraft = manifest.get("minecraft") or {}
                version = minecraft.get("version")
                if isinstance(version, str) and version.strip():
                    return version.strip()
            except Exception:
                pass

    # Check Modrinth index
    index_path = root / "modrinth.index.json"
    if index_path.exists():
        try:
            manifest = json.loads(index_path.read_text())
            deps = manifest.get("dependencies") or {}
            version = deps.get("minecraft")
            if isinstance(version, str) and version.strip():
                return version.strip()
        except Exception:
            pass

    # 2. Scan for specific Server JARs standard naming
    # e.g. forge-1.20.1-47.1.0-server.jar, server-1.20.1.jar, vanilla-1.20.1.jar
    server_jars = [p.name for p in root.rglob("*.jar") if "server" in p.name.lower() or "forge" in p.name.lower()]
    found_versions = []
    for name in server_jars:
        found_versions.extend(extract_minecraft_versions(name))
    
    best = pick_best_version(found_versions)
    if best:
        return best

    # 3. Fallback: If unix_args.txt exists, it's definitely > 1.16.5. 
    # Returning None will fallback to default logic, but we want to ensure we don't pick 1.13.
    # We can return None here and handle "unix_args implies Java 17+" in runtime.py
    return None

def detect_generic_start_command(root: Path, ram_mb: int, instance_id: Optional[str] = None) -> Tuple[List[str], Optional[str]]:
    """
    Attempts to detect a start command from generic scripts, Fabric jars, or generic Server jars.
    Returns (command_list, relative_entry_path) or raises ValueError if not found.
    """
    preferred_names = {
        "start.sh", "run.sh", "serverstart.sh", "startserver.sh",
        "launch.sh", "start.bat", "run.bat", "startserver.bat"
    }

    from .state import _log_line
    
    all_files = list(root.rglob("*"))
    if instance_id:
        _log_line(instance_id, f"[INFO] DEBUG: Scanning {root} - Found {len(all_files)} files")
        for f in all_files[:20]: # Increased to 20
            _log_line(instance_id, f"[INFO] DEBUG: File: {f.relative_to(root)}")

    # 1. Unix Args
    unix_args = next((p for p in root.rglob("unix_args.txt")), None)
    if unix_args:
        rel_args = unix_args.relative_to(root)
        rel_dir = rel_args.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_mb}M -Xmx{ram_mb}M"
        command = [
            "/bin/bash", "-c",
            (f"{cd_prefix}if [ ! -f user_jvm_args.txt ]; then : > user_jvm_args.txt; fi; "
             f"java {jvm_opts} @user_jvm_args.txt @{rel_args.as_posix()} nogui")
        ]
        return command, rel_args.as_posix()

    # 2. Fabric Launch Jar (Moved up)
    fabric_launch = next((p for p in root.rglob("fabric-server-launch.jar")), None)
    if fabric_launch and fabric_launch.is_file():
        rel_launch = fabric_launch.relative_to(root)
        rel_dir = rel_launch.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_mb}M -Xmx{ram_mb}M"
        command = ["/bin/bash", "-c", f"{cd_prefix}java {jvm_opts} -jar {rel_launch.name} nogui"]
        return command, rel_launch.as_posix()
        
    # 3. Fabric Installer (Moved up)
    fabric_installer = next((p for p in root.rglob("*.jar") if "fabric-installer" in p.name.lower()), None)
    if fabric_installer and fabric_installer.is_file():
        rel_installer = fabric_installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_mb}M -Xmx{ram_mb}M"
        install_cmd = f"{cd_prefix}java -jar {rel_installer.name} server -downloadMinecraft"
        run_cmd = f"{cd_prefix}java {jvm_opts} -jar fabric-server-launch.jar nogui"
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    # 4. Start Scripts
    def pick_script() -> Optional[Path]:
        scripts = [p for p in root.rglob("*") if p.suffix.lower() in {".sh", ".bat", ".cmd"}]
        # Filter out ServerPackCreator scripts
        valid_scripts = []
        for s in scripts:
            try:
                # Read start of file to check for SPC signature
                content = s.read_text(errors='ignore')
                if "ServerPackCreator" in content:
                    continue
            except Exception:
                pass
            valid_scripts.append(s)
            
        if not valid_scripts:
            return None
            
        scripts_sorted = sorted(
            valid_scripts,
            key=lambda p: (
                0 if p.suffix.lower() == ".sh" else 1,
                0 if p.name.lower() in preferred_names else 1,
                len(p.parts),
            ),
        )
        return scripts_sorted[0]

    script = pick_script()
    if script and script.suffix.lower() == ".sh":
        rel = script.relative_to(root)
        rel_posix = rel.as_posix()
        command = [
            "/bin/bash", "-c",
            f"cd /data && chmod +x {rel_posix} && ./{rel_posix}"
        ]
        return command, rel.as_posix()

    # 5. Generic Jar Fallback
    jar_candidates = [
        p for p in root.rglob("*.jar")
        if not any(part in {"libraries", "mods", "plugins"} for part in p.parts)
        and "installer" not in p.name.lower()
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
        rel_dir = rel.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_mb}M -Xmx{ram_mb}M"
        command = ["/bin/bash", "-c", f"{cd_prefix}java {jvm_opts} -jar {rel.name} nogui"]
        return command, rel.as_posix()

    return [], None
