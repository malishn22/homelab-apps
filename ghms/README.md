# GHMS — game server manager

Self-hosted control plane for game servers. A FastAPI backend spawns and manages one container per
game instance through the Docker socket; a Vite frontend drives it.

Source lives in [`malishn22/ghms-dev`](https://github.com/malishn22/ghms-dev). This directory holds
deploy manifests and runtime state only — **never build from here.**

| | |
|---|---|
| API | `:8000` (`ghms-backend`) |
| Web | `:3010` (`ghms-frontend`) |
| Vhost | `minecraft.home` → nginx → `ghms-frontend` |
| Images | `ghcr.io/malishn22/minecraft-backend`, `minecraft-frontend` |

> The directory was called `minecraft/` until July 2026, when GHMS grew past Minecraft. The
> `minecraft.home` vhost and the `minecraft-*` image names still carry the old scope. Renaming the
> vhost means editing `/etc/hosts` on every client machine, so it waits for real LAN DNS.

## Run

```bash
cd ~/homelab/apps/ghms
cp .env.example .env          # then set HOMELAB_ROOT
docker compose pull
docker compose up -d
```

Deploys are normally automatic: pushing to `ghms-dev` runs lint/test → build & push to GHCR →
a deploy job on this host's self-hosted runner that does `docker compose pull && up -d` here.

## Instances

Game servers are **not** Compose services. GHMS creates them on demand and records them in
`backend/data/instances/instances.json`. Start and stop them from the GHMS UI.

| Instance | Game | ID | Port |
|---|---|---|---|
| My Minecraft Server | minecraft | `srv-xxxxxxxx` | 25565 |
| My Hytale Server | hytale | `srv-yyyyyyyy` | 5520 |
| My Satisfactory Server | satisfactory | `srv-zzzzzzzz` | 7777 tcp+udp, 8888 |

They join `minecraft_instances`, a separate bridge from `homelab`, so game servers stay isolated
from the rest of the stack.

## Caveats

### Never write a compose file for a game server

Satisfactory was migrated from its own `apps/satisfactory/` stack into GHMS on 2026-07-04, but the
old compose file was left behind. On 2026-07-22 a `docker compose up` in that directory grabbed
ports 7777/8888 and knocked the live server offline — GHMS could not restart its own container and
reported `Bind for 0.0.0.0:8888 failed: port is already allocated`.

Two systems allocate host ports on this box — Compose files by hand, GHMS per instance — and
neither knows about the other. Docker only refuses at bind time, so you find out when something
breaks. Check `~/homelab/PORTS.md` before claiming a port.

### `instances.json` stores absolute host paths

`instance_dir` and `extract_dir` are written as full host paths like
`~/homelab/apps/ghms/backend/data/servers/...`. **Renaming any directory above
`backend/data/servers/` breaks instances until this file is edited to match.**

The field is also inconsistent: the Minecraft instance stores a *container-side* path
(`/data/servers/minecraft/srv-xxxxxxxx`) while Hytale and Satisfactory store host paths. Only the
host-path entries need editing on a rename — changing the container-side one breaks it.

### After any path change, remove the instance containers

A container's bind mount is resolved at **creation** and baked into its config. Rename a directory
and an existing container still points at the old path — and because Docker **auto-creates missing
bind-mount source directories**, starting it does not error. It silently creates an empty folder
and boots the server with a **brand new empty world**, reporting ONLINE.

```bash
docker rm satisfactory-srv-xxxxxxxx     # then Start from the UI
```

GHMS then builds a fresh container against the corrected path. Verify the world is the real one by
checking that saves carry today's date and keep advancing:

```bash
find backend/data/servers/satisfactory/srv-xxxxxxxx/saved -name '*.sav' \
  -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -3
```

### `HOMELAB_ROOT` must be an absolute host path

Set in `.env` to `~/homelab`. It is passed to the backend as `HOST_SERVERS_ROOT` and used
to build bind-mount paths for containers the backend spawns. Those are resolved by the Docker
**daemon** on the host, not inside the backend container, so a relative path silently points at
nothing.

### The backend mounts `/var/run/docker.sock`

Full control of the Docker daemon — effectively host root. Deliberate, since GHMS is a container
orchestrator, and the reason this stack is not exposed outside the LAN.

### Stop game servers gracefully

Use the UI's Stop button. If you must use the CLI, allow time for the world to flush — `docker
stop` defaults to a 10-second grace period before `SIGKILL`, which is not always enough:

```bash
docker stop -t 60 satisfactory-srv-xxxxxxxx
```

`docker stop` also leaves GHMS believing the instance is still ONLINE until it next polls.

## Files

```
ghms/
├─ docker-compose.yml           deploy — pulls GHCR images
├─ docker-compose.dev.yml       dev — builds from the upstream checkout (run from ghms-dev)
├─ .env.example
├─ backend/{Dockerfile, data/}  data/ is runtime state — gitignored
└─ frontend/{Dockerfile, docker-entrypoint.sh}
```

`backend/data/` holds `instances/` (instance registry + backup settings), `servers/` (per-instance
game data, several GB), `backups/`, and the `*-defaults` templates applied to new servers.
