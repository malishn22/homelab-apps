"""
Backward-compatible re-export layer.

All implementation has been split into:
  - enums.py      : ServerStatus enum
  - java.py       : Java version detection and JVM arg helpers
  - container.py  : Docker container operations
  - monitor.py    : Status detection, log streaming, stats collection
  - lifecycle.py  : High-level create/start/stop/restart/update/delete
"""

from .enums import ServerStatus

# Backwards-compatible constant aliases
STATUS_PREPARING = ServerStatus.PREPARING
STATUS_OFFLINE = ServerStatus.OFFLINE
STATUS_STARTING = ServerStatus.STARTING
STATUS_STOPPING = ServerStatus.STOPPING
STATUS_RESTARTING = ServerStatus.RESTARTING
STATUS_ONLINE = ServerStatus.ONLINE
STATUS_ERROR = ServerStatus.ERROR

# Re-export lifecycle functions (the main public API)
from .lifecycle import (
    create_instance,
    start_instance,
    stop_instance,
    restart_instance,
    update_instance,
    send_command,
    delete_instance,
)

# Re-export monitoring functions and helpers
from .monitor import (
    _server_run_dirs,
    instance_status,
    tail_logs,
)

__all__ = [
    "_server_run_dirs",
    "ServerStatus",
    "STATUS_PREPARING",
    "STATUS_OFFLINE",
    "STATUS_STARTING",
    "STATUS_STOPPING",
    "STATUS_RESTARTING",
    "STATUS_ONLINE",
    "STATUS_ERROR",
    "create_instance",
    "start_instance",
    "stop_instance",
    "restart_instance",
    "update_instance",
    "send_command",
    "delete_instance",
    "instance_status",
    "tail_logs",
]
