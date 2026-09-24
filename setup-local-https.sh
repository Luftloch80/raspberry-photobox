#!/usr/bin/env bash
# Richtet HTTPS im Heimnetz bzw. im Photobox-Hotspot ein.
#
# Caddy nimmt HTTPS-Verbindungen an und leitet sie an die Photobox weiter.
# Das Zertifikat stellt dieses Skript selbst aus (gültig ~2 Jahre), damit es auch
# funktioniert, wenn die Uhr des Pi ohne Internet falsch geht. Unterschrieben wird
# es von einer eigenen Zertifizierungsstelle (CA), die einmalig auf dem iPad
# installiert wird. Eine bereits vorhandene Caddy-CA wird weiterverwendet, damit
# ein schon eingerichtetes iPad nichts neu installieren muss.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
PORT="$(grep -oP '^PHOTOBOX_PORT=\K\d+' "$DIR/.env" 2>/dev/null || echo 8080)"
HOTSPOT_IP=10.42.0.1
HOST="$(hostname).local"

CADDY_CA=/var/lib/caddy/.local/share/caddy/pki/authorities/local
OWN_CA=/etc/photobox-ca
CERT=/etc/caddy/photobox.crt
KEY=/etc/caddy/photobox.key

echo "==> Pakete installieren (Caddy, Avahi, OpenSSL)"
sudo apt-get install -y caddy avahi-daemon openssl

echo "==> Zertifizierungsstelle wählen"
if sudo test -f "$CADDY_CA/root.crt" && sudo test -f "$CADDY_CA/root.key"; then
  CA_CRT="$CADDY_CA/root.crt"
  CA_KEY="$CADDY_CA/root.key"
  echo "    vorhandene Caddy-CA wird weiterverwendet"
else
  CA_CRT="$OWN_CA/ca.crt"
  CA_KEY="$OWN_CA/ca.key"
  if ! sudo test -f "$CA_CRT"; then
    echo "    neue Photobox-CA wird erstellt"
    sudo mkdir -p "$OWN_CA"
    sudo chmod 700 "$OWN_CA"
    sudo openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
      -keyout "$CA_KEY" -out "$CA_CRT" -days 3650 -subj "/CN=Photobox Local CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign"
  fi
fi

echo "==> Server-Zertifikat ausstellen"
SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1,IP:$HOTSPOT_IP"
for ip in $(hostname -I); do
  case "$ip" in
    *:*) ;;                                   # IPv6 überspringen
    "$HOTSPOT_IP") ;;
    *) SAN="$SAN,IP:$ip" ;;
  esac
done
echo "    gültig für: ${SAN//,/ }"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/ext.cnf" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EXT
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$TMP/server.key" -out "$TMP/server.csr" -subj "/CN=Photobox" 2> /dev/null
# 800 Tage: iOS akzeptiert höchstens 825 Tage
sudo openssl x509 -req -in "$TMP/server.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -CAserial "$TMP/ca.srl" -days 800 -sha256 -extfile "$TMP/ext.cnf" -out "$TMP/server.crt" 2> /dev/null
sudo install -o caddy -g caddy -m 644 "$TMP/server.crt" "$CERT"
sudo install -o caddy -g caddy -m 600 "$TMP/server.key" "$KEY"

echo "==> Caddy konfigurieren"
sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDY
# Photobox – HTTPS im Heimnetz/Hotspot (erzeugt von setup-local-https.sh)
:443 {
	tls $CERT $KEY
	reverse_proxy localhost:$PORT
}

:80 {
	redir https://{host}{uri}
}
CADDY
sudo systemctl enable caddy
sudo systemctl restart caddy

sudo cp "$CA_CRT" "$DIR/ca.crt"
sudo chown "$USER_NAME" "$DIR/ca.crt"
sudo chmod 644 "$DIR/ca.crt"

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Fertig! Falls das iPad das Zertifikat noch nicht kennt, einmalig in Safari:"
echo "  1. Zertifikat laden:   http://$IP:$PORT/ca.crt   → 'Zulassen'"
echo "  2. Einstellungen → 'Profil geladen' → Installieren"
echo "  3. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen → einschalten"
echo "Photobox öffnen:  https://$IP   ·   im Hotspot: https://$HOTSPOT_IP   ·   https://$HOST"
