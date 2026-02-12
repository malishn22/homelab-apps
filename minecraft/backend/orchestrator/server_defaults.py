"""Apply host-side server-defaults.properties and whitelist-defaults.json to server instances."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .state import _log_line, get_instance

log = logging.getLogger(__name__)

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
DEFAULT_TEMPLATE_CONTENT = "server-ip=\nwhite-list=true\n"
DEFAULT_WHITELIST_CONTENT = "[]\n"
DEFAULT_OPS_CONTENT = "[]\n"


def get_defaults_path() -> Path:
    """Resolve path to server-defaults template from env."""
    return Path(os.environ.get("SERVER_DEFAULTS_PATH", str(CONTAINER_DATA_ROOT / "server-defaults.properties")))


def _parse_properties(content: str) -> Dict[str, str]:
    """Parse key=value lines, ignore comments and blanks."""
    out: Dict[str, str] = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip()
    return out


def _serialize_properties(props: Dict[str, str]) -> str:
    """Serialize dict to properties format."""
    lines = [f"{k}={v}" for k, v in sorted(props.items())]
    return "\n".join(lines) + "\n"


def load_defaults() -> Dict[str, str]:
    """
    Parse key=value from template file. Create file with defaults if missing.
    """
    path = get_defaults_path()
    if path.exists():
        raw = path.read_text(encoding="utf-8", errors="replace")
        return _parse_properties(raw)
    # Create default file if missing
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DEFAULT_TEMPLATE_CONTENT, encoding="utf-8")
    log.info("Created server-defaults.properties at %s", path)
    return _parse_properties(DEFAULT_TEMPLATE_CONTENT)


def apply_server_defaults(server_dir: Path, instance_id: Optional[str] = None) -> None:
    """
    Apply template defaults to server_dir/server.properties.
    Removes built-in parameters that we override, then appends our defaults at the end
    so it's clear what was adjusted.
    """
    defaults = dict(load_defaults())
    if not defaults:
        return

    if instance_id:
        instance = get_instance(instance_id)
        if instance is not None:
            defaults["server-port"] = str(instance.get("port", 25565))

    override_keys = set(defaults.keys())
    props_path = server_dir / "server.properties"

    if props_path.exists():
        lines: List[str] = []
        for line in props_path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                lines.append(line)
                continue
            if "=" in stripped:
                key = stripped.split("=", 1)[0].strip()
                if key in override_keys:
                    continue
            lines.append(line)

        suffix = "\n".join(lines).rstrip()
        applied = "\n".join(f"{k}={v}" for k, v in sorted(defaults.items()))
        content = f"{suffix}\n\n# Applied by server-defaults\n{applied}\n"
    else:
        props_path.parent.mkdir(parents=True, exist_ok=True)
        applied = "\n".join(f"{k}={v}" for k, v in sorted(defaults.items()))
        content = f"# Applied by server-defaults\n{applied}\n"

    props_path.write_text(content, encoding="utf-8")

    if instance_id:
        _log_line(instance_id, "[PREP] Applied server-defaults template")


def get_whitelist_defaults_path() -> Path:
    """Resolve path to whitelist-defaults template from env."""
    return Path(
        os.environ.get("WHITELIST_DEFAULTS_PATH", str(CONTAINER_DATA_ROOT / "whitelist-defaults.json"))
    )


def load_whitelist_defaults() -> List[Dict[str, Any]]:
    """
    Load whitelist-defaults.json. Returns list of {"uuid": str, "name": str}.
    Create file with empty array if missing.
    """
    path = get_whitelist_defaults_path()
    if path.exists() and path.is_file():
        raw = path.read_text(encoding="utf-8", errors="replace")
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [e for e in data if isinstance(e, dict) and "uuid" in e and "name" in e]
            return []
        except json.JSONDecodeError:
            log.warning("Invalid JSON in whitelist-defaults.json: %s", path)
            return []
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DEFAULT_WHITELIST_CONTENT, encoding="utf-8")
    log.info("Created whitelist-defaults.json at %s", path)
    return []


def apply_whitelist_defaults(server_dir: Path, instance_id: Optional[str] = None) -> None:
    """
    Merge default whitelist entries into server_dir/whitelist.json.
    Adds entries from defaults that are not already present (by UUID).
    """
    defaults = load_whitelist_defaults()
    if not defaults:
        return

    wl_path = server_dir / "whitelist.json"
    existing: List[Dict[str, Any]] = []
    if wl_path.exists():
        try:
            raw = wl_path.read_text(encoding="utf-8", errors="replace")
            data = json.loads(raw)
            if isinstance(data, list):
                existing = [e for e in data if isinstance(e, dict) and "uuid" in e and "name" in e]
        except json.JSONDecodeError:
            pass

    seen_uuids = {e.get("uuid", "").strip().lower() for e in existing if e.get("uuid")}
    added = 0
    for entry in defaults:
        uuid_val = (entry.get("uuid") or "").strip()
        name_val = (entry.get("name") or "").strip()
        if not uuid_val or not name_val:
            continue
        if uuid_val.lower() not in seen_uuids:
            existing.append({"uuid": uuid_val, "name": name_val})
            seen_uuids.add(uuid_val.lower())
            added += 1

    if added > 0:
        wl_path.parent.mkdir(parents=True, exist_ok=True)
        wl_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        if instance_id:
            _log_line(instance_id, f"[PREP] Applied whitelist-defaults ({added} entries)")


def get_ops_defaults_path() -> Path:
    """Resolve path to ops-defaults template from env."""
    return Path(
        os.environ.get("OPS_DEFAULTS_PATH", str(CONTAINER_DATA_ROOT / "ops-defaults.json"))
    )


def load_ops_defaults() -> List[Dict[str, Any]]:
    """
    Load ops-defaults.json. Returns list of operator objects (uuid, name, level, bypassesPlayerLimit).
    Create file with empty array if missing.
    """
    path = get_ops_defaults_path()
    if path.exists() and path.is_file():
        raw = path.read_text(encoding="utf-8", errors="replace")
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [e for e in data if isinstance(e, dict) and "uuid" in e and "name" in e]
            return []
        except json.JSONDecodeError:
            log.warning("Invalid JSON in ops-defaults.json: %s", path)
            return []
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DEFAULT_OPS_CONTENT, encoding="utf-8")
    log.info("Created ops-defaults.json at %s", path)
    return []


def apply_ops_defaults(server_dir: Path, instance_id: Optional[str] = None) -> None:
    """
    Merge default ops entries into server_dir/ops.json.
    Adds entries from defaults that are not already present (by UUID).
    Preserves level and bypassesPlayerLimit from defaults when adding.
    """
    defaults = load_ops_defaults()
    if not defaults:
        return

    ops_path = server_dir / "ops.json"
    existing: List[Dict[str, Any]] = []
    if ops_path.exists():
        try:
            raw = ops_path.read_text(encoding="utf-8", errors="replace")
            data = json.loads(raw)
            if isinstance(data, list):
                existing = [e for e in data if isinstance(e, dict) and "uuid" in e and "name" in e]
        except json.JSONDecodeError:
            pass

    seen_uuids = {e.get("uuid", "").strip().lower() for e in existing if e.get("uuid")}
    added = 0
    for entry in defaults:
        uuid_val = (entry.get("uuid") or "").strip()
        name_val = (entry.get("name") or "").strip()
        if not uuid_val or not name_val:
            continue
        if uuid_val.lower() not in seen_uuids:
            op_entry: Dict[str, Any] = {"uuid": uuid_val, "name": name_val}
            if "level" in entry:
                op_entry["level"] = entry["level"]
            if "bypassesPlayerLimit" in entry:
                op_entry["bypassesPlayerLimit"] = entry["bypassesPlayerLimit"]
            existing.append(op_entry)
            seen_uuids.add(uuid_val.lower())
            added += 1

    if added > 0:
        ops_path.parent.mkdir(parents=True, exist_ok=True)
        ops_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        if instance_id:
            _log_line(instance_id, f"[PREP] Applied ops-defaults ({added} entries)")
