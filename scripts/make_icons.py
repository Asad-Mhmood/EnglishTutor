"""
Render the PWA icon set from the tutor logo.

    python scripts/make_icons.py           # write the PNGs
    python scripts/make_icons.py --check   # fail if they are missing or stale (for CI)

Needs Pillow (`pip install pillow`). It is deliberately NOT in requirements.txt: that file is
the agent's *runtime* dependency list and ships into the LiveKit container, and an image
library the agent never imports has no business being in it.

WHY THIS EXISTS

`web/public/tutor-logo.svg` is the mark. A phone home screen cannot use it — Android and iOS
both want PNGs at fixed sizes, and the manifest has to name stable URLs — so the icons are
generated copies, committed to `web/public/` and served as static CDN assets. Generating them
per request through `next/og` instead would spend a function invocation on an image that
changes roughly never.

Same problem as scripts/sync_taxonomy.py, same shape of answer: one source, a generated copy,
and a `--check` so drift is reported rather than discovered on someone's home screen.

WHAT IS DERIVED, AND WHAT IS TRANSCRIBED

The brand colour IS read from the SVG, so recolouring the logo recolours the icons.

The GEOMETRY IS NOT. The bubble is one bezier path, transcribed into `CUBICS` below, because
rasterizing arbitrary SVG means either a real dependency (cairosvg, which wants native libs on
Windows) or a half-written path parser, which is its own liability. The transcription is exact
and the path has changed once in the project's life.

To keep that from rotting silently, the script pins the exact `d` attribute it was transcribed
from and REFUSES TO RUN if the SVG's path no longer matches. Edit the logo's shape and this
fails loudly with instructions, instead of quietly re-rendering yesterday's bubble forever.

THE ICON TREATMENT

The mark is inverted onto a solid brand tile — green background, white bubble — rather than
reproduced as-is. A transparent tile is composited onto black by iOS, and a white one reads as
an unfinished placeholder on a home screen. The maskable variant additionally pulls the mark
into the inner safe circle, because Android launchers crop icons to whatever shape they like
and a round mask would otherwise clip the bubble's tail off.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "web" / "public" / "tutor-logo.svg"
PUBLIC = ROOT / "web" / "public"

# Supersample factor: everything is drawn at size*SS and reduced with LANCZOS, which is what
# gives the curve and the round caps clean edges. PIL has no antialiased polygon fill.
SS = 8

WHITE = (255, 255, 255)

# --- the transcription, and the guard that keeps it honest ---------------------------------
#
# The bubble path exactly as it appears in tutor-logo.svg. If this no longer matches, the
# CUBICS below describe a shape the logo no longer has — see WHAT IS DERIVED above.
EXPECTED_PATH = (
    "M12 3C6.9 3 2.8 6.4 2.8 10.6c0 2.4 1.3 4.5 3.4 5.9v4.0l3.7-2.1c.7.1 1.4.2 2.1.2 "
    "5.1 0 9.2-3.4 9.2-7.6S17.1 3 12 3Z"
)

# The same path as absolute cubic segments in the 24x24 viewBox: (control1, control2, end).
START = (12.0, 3.0)
CUBICS = [
    ((6.9, 3.0), (2.8, 6.4), (2.8, 10.6)),
    ((2.8, 13.0), (4.1, 15.1), (6.2, 16.5)),
    # v4.0 then l3.7 -2.1 — the tail. Straight, written as degenerate curves so the flattener
    # below needs only one code path.
    ((6.2, 20.5), (6.2, 20.5), (6.2, 20.5)),
    ((9.9, 18.4), (9.9, 18.4), (9.9, 18.4)),
    ((10.6, 18.5), (11.3, 18.6), (12.0, 18.6)),
    ((17.1, 18.6), (21.2, 15.2), (21.2, 11.0)),
    # S 17.1 3, 12 3 — a smooth cubic, whose first control is the reflection of the previous
    # segment's second control about the current point: 2*(21.2,11.0) - (21.2,15.2).
    ((21.2, 6.8), (17.1, 3.0), (12.0, 3.0)),
]

# The two speech lines: (x0, y0, x1, y1), stroke-width 1.5, round caps.
LINES = [(7.7, 9.4, 16.3, 9.4), (7.7, 12.6, 13.3, 12.6)]
STROKE_W = 1.5

# name, pixel size, and how much of the tile the 24x24 mark spans. The maskable one is smaller
# because a launcher may crop away the outer ~20%.
OUTPUTS = [
    ("icon-192.png", 192, 0.62),
    ("icon-512.png", 512, 0.62),
    ("icon-maskable-512.png", 512, 0.46),
    ("apple-touch-icon.png", 180, 0.62),
]


def _normalize(path_data: str) -> str:
    """Collapse whitespace, so re-wrapping the `d` attribute is not treated as a change."""
    return " ".join(path_data.split())


def _rel(path: Path) -> str:
    """
    A path for humans — repo-relative where possible, absolute otherwise.

    The fallback is not decoration. This is called while building the messages below, and a
    bare `relative_to` raises on anything outside ROOT; a guard whose error path can itself
    throw replaces a clear explanation with a traceback at the exact moment one is useless.
    """
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_logo() -> tuple[int, int, int]:
    """
    The mark's fill colour, after checking its geometry is still the one we transcribed.

    Raises SystemExit rather than returning a fallback: rendering the wrong shape silently is
    the exact failure this guard exists to prevent.
    """
    svg = LOGO.read_text(encoding="utf-8")

    path_match = re.search(r'd="([^"]+)"', svg)
    fill_match = re.search(r'fill="#([0-9a-fA-F]{6})"', svg)
    if not path_match or not fill_match:
        raise SystemExit(f"ERROR: could not find a path and a fill in {_rel(LOGO)}")

    if _normalize(path_match.group(1)) != _normalize(EXPECTED_PATH):
        raise SystemExit(
            f"ERROR: the bubble path in {_rel(LOGO)} has changed.\n"
            f"The icon geometry in this script is a hand transcription of that path, so it "
            f"would now render the OLD shape.\n"
            f"Re-transcribe CUBICS (and EXPECTED_PATH) from the new path before rendering."
        )

    hex_colour = fill_match.group(1)
    return tuple(int(hex_colour[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _cubic(p0, c1, c2, p3, steps: int = 96):
    """Flatten one cubic bezier to points, excluding p0 — the previous segment supplied it."""
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
        out.append((x, y))
    return out


def _outline():
    """The bubble as one closed polygon in viewBox coordinates."""
    points = [START]
    current = START
    for c1, c2, end in CUBICS:
        points.extend(_cubic(current, c1, c2, end))
        current = end
    return points


def render(size: int, glyph_fraction: float, brand: tuple[int, int, int]) -> Image.Image:
    """One icon: the mark centred on a solid brand tile."""
    canvas = size * SS
    image = Image.new("RGB", (canvas, canvas), brand)
    draw = ImageDraw.Draw(image)

    scale = canvas * glyph_fraction / 24.0
    offset = (canvas - 24.0 * scale) / 2.0

    def to_px(x: float, y: float) -> tuple[float, float]:
        return (offset + x * scale, offset + y * scale)

    draw.polygon([to_px(x, y) for x, y in _outline()], fill=WHITE)

    # Round caps: PIL's line width has no cap style, so each endpoint gets its own disc.
    radius = STROKE_W * scale / 2.0
    for x0, y0, x1, y1 in LINES:
        start, end = to_px(x0, y0), to_px(x1, y1)
        draw.line([start, end], fill=brand, width=max(1, round(STROKE_W * scale)))
        for cx, cy in (start, end):
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=brand)

    return image.resize((size, size), Image.LANCZOS)


def _matches(rendered: Image.Image, path: Path) -> bool:
    """
    Whether the committed file already holds this image.

    Compared as PIXELS, not as file bytes. PNG encoders are free to vary their output between
    Pillow releases, so a byte comparison would report drift every time someone upgraded a
    library — a check that cries wolf gets ignored, and then it protects nothing.
    """
    if not path.exists():
        return False
    try:
        with Image.open(path) as existing:
            existing = existing.convert("RGB")
            if existing.size != rendered.size:
                return False
            return ImageChops.difference(existing, rendered).getbbox() is None
    except OSError:
        return False  # unreadable or not an image; regenerate it


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if any icon is missing or stale, and write nothing",
    )
    args = parser.parse_args()

    brand = read_logo()
    stale: list[str] = []

    for name, size, fraction in OUTPUTS:
        destination = PUBLIC / name
        image = render(size, fraction, brand)

        if _matches(image, destination):
            print(f"up to date: {_rel(destination)}")
            continue

        if args.check:
            stale.append(name)
            continue

        image.save(destination, "PNG", optimize=True)
        print(f"wrote {_rel(destination)} ({destination.stat().st_size:,} bytes)")

    if stale:
        print(
            f"ERROR: {len(stale)} icon(s) missing or stale: {', '.join(stale)}.\n"
            f"Run: python scripts/make_icons.py",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
