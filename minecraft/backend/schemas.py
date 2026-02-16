from typing import Dict, List, Optional
from pydantic import BaseModel, Field


# --- Request models ---

class CreateServerRequest(BaseModel):
    name: str = Field(..., example="My Modded Server")
    project_id: str
    version_id: str
    version_number: Optional[str] = None
    loader: Optional[str] = None
    source: Optional[str] = None
    port: int = Field(25565, ge=1, le=65535)
    ram_mb: int = Field(4096, ge=1024, le=32768)


class UpdateServerRequest(BaseModel):
    name: Optional[str] = None
    port: Optional[int] = Field(None, ge=1, le=65535)
    max_players: Optional[int] = Field(None, ge=1, le=1000)
    ram_mb: Optional[int] = Field(None, ge=1024, le=32768)


class CommandRequest(BaseModel):
    command: str


# --- Response models ---

class ServerStatsResponse(BaseModel):
    ramUsage: float = 0
    ramTotal: float = 0
    cpuLoad: float = 0.0
    latency: Optional[float] = None
    players: int = 0
    maxPlayers: int = 20


class ServerStatusResponse(BaseModel):
    status: str
    stats: Optional[ServerStatsResponse] = None


class ServerInstanceResponse(BaseModel):
    id: str
    name: str
    project_id: str
    version_id: str
    version_number: Optional[str] = None
    loader: Optional[str] = None
    source: Optional[str] = None
    port: int
    ram_mb: int
    status: str
    container_name: Optional[str] = None
    minecraft_version: Optional[str] = None


class ListServersResponse(BaseModel):
    items: List[Dict]


class LogsResponse(BaseModel):
    lines: List[str]


class CommandResponse(BaseModel):
    sent: bool
    command: str
