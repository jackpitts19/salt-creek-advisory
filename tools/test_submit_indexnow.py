#!/usr/bin/env python3
"""Tests for tools/submit_indexnow.py.

    python3 tools/test_submit_indexnow.py

Nothing here touches the network. Submitting is the only part that does, and it
is injected as an argument precisely so everything deciding what to submit can
be tested without it.

Stdlib only, to match the rest of tools/.
"""
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest

SUBMIT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "submit_indexnow.py")

_spec = importlib.util.spec_from_file_location("submit_indexnow", SUBMIT_PATH)
submit_indexnow = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(submit_indexnow)

SITE = submit_indexnow.SITE
KEY = "0123456789abcdef0123456789abcdef"
LASTMOD = "2026-08-01"


def sitemap(routes, site=SITE, lastmod=LASTMOD):
    """A sitemap of routes; a route may be (route, lastmod) to set its own date."""
    locs = "".join(
        "<url><loc>{}{}</loc><lastmod>{}</lastmod></url>".format(
            site, *(route if isinstance(route, tuple) else (route, lastmod)))
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

    def write_sitemap(self, routes, **kwargs):
        with open("sitemap.xml", "w", encoding="utf-8") as handle:
            handle.write(sitemap(routes, **kwargs))

    def write_page(self, name):
        directory = os.path.dirname(name)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(name, "w", encoding="utf-8") as handle:
            handle.write("<html></html>")

    def git(self, *args):
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, check=True,
            env=dict(os.environ, GIT_AUTHOR_DATE="2026-08-01T12:00:00+00:00",
                     GIT_COMMITTER_DATE="2026-08-01T12:00:00+00:00"),
        ).stdout

    def init_repo(self):
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.git("config", "commit.gpgsign", "false")

    def commit(self, message="change"):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

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

    def test_the_real_key_is_found_alongside_robots_and_llms(self):
        # The test above passes even with KEY_PATTERN deleted, because robots.txt
        # would still fail the body-equals-stem check and raise by another route.
        # This is the case that actually pins the filter: with the real key
        # present, dropping the filter makes robots.txt and llms.txt candidates
        # too, and find_key raises "more than one" instead of returning the key.
        self.write_key()
        for name in ("robots.txt", "llms.txt"):
            with open(name, "w", encoding="utf-8") as handle:
                handle.write("User-agent: *\nAllow: /\n")
        self.assertEqual(submit_indexnow.find_key(), KEY)

    def test_two_hex_shaped_files_are_ambiguous_rather_than_a_coin_flip(self):
        self.write_key()
        self.write_key(name="f" * 32 + ".txt", body="f" * 32)
        with self.assertRaises(submit_indexnow.IndexNowError):
            submit_indexnow.find_key()

    # --- refusing to run in the wrong place ----------------------------------

    def test_running_outside_the_site_root_fails_rather_than_succeeding(self):
        # A stray hex-named file in an unrelated directory looks exactly like a
        # key. Without this the tool reports success while submitting a garbage
        # key from wherever it happened to be run.
        self.write_key()
        sent = []
        self.assertEqual(submit_indexnow.main(["/msp-ma-advisor"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    # --- translating network failures ----------------------------------------

    def test_an_http_error_becomes_an_indexnow_error(self):
        import urllib.error

        def raise_http(*_args, **_kwargs):
            raise urllib.error.HTTPError(
                submit_indexnow.ENDPOINT, 422, "Unprocessable", {}, io.BytesIO(b"bad key"))

        original = submit_indexnow.urllib.request.urlopen
        submit_indexnow.urllib.request.urlopen = raise_http
        try:
            with self.assertRaises(submit_indexnow.IndexNowError) as caught:
                submit_indexnow.post(submit_indexnow.build_payload(KEY, [SITE + "/"]))
            self.assertIn("422", str(caught.exception))
        finally:
            submit_indexnow.urllib.request.urlopen = original

    def test_an_unreachable_endpoint_becomes_an_indexnow_error(self):
        import urllib.error

        def raise_url(*_args, **_kwargs):
            raise urllib.error.URLError("name resolution failed")

        original = submit_indexnow.urllib.request.urlopen
        submit_indexnow.urllib.request.urlopen = raise_url
        try:
            with self.assertRaises(submit_indexnow.IndexNowError):
                submit_indexnow.post(submit_indexnow.build_payload(KEY, [SITE + "/"]))
        finally:
            submit_indexnow.urllib.request.urlopen = original

    def test_an_unreadable_key_file_is_reported_cleanly(self):
        # An I/O oddity should still print "IndexNow: ..." rather than dumping a
        # traceback at whoever ran it.
        self.write_sitemap(["/"])
        with open(KEY + ".txt", "wb") as handle:
            handle.write(b"\xff\xfe not utf-8")
        sent = []
        self.assertEqual(submit_indexnow.main(["/msp-ma-advisor"], submit=sent.append), 1)
        self.assertEqual(sent, [])

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
        self.write_page("msp-ma-advisor.html")
        sent = []
        self.assertEqual(submit_indexnow.main([SITE + "/msp-ma-advisor"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/msp-ma-advisor"])

    def test_a_bare_route_is_accepted_and_expanded(self):
        # Typing the full origin every time invites a typo in the one field that
        # has to match exactly.
        self.write_key()
        self.write_sitemap(["/"])
        self.write_page("msp-ma-advisor.html")
        sent = []
        self.assertEqual(submit_indexnow.main(["/msp-ma-advisor"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/msp-ma-advisor"])

    # --- a route must have a page behind it -----------------------------------

    def test_a_route_with_no_page_behind_it_is_rejected(self):
        # A typo in a route announces a URL that 404s. The engines fetch it,
        # find nothing, and the one page that actually changed goes unannounced.
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["/msp-ma-advisr"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_a_full_url_with_no_page_behind_it_is_rejected_too(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main([SITE + "/nope"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_which_file_answers_each_route(self):
        self.write_page("index.html")
        self.write_page("about.html")
        self.write_page("articles/msp-valuation-multiples-2026.html")
        self.write_page("feed.xml")
        self.write_page("assets/Salt-Creek-2026-MSP-MA-Valuation-Guide.pdf")
        for route in ["/", "/about", "/articles/msp-valuation-multiples-2026", "/feed.xml",
                      "/assets/Salt-Creek-2026-MSP-MA-Valuation-Guide.pdf"]:
            self.assertTrue(submit_indexnow.page_exists(SITE + route), route)
        for route in ["/contact", "/articles/msp-valuation-multiples", "/about.html",
                      "/llms.txt", "/assets/missing.pdf", "/about/"]:
            self.assertFalse(submit_indexnow.page_exists(SITE + route), route)

    def test_removed_allows_a_route_with_no_page(self):
        # A deleted or redirected URL is worth announcing so the engines drop
        # or re-crawl it, and by definition it has no file behind it.
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--removed", "/old-page"], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/old-page"])

    def test_removed_still_checks_the_host(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--removed", "https://example.com/x"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_removed_with_all_is_an_error(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--removed", "--all"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    # --- --since <ref>: only what changed ------------------------------------

    def test_since_submits_what_is_new_or_changed_since_the_ref(self):
        self.init_repo()
        self.write_key()
        self.write_sitemap([("/", "2026-08-01"), ("/about", "2026-08-01"), ("/faq", "2026-08-01")])
        before = self.commit("before")
        self.write_sitemap([
            ("/", "2026-08-01"),          # unchanged
            ("/about", "2026-09-15"),     # lastmod moved
            ("/contact", "2026-09-15"),   # new
            # /faq dropped: it is redirected now, and that is not announced here
        ])
        self.commit("after")
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", before], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/about", SITE + "/contact"])

    def test_since_reads_the_working_copy_not_head(self):
        # The workflow runs on the pushed commit, but by hand this is run after
        # build_feed.py and before the regenerated sitemap is committed.
        self.init_repo()
        self.write_key()
        self.write_sitemap([("/", "2026-08-01")])
        before = self.commit("before")
        self.write_sitemap([("/", "2026-08-01"), ("/about", "2026-09-15")])
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", before], submit=sent.append), 0)
        self.assertEqual(sent[0]["urlList"], [SITE + "/about"])

    def test_since_with_nothing_changed_submits_nothing_and_succeeds(self):
        # On a push that touched no page, the workflow must stay green and quiet.
        self.init_repo()
        self.write_key()
        self.write_sitemap(["/", "/about"])
        before = self.commit("before")
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", before], submit=sent.append), 0)
        self.assertEqual(sent, [])

    def test_since_skips_when_the_previous_sitemap_is_on_another_host(self):
        # After a domain move every URL looks new. That announcement belongs to
        # the engines' site-move tools and a deliberate --all, not to a push.
        self.init_repo()
        self.write_key()
        self.write_sitemap(["/", "/about"], site="https://previous-domain.example")
        before = self.commit("before")
        self.write_sitemap(["/", "/about"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", before], submit=sent.append), 0)
        self.assertEqual(sent, [])

    def test_since_a_ref_with_no_sitemap_is_an_error(self):
        self.init_repo()
        self.write_key()
        self.write_page("index.html")
        before = self.commit("before")
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", before], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_since_an_unknown_ref_is_an_error(self):
        self.init_repo()
        self.write_key()
        self.write_sitemap(["/"])
        self.commit("before")
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", "not-a-ref"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_since_without_a_ref_is_an_error(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--since"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_since_cannot_be_combined_with_all_or_explicit_urls(self):
        self.write_key()
        self.write_sitemap(["/"])
        sent = []
        self.assertEqual(submit_indexnow.main(["--since", "HEAD", "--all"], submit=sent.append), 1)
        self.assertEqual(submit_indexnow.main(["--since", "HEAD", "/about"], submit=sent.append), 1)
        self.assertEqual(sent, [])

    def test_since_dry_run_lists_without_submitting(self):
        self.init_repo()
        self.write_key()
        self.write_sitemap(["/"])
        before = self.commit("before")
        self.write_sitemap(["/", "/about"])

        def refuse(_payload):
            raise AssertionError("a dry run must not reach the network")

        self.assertEqual(submit_indexnow.main(["--since", before, "--dry-run"], submit=refuse), 0)

    def test_changed_since_compares_loc_and_lastmod(self):
        old = sitemap([("/", "2026-08-01"), ("/a", "2026-08-01")])
        new = sitemap([("/", "2026-08-01"), ("/a", "2026-08-02"), ("/b", "2026-08-02")])
        self.assertEqual(submit_indexnow.changed_since(old, new), [SITE + "/a", SITE + "/b"])

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
