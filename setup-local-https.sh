#!/usr/bin/env bash
# Richtet HTTPS im Heimnetz ein (ohne Internet/Cloudflare).
# Caddy erzeugt eine eigene Zertifizierungsstelle; deren Zertifikat wird
# einmalig auf dem iPad installiert, danach funktioniert die Kamera.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
IP="$(hostname -I | awk '{print $1}')"
HOST="$(hostname).local"
PORT="$(grep -oP '^PHOTOBOX_PORT=\K\d+' "$DIR/.env" 2>/dev/null || echo 8080)"
ROOT_CRT=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt

echo "==> Caddy installieren"
sudo apt-get install -y caddy avahi-daemon

write_caddyfile() {
  local tls_block="$1"
  sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDY
# Photobox – HTTPS im Heimnetz (erzeugt von setup-local-https.sh)
https://$IP, https://$HOST {
	$tls_block
	reverse_proxy localhost:$PORT
}
CADDY
}

echo "==> Caddy konfigurieren für https://$IP und https://$HOST"
# Kurzlebige Zertifikate (7 Tage) statt 12 Stunden, falls die Uhr des Pi ohne Internet abweicht
write_caddyfile "tls {
		issuer internal {
			lifetime 7d
		}
	}"
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1; then
  write_caddyfile "tls internal"
fi
sudo systemctl enable caddy
sudo systemctl restart caddy

echo "==> Warte auf das Caddy-Zertifikat …"
for _ in $(seq 1 30); do
  sudo test -f "$ROOT_CRT" && break
  sleep 1
done
sudo cp "$ROOT_CRT" "$DIR/ca.crt"
sudo chown "$USER_NAME" "$DIR/ca.crt"

echo
echo "Fertig! Jetzt auf dem iPad in Safari:"
echo "  1. Zertifikat laden:   http://$IP:$PORT/ca.crt   → 'Zulassen'"
echo "  2. Einstellungen → 'Profil geladen' → Installieren"
echo "  3. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen"
echo "     → 'Caddy Local Authority' einschalten"
echo "  4. Photobox öffnen:     https://$IP   (oder https://$HOST)"
