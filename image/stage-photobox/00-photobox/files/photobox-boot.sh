#!/bin/bash
# Photobox-Start: liest /boot/firmware/photobox.txt und richtet bei jedem Boot
# Hotspot, Zertifikate und die Photobox-Konfiguration ein.
set -u

CONF=/boot/firmware/photobox.txt
APP=/opt/photobox
STATE=/etc/photobox
HOTSPOT_IP=10.42.0.1
NM_FILE=/etc/NetworkManager/system-connections/Photobox-Hotspot.nmconnection

log() { echo "photobox-boot: $*"; }

install -d -m 700 "$STATE"
[ -f "$CONF" ] || cp "$APP/photobox.txt.default" "$CONF" 2> /dev/null || true

# ---- Einstellungen lesen (Windows-Zeilenenden werden toleriert) ----
WLAN_NAME=Photobox
WLAN_PASSWORT=photobox123
PIN=2468
WLAN_KANAL=6
WLAN_LAND=DE
DRUCKER=
DRUCK_OPTIONEN=fit-to-page

if [ -f "$CONF" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    key="${key//[[:space:]]/}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    case "$key" in
      WLAN_NAME|WLAN_PASSWORT|PIN|WLAN_KANAL|WLAN_LAND|DRUCKER|DRUCK_OPTIONEN) printf -v "$key" '%s' "$val" ;;
    esac
  done < "$CONF"
fi

if [ ${#WLAN_PASSWORT} -lt 8 ] || [ ${#WLAN_PASSWORT} -gt 63 ]; then
  log "WLAN_PASSWORT muss 8-63 Zeichen haben – verwende 'photobox123'"
  WLAN_PASSWORT=photobox123
fi
[ -n "$WLAN_NAME" ] || WLAN_NAME=Photobox
WLAN_NAME="${WLAN_NAME//;/}"
[[ "$WLAN_KANAL" =~ ^([1-9]|1[0-3])$ ]] || WLAN_KANAL=6
[[ "$WLAN_LAND" =~ ^[A-Za-z]{2}$ ]] || WLAN_LAND=DE
WLAN_LAND="${WLAN_LAND^^}"
[ -n "$PIN" ] || PIN=2468

# ---- WLAN-Land ----
if [ "$(cat "$STATE/wifi-country" 2> /dev/null)" != "$WLAN_LAND" ]; then
  raspi-config nonint do_wifi_country "$WLAN_LAND" && echo "$WLAN_LAND" > "$STATE/wifi-country"
fi
rfkill unblock wifi 2> /dev/null || true

# ---- Hotspot (NetworkManager liest die Datei beim Start) ----
umask 077
cat > "$NM_FILE" << NM
[connection]
id=Photobox-Hotspot
uuid=6f1c2b1e-5d3a-4c8e-9a47-70b0c0ffee01
type=wifi
interface-name=wlan0
autoconnect=true
autoconnect-priority=100

[wifi]
mode=ap
ssid=$WLAN_NAME
band=bg
channel=$WLAN_KANAL

[wifi-security]
key-mgmt=wpa-psk
proto=rsn;
pairwise=ccmp;
group=ccmp;
psk=$WLAN_PASSWORT

[ipv4]
method=shared
address1=$HOTSPOT_IP/24

[ipv6]
method=disabled
NM
chmod 600 "$NM_FILE"
umask 022

# ---- Photobox-Konfiguration ----
[ -s "$STATE/secret_key" ] || openssl rand -hex 32 > "$STATE/secret_key"
cat > "$APP/.env" << ENV
PHOTOBOX_PIN=$PIN
PHOTOBOX_SECRET_KEY=$(cat "$STATE/secret_key")
PHOTOBOX_PRINTER=$DRUCKER
PHOTOBOX_PRINT_OPTIONS=$DRUCK_OPTIONEN
PHOTOBOX_HOST=0.0.0.0
PHOTOBOX_PORT=8080
ENV
chmod 600 "$APP/.env"

# ---- Zertifikate (einmalig pro Gerät, 800 Tage gültig) ----
CA_CRT="$STATE/ca.crt"
CA_KEY="$STATE/ca.key"
if [ ! -s "$CA_CRT" ] || [ ! -s "$CA_KEY" ]; then
  log "erzeuge Zertifizierungsstelle"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$CA_KEY" -out "$CA_CRT" -days 3650 -subj "/CN=Photobox Local CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2> /dev/null
  rm -f /etc/caddy/photobox.crt
fi
if [ ! -s /etc/caddy/photobox.crt ] || [ ! -s /etc/caddy/photobox.key ]; then
  log "erzeuge Server-Zertifikat"
  TMP="$(mktemp -d)"
  cat > "$TMP/ext.cnf" << EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:$(hostname).local,DNS:photobox.local,DNS:localhost,IP:$HOTSPOT_IP,IP:127.0.0.1
EXT
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$TMP/server.key" -out "$TMP/server.csr" -subj "/CN=Photobox" 2> /dev/null
  openssl x509 -req -in "$TMP/server.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" \
    -CAcreateserial -CAserial "$TMP/ca.srl" -days 800 -sha256 \
    -extfile "$TMP/ext.cnf" -out "$TMP/server.crt" 2> /dev/null
  install -o caddy -g caddy -m 644 "$TMP/server.crt" /etc/caddy/photobox.crt
  install -o caddy -g caddy -m 600 "$TMP/server.key" /etc/caddy/photobox.key
  rm -rf "$TMP"
fi
install -m 644 "$CA_CRT" "$APP/ca.crt"

log "fertig: WLAN '$WLAN_NAME', Photobox unter https://$HOTSPOT_IP"
