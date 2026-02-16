"""Shared enumerations for the orchestrator package."""

from enum import Enum


class ServerStatus(str, Enum):
    """Server instance lifecycle status values."""
    PREPARING = "PREPARING"
    OFFLINE = "OFFLINE"
    STARTING = "STARTING"
    STOPPING = "STOPPING"
    RESTARTING = "RESTARTING"
    ONLINE = "ONLINE"
    ERROR = "ERROR"
