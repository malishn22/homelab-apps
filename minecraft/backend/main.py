
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Try package-style imports first (backend.main)
try:
    from .config import validate_modrinth_settings
    from .db import init_db
    from .api.modpacks import router as modpacks_router
    from .api.servers import router as servers_router
except ImportError:
    # Fallback for flat layout (/app/main.py in Docker)
    import sys

    BASE_DIR = Path(__file__).resolve().parent
    if str(BASE_DIR) not in sys.path:
        sys.path.append(str(BASE_DIR))

    from config import validate_modrinth_settings  # type: ignore
    from db import init_db  # type: ignore
    from api.modpacks import router as modpacks_router  # type: ignore
    from api.servers import router as servers_router  # type: ignore


app = FastAPI(title="Craft Control API", version="0.1.0")

# CORS – keep wide open for now; you can tighten later
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    """
    Validate config and initialize DB on process start.
    """
    validate_modrinth_settings()
    init_db()


# The routers themselves define "modpacks" and "servers" prefixes.
# Here we just mount everything under /api so the final paths are:
#   /api/modpacks/...
#   /api/servers/...
app.include_router(modpacks_router, prefix="/api")
app.include_router(servers_router, prefix="/api")


if __name__ == "__main__":
    # Local/dev entrypoint: python backend/main.py
    host = os.environ.get("UVICORN_HOST", "0.0.0.0")
    port = int(os.environ.get("UVICORN_PORT", "8000"))
    reload_enabled = os.environ.get("UVICORN_RELOAD", "true").lower() == "true"

    target = "main:app" if reload_enabled else app
    uvicorn.run(target, host=host, port=port, reload=reload_enabled)
