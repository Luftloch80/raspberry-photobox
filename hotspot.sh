#!/usr/bin/env bash
# Photobox-Hotspot ein-/ausschalten:  ./hotspot.sh on | off | status
set -euo pipefail

CON=Photobox-Hotspot

case "${1:-status}" in
  on)
    echo "Hotspot wird eingeschaltet. Eine SSH-Verbindung über WLAN bricht jetzt ab."
    sudo nmcli connection up "$CON"
    ;;
  off)
    sudo nmcli connection down "$CON" || true
    echo "Hotspot aus. Verbinde mit bekanntem WLAN …"
    sudo nmcli device wifi rescan > /dev/null 2>&1 || true
    sleep 3
    sudo nmcli device connect wlan0 || true
    ;;
  status)
    if nmcli -t -f NAME connection show --active | grep -qx "$CON"; then
      echo "Hotspot ist AN:  WLAN '$(nmcli -g 802-11-wireless.ssid connection show "$CON")'  →  https://10.42.0.1"
    else
      echo "Hotspot ist AUS."
    fi
    ;;
  *)
    echo "Aufruf: $0 on | off | status" >&2
    exit 1
    ;;
esac
