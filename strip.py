"""Fotostreifen für den Druck: bis zu 4 Fotos untereinander, weißer Hintergrund,
dünner schwarzer Rahmen – so wie die rechte Spalte auf dem iPad.

Formate:
- „58mm“ / „80mm“: ein einzelner Streifen für Bondrucker (Thermo-Rolle). Die Seite ist
  so breit wie die Rolle und genau so lang wie der Streifen.
- „10x15“: ein Streifen ist 2 × 6 Zoll (ca. 5 × 15 cm). Auf ein 4 × 6-Zoll-Fotopapier
  (10 × 15 cm) passen zwei Streifen nebeneinander; dazwischen eine feine Schnittlinie.
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageOps

DPI = 300
STRIP_W, STRIP_H = 2 * DPI, 6 * DPI       # 600 × 1800 px
MARGIN = 36                               # Rand links/rechts/oben
GAP = 24                                  # Abstand zwischen den Fotos
BORDER = 3                                # schwarzer Rahmen um jedes Foto
SLOTS = 4


def _cover(img, w, h):
    """Bild auf w × h zuschneiden (mittig), ohne Verzerrung."""
    return ImageOps.fit(img, (w, h), method=Image.LANCZOS, centering=(0.5, 0.5))


def make_strip(paths):
    """Einen Streifen aus bis zu 4 Fotos erzeugen."""
    strip = Image.new("RGB", (STRIP_W, STRIP_H), "white")
    draw = ImageDraw.Draw(strip)
    photo_w = STRIP_W - 2 * MARGIN
    photo_h = round(photo_w * 3 / 4)                      # Fotos im Format 4:3
    top = MARGIN
    for path in list(paths)[:SLOTS]:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            inner = _cover(img, photo_w - 2 * BORDER, photo_h - 2 * BORDER)
        draw.rectangle([MARGIN, top, MARGIN + photo_w - 1, top + photo_h - 1], fill="black")
        strip.paste(inner, (MARGIN + BORDER, top + BORDER))
        top += photo_h + GAP
    return strip


MM = DPI / 25.4                           # Pixel pro Millimeter
# Rollenbreite → bedruckbare Breite (übliche Bondrucker: 58 mm → 48 mm, 80 mm → 72 mm)
ROLL_PRINT_WIDTH = {58: 48, 80: 72}


# Bildaufbereitung für Thermodrucker (nur Schwarz/Weiß, Punkte laufen etwas zu):
# Graustufen, Kontrast strecken, Gegenlicht ausgleichen, Mitteltöne aufhellen, nachschärfen.
#   PHOTOBOX_THERMAL_GAMMA: < 1 = heller (Standard 0.6), 1 = unverändert
#   PHOTOBOX_THERMAL_EQUALIZE: 0 … 1, wie stark dunkle Bereiche angehoben werden (Standard 0.5)
#   PHOTOBOX_THERMAL=0 schaltet die Aufbereitung ab
THERMAL = os.environ.get("PHOTOBOX_THERMAL", "1") != "0"
THERMAL_GAMMA = float(os.environ.get("PHOTOBOX_THERMAL_GAMMA", "0.6"))
THERMAL_EQUALIZE = float(os.environ.get("PHOTOBOX_THERMAL_EQUALIZE", "0.5"))


def thermal_tone(img):
    """Foto für den Thermodruck aufbereiten; gibt ein Graustufenbild zurück."""
    gray = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    if THERMAL_EQUALIZE > 0:
        # Histogrammausgleich hebt Gesichter vor hellem Hintergrund (Gegenlicht) an
        gray = Image.blend(gray, ImageOps.equalize(gray), min(THERMAL_EQUALIZE, 1.0))
    if THERMAL_GAMMA != 1:
        lut = [round(255 * (i / 255) ** THERMAL_GAMMA) for i in range(256)]
        gray = gray.point(lut)
    return gray.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2))


def make_roll_strip(paths, roll_mm=58):
    """Einzelner Streifen für eine Bondrucker-Rolle; gibt (Bild, Länge in mm) zurück."""
    width = round(roll_mm * MM)
    side = round((roll_mm - ROLL_PRINT_WIDTH.get(roll_mm, roll_mm - 10)) / 2 * MM)
    top = bottom = round(4 * MM)
    gap = round(3 * MM)
    photo_w = width - 2 * side
    photo_h = round(photo_w * 3 / 4)
    paths = list(paths)[:SLOTS]
    height = top + bottom + len(paths) * photo_h + max(0, len(paths) - 1) * gap
    strip = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(strip)
    y = top
    for path in paths:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            inner = _cover(img, photo_w - 2 * BORDER, photo_h - 2 * BORDER)
            if THERMAL:
                inner = thermal_tone(inner).convert("RGB")
        draw.rectangle([side, y, side + photo_w - 1, y + photo_h - 1], fill="black")
        strip.paste(inner, (side + BORDER, y + BORDER))
        y += photo_h + gap
    return strip, height / MM


# --------------------------------------------------------------------------
# Direktdruck auf ESC/POS-Bondrucker (z. B. Citizen CT-S310II, Epson TM-T20)
# --------------------------------------------------------------------------
# Der Streifen wird genau in der Auflösung des Druckkopfs (8 Punkte/mm = 203 dpi) erzeugt,
# per Fehlerverteilung (Floyd-Steinberg) in reines Schwarz/Weiß umgerechnet und als
# ESC/POS-Rasterbild samt Schnittbefehl an den Drucker geschickt (CUPS „raw“). So rechnet
# kein Treiber das Bild noch einmal um, und der Drucker schiebt vor dem Schnitt selbst
# bis zum Messer vor.

ESCPOS_DOTS_PER_MM = 8


def escpos_head_dots(roll_mm):
    """Breite des Druckkopfs in Punkten: 80-mm-Rolle → 576 (72 mm), 58-mm-Rolle → 384 (48 mm)."""
    dots = int(os.environ.get("PHOTOBOX_ESCPOS_DOTS", "0") or 0)
    if dots:
        return dots // 8 * 8
    return 576 if roll_mm >= 72 else 384


def make_escpos_strip(paths, roll_mm=80):
    """Streifen für den Direktdruck; gibt (Schwarzweißbild, ESC/POS-Daten) zurück."""
    dpmm = ESCPOS_DOTS_PER_MM
    width = escpos_head_dots(roll_mm)
    side = round(1.5 * dpmm)
    top = bottom = round(3 * dpmm)
    gap = round(2.5 * dpmm)
    border = 2
    photo_w = width - 2 * side
    photo_h = round(photo_w * 3 / 4)
    paths = list(paths)[:SLOTS]
    height = top + bottom + len(paths) * photo_h + max(0, len(paths) - 1) * gap
    strip = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(strip)
    y = top
    for path in paths:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            inner = _cover(img, photo_w - 2 * border, photo_h - 2 * border)
        inner = thermal_tone(inner) if THERMAL else inner.convert("L")
        draw.rectangle([side, y, side + photo_w - 1, y + photo_h - 1], fill=0)
        strip.paste(inner, (side + border, y + border))
        y += photo_h + gap
    bw = strip.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    return bw, escpos_raster(bw)


def escpos_raster(bw):
    """Schwarzweißbild → ESC/POS: Initialisieren, Rasterbild (GS v 0), vorschieben + schneiden."""
    width_bytes = (bw.width + 7) // 8
    # Pillow: Bit 1 = weiß; ESC/POS: Bit 1 = schwarz → invertieren
    data = bytes(b ^ 0xFF for b in bw.tobytes())
    out = bytearray(b"\x1b@")
    band = 256  # Zeilen pro Rasterbefehl
    for y0 in range(0, bw.height, band):
        rows = min(band, bw.height - y0)
        out += b"\x1dv0\x00" + bytes([width_bytes & 0xFF, width_bytes >> 8, rows & 0xFF, rows >> 8])
        out += data[y0 * width_bytes:(y0 + rows) * width_bytes]
    # GS V 66 n: bis zum Messer (+ n Punkte) vorschieben, dann schneiden
    out += b"\x1dV\x42" + bytes([min(255, int(os.environ.get("PHOTOBOX_ESCPOS_FEED", "0") or 0))])
    return bytes(out)


def make_sheet(paths, strips_per_page=2):
    """Druckbogen: 1 Streifen (2 × 6 Zoll) oder 2 nebeneinander (4 × 6 Zoll)."""
    strip = make_strip(paths)
    if strips_per_page <= 1:
        return strip
    sheet = Image.new("RGB", (STRIP_W * 2, STRIP_H), "white")
    sheet.paste(strip, (0, 0))
    sheet.paste(strip, (STRIP_W, 0))
    # feine, gestrichelte Schnittlinie in der Mitte
    draw = ImageDraw.Draw(sheet)
    x = STRIP_W
    for y in range(0, STRIP_H, 24):
        draw.line([(x, y), (x, y + 10)], fill=(190, 190, 190), width=2)
    return sheet
