#!/bin/sh

set -e

if [ ! -f /config/settings.yml ]; then
  cp -n /app/settings.template.yml /config/settings.yml
  chmod 775 /config/settings.yml
fi

exec /usr/local/bin/dockobserver
