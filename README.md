# Homelab Apps

Deployment manifests for the applications running on my homelab host.

> ⚠️ **This repository contains no application source code.**
> Every image here is pulled from `ghcr.io/malishn22/*` and built in its own upstream repository.
> This repo holds only the Compose files, env templates, and runtime data layout that decide how
> those images run on the host.

Infrastructure — reverse proxy, monitoring, media, bookmarks — lives in the companion repo.

[![Infra Repo](https://img.shields.io/badge/Repo-homelab--infra-blue?style=for-the-badge)](https://github.com/malishn22/homelab-infra)

---

## 🧭 Where the source lives

| Stack | Image | Source repository |
|---|---|---|
| calimali | `ghcr.io/malishn22/calimali-backend` | `malishn22/calimali-backend` |
| ghms | `ghcr.io/malishn22/minecraft-backend`, `minecraft-frontend` | `malishn22/ghms-dev` |
| spotify-archiver (scheduler) | `ghcr.io/malishn22/spotify-archiver` | `malishn22/spotify-archiver` |
| spotify-archiver (web) | `ghcr.io/malishn22/spotify-archiver-backend`, `-frontend` | `malishn22/spotify-archiver-web` |

Game servers (Satisfactory, Minecraft, Hytale) are **not stacks** — GHMS spawns them from
third-party or vendored images through the Docker socket. See the GHMS section below.

Each source repo builds and pushes its own image with a self-hosted runner on this host. Deploying
here is `docker compose pull && docker compose up -d` — never a build.

The `Dockerfile`s under `ghms/` are the exception that proves the rule: they declare
`context: ../..` and `COPY apps/minecraft/...`, which only resolves inside the **upstream** repo's
checkout. They are unbuildable from this repository by design.

> The `apps/minecraft/` in that `COPY` is the **upstream** repo's own layout and is correct as
> written — it is unrelated to this repo's directory, which was renamed `minecraft/` → `ghms/` in
> July 2026. Do not "fix" it.

---

## 🗂️ Repository structure

```text
apps/
├─ calimali/                            # ASP.NET Core API + PostgreSQL 16
│  ├─ docker-compose.yml
│  └─ .env.example
│
├─ ghms/                                # GHMS — game server manager (FastAPI + Vite)
│  ├─ docker-compose.yml                # deploy: pulls GHCR images
│  ├─ docker-compose.dev.yml            # dev: builds from the upstream checkout
│  ├─ .env.example
│  ├─ README.md
│  ├─ backend/{Dockerfile, data/}       # data/ is runtime state — gitignored
│  └─ frontend/{Dockerfile, docker-entrypoint.sh}
│
└─ spotify-archiver/
   ├─ spotify-archiver-scheduler/       # Python exporter + PostgreSQL + ofelia cron
   │  ├─ docker-compose.yml
   │  └─ .env.example
   └─ spotify-archiver-web/             # Web UI over the archived data
      ├─ docker-compose.yml
      └─ .env.example
```

---

## 🚀 Running a stack

Every stack joins the **external** Docker bridge network `homelab`, which is created once by hand
and shared with the infra stacks. That shared bridge is what lets nginx reach each container by
name — `proxy_pass http://ghms-backend:8000` with no IP anywhere.

```bash
docker network create homelab      # once per host, if it doesn't exist
cd <stack>
cp .env.example .env               # then fill in the values
docker compose pull
docker compose up -d
```

### `HOMELAB_ROOT`

`ghms/` bind-mounts its runtime data using `${HOMELAB_ROOT}`, which must be an **absolute host
path** to the homelab root (`~/homelab`). Set it in `ghms/.env`.

It cannot be a relative path: the value is also passed to the backend as `HOST_SERVERS_ROOT` so
that, when the backend asks Docker to create a game server container, it can specify a bind mount.
Those paths are resolved by the Docker **daemon** on the host, not inside the backend container —
so a path relative to the container's working directory would point at nothing.

---

## 📦 Stack notes

### calimali — `:8080`, db on `:5433`

ASP.NET Core API against PostgreSQL 16. The DB port is published on 5433 to avoid colliding with
the spotify-archiver Postgres already on 5432. Data lives in the named volume `calimali_db`, which
means it lives under `/var/lib/docker/volumes` — see the note on `/var` below.

### ghms — API `:8000`, web `:3010`, vhost `minecraft.home`

GHMS manages **all** game servers on this host — Minecraft, Hytale and Satisfactory. The directory
was called `minecraft/` until July 2026, when it stopped being accurate. The `minecraft.home` vhost
is the last name still carrying the old scope; renaming it means editing `/etc/hosts` on every
client, so it waits for real LAN DNS.

Two networks on purpose:

- `homelab` — how nginx and the frontend reach the backend.
- `minecraft_instances` — the network the backend *creates game server containers on*, keeping
  per-instance servers isolated from the rest of the homelab.

The backend mounts `/var/run/docker.sock` because it is a container orchestrator: it starts, stops,
and configures game server containers on demand. Mounting the socket grants full control of the
Docker daemon, which is effectively host root — it is deliberate here, and it is the reason this
stack is not exposed outside the LAN.

`docker-compose.dev.yml` builds both images from an upstream checkout instead of pulling; use it
from the `ghms-dev` repo, not from here.

See `ghms/README.md` for instance management and the `instances.json` path trap.

### spotify-archiver — web `:3001`/`:8001`, postgres `:5432`

Two compose projects that share state:

- **scheduler** — the Python exporter, its PostgreSQL 16 database, and an
  [ofelia](https://github.com/mcuadros/ofelia) container that runs the export on a schedule.
  ofelia reads its jobs from **container labels** rather than a config file, so the schedule
  (`0 0 6 */2 * *` — 06:00 every second day; ofelia uses a 6-field cron with leading seconds) is
  declared on the `spotify-export` service itself.
- **web** — the UI and API over the archived data.

The web project owns `.spotify_token_cache/`, and the scheduler mounts that same directory from
`../spotify-archiver-web/`. One OAuth token refresh, shared by both — which also means the web
stack must have authenticated at least once before a scheduled export can succeed.

### game servers — managed by GHMS, not by Compose

Satisfactory (`:7777` tcp/udp + `:8888`), Minecraft (`:25565`) and Hytale (`:5520`) run as **GHMS
instances**. There is no compose file for them and there should not be one — start and stop them
from the GHMS UI.

Satisfactory previously ran from its own `apps/satisfactory/` stack and was migrated into GHMS on
2026-07-04. The old compose file was left behind, and on 2026-07-22 running it took ports
7777/8888 and knocked the live server offline. It has been deleted;
`apps/satisfactory/satisfactory-server/` is kept only as a frozen pre-migration copy of the world
until backups are in place.

---

## ⚠️ Host constraints worth knowing

- **Never commit a `.env`.** Every stack ships a `.env.example`; the real file is gitignored and
  holds live credentials.
- Images are `:latest` and pulled continuously by CI, so old layers accumulate. A weekly prune
  (`infra/scripts/docker-cleanup.sh`) keeps `/var` from filling.
