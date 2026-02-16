"""Server monitoring: status detection, log streaming, stats collection."""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .state import (
    get_instance,
    upsert_instance,
    _log_buffers,
    _log_lock,
)
from .container import get_container, container_ready
from .enums import ServerStatus

log = logging.getLogger(__name__)

PING_HOST = os.environ.get("MINECRAFT_PING_HOST", "host.docker.internal")

CONTAINER_DATA_ROOT = Path(os.environ.get("CONTAINER_DATA_ROOT", "/data"))
CONTAINER_SERVERS_ROOT = CONTAINER_DATA_ROOT / "servers"
HOST_SERVERS_ROOT = Path(os.environ.get("HOST_SERVERS_ROOT", "/data/servers"))


def _server_run_dirs(instance_id: str) -> Tuple[Path, Path]:
    server_dir_container = CONTAINER_SERVERS_ROOT / instance_id
    server_dir_host = HOST_SERVERS_ROOT / instance_id
    return server_dir_container, server_dir_host


def ping_server_players(host: str, port: int) -> Optional[Tuple[int, int, float]]:
    """Use mcstatus to get (online, max, latency_ms) or None."""
    try:
        from mcstatus import JavaServer
        server = JavaServer(host, port)
        status = server.status()
        return (status.players.online, status.players.max, status.latency)
    except Exception:
        return None


def read_max_players_from_properties(server_dir: Path) -> Optional[int]:
    """Read max-players from server.properties."""
    props_path = server_dir / "server.properties"
    if not props_path.exists():
        return None
    try:
        text = props_path.read_text(errors="ignore")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key.strip().lower() == "max-players":
                v = val.strip()
                if v.isdigit():
                    return int(v)
                return None
    except Exception:
        pass
    return None


def should_hide_perf_line(line: str) -> bool:
    """Hide TPS/dimension perf spam from logs."""
    lower = line.lower()
    if "mean tick time" in lower and "mean tps" in lower:
        return True
    if "tps" in lower and "ms/tick" in lower:
        return True
    if "unknown or incomplete command" in lower:
        if "neoforge tps" in lower or "forge tps" in lower:
            return True
    if "neoforge tps<--" in lower or "forge tps<--" in lower:
        return True
    return False


def instance_status(instance_id: str) -> Dict:
    """Return current status + resource stats for an instance."""
    instance = get_instance(instance_id)
    if not instance:
        return {
            "status": "OFFLINE",
            "stats": {
                "ramUsage": 0,
                "ramTotal": 0,
                "cpuLoad": 0.0,
                "latency": None,
                "players": 0,
                "maxPlayers": 20,
            },
        }

    status = instance.get("status", "OFFLINE")
    server_dir_container, server_dir_host = _server_run_dirs(instance_id)
    stats = {
        "ramUsage": 0,
        "ramTotal": round((instance.get("ram_mb", 0) or 0) / 1024, 2),
        "cpuLoad": 0.0,
        "latency": None,
        "players": 0,
        "maxPlayers": read_max_players_from_properties(server_dir_host) or 20,
    }

    container = get_container(instance)

    # No container
    if not container:
        if status in {ServerStatus.PREPARING, ServerStatus.RESTARTING, ServerStatus.ERROR}:
            return {"status": status, "stats": stats}
        if status != ServerStatus.OFFLINE:
            status = ServerStatus.OFFLINE
            instance["status"] = status
            upsert_instance(instance)
        return {"status": status, "stats": stats}

    # Container exists: collect stats
    try:
        container.reload()
        state = container.attrs.get("State", {})
        running = state.get("Running", False)
    except Exception as exc:
        log.warning("Failed to reload container for %s: %s", instance_id, exc)
        running = False

    # CPU / RAM stats
    try:
        raw_stats = container.stats(stream=False)
        mem_usage = raw_stats.get("memory_stats", {}).get("usage", 0)
        mem_limit = raw_stats.get("memory_stats", {}).get("limit", 1)
        cpu_delta = (
            raw_stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
            - raw_stats.get("precpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
        )
        system_delta = (
            raw_stats.get("cpu_stats", {}).get("system_cpu_usage", 0)
            - raw_stats.get("precpu_stats", {}).get("system_cpu_usage", 0)
        )
        cpu_percent = 0.0
        if system_delta > 0 and cpu_delta > 0:
            cpu_percent = (
                (cpu_delta / system_delta)
                * 100.0
                * len(
                    raw_stats.get("cpu_stats", {}).get("cpu_usage", {}).get("percpu_usage", [])
                    or [1]
                )
            )
        mem_usage_gb = round(mem_usage / (1024 ** 3), 2)
        mem_limit_gb = round(mem_limit / (1024 ** 3), 2)
        configured_mb = instance.get("ram_mb", 0) or 0
        configured_gb = round(configured_mb / 1024, 2)
        stats["ramTotal"] = configured_gb if configured_gb > 0 else mem_limit_gb
        stats["ramUsage"] = min(mem_usage_gb, stats["ramTotal"]) if stats["ramTotal"] > 0 else mem_usage_gb
        stats["cpuLoad"] = round(cpu_percent, 2)
    except Exception as exc:
        log.warning("Failed to read stats for %s: %s", instance_id, exc)

    # Players + latency via mcstatus
    max_from_props = read_max_players_from_properties(server_dir_host)
    try:
        if running and status in {ServerStatus.ONLINE, ServerStatus.STARTING}:
            ping_result = ping_server_players(PING_HOST, instance.get("port", 25565))
            if ping_result is not None:
                stats["players"] = ping_result[0]
                stats["maxPlayers"] = ping_result[1]
                stats["latency"] = round(ping_result[2], 2)
            else:
                stats["players"] = 0
                stats["maxPlayers"] = max_from_props or 20
                stats["latency"] = None
        else:
            stats["players"] = 0
            stats["maxPlayers"] = max_from_props or 20
            stats["latency"] = None
    except Exception as exc:
        log.warning("Failed to ping server for %s: %s", instance_id, exc)

    # State transitions
    if not running:
        if status != ServerStatus.ERROR:
            status = ServerStatus.OFFLINE
    else:
        if status in {ServerStatus.STARTING, ServerStatus.RESTARTING}:
            status = ServerStatus.ONLINE if container_ready(container) else ServerStatus.STARTING
        elif status in {ServerStatus.OFFLINE, ServerStatus.PREPARING}:
            status = ServerStatus.ONLINE if container_ready(container) else ServerStatus.STARTING

    instance["status"] = status
    upsert_instance(instance)
    return {"status": status, "stats": stats}


def tail_logs(instance_id: str, tail: int = 200) -> List[str]:
    """Return the last `tail` log lines for an instance."""
    instance = get_instance(instance_id)
    if not instance:
        return []

    with _log_lock:
        buf = _log_buffers.get(instance_id, [])
    logs: List[str] = list(buf)

    container = get_container(instance)
    if container:
        try:
            raw = container.logs(tail=tail).decode("utf-8", errors="ignore")
            container_lines = [line for line in raw.splitlines() if not should_hide_perf_line(line)]
            logs.extend(container_lines)
        except Exception as exc:
            log.warning("Failed to fetch logs for %s: %s", instance_id, exc)

    deduped: List[str] = []
    for line in logs:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    with _log_lock:
        _log_buffers[instance_id] = deduped[-2000:]

    return deduped[-tail:]
