#!/usr/bin/env bash
# Erlaubt der Photobox, zwischen Hotspot und normalem WLAN umzuschalten
# (Schalter auf der Statusseite). Installiert das Hilfsskript und eine
# sudo-Regel, die nur genau dieses Skript freigibt.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${1:-${SUDO_USER:-$USER}}"

sudo install -m 755 -o root -g root "$DIR/deploy/photobox-wifi" /usr/local/sbin/photobox-wifi
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/local/sbin/photobox-wifi" \
  | sudo tee /etc/sudoers.d/photobox-wifi > /dev/null
sudo chmod 440 /etc/sudoers.d/photobox-wifi
sudo visudo -cf /etc/sudoers.d/photobox-wifi > /dev/null

echo "WLAN-Umschalter eingerichtet (für Benutzer '$USER_NAME')."
