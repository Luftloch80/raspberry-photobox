"""Fotostreifen für den Druck: bis zu 4 Fotos untereinander, weißer Hintergrund,
dünner schwarzer Rahmen – so wie die rechte Spalte auf dem iPad.

Formate:
- „58mm“ / „80mm“: ein einzelner Streifen für Bondrucker (Thermo-Rolle). Die Seite ist
  so breit wie die Rolle und genau so lang wie der Streifen.
- „10x15“: ein Streifen ist 2 × 6 Zoll (ca. 5 × 15 cm). Auf ein 4 × 6-Zoll-Fotopapier
  (10 × 15 cm) passen zwei Streifen nebeneinander; dazwischen eine feine Schnittlinie.
"""

from PIL import Image, ImageDraw, ImageOps

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
        draw.rectangle([side, y, side + photo_w - 1, y + photo_h - 1], fill="black")
        strip.paste(inner, (side + BORDER, y + BORDER))
        y += photo_h + gap
    return strip, height / MM


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
