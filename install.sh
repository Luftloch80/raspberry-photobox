#!/usr/bin/env bash
# Installiert die Photobox auf einem Raspberry Pi (Raspberry Pi OS / Debian).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

echo "==> Pakete installieren (CUPS, Python)"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip cups printer-driver-gutenprint libjpeg-dev zlib1g-dev
sudo usermod -aG lpadmin "$USER_NAME"

echo "==> Python-Umgebung einrichten"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install --upgrade pip
"$DIR/.venv/bin/pip" install -r "$DIR/requirements.txt"

if [ ! -f "$DIR/.env" ]; then
  echo "==> .env anlegen"
  cp "$DIR/.env.example" "$DIR/.env"
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  PIN="$(python3 -c 'import secrets; print(f"{secrets.randbelow(10**6):06d}")')"
  sed -i "s/^PHOTOBOX_SECRET_KEY=.*/PHOTOBOX_SECRET_KEY=$SECRET/" "$DIR/.env"
  sed -i "s/^PHOTOBOX_PIN=.*/PHOTOBOX_PIN=$PIN/" "$DIR/.env"
  chmod 600 "$DIR/.env"
  echo "    Deine PIN für das iPad: $PIN  (änderbar in $DIR/.env)"
fi

echo "==> systemd-Dienst einrichten"
sed -e "s#__DIR__#$DIR#g" -e "s#__USER__#$USER_NAME#g" "$DIR/deploy/photobox.service" \
  | sudo tee /etc/systemd/system/photobox.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now photobox

echo
echo "Fertig! Die Photobox läuft lokal auf http://127.0.0.1:8080"
echo "Nächste Schritte (siehe README.md):"
echo "  1. Drucker in CUPS einrichten:  http://<pi-adresse>:631  (oder: sudo lpadmin ...)"
echo "  2. Cloudflare Tunnel einrichten, damit die Photobox per HTTPS aus dem Internet erreichbar ist"
