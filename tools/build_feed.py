#!/usr/bin/env python3
"""Regenerate feed.xml and sitemap.xml from the pages themselves.

Run from the repository root after adding or editing an article:

    python3 tools/build_feed.py

Source of truth is each article's existing Article JSON-LD block, so the feed,
the sitemap and the structured data can never disagree with each other. Pages
that are not articles take their lastmod from the last git commit that changed
them for a reason other than a ?v= cache stamp. Stdlib only, no build step,
no dependencies.
"""
import glob
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from xml.sax.saxutils import escape

# Shared with the stamper so "a stamp-only change" means exactly what it writes.
# Run as `python3 tools/build_feed.py`, tools/ is already first on sys.path.
from stamp_assets import ASSETS, reference_pattern

SITE = "https://saltcreekadvisory.com"
# Matches the <link rel="alternate"> title in the markup exactly. The two drifted
# once already, on the em dash, and a feed title that disagrees with the tag
# pointing at it is the kind of thing only a reader ever notices.
FEED_TITLE = "Salt Creek Advisory - Articles & Guides"
FEED_DESCRIPTION = (
    "M&A guides for lower middle market business owners: valuation multiples, "
    "the sale process, and how to choose an advisor."
)

JSON_LD = re.compile(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', re.DOTALL)
NOINDEX = re.compile(r'<meta name="robots"[^>]*noindex', re.IGNORECASE)

# The 404 page is reachable only by error and carries noindex anyway.
SITEMAP_EXCLUDE = {"404.html"}


def article_nodes(path):
    """Yield every Article JSON-LD node in a page."""
    html = open(path, encoding="utf-8").read()
    if NOINDEX.search(html):
        return
    for raw in JSON_LD.findall(html):
        try:
            node = json.loads(raw)
        except json.JSONDecodeError as err:
            print(f"  !! {path}: invalid JSON-LD ({err})", file=sys.stderr)
            continue
        if isinstance(node, dict) and node.get("@type") == "Article":
            yield node


def collect_articles():
    articles = []
    for path in sorted(glob.glob("articles/*.html")):
        nodes = list(article_nodes(path))
        if not nodes:
            print(f"  !! {path}: no Article JSON-LD, skipped", file=sys.stderr)
            continue
        node = nodes[0]
        missing = [f for f in ("headline", "url", "datePublished") if not node.get(f)]
        if missing:
            print(f"  !! {path}: missing {missing}, skipped", file=sys.stderr)
            continue
        articles.append({
            "title": node["headline"],
            "url": node["url"],
            "description": node.get("description", ""),
            "published": node["datePublished"],
            "modified": node.get("dateModified", node["datePublished"]),
            "author": (node.get("author") or {}).get("name", "Salt Creek Advisory"),
            "path": path,
        })
    articles.sort(key=lambda a: (a["published"], a["url"]), reverse=True)
    return articles


def to_rfc822(iso_date):
    parsed = datetime.strptime(iso_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return parsed.strftime("%a, %d %b %Y %H:%M:%S +0000")


def _without_stamps(line):
    """A diff line with every ?v= cache stamp removed, using stamp_assets' own regex."""
    for asset in ASSETS:
        line = reference_pattern(asset).sub(
            lambda m, a=asset: m.group(1) + m.group(2) + a + m.group(3), line
        )
    return line


def _changed_lines(commit, path, cwd=None):
    """The removed and added lines one commit made to `path`, headers excluded.

    Merges are diffed against their first parent, which is what the branch the
    sitemap is built from actually received.
    """
    result = subprocess.run(
        ["git", "show", "--format=", "--no-color", "--no-ext-diff", "-U0",
         "--diff-merges=first-parent", commit, "--", path],
        capture_output=True, text=True, check=False, cwd=cwd,
    )
    removed, added = [], []
    in_hunk = False
    for line in result.stdout.splitlines():
        if line.startswith("@@"):
            in_hunk = True
        elif not in_hunk:
            continue  # "diff --git", "index", "---" and "+++" headers
        elif line.startswith("-"):
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append(line[1:])
    return removed, added


def is_stamp_only_change(commit, path, cwd=None):
    """True when a commit changed nothing in `path` but ?v= asset stamps.

    tools/stamp_assets.py rewrites the stamp in every page whenever styles.css
    or a script changes, so without this every page's sitemap lastmod would
    reset on each CSS tweak, telling crawlers that pages changed when their
    content did not. An empty diff (a mode change, say) is counted as a real
    change rather than guessed at.
    """
    removed, added = _changed_lines(commit, path, cwd)
    if not removed and not added:
        return False
    return sorted(map(_without_stamps, removed)) == sorted(map(_without_stamps, added))


def git_last_modified(path, cwd=None):
    """Date of the last commit that changed `path` for a reason other than a stamp."""
    result = subprocess.run(
        ["git", "log", "--format=%H %cs", "--", path],
        capture_output=True, text=True, check=False, cwd=cwd,
    )
    history = [line.split(" ", 1) for line in result.stdout.splitlines() if line.strip()]
    for commit, date in history:
        if not is_stamp_only_change(commit, path, cwd):
            return date
    if history:
        # Every commit was stamp-only, which cannot happen for a file git ever
        # added; fall back to the newest one rather than inventing a date.
        return history[0][1]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def build_feed(articles):
    items = []
    for a in articles:
        items.append(
            "    <item>\n"
            f"      <title>{escape(a['title'])}</title>\n"
            f"      <link>{escape(a['url'])}</link>\n"
            f"      <guid isPermaLink=\"true\">{escape(a['url'])}</guid>\n"
            f"      <description>{escape(a['description'])}</description>\n"
            f"      <dc:creator>{escape(a['author'])}</dc:creator>\n"
            f"      <pubDate>{to_rfc822(a['published'])}</pubDate>\n"
            "    </item>"
        )
    built = to_rfc822(articles[0]["modified"]) if articles else to_rfc822(
        datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        "  <channel>\n"
        f"    <title>{escape(FEED_TITLE)}</title>\n"
        f"    <link>{SITE}/articles</link>\n"
        f"    <description>{escape(FEED_DESCRIPTION)}</description>\n"
        "    <language>en-us</language>\n"
        f"    <lastBuildDate>{built}</lastBuildDate>\n"
        f'    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml" />\n'
        + "\n".join(items) + "\n"
        "  </channel>\n"
        "</rss>\n"
    )


def root_pages():
    """Discover indexable top-level pages from disk, so a new page needs no edit here."""
    pages = []
    for path in sorted(glob.glob("*.html")):
        if path in SITEMAP_EXCLUDE:
            continue
        if NOINDEX.search(open(path, encoding="utf-8").read()):
            continue
        slug = "" if path == "index.html" else path[: -len(".html")]
        pages.append((f"{SITE}/{slug}" if slug else f"{SITE}/", path))
    # Homepage first, then alphabetical. Order carries no ranking weight.
    pages.sort(key=lambda page: (page[1] != "index.html", page[1]))
    return pages


def build_sitemap(articles):
    rows = [(loc, git_last_modified(path)) for loc, path in root_pages()]
    for a in articles:
        rows.append((a["url"], a["modified"]))

    body = "\n".join(
        f"  <url><loc>{escape(loc)}</loc><lastmod>{lastmod}</lastmod></url>"
        for loc, lastmod in rows
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )


def main():
    articles = collect_articles()
    if not articles:
        print("No articles found. Refusing to write an empty feed.", file=sys.stderr)
        return 1

    # Render both documents before opening anything for writing: opening a file
    # for write truncates it, and these builders read from the tree they describe.
    feed = build_feed(articles)
    sitemap = build_sitemap(articles)
    open("feed.xml", "w", encoding="utf-8").write(feed)
    open("sitemap.xml", "w", encoding="utf-8").write(sitemap)
    print(f"feed.xml     {len(articles)} items")
    print("sitemap.xml  written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
