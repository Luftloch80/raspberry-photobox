#!/usr/bin/env bash
# Richtet auf dem Raspberry Pi einen eigenen WLAN-Hotspot für die Photobox ein.
# Das iPad verbindet sich direkt mit dem Pi, es wird kein Router und kein Internet gebraucht.
#
#   ./setup-hotspot.sh [WLAN-NAME] [PASSWORT]
#
# Der Hotspot startet automatisch, sobald kein bekanntes WLAN in Reichweite ist
# (z. B. auf der Party). Zu Hause verbindet sich der Pi weiter mit dem Heim-WLAN.
# Manuell umschalten: ./hotspot.sh on | off | status
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SSID="${1:-Photobox}"
PASS="${2:-}"
CON=Photobox-Hotspot
HOTSPOT_IP=10.42.0.1
IFACE=wlan0

if ! systemctl is-active --quiet NetworkManager; then
  echo "Fehler: NetworkManager läuft nicht (nötig ab Raspberry Pi OS Bookworm)." >&2
  exit 1
fi
if systemctl is-active --quiet hostapd 2> /dev/null; then
  echo "Fehler: hostapd läuft bereits und belegt das WLAN. Erst deaktivieren:" >&2
  echo "  sudo systemctl disable --now hostapd" >&2
  exit 1
fi

if [ -z "$PASS" ]; then
  PASS="$(python3 -c 'import secrets,string; a=string.ascii_lowercase+string.digits; print("".join(secrets.choice(a) for _ in range(10)))')"
fi
if [ ${#PASS} -lt 8 ]; then
  echo "Fehler: Das WLAN-Passwort muss mindestens 8 Zeichen haben." >&2
  exit 1
fi

echo "==> WLAN-Land auf DE setzen"
if command -v raspi-config > /dev/null; then
  sudo raspi-config nonint do_wifi_country DE
fi
sudo rfkill unblock wifi || true

echo "==> Hotspot '$SSID' anlegen"
sudo nmcli connection delete "$CON" > /dev/null 2>&1 || true
sudo nmcli connection add type wifi ifname "$IFACE" con-name "$CON" ssid "$SSID" \
  connection.autoconnect yes \
  connection.autoconnect-priority -10 \
  802-11-wireless.mode ap \
  802-11-wireless.band bg \
  802-11-wireless.channel 6 \
  ipv4.method shared \
  ipv4.addresses "$HOTSPOT_IP/24" \
  ipv6.method disabled \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.proto rsn \
  wifi-sec.pairwise ccmp \
  wifi-sec.group ccmp \
  wifi-sec.psk "$PASS" > /dev/null

echo "==> WLAN-Umschalter für die Statusseite einrichten"
"$DIR/setup-wifi-switch.sh"

echo "==> Zertifikat um die Hotspot-Adresse $HOTSPOT_IP erweitern"
"$DIR/setup-local-https.sh" > /dev/null

WIFI_CON="$(nmcli -t -f DEVICE,STATE,CONNECTION device | awk -F: -v i="$IFACE" '$1==i && $2=="connected" {print $3}')"

echo
echo "Hotspot eingerichtet:"
echo "  WLAN-Name: $SSID"
echo "  Passwort:  $PASS"
echo "  Photobox:  https://$HOTSPOT_IP"
echo
if [ -n "$WIFI_CON" ] && [ "$WIFI_CON" != "$CON" ]; then
  echo "Der Pi ist gerade per WLAN mit '$WIFI_CON' verbunden. Der Hotspot startet"
  echo "automatisch, wenn dieses WLAN nicht in Reichweite ist (z. B. auf der Party)."
  echo "Sofort einschalten: ./hotspot.sh on   (die SSH-Verbindung über WLAN bricht dann ab!)"
else
  echo "==> Hotspot wird gestartet"
  sudo nmcli connection up "$CON" > /dev/null
  echo "Hotspot läuft."
fi
