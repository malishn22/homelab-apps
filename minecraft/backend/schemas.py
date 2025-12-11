from typing import Optional
from pydantic import BaseModel, Field


class CreateServerRequest(BaseModel):
    name: str = Field(..., example="My Modded Server")
    project_id: str
    version_id: str
    version_number: Optional[str] = None
    loader: Optional[str] = None
    port: int = Field(25565, ge=1, le=65535)
    ram_gb: int = Field(4, ge=1, le=32)


class CommandRequest(BaseModel):
    command: str
