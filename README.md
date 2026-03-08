# DockObserver

A lightweight container that scans local Docker containers and Compose stacks, and checks for updates.

## Features
- Docker socket scan (running + stopped containers)
- Compose scan via mounted directories (`COMPOSE_MOUNTS`)
- Resolves Compose `image` variables from `.env` in each stack directory
- If a Compose `image` cannot be resolved directly, it maps via Docker Compose labels from the socket
- Persistent JSON store at `/data/db.json`
- Web UI for desktop + mobile
- Scheduled background tasks for refresh + update checks
- Shows last local scan and last automatic update check in the Web UI
- Update action with confirmation modal and optional `docker image prune -af`
- Asynchronous update jobs with separate live console per operation (parallel-capable)

## Start (Docker)
```bash
docker compose up -d
```

## Environment Variables
- `DATA_DIR` (default `/data`)
- `DOCKER_SOCKET` (default `/var/run/docker.sock`)
- `COMPOSE_MOUNTS` (default empty, comma-separated)
- `LOCAL_REFRESH_HOURS` (default `6`)
- `UPDATE_INTERVAL_MINUTES` (default `30`)
- `UPDATE_BATCH_SIZE` (default `5`)
- `DRY_RUN` (default `false`) -> when `true`, no registry requests are made; each check randomly marks 0-2 images as dummy updates; update actions run as successful dummy runs (without `docker pull`/`docker compose up`)
- `APP_LOCALE` (default `en`, values: `de` or `en`) for Web UI text and update-check logs (`docker compose logs -f`)
- `PORT` (default `8080`)

## Language
- Language can be changed in the Web UI (DE/EN).
- The selection is stored server-side and persists across reloads.
- Because the setting is stored globally on the server, it applies across devices.

## Notes
- Update checks compare the remote digest for the configured tag (without pulling during checks).
- For digest-pinned Compose images, checks follow Compose semantics: no tag tracking, only validation whether the pinned digest is present/changed locally.
- Compose updates run via `docker compose -f <compose> up --pull always -d`.
- Unmanaged updates run via `docker pull <image:tag>`.
- The runtime image includes `docker` + `docker compose` CLI for update operations.
