#!/usr/bin/env bash
# Photobox-Hotspot ein-/ausschalten:  ./hotspot.sh on | off | status
set -euo pipefail

case "${1:-status}" in
  on)
    echo "Hotspot wird eingeschaltet. Eine SSH-Verbindung über WLAN bricht jetzt ab."
    sudo /usr/local/sbin/photobox-wifi hotspot
    ;;
  off)
    echo "Hotspot aus, verbinde mit bekanntem WLAN …"
    sudo /usr/local/sbin/photobox-wifi client
    ;;
  status)
    if [ "$(/usr/local/sbin/photobox-wifi status)" = "hotspot" ]; then
      echo "Hotspot ist AN:  WLAN '$(sudo /usr/local/sbin/photobox-wifi credentials | head -1)'  →  https://photobox.local"
    else
      echo "Hotspot ist AUS."
    fi
    ;;
  *)
    echo "Aufruf: $0 on | off | status" >&2
    exit 1
    ;;
esac
