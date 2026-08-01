#!/usr/bin/env python3
"""Check the site for the kinds of drift that keep recurring.

Run from the repository root before committing:

    python3 tools/check_site.py

Every check here stands for a bug that has already shipped at least once:
orphaned articles, canonicals left pointing at the page they were duplicated
off, JSON-LD corrupted by a find-and-replace, sitemap entries naming files that
no longer exist. Forty-five hand-maintained pages is more than anyone can hold
in their head, and none of this is visible until a crawler finds it.

Read only: it changes nothing, it just refuses to stay quiet. Stdlib only, no
build step, no dependencies.

Exits 1 if any error is found, 0 otherwise. Warnings never fail the run.
"""
import glob
import json
import os
import re
import sys
from urllib.parse import urljoin, urlparse

SITE = "https://saltcreekadvisory.com"

JSON_LD = re.compile(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', re.DOTALL)
NOINDEX = re.compile(r'<meta name="robots"[^>]*noindex', re.IGNORECASE)
TITLE = re.compile(r"<title>(.*?)</title>", re.DOTALL | re.IGNORECASE)
DESCRIPTION = re.compile(r'<meta name="description" content="(.*?)"', re.DOTALL | re.IGNORECASE)
CANONICAL = re.compile(r'<link rel="canonical" href="(.*?)"', re.IGNORECASE)
LINK_ATTR = re.compile(r'(?:href|src)="([^"]*)"', re.IGNORECASE)
IMG_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
SITEMAP_LOC = re.compile(r"<loc>(.*?)</loc>", re.DOTALL)

# Mirrors tools/build_feed.py deliberately rather than importing it: the point of
# this script is to verify that generator's output independently.
SITEMAP_EXCLUDE = {"404.html"}

# Paths served as-is. Anything else is a clean, extensionless route that the
# Worker maps onto a .html file (see normalizePathname in src/index.js).
FILE_EXTENSIONS = {
    ".pdf", ".xml", ".txt", ".json", ".ico", ".css", ".js",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif",
    ".woff", ".woff2", ".ttf", ".otf",
}

# Google truncates SERP titles past roughly this width. Warnings, not errors.
MAX_TITLE_CHARS = 60
MAX_DESCRIPTION_CHARS = 160


def page_paths():
    """Every HTML page in the site, repo-relative."""
    return sorted(glob.glob("*.html") + glob.glob("articles/*.html"))


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def route_for(path):
    """The public URL path a source file is served at."""
    if path == "index.html":
        return "/"
    return "/" + path[: -len(".html")]


def file_for(route):
    """The source file a URL path resolves to."""
    relative = route.lstrip("/")
    if relative == "":
        return "index.html"
    if os.path.splitext(relative)[1].lower() in FILE_EXTENSIONS:
        return relative
    return relative + ".html"


def is_internal(href):
    """True for links this repo is responsible for resolving."""
    if not href or href.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return False
    return not urlparse(href).scheme


def check_internal_links(path, html, errors, _warnings):
    base = urljoin(SITE, route_for(path))
    for href in LINK_ATTR.findall(html):
        if not is_internal(href):
            continue
        route = urlparse(urljoin(base, href)).path
        target = file_for(route)
        if not os.path.exists(target):
            errors.append("{}: link '{}' resolves to {}, which does not exist".format(
                path, href, target))


def check_head_tags(path, html, errors, warnings):
    title = TITLE.search(html)
    if not title or not title.group(1).strip():
        errors.append("{}: missing <title>".format(path))
    elif len(title.group(1).strip()) > MAX_TITLE_CHARS:
        warnings.append("{}: title is {} chars, Google truncates past {}".format(
            path, len(title.group(1).strip()), MAX_TITLE_CHARS))

    description = DESCRIPTION.search(html)
    if not description or not description.group(1).strip():
        errors.append("{}: missing meta description".format(path))
    elif len(description.group(1).strip()) > MAX_DESCRIPTION_CHARS:
        warnings.append("{}: meta description is {} chars, past {}".format(
            path, len(description.group(1).strip()), MAX_DESCRIPTION_CHARS))


def check_canonical(path, html, errors, _warnings):
    """A canonical pointing at another page de-indexes this one. It has happened."""
    found = CANONICAL.search(html)
    if not found:
        # A noindex page has no canonical URL to declare, and 404.html has no URL
        # at all. Only demand one from pages that are meant to rank.
        if not NOINDEX.search(html):
            errors.append("{}: missing canonical".format(path))
        return
    expected = SITE + route_for(path)
    actual = found.group(1).strip()
    if actual.rstrip("/") != expected.rstrip("/"):
        errors.append("{}: canonical is '{}', expected '{}'".format(path, actual, expected))


def check_json_ld(path, html, errors, _warnings):
    for index, raw in enumerate(JSON_LD.findall(html), start=1):
        if not raw.strip():
            errors.append("{}: JSON-LD block {} is empty".format(path, index))
            continue
        try:
            json.loads(raw)
        except json.JSONDecodeError as err:
            errors.append("{}: JSON-LD block {} does not parse ({})".format(path, index, err))


def check_images(path, html, errors, _warnings):
    for tag in IMG_TAG.findall(html):
        if "alt=" not in tag.lower():
            errors.append("{}: <img> without alt: {}".format(path, tag[:80]))


PAGE_CHECKS = (
    check_internal_links,
    check_head_tags,
    check_canonical,
    check_json_ld,
    check_images,
)


def indexable_routes():
    """Routes that should appear in the sitemap, discovered from disk."""
    routes = set()
    for path in page_paths():
        if path in SITEMAP_EXCLUDE or NOINDEX.search(read(path)):
            continue
        routes.add(route_for(path))
    return routes


def check_sitemap(errors, warnings):
    if not os.path.exists("sitemap.xml"):
        errors.append("sitemap.xml is missing")
        return

    listed = set()
    for loc in SITEMAP_LOC.findall(read("sitemap.xml")):
        route = urlparse(loc.strip()).path or "/"
        listed.add(route if route == "/" else route.rstrip("/"))
        target = file_for(route)
        if not os.path.exists(target):
            errors.append("sitemap.xml: <loc>{}</loc> names {}, which does not exist".format(
                loc.strip(), target))

    expected = indexable_routes()
    for route in sorted(expected - listed):
        errors.append("sitemap.xml: {} is indexable but unlisted (orphan)".format(route))
    for route in sorted(listed - expected):
        warnings.append("sitemap.xml: {} is listed but is noindex or excluded".format(route))


def check_orphans(errors, _warnings):
    """A page no other page links to is reachable only by sitemap.

    Four articles shipped that way once. Google discovers such pages late, ranks
    them worse, and a reader browsing the site can never arrive at them at all.
    """
    linked_to = set()
    for path in page_paths():
        base = urljoin(SITE, route_for(path))
        own_route = route_for(path)
        for href in LINK_ATTR.findall(read(path)):
            if not is_internal(href):
                continue
            route = urlparse(urljoin(base, href)).path
            normalized = route if route == "/" else route.rstrip("/")
            if normalized != own_route:
                linked_to.add(normalized)

    # The homepage is the entry point, so nothing needs to link to it for it to be
    # found. Every page does anyway, through the nav logo.
    candidates = indexable_routes() - linked_to - {"/"}
    for route in sorted(candidates):
        errors.append("{} is indexable but no other page links to it (orphan)".format(route))


def main():
    paths = page_paths()
    if not paths:
        print("No HTML pages found — run this from the repository root.", file=sys.stderr)
        return 1

    errors = []
    warnings = []
    for path in paths:
        html = read(path)
        for check in PAGE_CHECKS:
            check(path, html, errors, warnings)
    check_sitemap(errors, warnings)
    check_orphans(errors, warnings)

    for warning in warnings:
        print("  warn  {}".format(warning))
    for error in errors:
        print("  FAIL  {}".format(error), file=sys.stderr)

    print("\n{} pages checked, {} errors, {} warnings".format(
        len(paths), len(errors), len(warnings)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
