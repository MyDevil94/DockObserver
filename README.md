# DockObserver

Ein schlanker Container, der lokale Docker-Container und Compose-Stacks scannt und Updates prueft.

## Features
- Docker Socket Scan (laufende + gestoppte Container)
- Compose-Scan ueber gemountete Verzeichnisse (`COMPOSE_MOUNTS`)
- Compose `image` Variablen werden aus `.env` im jeweiligen Stack-Ordner aufgeloest
- Wenn Compose `image` nicht aufloesbar ist, wird ueber Docker-Compose Labels aus dem Socket gemappt
- Persistenter JSON-Store in `/data/db.json`
- Web UI fuer PC + Mobil
- Geplante Hintergrund-Tasks fuer Refresh + Update-Checks
- Anzeige von letztem lokalem Scan und letztem automatischen Update-Check in der Web-UI
- Update-Action mit Bestaetigungs-Overlay und optionalem `docker image prune -af`
- Asynchrone Update-Jobs mit separater Live-Konsole pro Vorgang (parallel ausfuehrbar)

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
- `DRY_RUN` (default `false`) -> wenn `true`, keine Registry-Requests; pro Check werden zufaellig 0-2 Images als Dummy-Update markiert
- `APP_LOCALE` (default `de`, Werte: `de` oder `en`) fuer Web-UI Texte und Update-Check Logs (`docker compose logs -f`)
- `PORT` (default `8080`)

## Sprache
- Sprache kann in der Web-UI umgestellt werden (DE/EN).
- Auswahl wird serverseitig gespeichert und bleibt beim naechsten Seitenaufruf erhalten.
- Da die Einstellung serverweit gespeichert wird, gilt sie auch geraeteuebergreifend.

## Hinweise
- Update-Checks pruefen den Remote-Digest fuer den konfigurierten Tag (ohne Pull beim Check).
- Bei digest-gepinnten Compose-Images folgt der Check der Compose-Semantik: kein Tag-Tracking, nur Pruefung ob der gepinnte Digest lokal vorhanden/abweichend ist.
- Private Registries benoetigen ggf. Auth (aktuell nicht implementiert).
- Compose-Updates laufen ueber `docker compose -f <compose> up --pull always -d`.
- Unmanaged-Updates laufen ueber `docker pull <image:tag>`.
- Runtime-Image enthaelt `docker` + `docker compose` CLI fuer Update-Operationen.
