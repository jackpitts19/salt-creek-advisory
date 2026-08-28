#!/usr/bin/env python3
"""Tests for tools/check_canonical.py.

    python3 tools/test_check_canonical.py

Nothing here touches the network. The fetcher is injected, exactly as in
test_check_links.py, so every test drives the classifier against a synthetic
production rather than the real one. That matters more than usual here: the
whole script is a network probe, and a suite that needed the network would be
unrunnable on the one day it is most needed, which is the day production breaks.

The weight sits on the classifier, for the reason check_links.py argues at
length. This job runs weekly and unattended, so a false alarm gets it muted and
a missed DUPLICATE defeats the point of having it. Both directions are pinned:
a timeout must never fail a run, and a bare slug serving 200 must always fail
one. Stdlib only, to match the rest of tools/.
"""
import importlib.util
import os
import sys
import tempfile
import unittest

CHECK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_canonical.py")

_spec = importlib.util.spec_from_file_location("check_canonical", CHECK_PATH)
check_canonical = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_canonical)

Hop = check_canonical.Hop
CANONICAL = check_canonical.CANONICAL
BLOCKED = check_canonical.BLOCKED
DUPLICATE = check_canonical.DUPLICATE
CHAIN = check_canonical.CHAIN
TARGET = check_canonical.TARGET
DEAD = check_canonical.DEAD
TAG = check_canonical.TAG

ORIGIN = "https://saltcreekadvisory.com"
GUIDE = ORIGIN + "/articles/msp-valuation-multiples-2026"
BARE = ORIGIN + "/articles/msp-valuation-multiples"


def redirect_then_ok(source, target):
    """The healthy shape: one 301, then a 200 at the canonical URL."""
    return [Hop(url=source, status=301, location=target), Hop(url=target, status=200)]


class ClassifyRedirectTestCase(unittest.TestCase):
    """What a non-canonical URL is allowed to do."""

    def test_single_hop_to_the_canonical_url_passes(self):
        finding = check_canonical.classify("bare slug", BARE, GUIDE, redirect_then_ok(BARE, GUIDE))
        self.assertIsNone(finding)

    def test_a_bare_slug_serving_200_is_a_duplicate(self):
        """The exact failure this script exists to catch: two live URLs."""
        hops = [Hop(url=BARE, status=200, body="")]
        finding = check_canonical.classify("bare slug", BARE, GUIDE, hops)
        self.assertIsNotNone(finding)
        self.assertEqual(finding.verdict, DUPLICATE)

    def test_two_hops_is_a_chain(self):
        middle = ORIGIN + "/articles/msp-valuation-multiples-2025"
        hops = [
            Hop(url=BARE, status=301, location=middle),
            Hop(url=middle, status=301, location=GUIDE),
            Hop(url=GUIDE, status=200),
        ]
        finding = check_canonical.classify("bare slug", BARE, GUIDE, hops)
        self.assertEqual(finding.verdict, CHAIN)
        self.assertIn("2 hops", finding.detail)

    def test_a_redirect_to_the_wrong_page_is_a_target_failure(self):
        wrong = ORIGIN + "/articles/ma-advisor-fees-2026"
        finding = check_canonical.classify("bare slug", BARE, GUIDE, redirect_then_ok(BARE, wrong))
        self.assertEqual(finding.verdict, TARGET)

    def test_a_redirect_into_a_404_is_dead(self):
        hops = [Hop(url=BARE, status=301, location=GUIDE), Hop(url=GUIDE, status=404)]
        finding = check_canonical.classify("bare slug", BARE, GUIDE, hops)
        self.assertEqual(finding.verdict, DEAD)

    def test_a_bare_slug_returning_404_is_dead_not_duplicate(self):
        """A dead legacy URL is a different bug from a duplicated one."""
        hops = [Hop(url=BARE, status=404)]
        finding = check_canonical.classify("bare slug", BARE, GUIDE, hops)
        self.assertEqual(finding.verdict, DEAD)

    def test_a_trailing_slash_on_either_side_is_not_a_mismatch(self):
        finding = check_canonical.classify(
            "bare slug", BARE, GUIDE, redirect_then_ok(BARE, GUIDE + "/")
        )
        self.assertIsNone(finding)


class ClassifyCanonicalTestCase(unittest.TestCase):
    """What the canonical URL itself must do."""

    def test_a_served_page_with_a_matching_canonical_tag_passes(self):
        body = '<link rel="canonical" href="{}" />'.format(GUIDE)
        hops = [Hop(url=GUIDE, status=200, body=body)]
        self.assertIsNone(check_canonical.classify(CANONICAL, GUIDE, GUIDE, hops))

    def test_a_canonical_tag_pointing_elsewhere_fails(self):
        """Pointing at the bare slug would hand the crawler back the duplicate."""
        body = '<link rel="canonical" href="{}" />'.format(BARE)
        hops = [Hop(url=GUIDE, status=200, body=body)]
        finding = check_canonical.classify(CANONICAL, GUIDE, GUIDE, hops)
        self.assertEqual(finding.verdict, TAG)

    def test_a_missing_canonical_tag_fails(self):
        hops = [Hop(url=GUIDE, status=200, body="<html><head></head></html>")]
        finding = check_canonical.classify(CANONICAL, GUIDE, GUIDE, hops)
        self.assertEqual(finding.verdict, TAG)

    def test_a_canonical_url_that_redirects_fails(self):
        finding = check_canonical.classify(CANONICAL, GUIDE, GUIDE, redirect_then_ok(GUIDE, BARE))
        self.assertEqual(finding.verdict, TARGET)

    def test_a_canonical_url_returning_500_is_dead(self):
        hops = [Hop(url=GUIDE, status=500)]
        finding = check_canonical.classify(CANONICAL, GUIDE, GUIDE, hops)
        self.assertEqual(finding.verdict, DEAD)


class NeverCryWolfTestCase(unittest.TestCase):
    """A weekly job that fails on a network blip is a job someone turns off."""

    def test_a_timeout_is_blocked_not_failed(self):
        hops = [Hop(url=BARE, error="timeout: timed out")]
        finding = check_canonical.classify("bare slug", BARE, GUIDE, hops)
        self.assertEqual(finding.verdict, BLOCKED)

    def test_an_unreachable_host_is_blocked(self):
        hops = [Hop(url=BARE, error="unreachable: nodename nor servname provided")]
        self.assertEqual(check_canonical.classify("www host", BARE, GUIDE, hops).verdict, BLOCKED)

    def test_a_429_is_blocked(self):
        hops = [Hop(url=BARE, status=429)]
        self.assertEqual(check_canonical.classify("bare slug", BARE, GUIDE, hops).verdict, BLOCKED)

    def test_a_403_from_an_edge_waf_is_blocked(self):
        hops = [Hop(url=BARE, status=403)]
        self.assertEqual(check_canonical.classify("bare slug", BARE, GUIDE, hops).verdict, BLOCKED)

    def test_a_timeout_on_the_redirect_target_is_blocked(self):
        hops = [Hop(url=BARE, status=301, location=GUIDE), Hop(url=GUIDE, error="timeout")]
        self.assertEqual(check_canonical.classify("bare slug", BARE, GUIDE, hops).verdict, BLOCKED)

    def test_blocked_findings_do_not_set_the_exit_code(self):
        report = check_canonical.Report(checked=1)
        report.blocked.append(check_canonical.Finding(BLOCKED, BARE, "timeout"))
        self.assertEqual(report.exit_code, 0)

    def test_one_failure_does_set_the_exit_code(self):
        report = check_canonical.Report(checked=1)
        report.failures.append(check_canonical.Finding(DUPLICATE, BARE, "served 200"))
        self.assertEqual(report.exit_code, 1)


class CanonicalTagTestCase(unittest.TestCase):
    def test_reads_href_after_rel(self):
        html = '<link rel="canonical" href="{}">'.format(GUIDE)
        self.assertEqual(check_canonical.canonical_tag(html), GUIDE)

    def test_reads_href_before_rel(self):
        """Attribute order is not guaranteed and a miss here would be a false TAG."""
        html = '<link href="{}" rel="canonical">'.format(GUIDE)
        self.assertEqual(check_canonical.canonical_tag(html), GUIDE)

    def test_single_quotes_and_odd_casing(self):
        html = "<LINK REL='canonical' HREF='{}'>".format(GUIDE)
        self.assertEqual(check_canonical.canonical_tag(html), GUIDE)

    def test_ignores_other_link_tags(self):
        html = '<link rel="alternate" href="https://example.com/feed.xml">'
        self.assertIsNone(check_canonical.canonical_tag(html))

    def test_returns_none_when_absent(self):
        self.assertIsNone(check_canonical.canonical_tag("<html></html>"))


class FollowTestCase(unittest.TestCase):
    """Hop walking, with a fetcher that never leaves the process."""

    def test_stops_at_a_200(self):
        def fetcher(url, want_body=False):
            return Hop(url=url, status=200, body="<html>" if want_body else None)

        self.assertEqual(len(check_canonical.follow(BARE, fetcher=fetcher)), 1)

    def test_follows_a_single_redirect(self):
        def fetcher(url, want_body=False):
            if url == BARE:
                return Hop(url=url, status=301, location=GUIDE)
            return Hop(url=url, status=200)

        hops = check_canonical.follow(BARE, fetcher=fetcher)
        self.assertEqual([hop.url for hop in hops], [BARE, GUIDE])

    def test_resolves_a_relative_location_header(self):
        """A Location of /articles/x is legal and must not be read as a host."""

        def fetcher(url, want_body=False):
            if url == BARE:
                return Hop(url=url, status=301, location="/articles/msp-valuation-multiples-2026")
            return Hop(url=url, status=200)

        hops = check_canonical.follow(BARE, fetcher=fetcher)
        self.assertEqual(hops[-1].url, GUIDE)

    def test_a_redirect_loop_terminates(self):
        def fetcher(url, want_body=False):
            return Hop(url=url, status=301, location=BARE if url != BARE else GUIDE)

        hops = check_canonical.follow(BARE, fetcher=fetcher)
        self.assertLessEqual(len(hops), check_canonical.MAX_HOPS + 1)


class ProbeBuildingTestCase(unittest.TestCase):
    """What gets probed is derived from disk, not from a hand-kept list."""

    def build_site(self, names):
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, "articles"))
        for name in names:
            with open(os.path.join(root, name), "w", encoding="utf-8") as handle:
                handle.write("<html></html>")
        return root

    def test_splits_guides_from_essays_by_the_year_suffix(self):
        root = self.build_site(
            ["articles/msp-valuation-multiples-2026.html", "articles/why-we-built-it.html"]
        )
        guides, others = check_canonical.page_paths(root)
        self.assertEqual(guides, ["msp-valuation-multiples-2026"])
        self.assertEqual(others, ["articles/why-we-built-it"])

    def test_index_becomes_the_bare_origin(self):
        root = self.build_site(["index.html"])
        _, others = check_canonical.page_paths(root)
        self.assertIn("", others)

    def test_404_is_not_probed(self):
        """It is supposed to return 404, so probing it would report a false DEAD."""
        root = self.build_site(["404.html", "about.html"])
        _, others = check_canonical.page_paths(root)
        self.assertNotIn("404", others)
        self.assertIn("about", others)

    def test_a_guide_gets_both_the_bare_and_the_stamped_probe(self):
        root = self.build_site(["articles/msp-valuation-multiples-2026.html"])
        urls = [url for _, url, _ in check_canonical.build_probes(root, ORIGIN)]
        self.assertIn(BARE, urls)
        self.assertIn(GUIDE, urls)

    def test_every_probe_expects_the_year_stamped_url(self):
        root = self.build_site(["articles/msp-valuation-multiples-2026.html"])
        probes = check_canonical.build_probes(root, ORIGIN)
        self.assertTrue(all(expected == GUIDE for _, _, expected in probes))

    def test_a_slug_with_digits_is_not_mistaken_for_a_year(self):
        """best-ma-advisors-selling-20-million-company is a real slug on this site."""
        root = self.build_site(["articles/best-ma-advisors-selling-20-million-company-2026.html"])
        guides, others = check_canonical.page_paths(root)
        self.assertEqual(guides, ["best-ma-advisors-selling-20-million-company-2026"])
        self.assertEqual(others, [])
        self.assertEqual(
            check_canonical.YEAR_RE.sub("", guides[0]),
            "best-ma-advisors-selling-20-million-company",
        )


class EndToEndTestCase(unittest.TestCase):
    """The whole run, against a synthetic production."""

    def build_site(self):
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, "articles"))
        for name in ["articles/msp-valuation-multiples-2026.html", "index.html"]:
            with open(os.path.join(root, name), "w", encoding="utf-8") as handle:
                handle.write("<html></html>")
        return root

    def healthy_fetcher(self, url, want_body=False):
        if url in (GUIDE, ORIGIN + "/"):
            body = '<link rel="canonical" href="{}">'.format(url) if want_body else None
            return Hop(url=url, status=200, body=body)
        target = ORIGIN + "/" if "/articles/" not in url else GUIDE
        return Hop(url=url, status=301, location=target)

    def test_a_healthy_site_reports_nothing(self):
        root = self.build_site()
        report = check_canonical.run(root, origin=ORIGIN, fetcher=self.healthy_fetcher)
        self.assertEqual(report.failures, [])
        self.assertEqual(report.exit_code, 0)
        self.assertGreater(report.checked, 0)

    def test_a_live_bare_slug_is_caught(self):
        """Regression guard for the failure the whole script is named after."""
        root = self.build_site()

        def leaky(url, want_body=False):
            if url == BARE:
                return Hop(url=url, status=200, body="<html></html>")
            return self.healthy_fetcher(url, want_body)

        report = check_canonical.run(root, origin=ORIGIN, fetcher=leaky)
        self.assertEqual(report.exit_code, 1)
        self.assertTrue(any(f.verdict == DUPLICATE and f.url == BARE for f in report.failures))


class VacuousRunTestCase(unittest.TestCase):
    """A run that probed nothing must not be mistaken for a clean run.

    This is the failure mode that would quietly retire the whole job: silence
    and health print almost the same thing, and the guard is only worth having
    if it can be believed on the day it stays quiet.
    """

    def test_an_empty_site_exits_non_zero(self):
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, "articles"))
        previous = os.getcwd()
        previous_argv = sys.argv
        try:
            os.chdir(root)
            sys.argv = ["check_canonical.py"]
            self.assertEqual(check_canonical.main(), 1)
        finally:
            os.chdir(previous)
            sys.argv = previous_argv

    def test_a_missing_articles_directory_exits_non_zero(self):
        root = tempfile.mkdtemp()
        previous = os.getcwd()
        previous_argv = sys.argv
        try:
            os.chdir(root)
            sys.argv = ["check_canonical.py"]
            self.assertEqual(check_canonical.main(), 1)
        finally:
            os.chdir(previous)
            sys.argv = previous_argv


if __name__ == "__main__":
    unittest.main(verbosity=2)
