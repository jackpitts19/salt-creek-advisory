#!/usr/bin/env python3
"""Stamp a content hash onto every stylesheet and script reference.

Run from the repository root after changing styles.css, main.js or analytics.js,
and before committing:

    python3 tools/stamp_assets.py

Why this exists: src/index.js serves .css and .js with max-age=3600, while HTML
gets max-age=0. A deploy therefore ships new markup against up to an hour of
cached CSS and JS, and visitors see a page whose HTML and styles disagree. That
window is not theoretical, it shipped once: the articles index went live with
its new markup while the edge still held the previous stylesheet and script.

Adding ?v=<hash> makes the asset URL change whenever its bytes change. The HTML
is always fresh, so it immediately points at a URL no cache has seen and the
asset is fetched straight away, while unchanged assets keep their cache entry.

Idempotent: existing stamps are replaced, so it is safe to run repeatedly.
Stdlib only, no build step, no dependencies.
"""
import glob
import hashlib
import io
import os
import re
import sys

# Only the assets pages load from this origin. Fonts and images sit behind their
# own cache rules; analytics.js is here because it ships under the same .js rule
# as main.js and would go stale the same way.
ASSETS = ("styles.css", "main.js", "analytics.js")
HASH_LENGTH = 8


def content_hash(filename):
    """Short hash of the asset's bytes, so the URL only moves when it does."""
    with open(filename, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()[:HASH_LENGTH]


def reference_pattern(asset):
    """Matches href/src for one asset at any of the depths the site uses.

    Pages sit at the root and under articles/, and 404.html reaches for assets
    from the site root, so the prefix is one of "", "../" or "/". An existing
    ?v= stamp is inside the match, so re-running replaces rather than stacks.
    """
    return re.compile(
        r'((?:href|src)=")((?:\.\./|/)?)'
        + re.escape(asset)
        + r'(?:\?v=[0-9a-f]+)?(")'
    )


def stamp(html, hashes):
    for asset, digest in hashes.items():
        html = reference_pattern(asset).sub(
            lambda m, a=asset, d=digest: "{}{}{}?v={}{}".format(
                m.group(1), m.group(2), a, d, m.group(3)
            ),
            html,
        )
    return html


def main():
    missing = [asset for asset in ASSETS if not os.path.exists(asset)]
    if missing:
        print(
            "Missing asset(s): {}. Run this from the repository root.".format(
                ", ".join(missing)
            ),
            file=sys.stderr,
        )
        return 1

    pages = sorted(glob.glob("*.html") + glob.glob("articles/*.html"))
    if not pages:
        print("No pages found. Run this from the repository root.", file=sys.stderr)
        return 1

    hashes = {asset: content_hash(asset) for asset in ASSETS}
    changed = 0
    for page in pages:
        with io.open(page, encoding="utf-8") as handle:
            original = handle.read()
        stamped = stamp(original, hashes)
        if stamped != original:
            with io.open(page, "w", encoding="utf-8") as handle:
                handle.write(stamped)
            changed += 1

    for asset, digest in sorted(hashes.items()):
        print("{:<14} {}".format(asset, digest))
    print("{} of {} pages updated".format(changed, len(pages)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
