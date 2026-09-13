#!/usr/bin/env python3
"""Generate a deterministic 1024x1024 Waxloom app-icon PPM.

The repository keeps the brand source as text. macOS/Xcode converts the PPM
into the PNG consumed by the shared AppIcon asset catalog.
"""

from __future__ import annotations

import math
import pathlib
import sys

SIZE = 1024
POINTS = (
    (0.12, 0.30),
    (0.30, 0.68),
    (0.49, 0.42),
    (0.68, 0.68),
    (0.88, 0.28),
)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def mix(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    denom = vx * vx + vy * vy
    if denom <= 1e-12:
        return math.hypot(wx, wy)
    t = clamp((wx * vx + wy * vy) / denom)
    dx = px - (ax + vx * t)
    dy = py - (ay + vy * t)
    return math.hypot(dx, dy)


def gradient_color(x: float) -> tuple[float, float, float]:
    left = (0.94, 0.22, 0.98)
    middle = (0.48, 0.31, 1.00)
    right = (0.09, 0.72, 1.00)
    if x < 0.52:
        t = x / 0.52
        return tuple(mix(left[i], middle[i], t) for i in range(3))
    t = (x - 0.52) / 0.48
    return tuple(mix(middle[i], right[i], t) for i in range(3))


def pixel(x: int, y: int) -> tuple[int, int, int]:
    nx = (x + 0.5) / SIZE
    ny = (y + 0.5) / SIZE

    # Dark Waxloom field with restrained violet/cyan atmosphere.
    r = 0.028 + 0.014 * ny
    g = 0.030 + 0.010 * ny
    b = 0.060 + 0.040 * ny

    violet = clamp(1.0 - math.hypot(nx - 0.18, ny - 0.84) / 0.72) ** 2
    cyan = clamp(1.0 - math.hypot(nx - 0.84, ny - 0.16) / 0.60) ** 2
    r += violet * 0.17
    b += violet * 0.26
    g += cyan * 0.09
    b += cyan * 0.17

    distance = min(
        distance_to_segment(nx, ny, *POINTS[index], *POINTS[index + 1])
        for index in range(len(POINTS) - 1)
    )

    # Soft neon bloom around the mark.
    glow = clamp(1.0 - distance / 0.19) ** 2
    gr, gg, gb = gradient_color(nx)
    r += gr * glow * 0.18
    g += gg * glow * 0.13
    b += gb * glow * 0.25

    # Rounded ribbon body; antialias the boundary across a narrow band.
    half_width = 0.060
    edge = 0.006
    body = clamp((half_width + edge - distance) / (2.0 * edge))
    if body > 0.0:
        # Slight highlight along the upper half makes the W feel woven rather than flat.
        highlight = clamp((0.54 - ny) / 0.22) * 0.18
        rr = clamp(gr + highlight)
        gg2 = clamp(gg + highlight * 0.65)
        bb = clamp(gb + highlight * 0.35)
        r = mix(r, rr, body)
        g = mix(g, gg2, body)
        b = mix(b, bb, body)

    return (
        int(clamp(r) * 255 + 0.5),
        int(clamp(g) * 255 + 0.5),
        int(clamp(b) * 255 + 0.5),
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: generate-waxloom-icon.py OUTPUT.ppm", file=sys.stderr)
        return 2

    output = pathlib.Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("wb") as handle:
        handle.write(f"P6\n{SIZE} {SIZE}\n255\n".encode("ascii"))
        row = bytearray(SIZE * 3)
        for y in range(SIZE):
            offset = 0
            for x in range(SIZE):
                red, green, blue = pixel(x, y)
                row[offset] = red
                row[offset + 1] = green
                row[offset + 2] = blue
                offset += 3
            handle.write(row)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
