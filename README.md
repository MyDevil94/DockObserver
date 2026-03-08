# DockObserver

Ein schlanker Container, der lokale Docker-Container und Compose-Stacks scannt und Updates prüft.

## Features
- Docker Socket Scan (laufende + gestoppte Container)
- Compose-Scan über gemountete Verzeichnisse (`COMPOSE_MOUNTS`)
- Compose `image` Variablen werden aus `.env` im jeweiligen Stack-Ordner aufgelöst
- Wenn Compose `image` nicht auflösbar ist, wird über Docker-Compose Labels aus dem Socket gemappt
- Persistenter JSON-Store in `/data/db.json`
- Web UI für PC + Mobil
- Geplante Hintergrund-Tasks für Refresh + Update-Checks
- Anzeige von letztem lokalem Scan und letztem automatischen Update-Check in der Web-UI
- Update-Action mit Bestätigungs-Overlay und optionalem `docker image prune -af`
- Asynchrone Update-Jobs mit separater Live-Konsole pro Vorgang (parallel ausführbar)

## Start (Docker)
```bash
docker compose up -d
```

## Environment Variablen
- `DATA_DIR` (default `/data`)
- `DOCKER_SOCKET` (default `/var/run/docker.sock`)
- `COMPOSE_MOUNTS` (default leer, komma-getrennt)
- `LOCAL_REFRESH_HOURS` (default `6`)
- `UPDATE_INTERVAL_MINUTES` (default `30`)
- `UPDATE_BATCH_SIZE` (default `5`)
- `DRY_RUN` (default `false`) -> wenn `true`, keine Registry-Requests; pro Check werden zufällig 0-2 Images als Dummy-Update markiert
- `APP_LOCALE` (default `de`, Werte: `de` oder `en`) für Web-UI Texte und Update-Check Logs (`docker compose logs -f`)
- `PORT` (default `8080`)

## Sprache
- Sprache kann in der Web-UI umgestellt werden (DE/EN).
- Auswahl wird serverseitig gespeichert und bleibt beim nächsten Seitenaufruf erhalten.
- Da die Einstellung serverweit gespeichert wird, gilt sie auch geräteübergreifend.

## Hinweise
- Update-Checks prüfen den Remote-Digest für den konfigurierten Tag (ohne Pull beim Check).
- Bei digest-gepinnten Compose-Images folgt der Check der Compose-Semantik: kein Tag-Tracking, nur Prüfung ob der gepinnte Digest lokal vorhanden/abweichend ist.
- Private Registries benötigen ggf. Auth (aktuell nicht implementiert).
- Compose-Updates laufen über `docker compose -f <compose> up --pull always -d`.
- Unmanaged-Updates laufen über `docker pull <image:tag>`.
- Runtime-Image enthält `docker` + `docker compose` CLI für Update-Operationen.
