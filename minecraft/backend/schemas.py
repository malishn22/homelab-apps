from typing import Optional
from pydantic import BaseModel, Field


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
