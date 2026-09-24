"""Raspberry Photobox – Server.

Liefert das Photobox-Dashboard für das iPad aus, speichert die aufgenommenen
Fotos und schickt sie per CUPS (`lp`) an den Drucker.
"""

import hmac
import os
import re
import subprocess
import time
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask.sessions import SecureCookieSessionInterface
from PIL import Image, ImageOps

BASE_DIR = Path(__file__).resolve().parent
PHOTO_DIR = Path(os.environ.get("PHOTOBOX_PHOTO_DIR", BASE_DIR / "photos"))
THUMB_DIR = PHOTO_DIR / "thumbs"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

PIN = os.environ.get("PHOTOBOX_PIN", "")
PRINTER = os.environ.get("PHOTOBOX_PRINTER", "")  # leer = CUPS-Standarddrucker
PRINT_OPTIONS = os.environ.get("PHOTOBOX_PRINT_OPTIONS", "fit-to-page").split()
MAX_COPIES = int(os.environ.get("PHOTOBOX_MAX_COPIES", "4"))
THUMB_SIZE = (480, 480)
PHOTO_NAME = re.compile(r"^\d{8}-\d{6}-\d{3}\.jpg$")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("PHOTOBOX_SECRET_KEY") or os.urandom(32),
    MAX_CONTENT_LENGTH=25 * 1024 * 1024,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
)


class SessionInterface(SecureCookieSessionInterface):
    """Setzt das Secure-Flag nur, wenn die Seite per HTTPS aufgerufen wurde.

    So klappt die Anmeldung sowohl im Heimnetz (http://) als auch über den
    Cloudflare Tunnel (https://, erkennbar an X-Forwarded-Proto).
    """

    def get_cookie_secure(self, app):
        return request.is_secure or request.headers.get("X-Forwarded-Proto") == "https"


app.session_interface = SessionInterface()


@app.context_processor
def asset_version():
    """Versionsnummer für CSS/JS, damit Safari nach einem Update nichts Altes aus dem Cache nimmt."""
    static = Path(app.static_folder)
    return {"v": int(max((static / f).stat().st_mtime for f in ("app.js", "style.css")))}


# --------------------------------------------------------------------------
# Anmeldung
# --------------------------------------------------------------------------

def logged_in():
    return not PIN or session.get("auth") is True


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if logged_in():
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify(error="Nicht angemeldet"), 401
        return redirect(url_for("login"))

    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    if not PIN:
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        if hmac.compare_digest(request.form.get("pin", "").encode(), PIN.encode()):
            session.clear()
            session.permanent = True
            session["auth"] = True
            return redirect(url_for("index"))
        time.sleep(1.5)  # bremst Durchprobieren der PIN
        error = "Falsche PIN"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# --------------------------------------------------------------------------
# Seiten & Dateien
# --------------------------------------------------------------------------

@app.route("/")
@login_required
def index():
    return render_template("index.html", max_copies=MAX_COPIES)


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
@login_required
def photo_file(name):
    if not PHOTO_NAME.match(name):
        abort(404)
    return send_from_directory(PHOTO_DIR, name, max_age=86400)


@app.route("/photos/thumbs/<name>")
@login_required
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
@login_required
def list_photos():
    names = sorted(
        (p.name for p in PHOTO_DIR.glob("*.jpg") if PHOTO_NAME.match(p.name)),
        reverse=True,
    )
    return jsonify([photo_info(n) for n in names])


@app.post("/api/photos")
@login_required
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
@login_required
def delete_photo(name):
    photo_path(name).unlink()
    (THUMB_DIR / name).unlink(missing_ok=True)
    return jsonify(ok=True)


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
@login_required
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
@login_required
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


if __name__ == "__main__":
    from waitress import serve

    host = os.environ.get("PHOTOBOX_HOST", "127.0.0.1")
    port = int(os.environ.get("PHOTOBOX_PORT", "8080"))
    print(f"Photobox läuft auf http://{host}:{port}")
    # cloudflared läuft auf demselben Pi und meldet per X-Forwarded-Proto, dass HTTPS benutzt wird
    serve(
        app,
        host=host,
        port=port,
        threads=8,
        trusted_proxy="127.0.0.1",
        trusted_proxy_headers={"x-forwarded-proto"},
    )
