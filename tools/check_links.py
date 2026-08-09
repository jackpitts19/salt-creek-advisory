#!/usr/bin/env python3
"""Check every external citation on the site for rot.

Run from the repository root, or weekly in CI:

    python3 tools/check_links.py

check_site.py deliberately stops at the domain boundary, and says so in its own
docstring. url-scheme.md says it too: "check_site.py cannot catch that, because
it does not follow external links." That gap had already cost something by the
time anyone looked. The Kaseya State of the MSP citation on msp-ma-advisor.html
was returning 404, sitting in the Sources line directly beneath four statistics,
on a page whose entire job is convincing an MSP owner the numbers are real. The
report had not been withdrawn. It had moved, and nothing here noticed.

Two hundred and fifty-nine external links across forty-nine pages is past what
anyone re-reads. The failure is silent by construction: the page still renders,
the checker still passes, and the only person who finds out is a prospect
checking your homework.

The hard part is not fetching URLs. It is not crying wolf.

A first pass reported 33 failures. Thirty were healthy pages that turn robots
away, and shipping that list would have trained everyone to ignore the job
inside a month:

  - SEC.gov 403s any request without a declared contact in the User-Agent, per
    its published access policy, and returns 200 the moment you supply one.
    Fourteen EDGAR filings looked dead and were not.
  - LinkedIn answers bots with 999, a status code it invented for the purpose.
  - Rate limiters answer 429, which means ask me later, not I am gone.
  - <link rel="preconnect"> hrefs are origins to warm, not pages. Fetching
    fonts.gstatic.com is supposed to fail.

So the classifier carries this script, not the fetcher. Only 404, 410, and a
host that no longer resolves count as DEAD and fail the run. Everything else
that is not a success is BLOCKED: printed, never fatal. A weekly job that fails
on LinkedIn every Monday is a job someone turns off.

Requests go out with a browser User-Agent first, then retry once with a
declared contact, which is what SEC.gov and other well-behaved gatekeepers ask
for. Both attempts are cheap and the retry only fires on a refusal.

Stdlib only, no build step, no dependencies.

Exits 1 if any link is DEAD, 0 otherwise. Blocked links never fail the run.
"""
import glob
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from html import unescape
from typing import List, Optional

SITE_HOST = "saltcreekadvisory.com"

OK = "ok"
DEAD = "dead"
BLOCKED = "blocked"

ERR_DNS = "dns"
ERR_TIMEOUT = "timeout"
ERR_OTHER = "other"

# Gone, and saying so. Everything else that fails is a door held shut.
DEAD_STATUSES = frozenset({404, 410})

# Sent first, because most of the web assumes a browser.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
# Sent on a refusal. SEC.gov's access policy asks for a declared contact and
# serves 200 to anyone who provides one.
DECLARED_UA = (
    "SaltCreekAdvisory-LinkCheck/1.0 "
    "(+https://saltcreekadvisory.com; jack@saltcreekadvisory.com)"
)
RETRY_WITH_DECLARED_UA = frozenset({401, 403, 405, 406})

DEFAULT_TIMEOUT = 25
DEFAULT_WORKERS = 12

# A <link> whose rel is one of these names an origin to open a socket to, not a
# document to fetch. Checking them produces guaranteed, meaningless failures.
ORIGIN_HINT_RELS = frozenset({"preconnect", "dns-prefetch"})

LINK_TAG = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
REL_ATTR = re.compile(r'\brel="([^"]*)"', re.IGNORECASE)
URL_ATTR = re.compile(r'(?:href|src)="([^"]*)"', re.IGNORECASE)


@dataclass
class Finding:
    """One URL, every page that cites it, and why it was flagged."""

    url: str
    status: Optional[int]
    error: Optional[str]
    pages: List[str] = field(default_factory=list)

    def reason(self):
        if self.status is not None:
            return "HTTP {}".format(self.status)
        return {ERR_DNS: "host does not resolve", ERR_TIMEOUT: "timed out"}.get(
            self.error, "connection failed"
        )


@dataclass
class Report:
    checked: int = 0
    dead: List[Finding] = field(default_factory=list)
    blocked: List[Finding] = field(default_factory=list)

    @property
    def exit_code(self):
        return 1 if self.dead else 0


def _strip_origin_hints(html):
    """Drop <link rel="preconnect"> and friends before any URL is extracted."""

    def replace(match):
        tag = match.group(0)
        rel = REL_ATTR.search(tag)
        if rel and rel.group(1).strip().lower() in ORIGIN_HINT_RELS:
            return ""
        return tag

    return LINK_TAG.sub(replace, html)


def extract_external(html):
    """Every off-site URL this page actually asks a browser to fetch.

    Sorted and deduplicated, because one source cited in five guides is one
    thing to check and one thing to fix, not five.
    """
    found = set()
    for raw in URL_ATTR.findall(_strip_origin_hints(html)):
        # Markup escapes the query separator. Requesting "?a=1&amp;b=2"
        # literally is how a live EDGAR query 404s for no reason.
        url = unescape(raw).strip()
        if not url.lower().startswith(("http://", "https://")):
            continue
        parts = url.split("/")
        host = parts[2].lower() if len(parts) > 2 else ""
        if host == SITE_HOST or host.endswith("." + SITE_HOST):
            continue
        found.add(url)
    return sorted(found)


def classify(status, error):
    """Decide whether a non-200 means gone, or merely means go away.

    Erring toward BLOCKED is deliberate. A false DEAD sends someone editing a
    page that was fine; a false BLOCKED costs one line of weekly output.
    """
    if status is not None:
        if 200 <= status < 400:
            return OK
        if status in DEAD_STATUSES:
            return DEAD
        return BLOCKED
    if error == ERR_DNS:
        return DEAD
    return BLOCKED


def _attempt(url, user_agent, timeout):
    """One request. Returns (status, error) with exactly one of them set."""
    request = urllib.request.Request(
        url, headers={"User-Agent": user_agent, "Accept": "*/*"}, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(2048)  # enough to confirm a body, cheap enough to discard
            return response.status, None
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.gaierror):
            return None, ERR_DNS
        if isinstance(exc.reason, socket.timeout):
            return None, ERR_TIMEOUT
        return None, ERR_OTHER
    except socket.timeout:
        return None, ERR_TIMEOUT
    except Exception:
        # A malformed URL or an exotic TLS failure is worth reporting, never
        # worth crashing a run that still has two hundred links to check.
        return None, ERR_OTHER


def fetch(url, timeout=DEFAULT_TIMEOUT):
    """Browser first, then a declared contact if the door was held shut."""
    status, error = _attempt(url, BROWSER_UA, timeout)
    if status in RETRY_WITH_DECLARED_UA:
        retry_status, retry_error = _attempt(url, DECLARED_UA, timeout)
        if retry_status is not None and 200 <= retry_status < 400:
            return retry_status, None
        if retry_status is not None:
            return retry_status, retry_error
    return status, error


def collect(root):
    """Map every external URL to the pages citing it, in page order."""
    pages = sorted(
        glob.glob(os.path.join(root, "*.html"))
        + glob.glob(os.path.join(root, "articles", "*.html"))
    )
    citations = OrderedDict()
    for path in pages:
        with open(path, encoding="utf-8") as handle:
            html = handle.read()
        relative = os.path.relpath(path, root)
        for url in extract_external(html):
            citations.setdefault(url, []).append(relative)
    return citations


def run(root, fetch=fetch, workers=DEFAULT_WORKERS):
    """Check every citation once, however many pages carry it."""
    citations = collect(root)
    report = Report(checked=len(citations))
    if not citations:
        return report

    urls = list(citations)
    with ThreadPoolExecutor(max_workers=min(workers, len(urls))) as pool:
        results = list(pool.map(fetch, urls))

    for url, (status, error) in zip(urls, results):
        verdict = classify(status, error)
        if verdict == OK:
            continue
        finding = Finding(url=url, status=status, error=error, pages=citations[url])
        (report.dead if verdict == DEAD else report.blocked).append(finding)
    return report


def main():
    root = os.getcwd()
    if not os.path.isdir(os.path.join(root, "articles")):
        print("No articles/ directory. Run this from the repository root.", file=sys.stderr)
        return 1

    report = run(root)

    for finding in report.blocked:
        print("  note  {}  {}".format(finding.reason().ljust(24), finding.url))
    if report.blocked:
        print("        (blocked, not broken: these refuse robots and work in a browser)")
        print("")

    for finding in report.dead:
        print("  DEAD  {}  {}".format(finding.reason().ljust(24), finding.url))
        for page in finding.pages:
            print("        cited by {}".format(page))

    print("")
    print(
        "{} external links checked, {} dead, {} blocked".format(
            report.checked, len(report.dead), len(report.blocked)
        )
    )
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
