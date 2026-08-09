#!/usr/bin/env python3
"""Tests for tools/check_links.py.

    python3 tools/test_check_links.py

The checker's value is entirely in what it refuses to shout about. A first pass
over this site's 259 external links reported 33 failures, of which 30 were
healthy pages that simply turn robots away. So the classifier gets the most
tests here: a 403 from SEC.gov and a 999 from LinkedIn must never fail a run,
while a 404 must always fail one. Get that backwards and the weekly job gets
muted, which is the same as not having it.

Nothing here touches the network. The fetcher is injected, so every test drives
the classifier and the extractor against synthetic inputs. Stdlib only, to
match the rest of tools/.
"""
import importlib.util
import os
import tempfile
import unittest

CHECK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_links.py")

_spec = importlib.util.spec_from_file_location("check_links", CHECK_PATH)
check_links = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_links)

OK = check_links.OK
DEAD = check_links.DEAD
BLOCKED = check_links.BLOCKED


class ExtractTestCase(unittest.TestCase):
    """What counts as a citation worth checking."""

    def test_finds_external_anchor_hrefs(self):
        html = '<a href="https://example.com/report">Report</a>'
        self.assertEqual(check_links.extract_external(html), ["https://example.com/report"])

    def test_skips_own_domain(self):
        html = (
            '<a href="https://saltcreekadvisory.com/valuation">us</a>'
            '<a href="https://example.com/x">them</a>'
        )
        self.assertEqual(check_links.extract_external(html), ["https://example.com/x"])

    def test_skips_relative_and_mailto_and_tel(self):
        html = (
            '<a href="../valuation">v</a>'
            '<a href="mailto:jack@saltcreekadvisory.com">mail</a>'
            '<a href="tel:+13125551212">call</a>'
        )
        self.assertEqual(check_links.extract_external(html), [])

    def test_skips_preconnect_origins(self):
        """fonts.gstatic.com is an origin to warm, not a page. It 404s by design."""
        html = (
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
            '<link rel="dns-prefetch" href="https://fonts.googleapis.com" />'
            '<a href="https://example.com/real">real</a>'
        )
        self.assertEqual(check_links.extract_external(html), ["https://example.com/real"])

    def test_keeps_stylesheet_links(self):
        """A stylesheet is a real fetchable resource, unlike a preconnect origin."""
        html = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />'
        self.assertEqual(
            check_links.extract_external(html),
            ["https://fonts.googleapis.com/css2?family=Inter"],
        )

    def test_unescapes_entities_in_urls(self):
        """An EDGAR query URL carries &amp; in markup. Requesting it literally 404s."""
        html = '<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=x&amp;CIK=1&amp;type=10-Q">f</a>'
        self.assertEqual(
            check_links.extract_external(html),
            ["https://www.sec.gov/cgi-bin/browse-edgar?action=x&CIK=1&type=10-Q"],
        )

    def test_deduplicates_and_sorts(self):
        html = (
            '<a href="https://b.com/2">b</a>'
            '<a href="https://a.com/1">a</a>'
            '<a href="https://b.com/2">b again</a>'
        )
        self.assertEqual(check_links.extract_external(html), ["https://a.com/1", "https://b.com/2"])


class ClassifyTestCase(unittest.TestCase):
    """The part that decides whether anyone gets woken up."""

    def test_success_statuses_are_ok(self):
        for status in (200, 201, 204, 301, 302, 308):
            self.assertEqual(check_links.classify(status, None), OK, status)

    def test_404_and_410_are_dead(self):
        self.assertEqual(check_links.classify(404, None), DEAD)
        self.assertEqual(check_links.classify(410, None), DEAD)

    def test_sec_style_403_is_blocked_not_dead(self):
        """SEC.gov serves 200 to a declared contact and 403 to everyone else."""
        self.assertEqual(check_links.classify(403, None), BLOCKED)

    def test_linkedin_999_is_blocked_not_dead(self):
        self.assertEqual(check_links.classify(999, None), BLOCKED)

    def test_rate_limit_is_blocked_not_dead(self):
        """429 means ask me later, which is not the same as gone."""
        self.assertEqual(check_links.classify(429, None), BLOCKED)

    def test_server_errors_are_blocked_not_dead(self):
        for status in (500, 502, 503):
            self.assertEqual(check_links.classify(status, None), BLOCKED, status)

    def test_unresolvable_host_is_dead(self):
        """A domain that no longer exists is the clearest possible rot."""
        self.assertEqual(check_links.classify(None, check_links.ERR_DNS), DEAD)

    def test_timeout_is_blocked_not_dead(self):
        self.assertEqual(check_links.classify(None, check_links.ERR_TIMEOUT), BLOCKED)

    def test_connection_error_is_blocked_not_dead(self):
        self.assertEqual(check_links.classify(None, check_links.ERR_OTHER), BLOCKED)


class RunTestCase(unittest.TestCase):
    """End to end over a synthetic site, with the network stubbed out."""

    def build_site(self, pages):
        tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(tmp, "articles"), exist_ok=True)
        for name, body in pages.items():
            with open(os.path.join(tmp, name), "w", encoding="utf-8") as handle:
                handle.write(body)
        return tmp

    def test_dead_link_fails_the_run_and_names_its_page(self):
        root = self.build_site(
            {"msp-ma-advisor.html": '<a href="https://vendor.com/moved">Source</a>'}
        )
        report = check_links.run(root, fetch=lambda url: (404, None))
        self.assertEqual(report.exit_code, 1)
        self.assertEqual(len(report.dead), 1)
        self.assertEqual(report.dead[0].url, "https://vendor.com/moved")
        self.assertIn("msp-ma-advisor.html", report.dead[0].pages)

    def test_blocked_link_reports_but_does_not_fail(self):
        root = self.build_site(
            {"index.html": '<a href="https://www.linkedin.com/in/jack-pitts/">li</a>'}
        )
        report = check_links.run(root, fetch=lambda url: (999, None))
        self.assertEqual(report.exit_code, 0)
        self.assertEqual(len(report.dead), 0)
        self.assertEqual(len(report.blocked), 1)

    def test_healthy_site_exits_zero(self):
        root = self.build_site({"index.html": '<a href="https://example.com/ok">ok</a>'})
        report = check_links.run(root, fetch=lambda url: (200, None))
        self.assertEqual(report.exit_code, 0)
        self.assertEqual(len(report.dead), 0)
        self.assertEqual(len(report.blocked), 0)

    def test_same_url_on_many_pages_is_fetched_once_and_lists_every_page(self):
        """One dead source cited across five guides is one problem, not five."""
        calls = []

        def fetch(url):
            calls.append(url)
            return 404, None

        root = self.build_site(
            {
                "index.html": '<a href="https://vendor.com/gone">s</a>',
                "articles/a.html": '<a href="https://vendor.com/gone">s</a>',
                "articles/b.html": '<a href="https://vendor.com/gone">s</a>',
            }
        )
        report = check_links.run(root, fetch=fetch)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(report.dead), 1)
        self.assertEqual(len(report.dead[0].pages), 3)

    def test_scans_articles_subdirectory(self):
        root = self.build_site({"articles/guide.html": '<a href="https://vendor.com/x">s</a>'})
        report = check_links.run(root, fetch=lambda url: (404, None))
        self.assertEqual(len(report.dead), 1)
        self.assertIn("articles/guide.html", report.dead[0].pages)


if __name__ == "__main__":
    unittest.main(verbosity=2)
