import json
import logging
import os
import shutil
import tarfile
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import docker
import requests
from docker.errors import NotFound as DockerNotFound

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "instances"
STATE_FILE = DATA_DIR / "instances.json"


class OrchestratorError(Exception):
    """Base error for orchestrator failures."""


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.touch(exist_ok=True)
    if not STATE_FILE.read_text().strip():
        STATE_FILE.write_text("[]")


def load_instances() -> List[Dict]:
    ensure_dirs()
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return []


def save_instances(instances: List[Dict]) -> None:
    ensure_dirs()
    STATE_FILE.write_text(json.dumps(instances, indent=2))


def upsert_instance(instance: Dict) -> Dict:
    instances = load_instances()
    filtered = [i for i in instances if i.get("id") != instance.get("id")]
    filtered.append(instance)
    save_instances(filtered)
    return instance


def get_instance(instance_id: str) -> Optional[Dict]:
    return next((i for i in load_instances() if i.get("id") == instance_id), None)


def _docker_client() -> docker.DockerClient:
    try:
        return docker.from_env()
    except Exception as exc:  # pragma: no cover - defensive
        raise OrchestratorError(f"Docker client error: {exc}") from exc


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    fh.write(chunk)


def _extract_archive(archive_path: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = archive_path.suffix.lower()
    if suffix in [".zip", ".mrpack"]:
        import zipfile

        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(dest_dir)
        return

    if tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path, "r:*") as tf:
            tf.extractall(dest_dir)
        return

    raise OrchestratorError(f"Unsupported archive format: {archive_path.name}")


def _detect_start_command(root: Path, ram_gb: int) -> Tuple[List[str], Optional[str]]:
    """Return (command, entry_target) to start the server, searching scripts and jars recursively."""

    preferred_names = {
        "start.sh",
        "run.sh",
        "serverstart.sh",
        "startserver.sh",
        "launch.sh",
    }

    # Try Forge installer first: forge-<mc>-<ver>-installer.jar
    installer = next((p for p in root.rglob("*.jar") if "installer" in p.name.lower()), None)
    if installer:
        rel_installer = installer.relative_to(root)
        rel_dir = rel_installer.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        name = rel_installer.name
        # Extract forge version segment between forge- and -installer
        forge_version = ""
        if "forge-" in name and "-installer" in name:
            forge_version = name.split("forge-", 1)[1].rsplit("-installer", 1)[0]
        install_cmd = f"{cd_prefix}java -jar {name} --installServer"
        if forge_version:
            run_cmd = (
                f"{cd_prefix}java @user_jvm_args.txt @libraries/net/minecraftforge/forge/{forge_version}/unix_args.txt nogui"
            )
        else:
            run_cmd = f"{cd_prefix}java -Xms{ram_gb}G -Xmx{ram_gb}G -jar {name} nogui"
        return ["/bin/bash", "-c", f"{install_cmd} && {run_cmd}"], rel_installer.as_posix()

    def pick_script() -> Optional[Path]:
        scripts = list(root.rglob("*.sh"))
        if not scripts:
            return None
        # Prefer known names, then shortest path
        scripts_sorted = sorted(
            scripts,
            key=lambda p: (0 if p.name.lower() in preferred_names else 1, len(p.parts)),
        )
        return scripts_sorted[0]

    script = pick_script()
    if script:
        rel = script.relative_to(root)
        rel_dir = rel.parent.as_posix()
        rel_name = rel.name
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        chmod_cmd = f"{cd_prefix}chmod +x {rel_name} && "
        runner = f"./{rel_name}" if script.suffix.lower() == ".sh" else f"bash {rel_name}"
        command = ["/bin/bash", "-c", f"{chmod_cmd}{runner}"]
        return command, rel.as_posix()

    # Fallback to java -jar: pick a likely server jar, skip library directories
    jar_candidates = [
        p
        for p in root.rglob("*.jar")
        if not any(part in {"libraries", "mods", "plugins"} for part in p.parts)
    ]
    if jar_candidates:
        jar_sorted = sorted(
            jar_candidates,
            key=lambda p: (
                0 if "server" in p.name.lower() else 1,
                0 if "forge" in p.name.lower() or "fabric" in p.name.lower() else 1,
                len(p.parts),
            ),
        )
        jar = jar_sorted[0]
        rel = jar.relative_to(root)
        rel_dir = rel.parent.as_posix()
        cd_prefix = f"cd {rel_dir} && " if rel_dir and rel_dir != "." else ""
        jvm_opts = f"-Xms{ram_gb}G -Xmx{ram_gb}G"
        command = ["/bin/bash", "-c", f"{cd_prefix}java {jvm_opts} -jar {rel.name} nogui"]
        return command, rel.as_posix()

    raise OrchestratorError("Could not detect start command in server pack")


def prepare_instance_files(
    project_id: str, version_id: str, file_url: str, ram_gb: int, instance_id: str
) -> Dict:
    """
    Download and extract the server pack for an instance, returning metadata with
    paths and detected start command.
    """
    instance_dir = DATA_DIR / instance_id
    pack_path = instance_dir / "serverpack"
    extract_dir = instance_dir / "server"
    pack_path.mkdir(parents=True, exist_ok=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    archive_path = pack_path / Path(file_url).name
    _download(file_url, archive_path)
    _extract_archive(archive_path, extract_dir)

    # Accept EULA by default
    (extract_dir / "eula.txt").write_text("eula=true\n")

    command, entry_target = _detect_start_command(extract_dir, ram_gb)
    return {
        "instance_dir": str(instance_dir),
        "extract_dir": str(extract_dir),
        "archive_path": str(archive_path),
        "entry_target": entry_target,
        "start_command": command,
    }


def create_instance(
    *, name: str, project_id: str, version_id: str, version_number: Optional[str], loader: Optional[str], port: int, ram_gb: int, file_url: str
) -> Dict:
    instance_id = f"srv-{uuid.uuid4().hex[:8]}"
    prepared = prepare_instance_files(project_id, version_id, file_url, ram_gb, instance_id)
    instance = {
        "id": instance_id,
        "name": name,
        "project_id": project_id,
        "version_id": version_id,
        "version_number": version_number,
        "loader": loader,
        "port": port,
        "ram_gb": ram_gb,
        "file_url": file_url,
        "status": "OFFLINE",
        "container_name": f"mc-{instance_id}",
        **prepared,
    }
    upsert_instance(instance)
    return instance


def _container_for(instance: Dict):
    client = _docker_client()
    try:
        return client.containers.get(instance["container_name"])
    except DockerNotFound:
        return None


def start_instance(instance_id: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    client = _docker_client()
    container = _container_for(instance)
    if container and container.status == "running":
        return {"status": "ONLINE"}

    workdir = Path(instance["extract_dir"])
    cmd = instance.get("start_command")
    if not cmd:
        raise OrchestratorError("Start command missing for instance")

    port = instance.get("port", 25565)
    ram_gb = instance.get("ram_gb", 4)

    if container:
        try:
            container.remove(force=True)
        except Exception:  # pragma: no cover
            pass

    env = {
        "EULA": "TRUE",
        "INIT_MEMORY": f"{ram_gb}G",
        "MAX_MEMORY": f"{ram_gb}G",
    }

    container = client.containers.run(
        image="eclipse-temurin:17-jre",
        name=instance["container_name"],
        command=cmd,
        working_dir="/data",
        environment=env,
        ports={"25565/tcp": port},
        volumes={str(workdir): {"bind": "/data", "mode": "rw"}},
        stdin_open=True,
        tty=False,
        detach=True,
    )

    instance["status"] = "STARTING"
    upsert_instance(instance)
    return {"status": "STARTING", "container_id": container.id}


def stop_instance(instance_id: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    container = _container_for(instance)
    if container:
        try:
            container.stop(timeout=20)
            container.remove()
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to stop container %s: %s", instance_id, exc)

    instance["status"] = "OFFLINE"
    upsert_instance(instance)
    return {"status": "OFFLINE"}


def instance_status(instance_id: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")

    status = instance.get("status", "OFFLINE")
    stats = {"ramUsage": 0, "ramTotal": instance.get("ram_gb", 0), "cpuLoad": 0.0, "tps": 0.0}

    container = _container_for(instance)
    if container:
        container.reload()
        state = container.attrs.get("State", {})
        running = state.get("Running", False)
        status = "ONLINE" if running else "OFFLINE"
        try:
            raw_stats = container.stats(stream=False)
            mem_usage = raw_stats.get("memory_stats", {}).get("usage", 0)
            mem_limit = raw_stats.get("memory_stats", {}).get("limit", 1)
            cpu_delta = raw_stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) - raw_stats.get("precpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
            system_delta = raw_stats.get("cpu_stats", {}).get("system_cpu_usage", 0) - raw_stats.get("precpu_stats", {}).get("system_cpu_usage", 0)
            cpu_percent = 0.0
            if system_delta > 0 and cpu_delta > 0:
                cpu_percent = (cpu_delta / system_delta) * 100.0 * len(raw_stats.get("cpu_stats", {}).get("cpu_usage", {}).get("percpu_usage", []) or [1])
            stats["ramUsage"] = round(mem_usage / (1024 ** 3), 2)
            stats["ramTotal"] = round(mem_limit / (1024 ** 3), 2)
            stats["cpuLoad"] = round(cpu_percent, 2)
            stats["tps"] = 20.0 if running else 0.0
        except Exception as exc:  # pragma: no cover
            log.warning("Failed to read stats for %s: %s", instance_id, exc)

    instance["status"] = status
    upsert_instance(instance)
    return {"status": status, "stats": stats}


def tail_logs(instance_id: str, tail: int = 200) -> List[str]:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")
    container = _container_for(instance)
    if not container:
        return []
    try:
        raw = container.logs(tail=tail).decode("utf-8", errors="ignore")
    except Exception as exc:  # pragma: no cover
        log.warning("Failed to fetch logs for %s: %s", instance_id, exc)
        return []
    return raw.splitlines()


def send_command(instance_id: str, command: str) -> Dict:
    instance = get_instance(instance_id)
    if not instance:
        raise OrchestratorError("Instance not found")
    container = _container_for(instance)
    if not container:
        raise OrchestratorError("Container is not running")

    client = _docker_client()
    exec_id = client.api.exec_create(
        container.id,
        cmd=["/bin/sh", "-c", f"printf '{command}\\n' > /proc/1/fd/0"],
        stdin=False,
        tty=False,
    )
    client.api.exec_start(exec_id)
    return {"sent": True, "command": command}


def delete_instance(instance_id: str) -> None:
    instance = get_instance(instance_id)
    if not instance:
        return
    try:
        stop_instance(instance_id)
    except OrchestratorError:
        pass
    instance_dir = Path(instance.get("instance_dir", DATA_DIR / instance_id))
    if instance_dir.exists():
        shutil.rmtree(instance_dir, ignore_errors=True)
    remaining = [i for i in load_instances() if i.get("id") != instance_id]
    save_instances(remaining)
