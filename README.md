# DockObserver

A lightweight container that scans local Docker containers and Compose stacks, and checks for updates.

## Features
- Docker socket scan (running + stopped containers)
- Compose scan via the container's bind mounts. Stack mounts must use identical `source:target` paths for lifecycle actions to work reliably.
- Resolves Compose `image` variables from `.env` in each stack directory
- If a Compose `image` cannot be resolved directly, it maps via Docker Compose labels from the socket
- Persistent JSON store at `/data/db.json`
- Web UI for desktop + mobile
- Scheduled background tasks for refresh + update checks
- Shows last local scan and last automatic update check in the Web UI
- Update action with confirmation modal and optional `docker image prune -af`
- Asynchronous update jobs with separate live console per operation (parallel-capable)
- Reads `org.opencontainers.image.*` labels such as `url` and `source` for project/source links in the UI

## Start (Docker)
```bash
cp .env.example .env
docker compose up -d
```

## Environment Variables
- `DATA_DIR` (default `/data`)
- `DOCKER_SOCKET` (default `/var/run/docker.sock`)
- `LOCAL_REFRESH_HOURS` (default `6`)
- `UPDATE_INTERVAL_MINUTES` (default `30`)
- `UPDATE_BATCH_SIZE` (default `5`)
- `NO_WEB_UPDATE_STACK_PATHS` (default empty, comma-separated stack directory paths). Matching Compose stacks are still checked for updates, but no update button is shown in the Web UI and `/api/update-group` is blocked for them.
- `GOTIFY_URL` + `GOTIFY_TOKEN` enable Gotify notifications for newly detected updates
- `NTFY_URL` + `NTFY_TOPIC` enable ntfy notifications for newly detected updates
- `DRY_RUN` (default `false`) -> when `true`, no registry requests are made; each check randomly marks 0-2 images as dummy updates; update actions run as successful dummy runs (without `docker pull`/`docker compose up`)
- `APP_LOCALE` (default `en`, values: `de` or `en`) for Web UI text and update-check logs (`docker compose logs -f`)
- `PORT` (default `8080`)

## Language
- Language can be changed in the Web UI (DE/EN).
- The selection is stored server-side and persists across reloads.
- Because the setting is stored globally on the server, it applies across devices.

## Notes
- DockObserver derives Compose stack roots automatically from its own bind mounts, excluding `DATA_DIR` and `DOCKER_SOCKET`.
- Only bind mounts with identical `source:target` paths are treated as stack roots. Example: `/opt/stacks:/opt/stacks`.
- `NO_WEB_UPDATE_STACK_PATHS` matches stack directories, for example `/opt/stacks/dockobserver,/opt/stacks/reverse-proxy`.
- Notifications are sent only on the first detection of an update, not on every later batch scan while the update remains available.
- If configured, Gotify and ntfy are both notified.
- Notification text is localized based on `APP_LOCALE`.
- Changelog links are derived from `org.opencontainers.image.source` when it points to a GitHub repository and are appended to notifications when available.
- Update checks compare the remote digest for the configured tag (without pulling during checks).
- For digest-pinned Compose images, checks follow Compose semantics: no tag tracking, only validation whether the pinned digest is present/changed locally.
- Compose updates run via `docker compose -f <compose> up --pull always -d`.
- Unmanaged updates run via `docker pull <image:tag>`.
- The runtime image includes `docker` + `docker compose` CLI for update operations.
