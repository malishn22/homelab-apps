import os
from pathlib import Path


def load_local_env() -> None:
    """
    Load environment variables from a local .env file if present without
    overriding variables that are already set.
    """
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key and key not in os.environ:
            os.environ[key.strip()] = value.strip().strip("'").strip('"')


# Load .env immediately on import so other modules see values in os.environ
load_local_env()

MODRINTH_BASE_URL = os.environ.get("MODRINTH_BASE_URL")
MODRINTH_USER_AGENT = os.environ.get("MODRINTH_USER_AGENT")
CURSEFORGE_BASE_URL = os.environ.get("CURSEFORGE_BASE_URL")
CURSEFORGE_API_KEY = os.environ.get("CURSEFORGE_API_KEY")


def validate_modrinth_settings() -> None:
    """
    Ensure Modrinth settings are present; raise early if missing.
    """
    if not MODRINTH_BASE_URL or not MODRINTH_USER_AGENT:
        raise RuntimeError(
            "Missing required environment variables: MODRINTH_BASE_URL and "
            "MODRINTH_USER_AGENT. Set them in backend/.env"
        )


def validate_curseforge_settings(required: bool = False) -> None:
    """
    Ensure CurseForge settings are present when required.
    """
    if not required:
        return
    if not CURSEFORGE_BASE_URL or not CURSEFORGE_API_KEY:
        raise RuntimeError(
            "Missing required environment variables: CURSEFORGE_BASE_URL and "
            "CURSEFORGE_API_KEY. Set them in backend/.env"
        )
