# DockObserver

Ein schlanker Container, der lokale Docker-Container und Compose-Stacks scannt und Updates prueft.

## Features
- Docker Socket Scan (laufende + gestoppte Container)
- Compose-Scan ueber gemountete Verzeichnisse (`COMPOSE_MOUNTS`)
- Persistenter JSON-Store in `/data/db.json`
- Web UI fuer PC + Mobil
- Geplante Hintergrund-Tasks fuer Refresh + Update-Checks

## Start (lokal)
```bash
npm install
npm run dev
```

## Start (Docker)
```bash
docker compose up --build
```

## Environment Variablen
- `DATA_DIR` (default `/data`)
- `DOCKER_SOCKET` (default `/var/run/docker.sock`)
- `COMPOSE_MOUNTS` (default leer, komma-getrennt)
- `LOCAL_REFRESH_HOURS` (default `6`)
- `UPDATE_INTERVAL_MINUTES` (default `30`)
- `UPDATE_BATCH_SIZE` (default `5`)
- `PORT` (default `8080`)

## Hinweise
- Update-Checks nutzen Registry-HEAD Requests (Docker Hub Token, andere Registries anonym).
- Private Registries benoetigen ggf. Auth (aktuell nicht implementiert).
