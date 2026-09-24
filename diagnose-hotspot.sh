#!/usr/bin/env bash
# Hotspot-Test mit Protokoll: schaltet für 3 Minuten auf den Hotspot, zeichnet
# alles auf und schaltet danach automatisch zurück ins normale WLAN.
#
#   sudo ./diagnose-hotspot.sh
#
# Während der 3 Minuten mit dem iPad mit dem Hotspot verbinden.
# Das Ergebnis steht danach in ~/hotspot-test.log
set -u

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo starten: sudo $0" >&2
  exit 1
fi

HOME_DIR="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
LOG="$HOME_DIR/hotspot-test.log"
CON=Photobox-Hotspot
WAIT=180

SSID="$(nmcli -g 802-11-wireless.ssid connection show "$CON" 2> /dev/null)"
PSK="$(nmcli -s -g 802-11-wireless-security.psk connection show "$CON" 2> /dev/null)"
if [ -z "$SSID" ]; then
  echo "Kein Hotspot eingerichtet – zuerst ./setup-hotspot.sh ausführen." >&2
  exit 1
fi

echo "Der Test läuft im Hintergrund weiter, auch wenn die SSH-Verbindung abbricht."
echo
echo "  Jetzt am iPad: Einstellungen → WLAN → '$SSID' ignorieren und neu verbinden"
echo "  Passwort: $PSK"
echo
echo "Nach ca. $((WAIT / 60 + 1)) Minuten ist der Pi wieder im normalen WLAN."
echo "Dann: cat $LOG"

systemd-run --quiet --collect --unit="photobox-hotspot-test-$$" bash -c "
  {
    echo '=== Hotspot-Test' \$(date)
    echo '--- Kernel / Treiber'
    uname -r
    echo -n 'brcmfmac feature_disable: '; cat /sys/module/brcmfmac/parameters/feature_disable 2>/dev/null || echo '(nicht gesetzt)'
    iw reg get 2>/dev/null | head -3
    echo '--- Hotspot-Einstellungen'
    nmcli -f 802-11-wireless.ssid,802-11-wireless.band,802-11-wireless.channel,802-11-wireless-security connection show '$CON'
  } > '$LOG' 2>&1
  START=\$(date '+%Y-%m-%d %H:%M:%S')
  /usr/local/sbin/photobox-wifi hotspot >> '$LOG' 2>&1
  {
    echo '--- Nach dem Start'
    iw dev wlan0 info
  } >> '$LOG' 2>&1
  sleep $WAIT
  {
    echo '--- Verbundene Geräte'
    iw dev wlan0 station dump | grep -E 'Station|signal:|authorized|authenticated'
    echo '--- Protokoll NetworkManager / wpa_supplicant / Kernel'
    journalctl --since \"\$START\" -u NetworkManager -u wpa_supplicant -k --no-pager \
      | grep -iE 'wlan0|brcmf|handshake|4-way|eapol|psk|auth|deauth|disassoc|AP-STA|supplicant|dnsmasq' | tail -80
  } >> '$LOG' 2>&1
  /usr/local/sbin/photobox-wifi client >> '$LOG' 2>&1
  chown ${SUDO_USER:-root} '$LOG'
"
