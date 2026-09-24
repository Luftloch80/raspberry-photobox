#!/usr/bin/env bash
# Installiert die Photobox auf einem Raspberry Pi (Raspberry Pi OS / Debian).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

echo "==> Pakete installieren (CUPS, Python)"
if ! sudo apt-get update; then
  echo "!!  'apt-get update' meldet Fehler (meist eine kaputte Paketquelle in /etc/apt/sources.list.d/)."
  echo "    Installation wird trotzdem fortgesetzt …"
fi
sudo apt-get install -y python3-venv python3-pip cups printer-driver-gutenprint libjpeg-dev zlib1g-dev iw
sudo usermod -aG lpadmin "$USER_NAME"
# CUPS-Weboberfläche auch im Heimnetz erreichbar machen (über Caddy: https://<pi-adresse>:8631)
sudo cupsctl --remote-admin --remote-any --share-printers WebInterface=yes
sudo systemctl restart cups

echo "==> Python-Umgebung einrichten"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install --upgrade pip
"$DIR/.venv/bin/pip" install -r "$DIR/requirements.txt"

if [ ! -f "$DIR/.env" ]; then
  echo "==> .env anlegen"
  cp "$DIR/.env.example" "$DIR/.env"
fi

echo "==> systemd-Dienst einrichten"
sed -e "s#__DIR__#$DIR#g" -e "s#__USER__#$USER_NAME#g" "$DIR/deploy/photobox.service" \
  | sudo tee /etc/systemd/system/photobox.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now photobox

echo
echo "==> HTTPS im lokalen Netz einrichten"
"$DIR/setup-local-https.sh"

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Fertig! Die Photobox läuft auf https://$IP"
echo "Nächste Schritte (siehe README.md):"
echo "  1. Drucker in CUPS einrichten:  https://$IP:8631"
echo "  2. Optional eigenen WLAN-Hotspot einrichten:  ./setup-hotspot.sh"
