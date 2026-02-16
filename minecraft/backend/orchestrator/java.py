"""Java version detection and JVM argument helpers."""

import logging
from pathlib import Path
from typing import Dict, Optional

from .state import _log_line, upsert_instance
from .utils import (
    detect_minecraft_version_from_root,
    extract_minecraft_versions,
    pick_best_version,
)

log = logging.getLogger(__name__)

LEGACY_JVM_ARGS_LINES = {
    "-XX:+UseG1GC",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:G1NewSizePercent=20",
    "-XX:G1ReservePercent=20",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=32M",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-Dsun.rmi.dgc.server.gcInterval=2147483646",
    "-Dsun.rmi.dgc.client.gcInterval=2147483646",
}


def is_legacy_jvm_args(text: str) -> bool:
    """Check if user_jvm_args.txt contains only the legacy default args."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    non_mem = [line for line in lines if not line.startswith(("-Xms", "-Xmx"))]
    if set(non_mem) != LEGACY_JVM_ARGS_LINES:
        return False
    for line in lines:
        if line.startswith(("-Xms", "-Xmx")):
            continue
        if line not in LEGACY_JVM_ARGS_LINES:
            return False
    return True


def parse_minecraft_version(value: Optional[str]) -> Optional[str]:
    """Extract the best Minecraft version from a version string."""
    if not value:
        return None
    versions = extract_minecraft_versions(value)
    return pick_best_version(versions)


def java_major_for_mc(version: Optional[str]) -> int:
    """Determine the required Java major version for a given Minecraft version."""
    if not version:
        return 17
    parts = [p for p in version.split(".") if p.isdigit()]
    if len(parts) >= 2 and parts[0] == "1":
        minor = int(parts[1])
        if minor >= 21:
            return 21
        if minor >= 18:
            return 17
        if minor == 17:
            return 17
        return 8
    return 17


def select_java_image(
    instance: Dict, server_dir: Path, source: Optional[str], instance_id: str
) -> str:
    """Choose the appropriate eclipse-temurin Docker image for the instance."""
    mc_version = instance.get("minecraft_version")
    if not mc_version:
        mc_version = detect_minecraft_version_from_root(server_dir, source=source)
    if not mc_version:
        mc_version = parse_minecraft_version(instance.get("version_number"))
    if mc_version and mc_version != instance.get("minecraft_version"):
        instance["minecraft_version"] = mc_version
        upsert_instance(instance)

    if mc_version:
        if java_major_for_mc(mc_version) == 8:
            if any(server_dir.rglob("unix_args.txt")):
                java_major = 21
                _log_line(instance_id, f"[PREP] Detected unix_args.txt with old MC version ({mc_version}). Forcing Java {java_major}.")
            else:
                java_major = 8
        else:
            java_major = java_major_for_mc(mc_version)
    else:
        if any(server_dir.rglob("unix_args.txt")):
            java_major = 21
            _log_line(instance_id, "[PREP] No MC version detected, but found unix_args.txt. Defaulting to Java 21.")
        else:
            java_major = 21

    if mc_version:
        _log_line(instance_id, f"[PREP] Using Java {java_major} for Minecraft {mc_version}")
    return f"eclipse-temurin:{java_major}-jre"


def wrap_command_for_java(cmd: list) -> list:
    """Prepend JAVA_HOME export when the command runs a shell script."""
    if len(cmd) < 2 or cmd[0] not in ("/bin/bash", "/bin/sh", "bash", "sh"):
        return cmd
    inner = cmd[-1]
    if not inner or ".sh" not in inner or "./" not in inner:
        return cmd
    java_prefix = "export JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && "
    return cmd[:-1] + [java_prefix + inner]
