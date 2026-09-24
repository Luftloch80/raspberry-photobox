# 📸 Raspberry Photobox

Eine Web-Photobox für das **iPad mini im Querformat**. Das iPad zeigt das Live-Bild
seiner Kamera, macht per Knopfdruck (mit Countdown) Fotos, zeigt alle Fotos in einer
Galerie an und schickt sie **auf Knopfdruck an den Drucker**.

Ein **Raspberry Pi** speichert die Fotos und druckt sie über CUPS. Alles läuft
**nur im lokalen Netz**: im Heimnetz oder im eigenen WLAN-Hotspot des Pi. Es wird
kein Internet gebraucht, und die Photobox ist von außen nicht erreichbar.

```
 iPad mini (Safari)  ──HTTPS, lokales WLAN──▶  Raspberry Pi  ──USB──▶  Drucker
   Kamera + Dashboard                          Caddy + Flask-Server + CUPS
```

## Funktionen

- Live-Kamerabild im Vollbild (Front- oder Rückkamera, optional gespiegelt)
- Großer Auslöser, Countdown (aus / 3 / 5 / 10 s) und Blitz-Effekt
- Auslösen auch per Bluetooth-Fernauslöser oder Tastatur (Leertaste/Enter)
- Galerie mit allen Fotos, neues Foto wird hervorgehoben
- Großansicht mit **Drucken**-Button und Anzahl der Abzüge
- Optional: automatisch nach jeder Aufnahme drucken
- Druckerstatus-Anzeige
- **Statusseite** (`/status`): WLAN/Hotspot mit verbundenen Geräten, Drucker mit Fehlern
  wie „Papier leer“, Warteschlange (abbrechen/fortsetzen), Temperatur und Speicherplatz
- Als App zum Home-Bildschirm hinzufügbar (Vollbild, ohne Safari-Leisten)
- Bildschirm bleibt an (Wake Lock), Hinweis bei Hochformat

## Schnellstart: Fertiges SD-Karten-Image

Unter **Releases** gibt es ein fertiges Image (`photobox-….img.xz`). Es startet nach dem
Booten automatisch den WLAN-Hotspot, die Photobox, CUPS und HTTPS.

1. Mit dem [Raspberry Pi Imager](https://www.raspberrypi.com/software/) auf eine SD-Karte
   schreiben: *Eigenes Image verwenden*, bei der Frage nach Anpassungen **Nein** wählen.
2. Optional am PC auf der SD-Karte (Laufwerk `bootfs`) die Datei **`photobox.txt`**
   anpassen: WLAN-Name, WLAN-Passwort, WLAN-Kanal, Drucker und Druckoptionen.
   Änderungen gelten auch später nach jedem Neustart.
3. Pi starten und 1–2 Minuten warten, bis das WLAN **Photobox** erscheint
   (Standard-Passwort `photobox123`).
4. iPad mit dem WLAN verbinden, dann in Safari:
   - `http://10.42.0.1:8080/ca.crt` → *Zulassen* → *Einstellungen → Profil geladen → Installieren*
   - *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* → **Photobox Local CA** einschalten
   - **https://10.42.0.1** öffnen
5. Drucker per USB anschließen und unter `https://10.42.0.1:631` einrichten
   (Anmeldung: Benutzer `photobox`, Passwort `photobox`).

SSH: `ssh photobox@10.42.0.1` (Passwort `photobox`, bitte mit `passwd` ändern). Über ein
LAN-Kabel ist der Pi zusätzlich im Heimnetz erreichbar (`photobox.local`).

Das Image wird von GitHub Actions gebaut (`.github/workflows/build-image.yml`, Stage in
`image/`). Ein neuer Build startet bei Änderungen in `image/` oder
manuell unter *Actions → Raspberry-Pi-Image bauen → Run workflow*. Wer ein anderes
Standard-Passwort möchte, legt das Repository-Secret `PI_PASSWORD` an.

## 1. Installation auf einem vorhandenen Raspberry Pi

```bash
git clone https://github.com/luftloch80/raspberry-photobox.git
cd raspberry-photobox
./install.sh
```

Das Skript installiert CUPS, Caddy und die Python-Abhängigkeiten, legt eine `.env` an,
richtet HTTPS ein und startet den Dienst `photobox`.
Einstellungen (Drucker, Druckoptionen) stehen in `.env`, siehe `.env.example`.
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

## 3. HTTPS im lokalen Netz

Safari gibt die Kamera nur über HTTPS frei, auch im lokalen Netz. `install.sh` richtet
dafür [Caddy](https://caddyserver.com) mit einem eigenen Zertifikat ein (erneut
ausführen mit `./setup-local-https.sh`).

Danach einmalig auf dem iPad (in **Safari**):

1. `http://<pi-adresse>:8080/ca.crt` öffnen → *Zulassen*
2. *Einstellungen* → *Profil geladen* → *Installieren*
3. *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* →
   die Photobox-Zertifizierungsstelle einschalten
4. Photobox öffnen: `https://<pi-adresse>` oder `https://<hostname>.local`

Hinweise:
- Das Zertifikat ist 800 Tage gültig. Eine falsch gehende Uhr des Pi (er hat keine
  Uhr mit Batterie) stört deshalb nicht. Danach `./setup-local-https.sh` erneut ausführen.
- Ändert sich die IP-Adresse des Pi, `./setup-local-https.sh` erneut ausführen. Das
  iPad muss dafür nichts neu installieren.

## 4. Eigener WLAN-Hotspot (für unterwegs, ohne Router)

Der Pi spannt selbst ein WLAN auf. Das iPad verbindet sich direkt mit ihm:

```bash
./setup-hotspot.sh                      # WLAN "Photobox", Passwort wird erzeugt
./setup-hotspot.sh MeinePhotobox geheim123   # eigener Name und Passwort (mind. 8 Zeichen)
```

- Der Hotspot startet **automatisch**, wenn kein bekanntes WLAN in Reichweite ist,
  also z. B. auf der Party. Zu Hause verbindet sich der Pi weiter mit dem Heim-WLAN.
- Photobox im Hotspot: **https://10.42.0.1**
- Manuell umschalten: `./hotspot.sh on`, `./hotspot.sh off`, `./hotspot.sh status`.
  Ist der Pi per WLAN mit SSH verbunden, bricht die Verbindung bei `on` ab.
- Das iPad meldet im Hotspot „Keine Internetverbindung“. Das ist normal, die Photobox
  funktioniert trotzdem.
- Der Drucker hängt am besten per USB am Pi. Ein WLAN-Drucker müsste sich sonst
  ebenfalls mit dem Hotspot verbinden.

## 5. iPad mini einrichten

1. In **Safari** `https://<pi-adresse>` (im Hotspot `https://10.42.0.1`) öffnen.
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
python app.py        # → http://127.0.0.1:8080
```

Im Desktop-Browser funktioniert die Kamera auch über `http://localhost`. Auf dem iPad ist
immer HTTPS nötig.

## Projektstruktur

| Datei | Inhalt |
|---|---|
| `app.py` | Flask-Server: Anmeldung, Foto-Upload/Galerie, Drucken über `lp` |
| `status.py`, `templates/status.html`, `static/status.js` | Statusseite für WLAN, Drucker und System |
| `templates/` | HTML für Dashboard und Statusseite |
| `static/app.js` | Kamera, Countdown, Aufnahme, Galerie, Drucken |
| `static/style.css` | Querformat-Layout für das iPad mini |
| `install.sh`, `deploy/photobox.service` | Installation und systemd-Dienst für den Pi |
| `setup-local-https.sh` | HTTPS im lokalen Netz (Caddy) |
| `setup-hotspot.sh`, `hotspot.sh` | Eigener WLAN-Hotspot des Pi |
| `photos/` | Gespeicherte Fotos (wird automatisch angelegt) |
