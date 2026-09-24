"""Raspberry Photobox – Server.

Liefert das Photobox-Dashboard für das iPad aus, speichert die aufgenommenen
Fotos und schickt sie per CUPS (`lp`) an den Drucker.
"""

import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from PIL import Image, ImageOps

import status

BASE_DIR = Path(__file__).resolve().parent
PHOTO_DIR = Path(os.environ.get("PHOTOBOX_PHOTO_DIR", BASE_DIR / "photos"))
THUMB_DIR = PHOTO_DIR / "thumbs"
ARCHIVE_DIR = PHOTO_DIR / "archiv"  # Fotos früherer Serien (nicht mehr in der Galerie)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

PRINTER = os.environ.get("PHOTOBOX_PRINTER", "")  # leer = CUPS-Standarddrucker
PRINT_OPTIONS = os.environ.get("PHOTOBOX_PRINT_OPTIONS", "fit-to-page").split()
MAX_COPIES = int(os.environ.get("PHOTOBOX_MAX_COPIES", "4"))
THUMB_SIZE = (480, 480)
PHOTO_NAME = re.compile(r"^\d{8}-\d{6}-\d{3}\.jpg$")

app = Flask(__name__)
app.config.update(MAX_CONTENT_LENGTH=25 * 1024 * 1024)


@app.context_processor
def asset_version():
    """Versionsnummer für CSS/JS, damit Safari nach einem Update nichts Altes aus dem Cache nimmt."""
    static = Path(app.static_folder)
    return {"v": int(max((static / f).stat().st_mtime for f in ("app.js", "status.js", "style.css")))}


# --------------------------------------------------------------------------
# Seiten & Dateien
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html", max_copies=MAX_COPIES)


@app.route("/login")
@app.route("/logout")
def old_login():
    """Frühere Anmeldeseite – alte Lesezeichen/Home-Bildschirm-Icons weiterleiten."""
    return redirect(url_for("index"))


@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory(
        app.static_folder, "manifest.webmanifest", mimetype="application/manifest+json"
    )


@app.route("/ca.crt")
def ca_certificate():
    """Zertifikat für HTTPS im Heimnetz (von setup-local-https.sh erzeugt)."""
    if not (BASE_DIR / "ca.crt").exists():
        abort(404)
    return send_from_directory(
        BASE_DIR, "ca.crt", mimetype="application/x-x509-ca-cert", as_attachment=True
    )


@app.route("/photos/<name>")
def photo_file(name):
    if not PHOTO_NAME.match(name):
        abort(404)
    return send_from_directory(PHOTO_DIR, name, max_age=86400)


@app.route("/photos/thumbs/<name>")
def thumb_file(name):
    if not PHOTO_NAME.match(name):
        abort(404)
    if not (THUMB_DIR / name).exists():
        if not (PHOTO_DIR / name).exists():
            abort(404)
        make_thumb(name)
    return send_from_directory(THUMB_DIR, name, max_age=86400)


# --------------------------------------------------------------------------
# Foto-API
# --------------------------------------------------------------------------

def make_thumb(name):
    with Image.open(PHOTO_DIR / name) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail(THUMB_SIZE)
        img.convert("RGB").save(THUMB_DIR / name, "JPEG", quality=80)


def photo_info(name):
    return {
        "id": name,
        "url": url_for("photo_file", name=name),
        "thumb": url_for("thumb_file", name=name),
        "created": datetime.strptime(name[:15], "%Y%m%d-%H%M%S").isoformat(),
    }


def photo_path(name):
    if not PHOTO_NAME.match(name):
        abort(404)
    path = PHOTO_DIR / name
    if not path.exists():
        abort(404)
    return path


@app.get("/api/photos")
def list_photos():
    names = sorted(
        (p.name for p in PHOTO_DIR.glob("*.jpg") if PHOTO_NAME.match(p.name)),
        reverse=True,
    )
    return jsonify([photo_info(n) for n in names])


@app.post("/api/photos")
def upload_photo():
    file = request.files.get("photo")
    if file is None:
        return jsonify(error="Kein Foto übermittelt"), 400

    try:
        img = Image.open(file.stream)
        img.load()
    except Exception:
        return jsonify(error="Ungültige Bilddatei"), 400

    now = datetime.now()
    name = now.strftime("%Y%m%d-%H%M%S-") + f"{now.microsecond // 1000:03d}.jpg"
    img.convert("RGB").save(PHOTO_DIR / name, "JPEG", quality=92)
    make_thumb(name)
    return jsonify(photo_info(name)), 201


@app.delete("/api/photos/<name>")
def delete_photo(name):
    photo_path(name).unlink()
    (THUMB_DIR / name).unlink(missing_ok=True)
    return jsonify(ok=True)


@app.post("/api/photos/archive")
def archive_photos():
    """Fotos aus der Galerie ins Archiv verschieben (z. B. wenn eine neue Serie beginnt).

    Die Dateien bleiben auf dem Pi erhalten: photos/archiv/<Datum>/
    """
    ids = (request.get_json(silent=True) or {}).get("ids", [])
    moved = 0
    for name in ids if isinstance(ids, list) else []:
        if not isinstance(name, str) or not PHOTO_NAME.match(name):
            continue
        src = PHOTO_DIR / name
        if not src.exists():
            continue
        dest = ARCHIVE_DIR / f"{name[:4]}-{name[4:6]}-{name[6:8]}"
        dest.mkdir(parents=True, exist_ok=True)
        src.replace(dest / name)
        (THUMB_DIR / name).unlink(missing_ok=True)
        moved += 1
    return jsonify(ok=True, archived=moved)


# --------------------------------------------------------------------------
# Drucken (CUPS)
# --------------------------------------------------------------------------

def lp_command(path, copies):
    cmd = ["lp", "-n", str(copies)]
    if PRINTER:
        cmd += ["-d", PRINTER]
    for opt in PRINT_OPTIONS:
        cmd += ["-o", opt]
    cmd.append(str(path))
    return cmd


@app.post("/api/photos/<name>/print")
def print_photo(name):
    path = photo_path(name)
    data = request.get_json(silent=True) or {}
    try:
        copies = int(data.get("copies", 1))
    except (TypeError, ValueError):
        copies = 1
    copies = max(1, min(copies, MAX_COPIES))

    try:
        result = subprocess.run(
            lp_command(path, copies), capture_output=True, text=True, timeout=30
        )
    except FileNotFoundError:
        return jsonify(error="CUPS (lp) ist nicht installiert"), 500
    except subprocess.TimeoutExpired:
        return jsonify(error="Drucker antwortet nicht"), 504

    if result.returncode != 0:
        msg = (result.stderr or result.stdout).strip() or "Druck fehlgeschlagen"
        return jsonify(error=msg), 500
    return jsonify(ok=True, copies=copies, job=result.stdout.strip())


@app.get("/api/printer")
def printer_status():
    env = {**os.environ, "LANG": "C", "LC_ALL": "C"}
    try:
        name = PRINTER
        if not name:
            out = subprocess.run(
                ["lpstat", "-d"], capture_output=True, text=True, timeout=10, env=env
            ).stdout
            name = out.split(":", 1)[1].strip() if ":" in out else ""
        if not name:
            return jsonify(ok=False, status="Kein Standarddrucker eingerichtet")
        result = subprocess.run(
            ["lpstat", "-p", name], capture_output=True, text=True, timeout=10, env=env
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return jsonify(ok=False, status="CUPS nicht erreichbar")

    out = result.stdout.strip()
    if result.returncode != 0 or not out:
        return jsonify(ok=False, status=f"Drucker „{name}“ nicht gefunden")
    ok = "disabled" not in out
    state = "bereit" if ok else "deaktiviert"
    if "now printing" in out:
        state = "druckt gerade"
    return jsonify(ok=ok, status=f"{name}: {state}")


# --------------------------------------------------------------------------
# Statusseite (WLAN, Drucker, System)
# --------------------------------------------------------------------------

@app.route("/status")
def status_page():
    return render_template("status.html")


@app.get("/api/status")
def status_api():
    photos = [p for p in PHOTO_DIR.glob("*.jpg") if PHOTO_NAME.match(p.name)]
    system = status.system_status(PHOTO_DIR)
    system["photos"] = len(photos)
    system["archived"] = sum(1 for p in ARCHIVE_DIR.rglob("*.jpg")) if ARCHIVE_DIR.exists() else 0
    system["time"] = datetime.now().isoformat(timespec="seconds")
    return jsonify(
        wifi=status.wifi_status(),
        printer=status.printer_status(PRINTER),
        system=system,
    )


@app.post("/api/wifi/mode")
def wifi_mode():
    mode = (request.get_json(silent=True) or {}).get("mode")
    if mode not in ("hotspot", "client"):
        return jsonify(error="Unbekannter Modus"), 400
    if not status.wifi_switch_available():
        return jsonify(error="Umschalten ist nicht eingerichtet (./setup-wifi-switch.sh)"), 503
    if mode == "client" and not status.known_networks():
        return jsonify(error="Kein normales WLAN gespeichert"), 409
    if mode == "hotspot" and not status.hotspot_configured():
        return jsonify(error="Hotspot ist nicht eingerichtet (./setup-hotspot.sh)"), 409
    status.switch_wifi(mode)
    return jsonify(ok=True, mode=mode), 202


@app.post("/api/wifi/hotspot-password")
def hotspot_password():
    password = str((request.get_json(silent=True) or {}).get("password", ""))
    if not 8 <= len(password) <= 63 or not all(" " <= c <= "~" for c in password):
        return jsonify(error="Das Passwort muss 8 bis 63 Zeichen haben (keine Umlaute)."), 400
    if not status.wifi_switch_available():
        return jsonify(error="Nicht eingerichtet (./setup-wifi-switch.sh)"), 503
    ok, msg, restarted = status.set_hotspot_password(password)
    if not ok:
        return jsonify(error=msg), 500
    return jsonify(ok=True, restarted=restarted)


@app.post("/api/printers/<name>/<action>")
def printer_action(name, action):
    if action not in ("resume", "cancel") or not re.fullmatch(r"[\w.@-]+", name):
        abort(404)
    ok, msg = status.printer_action(action, name)
    if not ok:
        return jsonify(error=msg), 500
    return jsonify(ok=True)


if __name__ == "__main__":
    from waitress import serve

    host = os.environ.get("PHOTOBOX_HOST", "127.0.0.1")
    port = int(os.environ.get("PHOTOBOX_PORT", "8080"))
    print(f"Photobox läuft auf http://{host}:{port}")
    serve(app, host=host, port=port, threads=8)
