# 📸 Raspberry Photobox

Eine Web-Photobox für das **iPad mini im Querformat**. Das iPad zeigt das Live-Bild
seiner Kamera, macht per Knopfdruck (mit Countdown) Fotos, zeigt alle Fotos in einer
Galerie an und schickt sie **auf Knopfdruck an den Drucker**.

Ein **Raspberry Pi** speichert die Fotos und druckt sie über CUPS. Per
**Cloudflare Tunnel** ist die Photobox über das Internet mit HTTPS erreichbar.
Das iPad braucht also nicht im selben WLAN zu sein, und es muss kein Port am
Router freigegeben werden.

```
 iPad mini (Safari)  ──HTTPS──▶  Cloudflare  ──Tunnel──▶  Raspberry Pi  ──USB/WLAN──▶  Drucker
   Kamera + Dashboard                                     Flask-Server + CUPS
```

## Funktionen

- Live-Kamerabild im Vollbild (Front- oder Rückkamera, optional gespiegelt)
- Großer Auslöser, Countdown (aus / 3 / 5 / 10 s) und Blitz-Effekt
- Auslösen auch per Bluetooth-Fernauslöser oder Tastatur (Leertaste/Enter)
- Galerie mit allen Fotos, neues Foto wird hervorgehoben
- Großansicht mit **Drucken**-Button und Anzahl der Abzüge
- Optional: automatisch nach jeder Aufnahme drucken
- Druckerstatus-Anzeige
- PIN-Schutz, weil die Photobox im Internet erreichbar ist
- Als App zum Home-Bildschirm hinzufügbar (Vollbild, ohne Safari-Leisten)
- Bildschirm bleibt an (Wake Lock), Hinweis bei Hochformat

## 1. Installation auf dem Raspberry Pi

```bash
git clone https://github.com/luftloch80/raspberry-photobox.git
cd raspberry-photobox
./install.sh
```

Das Skript installiert CUPS und die Python-Abhängigkeiten, legt eine `.env` mit
zufälliger **PIN** an (wird am Ende angezeigt) und startet den Dienst `photobox`.
Einstellungen (PIN, Drucker, Druckoptionen) stehen in `.env`, siehe `.env.example`.
Nach Änderungen: `sudo systemctl restart photobox`.

## 2. Drucker einrichten (CUPS)

1. Drucker per USB oder WLAN anschließen.
2. CUPS-Weboberfläche im Browser öffnen: `http://<pi-adresse>:631` → *Verwaltung* →
   *Drucker hinzufügen* (Anmeldung mit dem Pi-Benutzer und seinem Passwort).
   `install.sh` gibt CUPS dafür mit `sudo cupsctl --remote-admin --remote-any` im Heimnetz frei.
3. Drucker als **Standarddrucker** festlegen, oder seinen Namen in `.env` als
   `PHOTOBOX_PRINTER` eintragen (`lpstat -p` zeigt die Namen).
4. Testdruck: `lp -o fit-to-page irgendein-bild.jpg`

Tipps:
- **Canon Selphy** (CP1300/CP1500) wird von `printer-driver-gutenprint` unterstützt.
  Für 10×15-Fotos: `PHOTOBOX_PRINT_OPTIONS=fit-to-page media=Postcard`
- Mögliche Optionen eines Druckers anzeigen: `lpoptions -p <DRUCKER> -l`

## 3. Über das Internet erreichbar machen (Cloudflare Tunnel)

Safari erlaubt den Kamerazugriff **nur über HTTPS**. Ein Cloudflare Tunnel liefert
HTTPS mit gültigem Zertifikat und braucht keine Portfreigabe am Router.

Voraussetzung: eine eigene Domain, die bei Cloudflare verwaltet wird (kostenloser Plan reicht).

```bash
# cloudflared installieren (64-bit Raspberry Pi OS)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login                     # öffnet einen Link zur Anmeldung bei Cloudflare
cloudflared tunnel create photobox
cloudflared tunnel route dns photobox photobox.deine-domain.de
```

`~/.cloudflared/config.yml` anlegen:

```yaml
tunnel: photobox
credentials-file: /home/pi/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: photobox.deine-domain.de
    service: http://localhost:8080
  - service: http_status:404
```

Als Dienst starten:

```bash
sudo cloudflared --config /home/pi/.cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
```

Die Photobox ist jetzt unter **https://photobox.deine-domain.de** erreichbar.

**Ohne eigene Domain, nur zum Ausprobieren:** `cloudflared tunnel --url http://localhost:8080`
erzeugt eine zufällige `https://….trycloudflare.com`-Adresse. Sie ändert sich bei jedem Start.

*Alternative:* [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
(`sudo tailscale funnel 8080`) funktioniert ebenfalls und liefert eine HTTPS-Adresse.

## 3b. Alternative: Nur im Heimnetz, ohne Internet

Safari gibt die Kamera nur über HTTPS frei, auch im Heimnetz. Das Skript richtet
[Caddy](https://caddyserver.com) mit einem eigenen Zertifikat ein:

```bash
./setup-local-https.sh
```

Danach einmalig auf dem iPad (in **Safari**):

1. `http://<pi-adresse>:8080/ca.crt` öffnen → *Zulassen*
2. *Einstellungen* → *Profil geladen* → *Installieren*
3. *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* →
   **Caddy Local Authority** einschalten
4. Photobox öffnen: `https://<pi-adresse>` oder `https://<hostname>.local`

Hinweise:
- Die IP-Adresse des Pi im Router fest vergeben (DHCP-Reservierung). Ändert sie sich,
  `./setup-local-https.sh` erneut ausführen. Das Zertifikat auf dem iPad bleibt gültig.
- Der Pi hat keine Uhr mit Batterie. Ohne Internet stellt er die Uhrzeit nach einem
  Neustart nicht nach. Liegt sie mehr als ein paar Tage daneben, lehnt das iPad das
  Zertifikat ab. Dann die Zeit setzen: `sudo date -s "2026-09-24 18:00"`.

## 4. iPad mini einrichten

1. In **Safari** die HTTPS-Adresse öffnen und mit der PIN anmelden.
2. Kamerazugriff erlauben (dauerhaft: `aA` in der Adressleiste → *Website-Einstellungen* → *Kamera: Erlauben*).
3. *Teilen* → **Zum Home-Bildschirm**. Danach die Photobox über das neue Icon starten,
   dann läuft sie im Vollbild ohne Safari-Leisten.
4. iPad ins **Querformat** drehen. Im Hochformat erscheint ein Hinweis.
5. Für den Party-Betrieb empfohlen:
   - *Einstellungen → Bedienungshilfen → Geführter Zugriff* aktivieren und in der Photobox
     dreimal die Seitentaste drücken. Dann können Gäste die App nicht verlassen.
   - *Einstellungen → Anzeige & Helligkeit → Automatische Sperre: Nie*
6. Über das ⚙️-Symbol oben links: Kamera wählen, Countdown, Spiegeln, Auto-Druck.

## Lokale Entwicklung

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PHOTOBOX_PIN=1234 python app.py        # → http://127.0.0.1:8080
```

Im Desktop-Browser funktioniert die Kamera auch über `http://localhost`. Auf dem iPad ist
immer HTTPS nötig.

## Projektstruktur

| Datei | Inhalt |
|---|---|
| `app.py` | Flask-Server: Anmeldung, Foto-Upload/Galerie, Drucken über `lp` |
| `templates/` | HTML für Dashboard und Anmeldung |
| `static/app.js` | Kamera, Countdown, Aufnahme, Galerie, Drucken |
| `static/style.css` | Querformat-Layout für das iPad mini |
| `install.sh`, `deploy/photobox.service` | Installation und systemd-Dienst für den Pi |
| `setup-local-https.sh` | HTTPS im Heimnetz ohne Internet (Caddy) |
| `photos/` | Gespeicherte Fotos (wird automatisch angelegt) |
