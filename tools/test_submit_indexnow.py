#!/usr/bin/env python3
"""Tests for tools/submit_indexnow.py.

    python3 tools/test_submit_indexnow.py

Nothing here touches the network. Submitting is the only part that does, and it
is injected as an argument precisely so everything deciding what to submit can
be tested without it.

Stdlib only, to match the rest of tools/.
"""
import importlib.util
import os
import tempfile
import unittest

SUBMIT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "submit_indexnow.py")

_spec = importlib.util.spec_from_file_location("submit_indexnow", SUBMIT_PATH)
submit_indexnow = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(submit_indexnow)

SITE = submit_indexnow.SITE
KEY = "0123456789abcdef0123456789abcdef"


def sitemap(routes):
    locs = "".join(
        "<url><loc>{}{}</loc><lastmod>2026-08-01</lastmod></url>".format(SITE, route)
        for route in routes
    )
    return '<?xml version="1.0" encoding="UTF-8"?><urlset>' + locs + "</urlset>"


class IndexNowTestCase(unittest.TestCase):
    """Each test builds a synthetic site root in a temporary directory."""

    def setUp(self):
        self._origin = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)

    def tearDown(self):
        os.chdir(self._origin)
        self._tmp.cleanup()

    def write_key(self, name=KEY + ".txt", body=KEY):
        with open(name, "w", encoding="utf-8") as handle:
            handle.write(body)

    def write_sitemap(self, routes):
        with open("sitemap.xml", "w", encoding="utf-8") as handle:
            handle.write(sitemap(routes))

    # --- finding the key -----------------------------------------------------

    def test_finds_the_hosted_key_file(self):
        self.write_key()
        self.assertEqual(submit_indexnow.find_key(), KEY)

    def test_missing_key_file_is_an_error(self):
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.find_key()

    def test_key_file_whose_name_and_contents_disagree_is_an_error(self):
        # IndexNow proves ownership by fetching <key>.txt and checking it holds
        # that same key. A mismatch fails verification quietly, which is a bad
        # way to learn why nothing ever got indexed.
        self.write_key(name=KEY + ".txt", body="f" * 32)
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.find_key()

    def test_unrelated_txt_files_are_not_mistaken_for_a_key(self):
        with open("robots.txt", "w", encoding="utf-8") as handle:
            handle.write("User-agent: *\nAllow: /\n")
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.find_key()

    # --- choosing what to submit ---------------------------------------------

    def test_reads_every_url_from_the_sitemap(self):
        self.write_sitemap(["/", "/msp-ma-advisor", "/articles/msp-valuation-multiples-2026"])
        self.assertEqual(submit_indexnow.sitemap_urls(), [
            SITE + "/",
            SITE + "/msp-ma-advisor",
            SITE + "/articles/msp-valuation-multiples-2026",
        ])

    def test_missing_sitemap_is_an_error(self):
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.sitemap_urls()

    def test_a_url_on_another_host_is_rejected(self):
        # IndexNow rejects the whole request when any URL is off-host, so one
        # stray link costs the entire submission rather than just itself.
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.validated([SITE + "/", "https://example.com/page"])

    def test_urls_on_our_host_pass_through_unchanged(self):
        urls = [SITE + "/", SITE + "/msp-ma-advisor"]
        self.assertEqual(submit_indexnow.validated(urls), urls)

    def test_a_plain_http_url_is_rejected(self):
        # The Worker 301s http to https, so announcing an http URL points the
        # engines at a redirect instead of the page.
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.validated(["http://saltcreekadvisory.com/msp-ma-advisor"])

    def test_a_protocol_relative_url_is_rejected(self):
        # urlparse reads the host off "//host/path" happily, so the host check
        # alone passes it through and we would submit a non-absolute URL.
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.validated(["//saltcreekadvisory.com/msp-ma-advisor"])

    def test_submitting_nothing_is_an_error(self):
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.validated([])

    def test_more_urls_than_the_api_accepts_is_an_error(self):
        too_many = ["{}/p{}".format(SITE, n) for n in range(submit_indexnow.MAX_URLS + 1)]
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.validated(too_many)

    # --- the payload ---------------------------------------------------------

    def test_payload_carries_host_key_and_key_location(self):
        payload = submit_indexnow.build_payload(KEY, [SITE + "/msp-ma-advisor"])
        self.assertEqual(payload["host"], "saltcreekadvisory.com")
        self.assertEqual(payload["key"], KEY)
        self.assertEqual(payload["keyLocation"], "{}/{}.txt".format(SITE, KEY))
        self.assertEqual(payload["urlList"], [SITE + "/msp-ma-advisor"])

    # --- the CLI -------------------------------------------------------------

    def test_dry_run_submits_nothing_and_succeeds(self):
        self.write_key()
        self.write_sitemap(["/", "/msp-ma-advisor"])

        def refuse(_payload):
            raise AssertionError("a dry run must not reach the network")

        self.assertEqual(submit_indexnow.main(["--all", "--dry-run"], submit=refuse), 0)

    def test_all_submits_every_sitemap_url(self):
        self.write_key()
        self.write_sitemap(["/", "/msp-ma-advisor"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--all"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/", SITE + "/msp-ma-advisor"])

    def test_explicit_urls_are_submitted_instead_of_the_sitemap(self):
        self.write_key()
        self.write_sitemap(["/", "/msp-ma-advisor", "/articles/when-to-start-exit-planning-2026"])
        sent = []
        self.assertEqual(submit_indexnow.main([SITE + "/msp-ma-advisor"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/msp-ma-advisor"])

    def test_a_bare_route_is_accepted_and_expanded(self):
        # Typing the full origin every time invites a typo in the one field that
        # has to match exactly.
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["/msp-ma-advisor"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/msp-ma-advisor"])

    def test_a_foreign_url_fails_the_run_without_submitting(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["https://example.com/page"], submit=sent.append), 1)
        self.assertEqual(sent, [], "nothing should be submitted when validation fails")

    def test_no_arguments_fails_rather_than_guessing(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main([], submit=sent.append), 1)
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
