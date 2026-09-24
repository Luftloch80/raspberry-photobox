"""Systemstatus für die Statusseite: WLAN (NetworkManager), Drucker (CUPS), System.

Alle Abfragen sind fehlertolerant: Fehlt ein Programm (z. B. nmcli auf einem
Entwicklungsrechner), wird der Bereich als „nicht verfügbar“ gemeldet.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

ENV = {**os.environ, "LANG": "C", "LC_ALL": "C"}
WIFI_IFACE = os.environ.get("PHOTOBOX_WIFI_IFACE", "wlan0")
LEASES = [
    Path(os.environ.get("PHOTOBOX_DHCP_LEASES", "/run/photobox-dhcp/leases")),  # hostapd-Hotspot
    Path(f"/var/lib/NetworkManager/dnsmasq-{WIFI_IFACE}.leases"),               # früherer NM-Hotspot
]

PRINTER_REASONS = {
    "media-empty": "Papier leer",
    "media-needed": "Papier einlegen",
    "media-jam": "Papierstau",
    "media-low": "Papier fast leer",
    "marker-supply-empty": "Farbband/Tinte leer",
    "marker-supply-low": "Farbband/Tinte fast leer",
    "toner-empty": "Toner leer",
    "toner-low": "Toner fast leer",
    "cover-open": "Abdeckung offen",
    "door-open": "Klappe offen",
    "input-tray-missing": "Papierfach fehlt",
    "offline": "Drucker offline",
    "offline-report": "Drucker offline",
    "connecting-to-device": "Verbinde mit Drucker …",
    "paused": "Angehalten",
    "shutdown": "Ausgeschaltet",
    "other": "Druckerfehler",
    "cups-missing-filter": "Treiber fehlt",
    "cups-insecure-filter": "Treiberproblem",
}


def run(cmd, timeout=5):
    """Befehl ausführen; gibt stdout zurück oder None, wenn er fehlt/fehlschlägt."""
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV)
    except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError):
        return None
    return res.stdout if res.returncode == 0 else None


def split_terse(line):
    """nmcli -t trennt mit ':' und maskiert ':' in Werten als '\\:'."""
    return [p.replace("\\:", ":") for p in re.split(r"(?<!\\):", line)]


# --------------------------------------------------------------------------
# WLAN
# --------------------------------------------------------------------------

def ipv4_addresses():
    out = run(["ip", "-4", "-o", "addr", "show"]) or ""
    addrs = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[1] != "lo":
            addrs.setdefault(parts[1], []).append(parts[3].split("/")[0])
    return addrs


def hotspot_clients():
    names = {}
    for leases in LEASES:
        try:
            for line in leases.read_text().splitlines():
                p = line.split()
                if len(p) >= 4:
                    names[p[1].lower()] = {"ip": p[2], "name": "" if p[3] == "*" else p[3]}
        except OSError:
            pass

    out = run(["iw", "dev", WIFI_IFACE, "station", "dump"])
    if out is None:
        return None
    clients, cur = [], None
    for line in out.splitlines():
        m = re.match(r"Station ([0-9a-f:]{17})", line.strip())
        if m:
            cur = {"mac": m.group(1), "signal": None, "connected": None}
            cur.update(names.get(cur["mac"], {"ip": "", "name": ""}))
            clients.append(cur)
        elif cur is not None:
            key, _, val = line.strip().partition(":")
            val = val.strip()
            if key == "signal":
                m = re.match(r"(-?\d+)", val)
                cur["signal"] = int(m.group(1)) if m else None
            elif key == "connected time":
                m = re.match(r"(\d+)", val)
                cur["connected"] = int(m.group(1)) if m else None
    return clients


def wifi_status():
    devices = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if devices is None:
        return {"available": False, "message": "NetworkManager nicht verfügbar"}

    info = {"available": True, "interface": WIFI_IFACE, "mode": "off",
            "ssid": "", "channel": "", "signal": None, "clients": [],
            "addresses": ipv4_addresses(), "ethernet": False}
    wifi_con = ""
    for line in devices.splitlines():
        dev, typ, state, con = (split_terse(line) + ["", "", "", ""])[:4]
        if typ == "ethernet" and state.startswith("connected"):
            info["ethernet"] = True
        if dev == WIFI_IFACE:
            info["state"] = state
            if state.startswith("connected"):
                wifi_con = con

    info["known"] = known_networks()
    creds = hotspot_credentials()
    info["hotspot_ssid"] = creds["ssid"] if creds else None
    info["hotspot_password"] = creds["password"] if creds else None
    try:
        # Neueste Meldung zuerst (siehe deploy/photobox-wifi)
        info["switch_log"] = Path(os.environ.get("PHOTOBOX_WIFI_LOG", "/run/photobox-wifi.log")).read_text().splitlines()[:6]
    except OSError:
        info["switch_log"] = []
    info["switch_available"] = wifi_switch_available()

    if hostapd_active():
        info.update(mode="hotspot", connection="hotspot", ssid=info["hotspot_ssid"] or "")
        m = re.search(r"channel (\d+)", run(["iw", "dev", WIFI_IFACE, "info"]) or "")
        info["channel"] = m.group(1) if m else ""
        clients = hotspot_clients()
        info["clients"] = clients or []
        if clients is None:
            info["message"] = "Geräteliste nicht verfügbar (iw fehlt)"
        return info

    if not wifi_con:
        info["message"] = "WLAN nicht verbunden"
        return info

    props = run(["nmcli", "-g", "802-11-wireless.mode,802-11-wireless.ssid,802-11-wireless.channel",
                 "connection", "show", wifi_con]) or ""
    mode, ssid, channel = (props.splitlines() + ["", "", ""])[:3]
    info.update(connection=wifi_con, ssid=ssid.replace("\\:", ":"), channel=channel)

    if mode == "ap":
        info["mode"] = "hotspot"
        clients = hotspot_clients()
        info["clients"] = clients or []
        if clients is None:
            info["message"] = "Geräteliste nicht verfügbar (iw fehlt)"
    else:
        info["mode"] = "client"
        scan = run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,CHAN", "device", "wifi", "list", "--rescan", "no"]) or ""
        for line in scan.splitlines():
            in_use, s_ssid, signal, chan = (split_terse(line) + ["", "", "", ""])[:4]
            if in_use == "*":
                info["signal"] = int(signal) if signal.isdigit() else None
                info["channel"] = info["channel"] or chan
    return info


WIFI_HELPER = os.environ.get("PHOTOBOX_WIFI_HELPER", "/usr/local/sbin/photobox-wifi")
HOTSPOT_CON = "Photobox-Hotspot"


def known_networks():
    """Gespeicherte normale WLANs (ohne den Photobox-Hotspot)."""
    out = run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"]) or ""
    nets = []
    for line in out.splitlines():
        name, typ = (split_terse(line) + ["", ""])[:2]
        if typ != "802-11-wireless" or name == HOTSPOT_CON:
            continue
        props = run(["nmcli", "-g", "802-11-wireless.mode,802-11-wireless.ssid",
                     "connection", "show", name]) or ""
        mode, ssid = (props.splitlines() + ["", ""])[:2]
        if mode != "ap":
            nets.append({"name": name, "ssid": ssid.replace("\\:", ":") or name})
    return nets


def wifi_switch_available():
    """Darf die Photobox umschalten? (Hilfsskript + sudo-Regel vorhanden)"""
    if not os.path.exists(WIFI_HELPER):
        return False
    return run(["sudo", "-n", "-l", WIFI_HELPER]) is not None


def hostapd_active():
    """Läuft der Photobox-Hotspot (hostapd, siehe deploy/photobox-wifi)?"""
    return run(["systemctl", "is-active", "--quiet", "photobox-hostapd"]) is not None


def hotspot_ssid():
    """WLAN-Name des Photobox-Hotspots, oder None wenn keiner eingerichtet ist."""
    creds = hotspot_credentials()
    return creds["ssid"] if creds else None


def hotspot_credentials():
    """Name und Passwort des Hotspots (Passwort lesen darf nur root → Hilfsskript)."""
    if not os.path.exists(WIFI_HELPER):
        return None
    out = run(["sudo", "-n", WIFI_HELPER, "credentials"])
    if out is None:
        return None
    lines = out.splitlines() + ["", ""]
    return {"ssid": lines[0].replace("\\:", ":"), "password": lines[1]}


def set_hotspot_password(password):
    """Neues Hotspot-Passwort setzen. Gibt (ok, Meldung, Hotspot-neu-gestartet) zurück."""
    try:
        res = subprocess.run(["sudo", "-n", WIFI_HELPER, "set-password"], input=password + "\n",
                             capture_output=True, text=True, timeout=30, env=ENV)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, "Passwort konnte nicht gesetzt werden", False
    if res.returncode != 0:
        return False, (res.stderr or res.stdout).strip() or "Passwort konnte nicht gesetzt werden", False
    return True, "", "restart" in res.stdout


def hotspot_configured():
    return hotspot_ssid() is not None


def switch_wifi(mode):
    """Umschalten im Hintergrund starten.

    Das Umschalten trennt das iPad vom bisherigen WLAN, daher wartet die
    Photobox nicht auf das Ergebnis. Das Hilfsskript schaltet selbst zurück
    auf den Hotspot, wenn kein bekanntes WLAN erreichbar ist.
    """
    if mode not in ("hotspot", "client"):
        raise ValueError(mode)
    subprocess.Popen(
        ["sudo", "-n", WIFI_HELPER, mode],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, env=ENV,
    )


# --------------------------------------------------------------------------
# Drucker
# --------------------------------------------------------------------------

def translate_reason(reason):
    base = re.sub(r"-(error|warning|report)$", "", reason)
    return PRINTER_REASONS.get(reason) or PRINTER_REASONS.get(base) or reason


def printer_status(configured=""):
    out = run(["lpstat", "-l", "-p"])
    if out is None:
        if run(["lpstat", "-r"]) is None:
            return {"available": False, "message": "CUPS nicht erreichbar"}
        out = ""

    default = ""
    d = run(["lpstat", "-d"]) or ""
    if ":" in d:
        default = d.split(":", 1)[1].strip()

    devices = {}
    for line in (run(["lpstat", "-v"]) or "").splitlines():
        m = re.match(r"device for (\S+): (\S+)", line)
        if m:
            devices[m.group(1)] = m.group(2)

    printers, cur = [], None
    for line in out.splitlines():
        if line.startswith("printer "):
            name, _, rest = line[len("printer "):].partition(" ")
            job = re.match(r"now printing (\S+?)\.?\s", rest)
            if job:
                state = "printing"
            elif rest.startswith("is idle"):
                state = "idle"
            elif rest.startswith("disabled"):
                state = "stopped"
            else:
                state = rest.split(".")[0].removeprefix("is ").strip() or "unknown"
            cur = {"name": name, "state": state, "enabled": not rest.startswith("disabled"),
                   "job": job.group(1) if job else ""}
            printers.append(cur)
            continue
        if cur is None:
            continue
        text = line.strip()
        if text.startswith("Description:"):
            cur["description"] = text.split(":", 1)[1].strip()
        elif text.startswith("Alerts:"):
            alerts = [a for a in text.split(":", 1)[1].split() if a not in ("none", "")]
            cur["alerts"] = [translate_reason(a) for a in alerts]
        elif text and not line.startswith("\t\t") and ":" not in text and "message" not in cur:
            cur["message"] = text  # Statusmeldung direkt unter der Druckerzeile

    for p in printers:
        p.setdefault("alerts", [])
        p["device"] = devices.get(p["name"], "")
        p["default"] = p["name"] == default
        p["selected"] = p["name"] == (configured or default)
        p["ok"] = p["enabled"] and not any(
            a for a in p["alerts"] if a not in ("Verbinde mit Drucker …",))

    jobs = []
    for line in (run(["lpstat", "-o"]) or "").splitlines():
        parts = line.split(None, 3)
        if len(parts) >= 3:
            job_id = parts[0]
            jobs.append({"id": job_id, "printer": job_id.rsplit("-", 1)[0], "user": parts[1],
                         "size": int(parts[2]) if parts[2].isdigit() else 0,
                         "time": parts[3].strip() if len(parts) > 3 else ""})

    return {"available": True, "default": default, "configured": configured,
            "printers": printers, "jobs": jobs}


def printer_action(action, name):
    if action == "resume":
        cmds = [["cupsenable", name], ["cupsaccept", name]]
    elif action == "cancel":
        cmds = [["cancel", "-a", name]]
    else:
        raise ValueError(action)
    for cmd in cmds:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=10, env=ENV)
        except FileNotFoundError:
            return False, "CUPS ist nicht installiert"
        if res.returncode != 0:
            return False, (res.stderr or res.stdout).strip() or "Aktion fehlgeschlagen"
    return True, ""


# --------------------------------------------------------------------------
# System
# --------------------------------------------------------------------------

def system_status(photo_dir):
    info = {"hostname": os.uname().nodename}
    try:
        info["uptime"] = int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError, IndexError):
        info["uptime"] = None
    try:
        info["temperature"] = int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000
    except (OSError, ValueError):
        info["temperature"] = None
    try:
        du = shutil.disk_usage(photo_dir)
        info["disk_free"] = du.free
        info["disk_total"] = du.total
    except OSError:
        info["disk_free"] = info["disk_total"] = None
    throttled = run(["vcgencmd", "get_throttled"])
    if throttled and "=" in throttled:
        try:
            info["undervoltage"] = bool(int(throttled.split("=")[1], 16) & 0x1)
        except ValueError:
            pass
    return info
