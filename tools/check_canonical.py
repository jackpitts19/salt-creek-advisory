#!/usr/bin/env python3
"""Check that production actually serves one URL per page.

Run from the repository root, or weekly in CI:

    python3 tools/check_canonical.py
    python3 tools/check_canonical.py --sample 5     # a quick smoke run
    python3 tools/check_canonical.py --origin http://localhost:8787

Every other guard in tools/ is offline, and that is the gap this fills.
test_worker_redirects.mjs imports src/index.js and drives it in-process, so it
proves the Worker's logic is right. It cannot prove the Worker is reachable.
Those are different claims, and only the second one is what a crawler sees.
check_links.py does go out to the network, but line 155 skips our own host by
design, so it has never looked at a single saltcreekadvisory.com URL.

The failure this exists to catch has no diff and no red test. Detach the www
custom domain in the Cloudflare dashboard, let a deploy half-land, or move the
route, and src/index.js is still correct, all fourteen redirect tests still
pass, check_site.py still reports zero errors, and production quietly starts
serving the same article at two URLs. Nothing in the repository changed, so
nothing in the repository can notice.

That is not hypothetical framing. url-scheme.md already asks a human to curl a
few old URLs after every rename round, under a heading that admits "None of
this is automated and none of it is anyone's job by default." This is that
paragraph, automated, and run on a clock rather than on a memory.

What counts as a failure is deliberately narrow, for the reason check_links.py
spells out at length: a weekly job that cries wolf gets muted, and a muted job
is worse than no job because it looks like coverage. So a timeout, a reset, a
DNS blip or a 429 is BLOCKED and never fails the run. Only these fail:

  DUPLICATE   a non-canonical URL served 200 instead of redirecting. This is
              the split-signal failure itself, caught in the act.
  CHAIN       more than one hop. Every extra hop sheds a little of whatever
              authority the inbound link carried, and chains grow silently.
  TARGET      a 301 that lands somewhere other than the canonical URL.
  DEAD        a canonical URL that is not 200.
  TAG         a served page whose <link rel="canonical"> disagrees with the URL
              it was served at, which tells a crawler to index something else.

Stdlib only, no build step, no dependencies. Exits 1 if anything above fired,
0 otherwise.
"""
import argparse
import glob
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

APEX_ORIGIN = "https://saltcreekadvisory.com"
WWW_HOST = "www.saltcreekadvisory.com"

DEFAULT_TIMEOUT = 20
DEFAULT_WORKERS = 8
MAX_HOPS = 5

# Essays deliberately carry no year, so the year suffix is what separates a
# guide from an essay here. url-scheme.md: "A year on
# why-we-built-salt-creek-around-relationships reads as dated rather than
# current, which is the opposite of the point."
YEAR_RE = re.compile(r"-(20\d{2})$")

CANONICAL_TAG_RE = re.compile(
    r"""<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']""",
    re.IGNORECASE,
)
CANONICAL_TAG_REVERSED_RE = re.compile(
    r"""<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']""",
    re.IGNORECASE,
)

BLOCKED = "blocked"
DUPLICATE = "DUPLICATE"
CHAIN = "CHAIN"
TARGET = "TARGET"
DEAD = "DEAD"
TAG = "TAG"

CANONICAL = "canonical"

# A refusal is not a redirect bug. 429 means ask me later; a 403 from an edge
# WAF means it did not like our User-Agent. Neither says anything about
# canonical URLs, so neither is allowed to fail the run.
BLOCKED_STATUSES = (403, 429, 503)

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stop at every 3xx so the caller can count hops itself.

    urllib follows redirects transparently, which would collapse a three-hop
    chain and a single hop into the same observation. Counting hops is most of
    the point here, so redirects have to be walked by hand.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


@dataclass
class Hop:
    """One request in a redirect chain."""

    url: str
    status: Optional[int] = None
    location: Optional[str] = None
    body: Optional[str] = None
    error: Optional[str] = None


@dataclass
class Finding:
    verdict: str
    url: str
    detail: str

    def line(self) -> str:
        label = "  note     " if self.verdict == BLOCKED else "  " + self.verdict.ljust(9)
        return "{}{}\n             {}".format(label, self.url, self.detail)


@dataclass
class Report:
    checked: int = 0
    failures: List[Finding] = field(default_factory=list)
    blocked: List[Finding] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return 1 if self.failures else 0


def fetch(url: str, want_body: bool = False, timeout: int = DEFAULT_TIMEOUT) -> Hop:
    """One request, no redirect following, never raising.

    Returns a Hop carrying the status and Location. A network failure comes back
    as `error` rather than an exception, so a single flaky URL cannot abort a run
    that still has two hundred to check.
    """
    request = urllib.request.Request(
        url,
        method="GET" if want_body else "HEAD",
        headers={"User-Agent": BROWSER_UA, "Accept": "text/html,*/*"},
    )
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            body = response.read(200000).decode("utf-8", errors="replace") if want_body else None
            return Hop(url=url, status=response.status, body=body)
    except urllib.error.HTTPError as err:
        # A 3xx arrives here because _NoRedirect refused to follow it. Nothing
        # non-2xx has a body worth parsing, so none is read.
        return Hop(url=url, status=err.code, location=err.headers.get("Location"))
    except urllib.error.URLError as err:
        reason = getattr(err, "reason", err)
        kind = "timeout" if isinstance(reason, socket.timeout) else "unreachable"
        return Hop(url=url, error="{}: {}".format(kind, reason))
    except socket.timeout:
        return Hop(url=url, error="timeout")
    except Exception as err:  # noqa: BLE001 - a malformed URL must not kill the run
        return Hop(url=url, error="other: {}".format(err))


def follow(url: str, fetcher=fetch, max_hops: int = MAX_HOPS, want_body: bool = False) -> List[Hop]:
    """Walk a redirect chain by hand, returning every hop in order.

    The body is only ever requested for the terminal response: asking for one on
    a 301 downloads the redirect stub for nothing.
    """
    hops: List[Hop] = []
    current = url
    for _ in range(max_hops + 1):
        hop = fetcher(current, want_body=want_body)
        hops.append(hop)
        if hop.status is None or not (300 <= hop.status < 400) or not hop.location:
            return hops
        current = urllib.parse.urljoin(current, hop.location)
    return hops


def canonical_tag(html: str) -> Optional[str]:
    """The href of <link rel="canonical">, whichever order the attributes sit in."""
    match = CANONICAL_TAG_RE.search(html) or CANONICAL_TAG_REVERSED_RE.search(html)
    return match.group(1).strip() if match else None


def page_paths(root: str) -> Tuple[List[str], List[str]]:
    """Every published page on disk, split into year-stamped guides and the rest.

    Disk is the source of truth, the same choice check_site.py makes. Reading the
    list out of sitemap.xml instead would make this blind to exactly the page a
    broken generator dropped.
    """
    guides: List[str] = []
    others: List[str] = []
    for path in sorted(glob.glob(os.path.join(root, "articles", "*.html"))):
        slug = os.path.basename(path)[: -len(".html")]
        if YEAR_RE.search(slug):
            guides.append(slug)
        else:
            others.append("articles/" + slug)
    for path in sorted(glob.glob(os.path.join(root, "*.html"))):
        name = os.path.basename(path)[: -len(".html")]
        if name == "404":
            continue
        others.append("" if name == "index" else name)
    return guides, others


def variants(slug: str, origin: str) -> List[Tuple[str, str]]:
    """Every non-canonical form of a guide that must collapse onto one URL.

    These are the shapes an inbound link actually arrives in: a bare slug from
    before the year stamp, a stale year, the legacy .html form, a trailing
    slash, the www host, and plain http. The last case stacks three corrections
    at once, which is the one most likely to grow a chain.
    """
    base = YEAR_RE.sub("", slug)
    canonical_path = "/articles/{}".format(slug)
    return [
        ("bare slug", "{}/articles/{}".format(origin, base)),
        ("stale year", "{}/articles/{}-2025".format(origin, base)),
        ("legacy .html", "{}{}.html".format(origin, canonical_path)),
        ("trailing slash", "{}{}/".format(origin, canonical_path)),
        ("www host", "https://{}{}".format(WWW_HOST, canonical_path)),
        ("http + www + .html", "http://{}{}.html".format(WWW_HOST, canonical_path)),
    ]


def classify(label: str, url: str, expected: str, hops: List[Hop]) -> Optional[Finding]:
    """Turn an observed chain into a verdict, erring towards silence.

    `expected` is the canonical URL this form must end on. `label` is CANONICAL
    for the canonical URL itself, which must be served directly rather than
    redirect at all.
    """
    first = hops[0]
    if first.error:
        return Finding(BLOCKED, url, "{} ({})".format(first.error, label))
    if first.status in BLOCKED_STATUSES:
        return Finding(BLOCKED, url, "status {} ({})".format(first.status, label))

    final = hops[-1]
    if final.error:
        return Finding(BLOCKED, url, "{} following {} ({})".format(final.error, final.url, label))
    if final.status in BLOCKED_STATUSES:
        return Finding(BLOCKED, url, "status {} at {} ({})".format(final.status, final.url, label))

    redirects = sum(1 for hop in hops if hop.status and 300 <= hop.status < 400)

    if label == CANONICAL:
        if redirects:
            chain = " -> ".join(hop.url for hop in hops)
            return Finding(TARGET, url, "canonical URL redirects instead of serving: " + chain)
        if final.status != 200:
            return Finding(DEAD, url, "canonical URL returned {}".format(final.status))
        if final.body is not None:
            tag = canonical_tag(final.body)
            if tag is None:
                return Finding(TAG, url, "page has no <link rel=canonical>")
            if tag.rstrip("/") != expected.rstrip("/"):
                return Finding(
                    TAG,
                    url,
                    "page declares canonical {} but is served at {}".format(tag, expected),
                )
        return None

    if redirects == 0:
        if final.status == 200:
            # The whole reason this script exists: two URLs, one page, both live.
            return Finding(
                DUPLICATE,
                url,
                "served 200 instead of redirecting to {} ({})".format(expected, label),
            )
        return Finding(
            DEAD, url, "returned {} instead of redirecting ({})".format(final.status, label)
        )

    if redirects > 1:
        chain = " -> ".join(hop.url for hop in hops)
        return Finding(CHAIN, url, "{} hops ({}): {}".format(redirects, label, chain))

    if final.url.rstrip("/") != expected.rstrip("/"):
        return Finding(
            TARGET, url, "redirected to {}, expected {} ({})".format(final.url, expected, label)
        )

    if final.status != 200:
        return Finding(DEAD, url, "redirect target returned {} ({})".format(final.status, label))

    return None


def build_probes(root: str, origin: str, sample: Optional[int] = None) -> List[Tuple[str, str, str]]:
    """Every (label, url, expected canonical) triple this run will check."""
    guides, others = page_paths(root)
    if sample:
        guides = guides[:sample]
        others = others[:sample]

    probes: List[Tuple[str, str, str]] = []
    for slug in guides:
        expected = "{}/articles/{}".format(origin, slug)
        probes.append((CANONICAL, expected, expected))
        for label, url in variants(slug, origin):
            probes.append((label, url, expected))

    for path in others:
        expected = "{}/{}".format(origin, path) if path else origin + "/"
        probes.append((CANONICAL, expected, expected))
        # Essays and static pages have no year to resolve, but they still have to
        # collapse www and .html, or the homepage alone is two URLs.
        probes.append(("www host", "https://{}/{}".format(WWW_HOST, path), expected))
        if path:
            probes.append(("legacy .html", "{}/{}.html".format(origin, path), expected))
    return probes


def run(root: str, origin: str = APEX_ORIGIN, fetcher=fetch, workers: int = DEFAULT_WORKERS,
        sample: Optional[int] = None) -> Report:
    probes = build_probes(root, origin, sample)
    report = Report(checked=len(probes))
    if not probes:
        return report

    def check(probe):
        label, url, expected = probe
        hops = follow(url, fetcher=fetcher, want_body=(label == CANONICAL))
        return classify(label, url, expected, hops)

    with ThreadPoolExecutor(max_workers=min(workers, len(probes))) as pool:
        results = list(pool.map(check, probes))

    for finding in results:
        if finding is None:
            continue
        (report.blocked if finding.verdict == BLOCKED else report.failures).append(finding)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--origin", default=APEX_ORIGIN, help="origin to probe")
    parser.add_argument("--sample", type=int, help="check only the first N pages, for a smoke run")
    parser.add_argument("--json", action="store_true", help="emit findings as JSON")
    args = parser.parse_args()

    root = os.getcwd()
    if not os.path.isdir(os.path.join(root, "articles")):
        print("No articles/ directory. Run this from the repository root.", file=sys.stderr)
        return 1

    report = run(root, origin=args.origin, sample=args.sample)

    # A run that probed nothing must not report success. Silence and health look
    # identical in the output, and this job's whole purpose is to be believed on
    # the day it stays quiet, so an empty run is a failure rather than a pass.
    if report.checked == 0:
        print("No pages found to probe. Run this from the repository root.", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps({
            "checked": report.checked,
            "failures": [vars(finding) for finding in report.failures],
            "blocked": [vars(finding) for finding in report.blocked],
        }, indent=2))
        return report.exit_code

    for finding in report.blocked:
        print(finding.line())
    if report.blocked:
        print("             (blocked, not broken: refused or unreachable, never fatal)")
        print("")

    for finding in report.failures:
        print(finding.line())
    if report.failures:
        print("")

    print(
        "{} URLs probed, {} canonical failures, {} blocked".format(
            report.checked, len(report.failures), len(report.blocked)
        )
    )
    return report.exit_code


if __name__ == "__main__":
    sys.exit(main())
