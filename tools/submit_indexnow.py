#!/usr/bin/env python3
"""Tell Bing, Yandex and the other IndexNow participants that a URL changed.

Run from the repository root after deploying new or edited pages:

    python3 tools/submit_indexnow.py /midwest-ma-advisor
    python3 tools/submit_indexnow.py --all --dry-run
    python3 tools/submit_indexnow.py --all

The ownership key has been hosted at the site root all along and the content
round design called for pings, but nothing ever sent one. Without this, a new
page waits to be found by an organic crawl. With it, the participating engines
hear about it within seconds of a deploy.

Nothing in the repository changes. This reads the key file and sitemap.xml and
makes one HTTPS request. Google does not participate in IndexNow, so this sits
alongside Search Console rather than replacing it.

Stdlib only, no build step, no dependencies.
"""
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

SITE = "https://saltcreekadvisory.com"
HOST = urlparse(SITE).hostname

ENDPOINT = "https://api.indexnow.org/indexnow"

# The published ceiling for one IndexNow request. This site is nowhere near it,
# so passing it means something assembled the list wrong.
MAX_URLS = 10000

# An IndexNow key is 8 to 128 hexadecimal characters. Matching that shape is
# what keeps robots.txt and llms.txt from being read as key files.
KEY_PATTERN = re.compile(r"^[0-9a-f]{8,128}$", re.IGNORECASE)

SITEMAP_LOC = re.compile(r"<loc>(.*?)</loc>", re.DOTALL)

TIMEOUT_SECONDS = 30


class IndexNowError(Exception):
    """Something is wrong with the key, the URL list, or the submission."""


def find_key():
    """The ownership key, from the <key>.txt file hosted at the site root.

    IndexNow verifies a submission by fetching that file and checking it holds
    the same key it was handed. Requiring the name and the contents to agree
    here turns a silent verification failure into a loud local one.
    """
    candidates = []
    for path in sorted(glob.glob("*.txt")):
        stem = os.path.splitext(os.path.basename(path))[0]
        if KEY_PATTERN.match(stem):
            candidates.append((path, stem))

    if not candidates:
        raise IndexNowError(
            "no IndexNow key file in the site root. Expected a file named "
            "<key>.txt whose contents are that same key.")
    if len(candidates) > 1:
        raise IndexNowError("more than one file looks like an IndexNow key: {}".format(
            ", ".join(path for path, _ in candidates)))

    path, stem = candidates[0]
    try:
        with open(path, encoding="utf-8") as handle:
            body = handle.read().strip()
    except (OSError, UnicodeDecodeError) as err:
        raise IndexNowError("could not read {}: {}".format(path, err))
    if body != stem:
        raise IndexNowError(
            "{} has to contain exactly its own name, '{}', but contains '{}'. "
            "IndexNow would reject the submission.".format(path, stem, body))
    return stem


def require_site_root():
    """Refuse to trust a key file found somewhere that is not the site root.

    A stray hex-named .txt in an unrelated directory looks exactly like a key,
    and find_key cannot tell the difference. Without this the tool reports
    success while submitting whatever it happened to find next to it. Nothing
    unsafe results, since the host is a hardcoded constant, but reporting
    success for work that did not happen is its own kind of failure.
    """
    if not os.path.exists("sitemap.xml"):
        raise IndexNowError("sitemap.xml is missing. Run this from the repository root.")


def sitemap_urls():
    """Every URL in sitemap.xml, in the order it lists them."""
    require_site_root()
    try:
        with open("sitemap.xml", encoding="utf-8") as handle:
            urls = [loc.strip() for loc in SITEMAP_LOC.findall(handle.read())]
    except (OSError, UnicodeDecodeError) as err:
        raise IndexNowError("could not read sitemap.xml: {}".format(err))
    if not urls:
        raise IndexNowError("sitemap.xml lists no URLs.")
    return urls


def absolute(url):
    """Accept a bare route as shorthand for a URL on this site."""
    return SITE + url if url.startswith("/") else url


def validated(urls):
    """The URLs unchanged, or an error naming the first one that is not ours.

    IndexNow rejects an entire request when any URL belongs to another host, so
    one stray link costs the whole submission rather than only itself.
    """
    if not urls:
        raise IndexNowError("no URLs to submit.")
    if len(urls) > MAX_URLS:
        raise IndexNowError("{} URLs is past the {} a single request accepts.".format(
            len(urls), MAX_URLS))
    for url in urls:
        parsed = urlparse(url)
        # The host check alone is not enough. urlparse reads a host off
        # "//host/path" quite happily, which would submit a URL that is not
        # absolute, and the Worker 301s http to https, so announcing an http
        # URL points the engines at a redirect rather than at the page.
        if parsed.scheme != "https":
            raise IndexNowError(
                "'{}' is not an https URL. The site is https only and the "
                "engines fetch exactly what they are given.".format(url))
        if parsed.hostname != HOST:
            raise IndexNowError(
                "'{}' is not on {}. IndexNow would reject the whole "
                "submission.".format(url, HOST))
    return urls


def build_payload(key, urls):
    return {
        "host": HOST,
        "key": key,
        "keyLocation": "{}/{}.txt".format(SITE, key),
        "urlList": urls,
    }


def post(payload):
    """POST the payload. The only function here that touches the network.

    200 means the list was accepted. 202 means it was accepted but the key has
    not been verified yet. Both mean the submission landed.
    """
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace").strip() or err.reason
        raise IndexNowError("IndexNow refused the submission: {} {}".format(err.code, detail))
    except urllib.error.URLError as err:
        raise IndexNowError("could not reach IndexNow: {}".format(err.reason))


def main(argv=None, submit=post):
    # `submit` defaults to the post function object captured at def time, not to
    # the module attribute. Patching submit_indexnow.post will therefore not
    # take effect here. Tests should pass submit= explicitly, which is the whole
    # reason the seam exists.
    argv = list(sys.argv[1:] if argv is None else argv)

    dry_run = "--dry-run" in argv
    use_sitemap = "--all" in argv
    targets = [arg for arg in argv if arg not in ("--dry-run", "--all")]

    try:
        if use_sitemap and targets:
            raise IndexNowError("pass either --all or explicit URLs, not both.")
        if not use_sitemap and not targets:
            raise IndexNowError(
                "nothing to submit. Pass one or more URLs, or --all to submit "
                "every URL in sitemap.xml.")

        # Before find_key, and on both paths: the explicit-URL path never reads
        # the sitemap, so without this it would happily trust a stray key file.
        require_site_root()
        key = find_key()
        urls = validated(sitemap_urls() if use_sitemap else [absolute(t) for t in targets])
        payload = build_payload(key, urls)
        plural = "" if len(urls) == 1 else "s"

        if dry_run:
            print("dry run, nothing submitted. Would send {} URL{} to {}:".format(
                len(urls), plural, ENDPOINT))
            for url in urls:
                print("  " + url)
            return 0

        status = submit(payload)
        suffix = " (HTTP {})".format(status) if status else ""
        print("submitted {} URL{} to IndexNow{}".format(len(urls), plural, suffix))
        return 0
    except IndexNowError as err:
        print("IndexNow: {}".format(err), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
