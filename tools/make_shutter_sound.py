"""Erzeugt static/shutter.wav: ein kurzes Kamera-„Klick-Klack“ aus gefiltertem Rauschen."""

import math
import random
import struct
import wave
from pathlib import Path
SR = 44100
OUT = Path(__file__).resolve().parent.parent / "static" / "shutter.wav"
random.seed(7)
out = [0.0] * int(SR * 0.26)

def bandpass(freq, q):
    w = 2 * math.pi * freq / SR
    alpha = math.sin(w) / (2 * q)
    b0, b1, b2 = alpha, 0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w), 1 - alpha
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]

def snap(at, freq, q, gain, decay):
    b0, b1, b2, a1, a2 = bandpass(freq, q)
    x1 = x2 = y1 = y2 = 0.0
    start = int(at * SR)
    n = int((decay * 2.5) * SR)
    for i in range(n):
        x = random.uniform(-1, 1)
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x, y1, y
        t = i / SR
        env = min(1.0, t / 0.0015) * math.exp(-t / (decay / 4.6))
        if start + i < len(out):
            out[start + i] += y * env * gain

snap(0.000, 3200, 0.8, 1.0, 0.035)   # Klick
snap(0.002, 900, 1.5, 0.6, 0.05)     # Körper
snap(0.110, 2400, 0.8, 0.75, 0.045)  # Klack
snap(0.112, 700, 1.5, 0.45, 0.06)
peak = max(abs(v) for v in out)
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(v / peak * 0.95 * 32767)) for v in out))
