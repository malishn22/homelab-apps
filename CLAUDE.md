# homelab-apps — working notes

Deployment manifests only. Read `README.md` first for the stack-by-stack detail; this file is the
short list of things that are easy to get wrong here.

## The one rule

**There is no application source in this repo.** Every image is `ghcr.io/malishn22/*`, built by CI
in its own upstream repo (`calimali-backend`, `ghms-dev`, `spotify-archiver`,
`spotify-archiver-web`). Deploying is `docker compose pull && up -d` — never a build.

The `ghms/` Dockerfiles look buildable but are not: they use `context: ../..` and
`COPY apps/minecraft/...`, paths that only resolve inside the upstream checkout. If a change is
needed to application behaviour, it belongs in the upstream repo, not here.

That `apps/minecraft/` is the **upstream** repo's own layout and is correct as written — it has
nothing to do with this repo's directory, which was renamed `minecraft/` → `ghms/` in July 2026.
Do not "fix" it to match.

## Conventions

- Commits: plain imperative, sentence case. No Conventional Commits prefixes.
  Match `git log` — e.g. "Nest Spotify scheduler and web under spotify-archiver/".
- A stack is complete when it has `docker-compose.yml`, `.env`, `.env.example`, and an entry in
  `README.md`. `calimali/` and the two `spotify-archiver/` stacks still lack their own `README.md`.
- All stacks join the external bridge network `homelab`. Declare it `external: true` — never let
  Compose create its own, or nginx loses name resolution to the container. (GHMS-spawned game
  servers are the exception: they go on `minecraft_instances`, deliberately isolated.)

## Traps

- **`HOMELAB_ROOT` must be an absolute host path.** It is passed through to the GHMS backend as
  `HOST_SERVERS_ROOT` and used to build bind-mount paths for containers the backend spawns. Those
  are resolved by the Docker daemon on the host, so a relative path silently points at nothing.
- **`ghms` and `spotify-archiver-scheduler` mount `/var/run/docker.sock`.** That is full control of
  the Docker daemon — effectively host root. It is intentional (GHMS spawns server containers;
  ofelia execs the sync job) but never add it to another service casually.
- **GHMS writes absolute host paths into `instances.json`.** Renaming any directory above
  `ghms/backend/data/servers/` silently breaks instances until that file is edited too. Worse, a
  container created *before* such a rename keeps the old path baked into its mount config, and
  Docker **auto-creates missing bind-mount sources** — so starting it yields an empty world with no
  error. After any path change, `docker rm` the instance containers so GHMS rebuilds them.
  Inconsistency to know about: the Minecraft instance stores a *container-side* path
  (`/data/servers/...`) in that same field while Hytale and Satisfactory store host paths.
- **Game servers are GHMS instances, not stacks.** Never write a compose file for one. A leftover
  `apps/satisfactory/docker-compose.yml` took ports 7777/8888 on 2026-07-22 and knocked the live
  server offline. Two systems allocate host ports here — Compose by hand, GHMS per instance — and
  neither knows about the other. Check `~/homelab/PORTS.md` first.
- **Two Postgres instances.** spotify-archiver on 5432, calimali on 5433. Adding a third stack with
  a database means picking a new host port.
- **The Spotify token cache is shared by bind mount**: the scheduler mounts
  `../spotify-archiver-web/.spotify_token_cache`. Moving or renaming either directory breaks
  scheduled exports with an auth error that looks unrelated.
- **Prometheus scrapes the spotify backend as `backend:8000`** — a very generic container name on a
  shared bridge. Do not name another service `backend`.

## Never commit

Any `.env`, `ghms/backend/data/`, `satisfactory/satisfactory-server/`,
`spotify-archiver/*/exports/`, `spotify-archiver/*/data/`, `.spotify_token_cache/`.