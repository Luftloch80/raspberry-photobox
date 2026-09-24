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

SSID="$(/usr/local/sbin/photobox-wifi credentials 2> /dev/null | sed -n 1p)"
PSK="$(/usr/local/sbin/photobox-wifi credentials 2> /dev/null | sed -n 2p)"
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
    echo 'brcmfmac-Optionen:'; modprobe -c 2>/dev/null | grep -i 'options brcmfmac' || echo '  (keine)'
    ls /boot/firmware/initramfs* 2>/dev/null | sed 's/^/initramfs: /'
    journalctl -k -b --no-pager | grep -iE 'brcmfmac.*(firmware|version)' | tail -3
    iw reg get 2>/dev/null | head -3
    echo '--- Hotspot-Einstellungen'
    grep -v PASSWORD /etc/photobox/hotspot.conf
  } > '$LOG' 2>&1
  START=\$(date '+%Y-%m-%d %H:%M:%S')
  /usr/local/sbin/photobox-wifi hotspot >> '$LOG' 2>&1
  {
    echo '--- Nach dem Start'
    iw dev wlan0 info
  } >> '$LOG' 2>&1
  # WLAN-Ereignisse (Anmelden/Abmelden von Geräten) mitschreiben
  timeout $WAIT iw event -t -f > /tmp/photobox-iw-events.txt 2>&1 &
  sleep $WAIT
  {
    echo '--- Verbundene Geräte'
    iw dev wlan0 station dump | grep -E 'Station|signal:|authorized|authenticated'
    echo '--- WLAN-Ereignisse'
    tail -60 /tmp/photobox-iw-events.txt
    echo '--- hostapd'
    journalctl --since \"\$START\" -u photobox-hostapd --no-pager | tail -40
    echo '--- dhcp'
    journalctl --since \"\$START\" -u photobox-dhcp --no-pager | tail -15
    echo '--- NetworkManager'
    journalctl --since \"\$START\" -u NetworkManager --no-pager | grep -viE 'dhcp4|dns|audit' | tail -40
    echo '--- Kernel'
    journalctl --since \"\$START\" -k --no-pager | grep -iE 'brcmf|wlan0|ieee80211' | tail -30
  } >> '$LOG' 2>&1
  /usr/local/sbin/photobox-wifi client >> '$LOG' 2>&1
  chown ${SUDO_USER:-root} '$LOG'
"
