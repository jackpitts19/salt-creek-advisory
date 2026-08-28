#!/usr/bin/env python3
"""Check the site for the kinds of drift that keep recurring.

Run from the repository root before committing:

    python3 tools/check_site.py
    python3 tools/check_site.py --strict-year   # scheduled rollover job only

Every check here stands for a bug that has already shipped at least once:
orphaned articles, canonicals left pointing at the page they were duplicated
off, JSON-LD corrupted by a find-and-replace, sitemap entries naming files that
no longer exist. Forty-five hand-maintained pages is more than anyone can hold
in their head, and none of this is visible until a crawler finds it.

Read only: it changes nothing, it just refuses to stay quiet. Stdlib only, no
build step, no dependencies.

Exits 1 if any error is found, 0 otherwise. Warnings never fail the run, with
one opt-in exception: --strict-year promotes the stale-guide-year warning to an
error, so the scheduled rollover job can raise an issue about it. Nothing that
gates a push passes that flag.
"""
import datetime
import glob
import json
import os
import re
import sys
# Imported by name: every check function takes a parameter called `html`, which
# would shadow the module inside exactly the places that need it.
from html import unescape
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


def rendered_length(source):
    """How long a head tag reads once the browser has decoded it.

    Measuring the source counts "&amp;" as five characters where a SERP shows
    one, which is how two perfectly good titles came to be flagged as too long.
    The tempting fix for a false warning is to damage a title that was fine.
    """
    return len(unescape(source.strip()))


def check_head_tags(path, html, errors, warnings):
    title = TITLE.search(html)
    if not title or not title.group(1).strip():
        errors.append("{}: missing <title>".format(path))
    elif rendered_length(title.group(1)) > MAX_TITLE_CHARS:
        warnings.append("{}: title is {} chars, Google truncates past {}".format(
            path, rendered_length(title.group(1)), MAX_TITLE_CHARS))

    description = DESCRIPTION.search(html)
    if not description or not description.group(1).strip():
        errors.append("{}: missing meta description".format(path))
    elif rendered_length(description.group(1)) > MAX_DESCRIPTION_CHARS:
        warnings.append("{}: meta description is {} chars, past {}".format(
            path, rendered_length(description.group(1)), MAX_DESCRIPTION_CHARS))


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


# Fields Google requires before it will treat a node as eligible for a rich
# result. Parsing is not validating: three Dataset citations shipped without a
# description and Search Console reported them as invalid, while check_json_ld
# passed them happily because the JSON was well-formed. Add a row here whenever
# a new @type appears in the markup.
REQUIRED_SCHEMA_FIELDS = {
    "Dataset": ("name", "description"),
}


def iter_nodes(node):
    """Every dict in a JSON-LD document, however deeply nested."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from iter_nodes(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_nodes(value)


def check_schema_required_fields(path, html, errors, _warnings):
    """A node missing a required field is invalid, not merely incomplete."""
    for raw in JSON_LD.findall(html):
        try:
            document = json.loads(raw)
        except json.JSONDecodeError:
            continue  # check_json_ld already reported this
        for node in iter_nodes(document):
            required = REQUIRED_SCHEMA_FIELDS.get(node.get("@type"))
            if not required:
                continue
            missing = [field for field in required if not node.get(field)]
            if missing:
                errors.append("{}: {} node '{}' is missing {}, so Google reports it "
                              "as invalid".format(path, node["@type"],
                                                  node.get("name", "unnamed")[:60],
                                                  ", ".join(missing)))


PAGE_CHECKS = (
    check_internal_links,
    check_head_tags,
    check_canonical,
    check_json_ld,
    check_schema_required_fields,
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


WORKER_PATH = os.path.join("src", "index.js")
WORKER_YEAR = re.compile(r'const CURRENT_GUIDE_YEAR = "(\d{4})"')
WORKER_GUIDE_SET = re.compile(r"const YEAR_STAMPED_GUIDES = new Set\(\[(.*?)\]\)", re.DOTALL)
WORKER_SLUG = re.compile(r'"([a-z0-9-]+)"')

LLMS_PATH = "llms.txt"
RELATED_PATH = os.path.join("tools", "build_related.py")
RELATED_MAP = re.compile(r"RELATED\s*=\s*\{(.*?)\n\}", re.DOTALL)
RELATED_ENTRY = re.compile(r'"([a-z0-9\-/]+)":\s*\[(.*?)\]', re.DOTALL)
RELATED_SLUG = re.compile(r'"([a-z0-9\-/]+)"')


def check_guide_year_is_current(errors, warnings, strict=False):
    """Say something when the guides are advertising last year.

    Everything else here checks internal consistency, which stays perfectly
    consistent while the whole site quietly goes stale: on the first of January
    the URLs and titles still say 2026, every test passes, and nothing points
    out that the one thing these slugs exist to signal is now wrong.

    A warning rather than an error on purpose. Refreshing the guides is
    editorial work with a real cost, and failing the build on New Year's Day
    would only teach someone to ignore the check.

    Which leaves the opposite problem: a warning printed inside a green build is
    a warning nobody reads. `strict` promotes it to an error, and only the
    scheduled rollover job passes it. That job blocks no one, so it is free to
    be loud; it turns the stale year into a tracking issue the way the weekly
    link check does for dead citations. Pushes keep the quiet warning.
    """
    if not os.path.exists(WORKER_PATH):
        return
    found = WORKER_YEAR.search(read(WORKER_PATH))
    if not found:
        return
    declared = int(found.group(1))
    now = datetime.date.today().year
    if declared < now:
        message = (
            "{}: CURRENT_GUIDE_YEAR is {} but it is now {}. Guide URLs and titles "
            "still say {}; refresh the content and roll the year.".format(
                WORKER_PATH, declared, now, declared))
        (errors if strict else warnings).append(message)
    elif declared > now:
        warnings.append(
            "{}: CURRENT_GUIDE_YEAR is {}, ahead of the current year {}".format(
                WORKER_PATH, declared, now))


def check_worker_slugs(errors, _warnings):
    """The Worker's guide list has to match the year-stamped files on disk.

    Guide URLs carry the year, so the Worker is the only thing turning an old
    inbound link into the current page. Drift is silent in both directions and
    both directions hurt: a slug listed there with no file behind it redirects
    visitors into a 404, and a year-stamped file missing from the list leaves
    its pre-rename URL dead. Neither surfaces until a crawler finds it.

    Skipped when src/index.js is absent, so the checker still runs against a
    plain directory of HTML.
    """
    if not os.path.exists(WORKER_PATH):
        return
    source = read(WORKER_PATH)
    year = WORKER_YEAR.search(source)
    declared_block = WORKER_GUIDE_SET.search(source)
    if not year or not declared_block:
        errors.append(
            "{}: could not find CURRENT_GUIDE_YEAR and YEAR_STAMPED_GUIDES, so "
            "year-stamped guide URLs cannot be verified".format(WORKER_PATH))
        return

    suffix = "-" + year.group(1)
    declared = set(WORKER_SLUG.findall(declared_block.group(1)))
    stamped = {
        os.path.basename(path)[: -len(".html")][: -len(suffix)]
        for path in glob.glob("articles/*.html")
        if os.path.basename(path)[: -len(".html")].endswith(suffix)
    }

    for base in sorted(declared - stamped):
        errors.append(
            "{}: YEAR_STAMPED_GUIDES lists '{}' but articles/{}{}.html does not exist, "
            "so its old URL would redirect into a 404".format(WORKER_PATH, base, base, suffix))
    for base in sorted(stamped - declared):
        errors.append(
            "articles/{}{}.html is year-stamped but '{}' is missing from YEAR_STAMPED_GUIDES "
            "in {}, so its pre-rename URL is dead".format(base, suffix, base, WORKER_PATH))


def check_llms_txt_coverage(errors, _warnings):
    """Every article has to appear in llms.txt, in both directions.

    llms.txt is how an answer engine learns what this site actually covers, so a
    guide missing from it is invisible to exactly the surface the firm is trying
    to win. Nothing else notices: the page renders, the sitemap lists it, every
    other check passes, and the only symptom is an assistant that has never heard
    of it. That is step 6 of the publish checklist in docs/url-scheme.md, and it
    is the step that actually got skipped when the dental guide shipped, which is
    why it is enforced here rather than trusted to a list.

    The reverse direction matters too: an entry describing a page that no longer
    exists teaches an assistant to cite a 404.

    Skipped when llms.txt is absent, so the checker still runs against a plain
    directory of HTML.
    """
    if not os.path.exists(LLMS_PATH):
        return
    listed = read(LLMS_PATH)
    for path in sorted(glob.glob("articles/*.html")):
        route = route_for(path)
        if "{}{}".format(SITE, route) not in listed:
            errors.append(
                "{} is not listed in {}, so answer engines have no summary of it "
                "(publish checklist step 6)".format(path, LLMS_PATH))

    for url in sorted(set(re.findall(r"https://saltcreekadvisory\.com/articles/[a-z0-9-]+", listed))):
        if not os.path.exists(file_for(url[len(SITE):])):
            errors.append(
                "{}: lists {}, which no longer exists, so an assistant citing it "
                "would send a reader to a 404".format(LLMS_PATH, url))


def check_related_symmetry(errors, _warnings):
    """Every guide needs a Keep Reading block AND inbound links from other blocks.

    The RELATED map in tools/build_related.py is the site's internal linking, so
    a guide that is a key but never a target gets a Keep Reading block of its own
    while nothing links back to it. It is not orphaned in the sitemap sense that
    check_orphans catches, because its card on articles.html still counts, so it
    passes every other check while sitting at one inbound link against three to
    eight for its peers. That is a page telling search engines it does not matter.

    This is exactly what happened to the dental guide: added as a key, never as a
    target, and nothing said so. Both halves of publish checklist step 5 are
    checked here, plus that every target resolves to something real.

    Skipped when tools/build_related.py is absent.
    """
    if not os.path.exists(RELATED_PATH):
        return
    block = RELATED_MAP.search(read(RELATED_PATH))
    if not block:
        errors.append(
            "{}: could not find the RELATED map, so internal linking cannot be "
            "verified".format(RELATED_PATH))
        return

    targets_by_key = {}
    for key, body in RELATED_ENTRY.findall(block.group(1)):
        targets_by_key[key] = RELATED_SLUG.findall(body)
    referenced = {t for targets in targets_by_key.values() for t in targets}

    on_disk = {
        os.path.basename(path)[: -len(".html")]
        for path in glob.glob("articles/*.html")
    }
    suffix_year = WORKER_YEAR.search(read(WORKER_PATH)) if os.path.exists(WORKER_PATH) else None
    suffix = "-" + suffix_year.group(1) if suffix_year else ""

    def base_of(slug):
        return slug[: -len(suffix)] if suffix and slug.endswith(suffix) else slug

    bases = {base_of(slug) for slug in on_disk}
    # Which bases actually carry the year on disk, derived rather than listed, so
    # the four year-free essays stay bare without being enumerated a second time.
    # build_related.py's own stamp() does exactly this; assuming the suffix here
    # instead would report every essay as a broken target.
    stamped_bases = {base_of(slug) for slug in on_disk if suffix and slug.endswith(suffix)}

    for base in sorted(bases - set(targets_by_key)):
        errors.append(
            "'{}' has no entry in the RELATED map in {}, so it renders no Keep "
            "Reading block (publish checklist step 5)".format(base, RELATED_PATH))
    for base in sorted(set(targets_by_key) - bases):
        errors.append(
            "{}: RELATED has an entry for '{}' but no article on disk matches "
            "it".format(RELATED_PATH, base))
    for base in sorted(set(targets_by_key) - referenced):
        errors.append(
            "'{}' is a RELATED key in {} but no other guide lists it as a target, "
            "so nothing links to it (publish checklist step 5)".format(base, RELATED_PATH))
    for target in sorted(referenced):
        if target.startswith("/"):
            route = target
        else:
            route = "/articles/" + target + (suffix if target in stamped_bases else "")
        if not os.path.exists(file_for(route)):
            errors.append(
                "{}: RELATED points at '{}', which resolves to {}, which does not "
                "exist".format(RELATED_PATH, target, route))


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    strict_year = "--strict-year" in argv

    paths = page_paths()
    if not paths:
        print("No HTML pages found. Run this from the repository root.", file=sys.stderr)
        return 1

    errors = []
    warnings = []
    for path in paths:
        html = read(path)
        for check in PAGE_CHECKS:
            check(path, html, errors, warnings)
    check_sitemap(errors, warnings)
    check_orphans(errors, warnings)
    check_worker_slugs(errors, warnings)
    check_llms_txt_coverage(errors, warnings)
    check_related_symmetry(errors, warnings)
    check_guide_year_is_current(errors, warnings, strict=strict_year)

    for warning in warnings:
        print("  warn  {}".format(warning))
    for error in errors:
        print("  FAIL  {}".format(error), file=sys.stderr)

    print("\n{} pages checked, {} errors, {} warnings".format(
        len(paths), len(errors), len(warnings)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
