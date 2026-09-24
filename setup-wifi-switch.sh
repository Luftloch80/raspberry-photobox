#!/usr/bin/env bash
# Richtet den Photobox-Hotspot (hostapd) und den Umschalter Hotspot ↔ WLAN ein.
# Installiert das Hilfsskript, die systemd-Dienste und eine sudo-Regel, die der
# Photobox nur genau dieses Skript freigibt. Ein früherer NetworkManager-Hotspot
# wird übernommen.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${1:-${SUDO_USER:-$USER}}"

echo "==> Pakete (hostapd, dnsmasq-base, iw)"
sudo apt-get install -y hostapd dnsmasq-base iw > /dev/null
# Den Standard-Dienst von hostapd nicht verwenden, die Photobox hat einen eigenen
sudo systemctl disable --now hostapd > /dev/null 2>&1 || true
sudo systemctl mask hostapd > /dev/null 2>&1 || true

echo "==> Hilfsskript und Dienste installieren"
sudo install -m 755 -o root -g root "$DIR/deploy/photobox-wifi" /usr/local/sbin/photobox-wifi
for unit in photobox-hostapd.service photobox-dhcp.service photobox-wifi-auto.service; do
  sudo install -m 644 "$DIR/deploy/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable photobox-wifi-auto.service > /dev/null

echo "$USER_NAME ALL=(root) NOPASSWD: /usr/local/sbin/photobox-wifi" \
  | sudo tee /etc/sudoers.d/photobox-wifi > /dev/null
sudo chmod 440 /etc/sudoers.d/photobox-wifi
sudo visudo -cf /etc/sudoers.d/photobox-wifi > /dev/null

# Früheren NetworkManager-Hotspot übernehmen (der funktioniert mit iPads nicht)
sudo /usr/local/sbin/photobox-wifi migrate

echo "WLAN-Umschalter eingerichtet (für Benutzer '$USER_NAME')."
