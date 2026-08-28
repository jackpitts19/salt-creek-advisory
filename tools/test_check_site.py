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
import datetime
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
        # A clean baseline that each test breaks in exactly one way. index links to
        # about so the baseline satisfies the orphan check too.
        self.write("index.html", page("/", body='<a href="/about">About</a>'))
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

    def run_checker(self, *argv):
        """Returns (exit_code, combined_output)."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_site.main(argv)
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
        self.write("index.html", page("/", body=(
            '<a href="/about">About</a><a href="/articles/foo">Guide</a>')))
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

    # --- orphan detection ----------------------------------------------------

    def test_page_nothing_links_to_is_caught(self):
        """In the sitemap but unreachable by crawling: four articles shipped this way."""
        self.write("unlinked.html", page("/unlinked"))
        self.write_sitemap(["/", "/about", "/unlinked"])
        self.assertFails("/unlinked is indexable but no other page links to it")

    def test_linked_page_is_not_an_orphan(self):
        self.write("index.html",
                   page("/", body='<a href="/about">About</a><a href="/reachable">Go</a>'))
        self.write("reachable.html", page("/reachable"))
        self.write_sitemap(["/", "/about", "/reachable"])
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a linked page should not be an orphan:\n" + output)

    def test_self_link_does_not_rescue_an_orphan(self):
        """A page linking only to itself is still unreachable from anywhere else."""
        self.write("lonely.html", page("/lonely", body='<a href="/lonely">Me</a>'))
        self.write_sitemap(["/", "/about", "/lonely"])
        self.assertFails("/lonely is indexable but no other page links to it")

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

    # --- required schema fields, not just parseable JSON ---------------------

    def test_dataset_without_description_is_caught(self):
        # Shipped for real: three Dataset citations parsed fine and Search
        # Console still reported them invalid.
        node = ('<script type="application/ld+json">'
                '{"@type": "Dataset", "name": "Some Series"}</script>')
        self.write("about.html", page("/about", head=node))
        self.assertFails("missing description")

    def test_dataset_nested_in_a_citation_list_is_checked(self):
        # The real ones sit inside an Article's citation array, not at the top
        # level, so the walk has to recurse.
        node = ('<script type="application/ld+json">'
                '{"@type": "Article", "citation": ['
                '{"@type": "Dataset", "name": "Buried Series"}]}</script>')
        self.write("about.html", page("/about", head=node))
        self.assertFails("Buried Series")

    def test_complete_dataset_passes(self):
        node = ('<script type="application/ld+json">'
                '{"@type": "Dataset", "name": "Some Series",'
                ' "description": "What it measures."}</script>')
        self.write("about.html", page("/about", head=node))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a complete Dataset should pass:\n" + output)

    # --- the Worker's guide list must match the files on disk ----------------

    def write_worker(self, slugs, year="2026"):
        """A synthetic src/index.js carrying just the two literals we parse."""
        listed = "".join('  "{}",\n'.format(slug) for slug in slugs)
        self.write("src/index.js", (
            'const CURRENT_GUIDE_YEAR = "{}";\n\n'
            "const YEAR_STAMPED_GUIDES = new Set([\n{}]);\n"
        ).format(year, listed))

    def write_guide(self, slug, year="2026"):
        """A year-stamped guide, linked from index so it is not an orphan."""
        route = "/articles/{}-{}".format(slug, year)
        self.write("articles/{}-{}.html".format(slug, year), page(route))
        self.write("index.html", page("/", body=(
            '<a href="/about">About</a><a href="{}">Guide</a>'.format(route))))
        self.write_sitemap(["/", "/about", route])

    def test_worker_slugs_matching_disk_passes(self):
        self.write_guide("alpha-guide")
        self.write_worker(["alpha-guide"])
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a matching guide list should pass:\n" + output)

    def test_worker_slug_without_a_file_is_caught(self):
        # Sends visitors from the old URL straight into a 404.
        self.write_guide("alpha-guide")
        self.write_worker(["alpha-guide", "beta-guide"])
        self.assertFails("beta-guide")

    def test_year_stamped_file_missing_from_worker_is_caught(self):
        # The guide is still reachable, but everything linking to its
        # pre-rename URL is dead, which is the failure nobody notices.
        self.write_guide("alpha-guide")
        self.write_worker([])
        self.assertFails("missing from YEAR_STAMPED_GUIDES")

    def test_unparseable_worker_is_caught(self):
        self.write_guide("alpha-guide")
        self.write("src/index.js", "export default { fetch() {} };\n")
        self.assertFails("cannot be verified")

    def test_stale_guide_year_warns_but_does_not_fail(self):
        # The whole site can be internally consistent and still be advertising
        # last year. Warn, do not fail: a build that breaks on New Year's Day
        # just teaches people to ignore the checker.
        self.write_guide("alpha-guide", year="2019")
        self.write_worker(["alpha-guide"], year="2019")
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a stale year should warn, not fail:\n" + output)
        self.assertIn("CURRENT_GUIDE_YEAR is 2019", output)

    def test_current_guide_year_does_not_warn(self):
        current = str(datetime.date.today().year)
        self.write_guide("alpha-guide", year=current)
        self.write_worker(["alpha-guide"], year=current)
        code, output = self.run_checker()
        self.assertEqual(code, 0, output)
        self.assertNotIn("CURRENT_GUIDE_YEAR is", output)

    def test_strict_year_turns_a_stale_year_into_a_failure(self):
        # The scheduled rollover job asks for this mode so a stale year can
        # raise an issue. Pushes keep the warning: see the test above.
        self.write_guide("alpha-guide", year="2019")
        self.write_worker(["alpha-guide"], year="2019")
        code, output = self.run_checker("--strict-year")
        self.assertEqual(code, 1, "--strict-year should fail on a stale year:\n" + output)
        self.assertIn("CURRENT_GUIDE_YEAR is 2019", output)

    def test_strict_year_is_quiet_when_the_year_is_current(self):
        # 51 weeks a year this is the path that runs, so it has to stay silent
        # or the job becomes noise and gets muted.
        current = str(datetime.date.today().year)
        self.write_guide("alpha-guide", year=current)
        self.write_worker(["alpha-guide"], year=current)
        code, output = self.run_checker("--strict-year")
        self.assertEqual(code, 0, "a current year should pass under --strict-year:\n" + output)
        self.assertNotIn("CURRENT_GUIDE_YEAR is", output)

    def test_strict_year_leaves_a_year_ahead_as_a_warning(self):
        # Pre-stamping next year's guides early is a deliberate act, not rot,
        # so it must not wake anyone up at 08:00 on a Monday.
        ahead = str(datetime.date.today().year + 1)
        self.write_guide("alpha-guide", year=ahead)
        self.write_worker(["alpha-guide"], year=ahead)
        code, output = self.run_checker("--strict-year")
        self.assertEqual(code, 0, "a year ahead should warn, not fail:\n" + output)
        self.assertIn("ahead of the current year", output)

    def test_missing_worker_skips_the_check(self):
        # The checker still has to run against a plain directory of HTML.
        code, output = self.run_checker()
        self.assertEqual(code, 0, "no Worker should not fail the run:\n" + output)

    # --- warnings inform without failing the run -----------------------------

    def test_long_title_warns_but_does_not_fail(self):
        long_title = "A" * (check_site.MAX_TITLE_CHARS + 5)
        self.write("about.html", page("/about", title=long_title))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a long title should not fail the run")
        self.assertIn("Google truncates past", output)

    def test_entities_count_as_the_character_they_render(self):
        # "&amp;" is five characters in the source and one on the SERP. Counting
        # the source spent two warnings on titles that were never too long, and
        # the tempting fix for a false warning is to damage a good title.
        # " &amp; B" is eight characters of source and four of rendered text, so
        # this lands one character over the limit before the fix and exactly on
        # it after. A wider margin would pass either way and prove nothing.
        title = "A" * (check_site.MAX_TITLE_CHARS - 4) + " &amp; B"
        self.write("about.html", page("/about", title=title))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a long title should not fail the run")
        self.assertNotIn("Google truncates past", output)

    def test_description_entities_count_as_rendered(self):
        description = "A" * (check_site.MAX_DESCRIPTION_CHARS - 4) + " &amp; B"
        self.write("about.html", page("/about", description=description))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a long description should not fail the run")
        self.assertNotIn("meta description is", output)



class PublishChecklistTestCase(unittest.TestCase):
    """The two publish-checklist steps that drift silently: llms.txt and RELATED.

    Both are enforced by check_site.py rather than trusted to a list in the docs,
    because trusting the list is exactly what failed. The dental guide shipped
    satisfying steps 1 through 4, missing step 6 entirely and half of step 5, and
    every check on the site stayed green while it sat at one inbound internal link
    against three to eight for its peers.
    """

    def setUp(self):
        self._origin = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)
        # A guide, an essay (deliberately year-free), and a hub linking to both,
        # so the baseline satisfies the orphan and sitemap checks too.
        self.write("index.html", page("/", body=(
            '<a href="/articles/guide-one-2026">One</a>'
            '<a href="/articles/an-essay">Essay</a>')))
        self.write("articles/guide-one-2026.html", page("/articles/guide-one-2026"))
        self.write("articles/an-essay.html", page("/articles/an-essay"))
        self.write("src/index.js", 'const CURRENT_GUIDE_YEAR = "2026"\n'
                   'const YEAR_STAMPED_GUIDES = new Set([\n  "guide-one",\n])\n')
        self.write("sitemap.xml", sitemap(["/", "/articles/guide-one-2026", "/articles/an-essay"]))
        self.write_llms(["guide-one-2026", "an-essay"])
        self.write_related({"guide-one": ["an-essay"], "an-essay": ["guide-one"]})

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

    def write_llms(self, slugs):
        lines = ["# Site"] + [
            "- [{0}]({1}/articles/{0}): a summary".format(slug, SITE) for slug in slugs]
        self.write("llms.txt", "\n".join(lines) + "\n")

    def write_related(self, mapping):
        rows = "".join(
            '    "{}": [{}],\n'.format(key, ", ".join('"{}"'.format(t) for t in targets))
            for key, targets in mapping.items())
        self.write("tools/build_related.py", "RELATED = {\n" + rows + "}\n")

    def run_checker(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_site.main(argv)
        return code, out.getvalue() + err.getvalue()

    def assertFails(self, needle):
        code, output = self.run_checker()
        self.assertEqual(code, 1, "expected a failure, got a clean run:\n" + output)
        self.assertIn(needle, output)

    def test_a_complete_site_passes(self):
        code, output = self.run_checker()
        self.assertEqual(code, 0, "complete site should pass:\n" + output)

    def test_an_essay_is_not_stamped_with_the_year(self):
        """The regression this check got wrong first time.

        Essays carry no year, so resolving a RELATED target by blindly appending
        the suffix reports all four of them as broken links on a healthy site.
        build_related.py derives which bases are stamped from disk; so must this.
        """
        code, output = self.run_checker()
        self.assertEqual(code, 0, "essays must not be year-stamped:\n" + output)
        self.assertNotIn("an-essay-2026", output)

    # --- step 6: llms.txt ------------------------------------------------------

    def test_an_article_missing_from_llms_txt_fails(self):
        self.write_llms(["an-essay"])
        self.assertFails("publish checklist step 6")

    def test_llms_txt_naming_a_deleted_article_fails(self):
        """An entry for a page that is gone teaches an assistant to cite a 404."""
        self.write_llms(["guide-one-2026", "an-essay", "guide-that-was-deleted-2026"])
        self.assertFails("which no longer exists")

    def test_a_missing_llms_txt_is_skipped_not_failed(self):
        os.remove(os.path.join(self._tmp.name, "llms.txt"))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "absent llms.txt should skip:\n" + output)

    # --- step 5: the RELATED map ----------------------------------------------

    def test_a_guide_that_is_never_a_target_fails(self):
        """The dental bug exactly: a key with a Keep Reading block and no inbound links."""
        self.write_related({"guide-one": ["an-essay"], "an-essay": []})
        self.assertFails("no other guide lists it as a target")

    def test_a_guide_with_no_related_entry_fails(self):
        self.write_related({"guide-one": ["guide-one"]})
        self.assertFails("has no entry in the RELATED map")

    def test_a_related_target_that_does_not_exist_fails(self):
        self.write_related({
            "guide-one": ["an-essay"],
            "an-essay": ["guide-one", "a-guide-that-does-not-exist"]})
        self.assertFails("which does not exist")

    def test_a_related_entry_with_no_article_behind_it_fails(self):
        self.write_related({
            "guide-one": ["an-essay"], "an-essay": ["guide-one"], "ghost-guide": ["guide-one"]})
        self.assertFails("no article on disk matches")

    def test_a_missing_related_map_is_skipped_not_failed(self):
        os.remove(os.path.join(self._tmp.name, "tools", "build_related.py"))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "absent build_related.py should skip:\n" + output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
