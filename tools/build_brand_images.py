#!/usr/bin/env python3
"""Render the images that have the firm's name drawn into them.

Run from the repository root after editing tools/brand_lockup.html:

    python3 tools/build_brand_images.py

Writes logo-full.png, logo-full-sm.webp and og-image.jpg. Before this they were
exports nobody could regenerate, which is why a change of name meant redrawing
them. The template is now the source: the dachshund is tools/brand_dachshund.png,
cut from the original artwork with only its ink kept (the scan's paper is not
flat, and showed as a faint box), and the lettering is set in the same two
typefaces the site serves.

Rendering is headless Google Chrome, through the helpers build_one_pager.py
already has. Each image is drawn at twice its size and scaled down, so the
lettering stays crisp at the small sizes. Needs Pillow for the scaling and the
WebP and JPEG encoding.
"""
import collections
import os
import sys
import tempfile

from build_one_pager import chrome, find_chrome

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "tools", "brand_lockup.html")

# Headless Chrome will not lay a page out in a window narrower than this. Asked
# for less, it draws the page this wide and the screenshot keeps only the left
# of it. The small logo once shipped that way, reading "PITT / & COMPAN", so a
# small target is drawn at a larger size of the same proportions and scaled down.
MIN_CHROME_WINDOW_PX = 500

# The lockup is symmetrical, so its left and right margins should match. This
# is how far apart they may be, as a share of the image's width, before the
# image is refused. A drawing cut off at one edge misses by far more.
CENTRE_TOLERANCE = 0.03
# Grey level (0 to 255) below which a pixel counts as ink rather than paper.
INK_THRESHOLD = 128

# `width` and `height` are the file's size; `render_width` and `render_height`
# are the window Chrome draws it in. `fragment` selects a layout inside the
# template: the share image sits the lockup in a wider canvas with more air.
Target = collections.namedtuple(
    "Target", "name width height render_width render_height fragment format options")

SUPERSAMPLE = 2
TARGETS = (
    Target("logo-full.png", 738, 593, 738, 593, "", "PNG", {"optimize": True}),
    Target("logo-full-sm.webp", 280, 225, 738, 593, "", "WEBP", {"quality": 90, "method": 6}),
    Target("og-image.jpg", 1200, 630, 1200, 630, "og", "JPEG",
           {"quality": 90, "optimize": True, "progressive": True}),
)


def off_centre(image):
    """How unevenly the drawing sits, as a share of the image's width.

    0 means the ink's left and right margins are equal. An image with no ink
    at all returns 1, the worst case, because a blank image is not centred.
    """
    ink = image.convert("L").point(lambda level: 255 if level < INK_THRESHOLD else 0)
    box = ink.getbbox()
    if box is None:
        return 1.0
    left_margin, right_margin = box[0], image.width - box[2]
    return abs(left_margin - right_margin) / image.width


def convert(screenshot_path, output_path, target):
    """Scale a screenshot down to the target's exact size and encode it.

    Raises ValueError, writing nothing, when the screenshot is not the size
    that was asked for or the drawing in it is not centred. Either means Chrome
    did not draw what was requested, and scaling the result to fit would ship a
    stretched or cropped logo that every other check on the site passes.
    """
    expected = (target.render_width * SUPERSAMPLE, target.render_height * SUPERSAMPLE)
    with Image.open(screenshot_path) as raw:
        if raw.size != expected:
            raise ValueError("Chrome drew {}x{} for {}, expected {}x{}".format(
                raw.size[0], raw.size[1], target.name, expected[0], expected[1]))
        image = raw.convert("RGB").resize((target.width, target.height), Image.LANCZOS)
    drift = off_centre(image)
    if drift > CENTRE_TOLERANCE:
        raise ValueError(
            "{} is drawn off-centre: its side margins differ by {:.0%} of the width".format(
                target.name, drift))
    image.save(output_path, target.format, **target.options)


def main():
    if Image is None:
        print("Pillow is not installed (pip install --user Pillow).", file=sys.stderr)
        return 1
    binary = find_chrome()
    if not binary:
        print("Google Chrome not found. Set CHROME=/path/to/chrome.", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as work:
        for target in TARGETS:
            raw = os.path.join(work, target.name + ".png")
            url = "file://" + TEMPLATE + ("#" + target.fragment if target.fragment else "")
            output = os.path.join(ROOT, target.name)
            try:
                chrome(
                    binary,
                    raw,
                    "--window-size={},{}".format(target.render_width, target.render_height),
                    "--force-device-scale-factor={}".format(SUPERSAMPLE),
                    "--screenshot={}".format(raw),
                    url,
                )
                convert(raw, output, target)
            except (RuntimeError, ValueError, OSError) as err:
                print("{}: {}".format(target.name, err), file=sys.stderr)
                return 1
            print("{:<20} {}x{} {:>8,} bytes".format(
                target.name, target.width, target.height, os.path.getsize(output)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
