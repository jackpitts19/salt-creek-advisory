#!/usr/bin/env python3
"""Tests for tools/check_site.py.

    python3 tools/test_check_site.py

A checker that passes is worthless unless it can also fail. Each test builds a
tiny synthetic site in a temporary directory, breaks exactly one thing, and
asserts the checker notices. The clean-site test guards the other direction:
no false positives on a well-formed page.

Stdlib only, to match the rest of tools/.
"""
import contextlib
import importlib.util
import io
import os
import tempfile
import unittest

CHECK_SITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_site.py")

_spec = importlib.util.spec_from_file_location("check_site", CHECK_SITE_PATH)
check_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_site)

SITE = check_site.SITE


def page(route, title="Sample Page", description="A sample description.",
         canonical=None, head="", body=""):
    """A minimal page that passes every check unless an argument breaks it."""
    if canonical is None:
        canonical = SITE + route
    canonical_tag = '<link rel="canonical" href="{}" />'.format(canonical) if canonical else ""
    title_tag = "<title>{}</title>".format(title) if title else ""
    description_tag = (
        '<meta name="description" content="{}" />'.format(description) if description else ""
    )
    return (
        '<!DOCTYPE html><html lang="en"><head>'
        + title_tag + description_tag + canonical_tag + head
        + "</head><body>" + body + "</body></html>"
    )


def sitemap(routes):
    locs = "".join("<url><loc>{}{}</loc></url>".format(SITE, route) for route in routes)
    return '<?xml version="1.0" encoding="UTF-8"?><urlset>' + locs + "</urlset>"


class CheckSiteTestCase(unittest.TestCase):
    """Runs the checker against a synthetic site written to a temp directory."""

    def setUp(self):
        self._origin = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        # A clean baseline that each test breaks in exactly one way.
        self.write("index.html", page("/"))
        self.write("about.html", page("/about"))
        self.write_sitemap(["/", "/about"])

    def tearDown(self):
        os.chdir(self._origin)
        self._tmp.cleanup()

    def write(self, path, content):
        full = os.path.join(self._tmp.name, path)
        parent = os.path.dirname(full)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(content)

    def write_sitemap(self, routes):
        self.write("sitemap.xml", sitemap(routes))

    def run_checker(self):
        """Returns (exit_code, combined_output)."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_site.main()
        return code, out.getvalue() + err.getvalue()

    def assertFails(self, needle):
        code, output = self.run_checker()
        self.assertEqual(code, 1, "expected a failure, got a clean run:\n" + output)
        self.assertIn(needle, output)

    # --- the checker stays quiet when nothing is wrong ------------------------

    def test_clean_site_passes(self):
        code, output = self.run_checker()
        self.assertEqual(code, 0, "clean site should pass:\n" + output)
        self.assertIn("0 errors", output)

    # --- every check can actually fail ---------------------------------------

    def test_broken_internal_link_is_caught(self):
        self.write("about.html", page("/about", body='<a href="/does-not-exist">Gone</a>'))
        self.assertFails("does-not-exist")

    def test_relative_link_out_of_articles_resolves(self):
        # ../valuation from /articles/foo must resolve to valuation.html, the
        # pattern every real article uses.
        self.write("valuation.html", page("/valuation"))
        self.write("articles/foo.html",
                   page("/articles/foo", body='<a href="../valuation">Value</a>'))
        self.write_sitemap(["/", "/about", "/valuation", "/articles/foo"])
        code, output = self.run_checker()
        self.assertEqual(code, 0, "relative article link should resolve:\n" + output)

    def test_wrong_canonical_is_caught(self):
        self.write("about.html", page("/about", canonical=SITE + "/index"))
        self.assertFails("canonical is")

    def test_missing_title_is_caught(self):
        self.write("about.html", page("/about", title=""))
        self.assertFails("missing <title>")

    def test_missing_description_is_caught(self):
        self.write("about.html", page("/about", description=""))
        self.assertFails("missing meta description")

    def test_invalid_json_ld_is_caught(self):
        broken = '<script type="application/ld+json">{"@type": "Article",}</script>'
        self.write("about.html", page("/about", head=broken))
        self.assertFails("does not parse")

    def test_valid_json_ld_passes(self):
        good = '<script type="application/ld+json">{"@type": "Article"}</script>'
        self.write("about.html", page("/about", head=good))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "valid JSON-LD should pass:\n" + output)

    def test_image_without_alt_is_caught(self):
        self.write("about.html", page("/about", body='<img src="/logo.png">'))
        self.assertFails("without alt")

    def test_orphan_page_missing_from_sitemap_is_caught(self):
        self.write("orphan.html", page("/orphan"))
        self.assertFails("/orphan is indexable but unlisted")

    def test_sitemap_entry_for_missing_file_is_caught(self):
        self.write_sitemap(["/", "/about", "/deleted-page"])
        self.assertFails("deleted-page")

    # --- noindex pages are held to a different standard ----------------------

    def test_noindex_page_needs_no_canonical(self):
        """Regression: 404.html is noindex and has no canonical URL to declare."""
        self.write("404.html", page("/404", canonical="",
                                    head='<meta name="robots" content="noindex, follow" />'))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "noindex page should not require a canonical:\n" + output)

    def test_noindex_page_is_not_required_in_sitemap(self):
        self.write("privacy.html", page("/privacy",
                                        head='<meta name="robots" content="noindex, follow" />'))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "noindex page should not count as a sitemap orphan:\n" + output)

    # --- warnings inform without failing the run -----------------------------

    def test_long_title_warns_but_does_not_fail(self):
        long_title = "A" * (check_site.MAX_TITLE_CHARS + 5)
        self.write("about.html", page("/about", title=long_title))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a long title should not fail the run")
        self.assertIn("Google truncates past", output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
