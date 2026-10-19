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
import json
import os
import tempfile
import unittest

CHECK_SITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_site.py")

_spec = importlib.util.spec_from_file_location("check_site", CHECK_SITE_PATH)
check_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_site)

SITE = check_site.SITE


def page(route, title="Sample Page", description="A sample description.",
         canonical=None, head="", body="", footer_legal=True):
    """A minimal page that passes every check unless an argument breaks it.

    footer_legal defaults on because every real page carries the regulatory
    disclosure; pass False to build the one case that omits it.
    """
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
        + "</head><body>" + body
        + ('<p class="footer-legal">Salt Creek Advisory LLC operates as an investment '
           "bank. Not a broker-dealer, not a registered investment adviser.</p>"
           if footer_legal else "")
        + "</body></html>"
    )


def sitemap(routes):
    locs = "".join("<url><loc>{}{}</loc></url>".format(SITE, route) for route in routes)
    return '<?xml version="1.0" encoding="UTF-8"?><urlset>' + locs + "</urlset>"


def json_ld(document):
    """One JSON-LD block, as every page carries them."""
    return '<script type="application/ld+json">{}</script>'.format(json.dumps(document))


ORGANIZATION_ID = SITE + "/#organization"


def organization(name="Salt Creek Advisory", url=SITE + "/", **fields):
    """The firm's node as the home page defines it, with any field overridden."""
    node = {"@type": "Organization", "@id": ORGANIZATION_ID, "name": name, "url": url}
    node.update(fields)
    return node


def pointer(node_id=ORGANIZATION_ID):
    """A bare reference to a node defined elsewhere: only an @id."""
    return {"@id": node_id}


def article(route, **fields):
    """An Article node carrying every field Google requires, for `route`."""
    node = {
        "@type": "Article", "headline": "A Guide", "image": SITE + "/og-image.jpg",
        "datePublished": "2026-01-01", "dateModified": "2026-01-01",
        "author": {"@type": "Person", "name": "Jack Pitts"},
        "publisher": organization(), "url": SITE + route,
        "mainEntityOfPage": {"@type": "WebPage", "@id": SITE + route},
    }
    node.update(fields)
    return node


def without(node, field):
    """A copy of `node` with one field left out, for the optional-field cases."""
    return {key: value for key, value in node.items() if key != field}


def breadcrumbs(*items):
    """A BreadcrumbList over (name, route) pairs, Home first."""
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": position, "name": name, "item": SITE + route}
        for position, (name, route) in enumerate(items, 1)]}


class SyntheticSiteTestCase(unittest.TestCase):
    """Runs the checker against a synthetic site written to a temp directory.

    Each test builds the site it needs, breaks exactly one thing, and asserts
    the checker notices. write_baseline() gives the smallest site that passes
    every check: two pages, linked, both in the sitemap.
    """

    def setUp(self):
        self._origin = os.getcwd()
        self._tmp = tempfile.TemporaryDirectory()
        os.chdir(self._tmp.name)

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

    def write_baseline(self):
        # index links to about so the baseline satisfies the orphan check too.
        self.write("index.html", page("/", body='<a href="/about">About</a>'))
        self.write("about.html", page("/about"))
        self.write_sitemap(["/", "/about"])

    def run_checker(self, *argv):
        """Returns (exit_code, combined_output)."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_site.main(argv)
        return code, out.getvalue() + err.getvalue()

    def assertPasses(self, reason="a clean site should pass"):
        code, output = self.run_checker()
        self.assertEqual(code, 0, reason + ":\n" + output)
        return output

    def assertFails(self, needle):
        code, output = self.run_checker()
        self.assertEqual(code, 1, "expected a failure, got a clean run:\n" + output)
        self.assertIn(needle, output)
        return output


class CheckSiteTestCase(SyntheticSiteTestCase):
    """Every check in the page loop, against the two-page baseline."""

    def setUp(self):
        super().setUp()
        # A clean baseline that each test breaks in exactly one way.
        self.write_baseline()

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
        self.write("about.html", page("/about", head=json_ld(article("/about"))))
        self.assertPasses("valid JSON-LD should pass")

    def test_image_without_alt_is_caught(self):
        self.write("about.html", page("/about", body='<img src="/logo.png">'))
        self.assertFails("without alt")

    # --- links the guard used to skip ----------------------------------------

    def test_single_quoted_broken_link_is_caught(self):
        self.write("about.html", page("/about", body="<a href='/does-not-exist'>Gone</a>"))
        self.assertFails("does-not-exist")

    def test_single_quoted_valid_link_passes(self):
        self.write("index.html", page("/", body="<a href='/about'>About</a>"))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a single-quoted link to a real page should pass:\n" + output)

    def test_absolute_link_to_our_own_site_is_validated(self):
        self.write("about.html", page("/about", body=(
            '<a href="{}/does-not-exist">Gone</a>'.format(SITE))))
        self.assertFails("does-not-exist")

    def test_absolute_www_link_is_validated(self):
        self.write("about.html", page("/about", body=(
            '<a href="https://www.saltcreekadvisory.com/missing-page">Gone</a>')))
        self.assertFails("missing-page")

    def test_absolute_link_to_a_real_page_passes(self):
        self.write("index.html", page("/", body=(
            '<a href="https://www.saltcreekadvisory.com/about?utm_source=x#team">About</a>')))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "an absolute link to a real page should pass:\n" + output)

    def test_absolute_self_link_counts_toward_orphans(self):
        """An absolute link from another page is a real inbound link."""
        self.write("index.html", page("/", body=(
            '<a href="/about">About</a><a href="{}/reachable">Go</a>'.format(SITE))))
        self.write("reachable.html", page("/reachable"))
        self.write_sitemap(["/", "/about", "/reachable"])
        code, output = self.run_checker()
        self.assertEqual(code, 0, "an absolute inbound link should count:\n" + output)

    def test_other_hosts_are_not_resolved_locally(self):
        self.write("about.html", page("/about", body=(
            '<a href="https://example.com/does-not-exist">Out</a>'
            '<a href="//cdn.example.com/x.js">Cdn</a>'
            '<a href="https://saltcreekadvisory.com.evil.example/x">Lookalike</a>')))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "external links are not local files:\n" + output)

    # --- image dimensions ----------------------------------------------------

    def test_image_with_numeric_dimensions_passes(self):
        self.write("logo.png", "")
        self.write("about.html", page("/about", body=(
            '<img src="/logo.png" alt="Logo" width="120" height=\'40\'>'
            '<img src="/logo.png" alt="" width=16 height=16 />')))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "sized images should pass:\n" + output)

    def test_image_without_width_is_caught(self):
        self.write("logo.png", "")
        self.write("about.html", page("/about", body='<img src="/logo.png" alt="Logo" height="40">'))
        self.assertFails("without numeric width and height")

    def test_image_without_height_is_caught(self):
        self.write("logo.png", "")
        self.write("about.html", page("/about", body='<img src="/logo.png" alt="Logo" width="40">'))
        self.assertFails("without numeric width and height")

    def test_non_numeric_dimensions_are_caught(self):
        self.write("logo.png", "")
        self.write("about.html", page("/about", body=(
            '<img src="/logo.png" alt="Logo" width="100%" height="auto">')))
        self.assertFails("without numeric width and height")

    def test_data_width_does_not_count_as_width(self):
        self.write("logo.png", "")
        self.write("about.html", page("/about", body=(
            '<img src="/logo.png" alt="Logo" data-width="40" data-height="40">')))
        self.assertFails("without numeric width and height")

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
        node = article("/about", citation=[{"@type": "Dataset", "name": "Buried Series"}])
        self.write("about.html", page("/about", head=json_ld(node)))
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

    # --- fonts are self-hosted ------------------------------------------------

    def test_a_page_pulling_a_google_fonts_stylesheet_fails(self):
        self.write("about.html", page(
            "/about",
            head='<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />'))
        self.assertFails("references fonts.googleapis.com")

    def test_a_preconnect_to_a_font_host_fails(self):
        self.write("about.html", page(
            "/about", head='<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'))
        self.assertFails("references fonts.gstatic.com")

    def test_a_font_preload_with_no_file_behind_it_fails(self):
        self.write("about.html", page(
            "/about",
            head='<link rel="preload" href="/fonts/missing.woff2" as="font" type="font/woff2" crossorigin />'))
        self.assertFails("font preload /fonts/missing.woff2 has no file at fonts/missing.woff2")

    def test_a_font_preload_with_a_file_behind_it_passes(self):
        self.write("fonts/inter-var.woff2", "wOF2")
        self.write("about.html", page(
            "/about",
            head='<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />'))
        code, output = self.run_checker()
        self.assertEqual(code, 0, output)

    def test_a_relative_font_preload_resolves_from_the_page_directory(self):
        self.write("fonts/inter-var.woff2", "wOF2")
        self.write("articles/guide.html", page(
            "/articles/guide",
            head='<link rel="preload" href="../fonts/inter-var.woff2" as="font" crossorigin />'))
        self.write("index.html", page("/", body='<a href="/about">About</a><a href="/articles/guide">G</a>'))
        self.write_sitemap(["/", "/about", "/articles/guide"])
        code, output = self.run_checker()
        self.assertEqual(code, 0, output)

    def test_a_non_font_preload_is_left_alone(self):
        self.write("hero.jpg", "jpg")
        self.write("about.html", page(
            "/about", head='<link rel="preload" href="/hero.jpg" as="image" />'))
        code, output = self.run_checker()
        self.assertEqual(code, 0, output)

    def test_a_stylesheet_font_url_without_a_file_fails(self):
        self.write("styles.css", "@font-face { font-family: X; src: url('fonts/nope.woff2') format('woff2'); }")
        self.assertFails("styles.css: @font-face names fonts/nope.woff2 but there is no file at fonts/nope.woff2")

    def test_a_stylesheet_font_url_with_a_file_passes(self):
        self.write("fonts/ok.woff2", "wOF2")
        self.write("styles.css", '@font-face { font-family: X; src: url("fonts/ok.woff2") format("woff2"); }')
        code, output = self.run_checker()
        self.assertEqual(code, 0, output)


    def test_the_short_form_in_the_navigation_lockup_passes(self):
        self.write("about.html", page(
            "/about", body='Salt Creek <span class="nav-logo-text-sub">Advisory</span>'))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "the short lockup should pass:\n" + output)

    def test_the_short_form_and_other_firms_pass(self):
        body = ("<p>Salt Creek Advisory helps owners. Salt Creek Advisory&rsquo;s team, "
                "unlike Bain &amp; Company, is two people.</p>")
        self.write("about.html", page("/about", body=body))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "the short form should pass:\n" + output)


class OrganizationPointerTestCase(SyntheticSiteTestCase):
    """A page that points at the firm's node must also define it.

    JSON-LD references are resolved per page, not per site. Fifteen root pages
    carried `"publisher": {"@id": ".../#organization"}` and nothing else, so on
    every one of them a crawler saw a publisher with no name, which Search
    Console reports as a missing field and an answer engine reads as nothing.
    """

    def setUp(self):
        super().setUp()
        self.write("index.html", page("/", head=json_ld(organization()),
                                      body='<a href="/about">About</a>'))
        self.write("about.html", page("/about"))
        self.write_sitemap(["/", "/about"])

    def write_about(self, *documents):
        self.write("about.html", page("/about", head="".join(json_ld(d) for d in documents)))

    def test_a_page_with_no_pointer_passes(self):
        self.assertPasses()

    def test_a_pointer_with_no_definition_on_the_page_fails(self):
        self.write_about({"@type": "AboutPage", "publisher": pointer()})
        self.assertFails("about.html: JSON-LD points at {} but no node on this page "
                         "defines it".format(ORGANIZATION_ID))

    def test_a_pointer_beside_a_matching_definition_passes(self):
        self.write_about({"@type": "AboutPage", "publisher": pointer()}, organization())
        self.assertPasses("a pointer resolved on the same page should pass")

    def test_the_definition_inside_a_graph_counts(self):
        self.write_about({"@context": "https://schema.org", "@graph": [
            {"@type": "AboutPage", "about": pointer(), "publisher": pointer()}, organization()]})
        self.assertPasses("a definition anywhere on the page should count")

    def test_a_definition_whose_name_differs_from_the_home_page_fails(self):
        self.write_about({"@type": "AboutPage", "publisher": pointer()},
                         organization(name="The Pitts Firm"))
        self.assertFails("about.html: {} is named 'The Pitts Firm' here but "
                         "'Salt Creek Advisory' on index.html".format(ORGANIZATION_ID))

    def test_a_definition_whose_url_differs_from_the_home_page_fails(self):
        self.write_about({"@type": "AboutPage", "publisher": pointer()},
                         organization(url=SITE + "/about"))
        self.assertFails("about.html: {} has url '{}/about' here but '{}/' on "
                         "index.html".format(ORGANIZATION_ID, SITE, SITE))

    def test_a_home_page_that_defines_nothing_is_reported_once(self):
        self.write("index.html", page("/", body='<a href="/about">About</a>'))
        self.write_about({"@type": "AboutPage", "publisher": pointer()}, organization())
        output = self.assertFails("index.html: defines no node with @id {}, so no other "
                                  "page's copy can be checked against it".format(ORGANIZATION_ID))
        self.assertEqual(output.count("defines no node"), 1)

    def test_pointers_at_other_nodes_are_left_alone(self):
        # The website node and the principals live on other pages by design;
        # only the firm's own node has to travel with every page that cites it.
        self.write_about({"@type": "AboutPage", "isPartOf": pointer(SITE + "/#website"),
                          "mainEntity": pointer(SITE + "/#jack-pitts")})
        self.assertPasses("pointers at other nodes are not this check's business")

    # --- the legal pages wait for counsel ------------------------------------

    def write_privacy(self, *documents):
        self.write("privacy.html", page("/privacy", head="".join(json_ld(d) for d in documents)))
        self.write("index.html", page("/", head=json_ld(organization()),
                                      body='<a href="/about">About</a><a href="/privacy">Privacy</a>'))
        self.write_sitemap(["/", "/about", "/privacy"])

    def test_a_held_legal_page_with_only_a_pointer_warns_instead_of_failing(self):
        """privacy.html may not be edited until counsel clears it (decision I),
        so its bare pointer stays in view as a warning rather than a failure."""
        self.write_privacy({"@type": "WebPage", "publisher": pointer()})
        output = self.assertPasses("a held legal page is a warning, not an error")
        self.assertIn("warn  privacy.html: JSON-LD points at {} but no node on this page "
                      "defines it".format(ORGANIZATION_ID), output)
        self.assertIn("held for counsel", output)

    def test_a_held_legal_page_that_defines_the_node_differently_still_fails(self):
        # The hold covers the missing node only; a wrong one is wrong anywhere.
        self.write_privacy({"@type": "WebPage", "publisher": pointer()},
                           organization(name="The Pitts Firm"))
        self.assertFails("privacy.html: {} is named 'The Pitts Firm' here but "
                         "'Salt Creek Advisory' on index.html".format(ORGANIZATION_ID))


def person(name="Jack Pitts", **fields):
    node = {"@type": "Person", "@id": SITE + "/#jack-pitts", "name": name,
            "jobTitle": "Co-Founder & Principal", "url": SITE + "/team#jack-pitts"}
    node.update(fields)
    return node


class StructuredDataTestCase(SyntheticSiteTestCase):
    """The markup that earns rich results and tells answer engines who wrote what.

    Parsing is not validating, and matching is not agreeing: an Article whose
    url names another page, a breadcrumb trail ending somewhere else, or a
    principal whose job title differs between two pages, all parse cleanly
    and all tell a crawler something false about this site.
    """

    def setUp(self):
        super().setUp()
        self.write_baseline()

    def write_about(self, *documents, route="/about"):
        self.write("about.html", page(route, head="".join(json_ld(d) for d in documents)))

    # --- required fields, per type ------------------------------------------

    def test_a_complete_article_faq_and_breadcrumb_trail_pass(self):
        faq = {"@type": "FAQPage", "url": SITE + "/about", "mainEntity": [
            {"@type": "Question", "name": "Q?", "acceptedAnswer": {"@type": "Answer", "text": "A."}}]}
        self.write_about(article("/about"), faq, breadcrumbs(("Home", "/"), ("About", "/about")))
        self.assertPasses()

    def test_an_article_missing_any_required_field_fails(self):
        for field in ("headline", "image", "datePublished", "dateModified", "author", "publisher"):
            with self.subTest(field=field):
                node = article("/about")
                del node[field]
                self.write_about(node)
                self.assertFails("Article node 'unnamed' is missing {}".format(field))

    def test_a_faq_page_without_questions_fails(self):
        self.write_about({"@type": "FAQPage", "url": SITE + "/about"})
        self.assertFails("FAQPage node 'unnamed' is missing mainEntity")

    def test_a_breadcrumb_list_without_items_fails(self):
        self.write_about({"@type": "BreadcrumbList"})
        self.assertFails("BreadcrumbList node 'unnamed' is missing itemListElement")

    # --- every self URL in the markup is the page's canonical -----------------

    def test_an_article_url_naming_another_page_fails(self):
        self.write_about(article("/about", url=SITE + "/"))
        self.assertFails("about.html: Article url '{}/' is not the page canonical "
                         "'{}/about'".format(SITE, SITE))

    def test_an_article_main_entity_naming_another_page_fails(self):
        self.write_about(article("/about", mainEntityOfPage={"@type": "WebPage", "@id": SITE + "/"}))
        self.assertFails("about.html: Article mainEntityOfPage '{}/' is not the page "
                         "canonical".format(SITE))

    def test_a_main_entity_written_as_a_bare_string_is_read(self):
        self.write_about(article("/about", mainEntityOfPage=SITE + "/about"))
        self.assertPasses("a string mainEntityOfPage naming the page should pass")
        self.write_about(article("/about", mainEntityOfPage=SITE + "/"))
        self.assertFails("Article mainEntityOfPage")

    def test_a_faq_page_url_naming_another_page_fails(self):
        self.write_about({"@type": "FAQPage", "url": SITE + "/", "mainEntity": [{"@type": "Question"}]})
        self.assertFails("about.html: FAQPage url '{}/' is not the page canonical".format(SITE))

    def test_a_faq_page_without_a_url_is_not_asked_for_one(self):
        self.write_about({"@type": "FAQPage", "mainEntity": [{"@type": "Question"}]})
        self.assertPasses("FAQPage url is optional")

    def test_an_article_without_a_url_is_not_asked_for_one(self):
        self.write_about(without(article("/about"), "url"))
        self.assertPasses("Article url is optional; only a wrong one is a finding")

    def test_an_article_without_a_main_entity_is_not_asked_for_one(self):
        self.write_about(without(article("/about"), "mainEntityOfPage"))
        self.assertPasses("Article mainEntityOfPage is optional; only a wrong one is a finding")

    def test_a_last_breadcrumb_without_an_item_is_not_asked_for_one(self):
        # Google's breadcrumb rules: `item` is required on every crumb but the last.
        trail = breadcrumbs(("Home", "/"), ("About", "/about"))
        crumbs = trail["itemListElement"]
        self.write_about({**trail, "itemListElement": crumbs[:-1] + [without(crumbs[-1], "item")]})
        self.assertPasses("the last crumb's item is optional; only a wrong one is a finding")

    def test_a_breadcrumb_trail_ending_on_another_page_fails(self):
        self.write_about(breadcrumbs(("Home", "/"), ("Contact", "/contact")))
        self.assertFails("about.html: the last breadcrumb item '{}/contact' is not the page "
                         "canonical".format(SITE))

    def test_a_trailing_slash_does_not_count_as_a_different_page(self):
        self.write("index.html", page("/", head=json_ld(breadcrumbs(("Home", "/"))),
                                      body='<a href="/about">About</a>'))
        self.assertPasses("the home canonical ends in a slash and so does its crumb")

    def test_a_page_without_a_canonical_is_not_compared(self):
        self.write("404.html", page("/404", canonical="", head=json_ld(article("/404")) + (
            '<meta name="robots" content="noindex, follow" />')))
        self.assertPasses("no canonical, nothing to compare against")

    # --- one @id, one set of facts, across the site ------------------------

    def write_team_and_guide(self, team_person, guide_person):
        self.write("team.html", page("/team", head=json_ld(team_person)))
        self.write("articles/guide.html", page("/articles/guide", head=json_ld(
            article("/articles/guide", author=guide_person))))
        self.write("index.html", page("/", body=(
            '<a href="/about">About</a><a href="/team">Team</a><a href="/articles/guide">G</a>')))
        self.write_sitemap(["/", "/about", "/team", "/articles/guide"])

    def test_copies_that_agree_pass(self):
        # The guide's copy carries less, and its url has no fragment. Both are fine.
        self.write_team_and_guide(
            person(sameAs=["https://a.example/", "https://b.example/"]),
            person(url=SITE + "/team", sameAs=["https://b.example/"]))
        self.assertPasses()

    def test_copies_that_disagree_on_a_name_fail(self):
        self.write_team_and_guide(person(), person(name="John Pitts"))
        self.assertFails("articles/guide.html: {}/#jack-pitts has name 'John Pitts' but "
                         "team.html has 'Jack Pitts'".format(SITE))

    def test_copies_that_disagree_on_a_job_title_fail(self):
        self.write_team_and_guide(person(), person(jobTitle="Principal"))
        self.assertFails("has jobTitle 'Principal' but team.html has 'Co-Founder & Principal'")

    def test_copies_whose_urls_differ_beyond_the_fragment_fail(self):
        self.write_team_and_guide(person(), person(url=SITE + "/about#jack-pitts"))
        self.assertFails("has url '{}/about#jack-pitts' but team.html has "
                         "'{}/team#jack-pitts'".format(SITE, SITE))

    def test_a_same_as_link_the_fullest_copy_lacks_fails(self):
        self.write_team_and_guide(
            person(sameAs=["https://a.example/", "https://b.example/"]),
            person(sameAs=["https://c.example/"]))
        self.assertFails("articles/guide.html: {}/#jack-pitts lists sameAs https://c.example/, "
                         "which the fullest copy on team.html does not".format(SITE))

    def test_a_field_one_copy_lacks_is_not_a_disagreement(self):
        node = person()
        del node["jobTitle"]
        self.write_team_and_guide(node, person())
        self.assertPasses("a copy may carry fewer fields, not different ones")

    def test_pointers_and_other_sites_ids_are_not_compared(self):
        self.write_team_and_guide(
            person(), {"@type": "Person", "@id": SITE + "/#jack-pitts"})
        self.write("about.html", page("/about", head=json_ld(
            {"@type": "Organization", "@id": "https://example.com/#org", "name": "A"})
            + json_ld({"@type": "Organization", "@id": "https://example.com/#org", "name": "B"})))
        self.assertPasses("a bare pointer carries no facts to disagree on")


class HeadingBreakTestCase(SyntheticSiteTestCase):
    """A <br> inside a heading must not sit between two words with no space.

    A browser breaks the line either way. Everything that reads the heading as
    text, a crawler, a feed reader, an answer engine quoting the title, sees
    the two words run together: 59 h1s read "SomethingElse", and in one guide
    the joined word was the firm's name.
    """

    def setUp(self):
        super().setUp()
        self.write_baseline()

    def write_heading(self, heading):
        self.write("about.html", page("/about", body=heading))

    def test_a_break_with_a_space_before_it_passes(self):
        self.write_heading("<h1>Selling a business <br>in 2026</h1>")
        self.assertPasses()

    def test_a_break_on_its_own_line_passes(self):
        self.write_heading("<h1>Selling a business<br>\n  in 2026</h1>")
        self.assertPasses()

    def test_a_break_between_two_words_fails(self):
        self.write_heading("<h1>Selling a business<br>in 2026</h1>")
        self.assertFails("about.html: <h1> breaks the line between 'business' and 'in' with "
                         "no space, so as text it reads 'businessin'")

    def test_every_break_spelling_is_read(self):
        for br in ("<br/>", "<br />", "<BR>", '<br class="x">'):
            with self.subTest(br=br):
                self.write_heading("<h2>Selling a business{}in 2026</h2>".format(br))
                self.assertFails("about.html: <h2> breaks the line")

    def test_a_break_inside_an_inline_tag_is_read(self):
        self.write_heading("<h1>Selling a <em>business<br>in</em> 2026</h1>")
        self.assertFails("reads 'businessin'")

    def test_a_non_breaking_space_counts_as_a_space(self):
        self.write_heading("<h1>Selling a business&nbsp;<br>in 2026</h1>")
        self.assertPasses("an entity space is still a space")

    def test_a_break_after_punctuation_still_needs_a_space(self):
        # "ready,in" is as joined as "readyin" to anything reading the text.
        self.write_heading("<h3>Ready,<br>set, sell</h3>")
        self.assertFails("reads 'Ready,set,'")

    def test_headings_without_breaks_are_left_alone(self):
        self.write_heading("<h1>Selling a <em>business</em></h1><h2>Two</h2><h6>Six</h6>")
        self.assertPasses()


class AssetsIgnoreTestCase(SyntheticSiteTestCase):
    """A hidden working folder at the top level must be held back from the deploy.

    Cloudflare uploads everything under the assets directory, which is the
    repository root, unless .assetsignore names it. A .claude or .superpowers
    folder that lands there is served to anyone who guesses the path, with
    whatever a session left in it.
    """

    def setUp(self):
        super().setUp()
        self.write_baseline()

    def test_a_site_with_no_hidden_entries_passes(self):
        self.assertPasses()

    def test_a_hidden_folder_listed_in_assetsignore_passes(self):
        os.makedirs(".claude")
        self.write(".secret/notes.txt", "x")
        self.write(".assetsignore", ".assetsignore\n.git\n.claude\n/.secret/\n")
        self.assertPasses("a listed hidden folder is held back")

    def test_a_hidden_folder_not_listed_fails(self):
        os.makedirs(".claude")
        self.write(".assetsignore", ".assetsignore\n.git\n")
        self.assertFails(".claude is a hidden top-level entry that .assetsignore does not "
                         "list, so a deploy would publish it")

    def test_a_hidden_file_not_listed_fails(self):
        self.write(".env", "SECRET=1\n")
        self.write(".assetsignore", ".assetsignore\n.git\n")
        self.assertFails(".env is a hidden top-level entry")

    def test_a_hidden_entry_with_no_assetsignore_at_all_fails(self):
        os.makedirs(".superpowers")
        self.assertFails(".superpowers is a hidden top-level entry that .assetsignore does not list")

    def test_a_comment_naming_the_folder_does_not_count(self):
        os.makedirs(".claude")
        self.write(".assetsignore", ".assetsignore\n# .claude\n")
        self.assertFails(".claude is a hidden top-level entry")

    def test_assetsignore_itself_must_be_listed(self):
        # It is a hidden file at the top level like any other.
        self.write(".assetsignore", ".git\n")
        self.assertFails(".assetsignore is a hidden top-level entry")

    def test_hidden_entries_below_the_top_level_are_not_this_checks_business(self):
        self.write("fonts/.keep", "")
        self.assertPasses("only the top level is the deploy's root")


WRANGLER_HEAD = 'name = "site"\nmain = "src/index.js"\n\n[assets]\ndirectory = "."\n'



class AnchorBalanceTestCase(SyntheticSiteTestCase):
    """A link missing its opening tag renders raw markup and passes every other check."""

    def setUp(self):
        super().setUp()
        self.write_baseline()

    def test_balanced_anchors_pass(self):
        code, output = self.run_checker()
        self.assertEqual(code, 0, "balanced anchors should pass:\n" + output)

    def test_an_anchor_missing_its_opening_tag_fails(self):
        """The exact bug this check was written for.

        A bulk retarget produced `</a> or href="/about">text</a>`, which shipped a
        visible href= in the middle of a sentence while every other check stayed
        green, because the href still pointed somewhere real.
        """
        self.write("index.html", page("/", body=(
            '<p>you can <a href="/about">ask us</a> or href="/about">try the tool</a>.</p>')))
        self.assertFails("malformed")

    def test_an_unclosed_anchor_fails(self):
        self.write("index.html", page("/", body='<p><a href="/about">About</p>'))
        self.assertFails("malformed")

    def test_the_error_names_the_page_and_both_counts(self):
        self.write("index.html", page("/", body=(
            '<p><a href="/about">a</a> or href="/about">b</a></p>')))
        code, output = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("index.html", output)
        self.assertIn("<a> opening tags", output)



class FooterDisclosureTestCase(SyntheticSiteTestCase):
    """The regulatory disclosure is compliance surface, not decoration.

    It drifted the way an unguarded thing does: 56 of 58 pages carried it, and the
    two that did not were the sector landing pages, the highest commercial intent
    pages on a financial services site.
    """

    def setUp(self):
        super().setUp()
        self.write_baseline()

    def test_pages_carrying_the_disclosure_pass(self):
        code, output = self.run_checker()
        self.assertEqual(code, 0, "disclosure present should pass:\n" + output)

    def test_a_page_without_the_disclosure_fails(self):
        self.write("about.html", page("/about", footer_legal=False))
        code, output = self.run_checker()
        self.assertEqual(code, 1, "missing disclosure must fail:\n" + output)
        self.assertIn("footer-legal", output)
        self.assertIn("about.html", output)



def header(current=None, value="page", drawer_tag="nav", prefix=""):
    """The site header: desktop nav plus mobile drawer, marking `current` if given."""
    def link(route, label):
        mark = ' aria-current="{}"'.format(value) if route == current else ""
        return '<a href="{}{}"{}>{}</a>'.format(prefix, route, mark, label)
    links = [("about", "About"), ("sectors", "Sectors"), ("contact", "Contact")]
    desktop = "".join("<li>{}</li>".format(link(r, t)) for r, t in links)
    drawer = "".join(link(r, t) for r, t in links + [("faq", "FAQ")])
    return ('<nav id="nav" aria-label="Primary"><a href="{0}" class="nav-logo">Home</a>'
            '<ul class="nav-links">{1}</ul>{2}</nav>'
            '<{3} class="nav-mobile-drawer" id="mobileDrawer" aria-label="Mobile">{4}</{3}>'
            ).format(prefix or "/", desktop, link("valuation", "Value My Business"),
                     drawer_tag, drawer)


class NavCurrentTestCase(SyntheticSiteTestCase):
    """Each root page marks its own header link, in both the desktop nav and drawer.

    Six root pages used to set class="active", thirteen set nothing, and the
    drawer never marked anything, so the check pins one mapping for all of them.
    Article pages are skipped: they mark Insights as their section instead.
    """

    def errors_for(self, path, body):
        errors = []
        check_site.check_nav_current(path, page("/x", body=body), errors, [])
        return errors

    def test_page_marking_its_own_link_in_both_places_passes(self):
        self.assertEqual(self.errors_for("about.html", header("about")), [])

    def test_missing_aria_current_on_the_desktop_link_fails(self):
        body = header("about").replace(
            '<li><a href="about" aria-current="page">', '<li><a href="about">')
        errors = self.errors_for("about.html", body)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("desktop nav", errors[0])

    def test_missing_aria_current_in_the_drawer_fails(self):
        body = header("about").replace(
            '<a href="about" aria-current="page">About</a><a href="sectors"',
            '<a href="about">About</a><a href="sectors"')
        errors = self.errors_for("about.html", body)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("mobile drawer", errors[0])

    def test_drawer_still_written_as_a_div_is_checked(self):
        errors = self.errors_for("about.html", header(None, drawer_tag="div"))
        self.assertEqual(len(errors), 2, errors)

    def test_wrong_link_marked_current_fails(self):
        errors = self.errors_for("about.html", header("contact"))
        self.assertTrue(any("needs aria-current" in e for e in errors), errors)
        self.assertTrue(any("carries aria-current" in e for e in errors), errors)

    def test_home_page_marking_any_link_fails(self):
        self.assertEqual(self.errors_for("index.html", header(None)), [])
        self.assertTrue(self.errors_for("index.html", header("about")))

    def test_sector_page_marks_sectors_as_its_section(self):
        self.assertEqual(
            self.errors_for("msp-ma-advisor.html", header("sectors", value="true")), [])
        errors = self.errors_for("msp-ma-advisor.html", header("sectors", value="page"))
        self.assertTrue(errors)
        self.assertIn('aria-current="true"', errors[0])

    def test_new_sector_pages_mark_sectors_as_their_section(self):
        for page in ("industrials-ma-advisor.html", "business-services-ma-advisor.html"):
            with self.subTest(page=page):
                self.assertEqual(
                    self.errors_for(page, header("sectors", value="true")), [])
                self.assertTrue(self.errors_for(page, header(None)))

    def test_valuation_marks_the_header_cta(self):
        self.assertEqual(self.errors_for("valuation.html", header("valuation")), [])
        self.assertTrue(self.errors_for("valuation.html", header(None)))

    def test_root_absolute_hrefs_resolve_to_the_same_route(self):
        self.assertEqual(self.errors_for("about.html", header("about", prefix="/")), [])

    def test_article_pages_are_skipped(self):
        body = header("about", prefix="../").replace("aria-current", "data-x")
        body = body.replace('href="../contact"', 'href="../contact" aria-current="page"')
        self.assertEqual(self.errors_for("articles/some-guide-2026.html", body), [])

    def test_page_without_a_header_is_skipped(self):
        self.assertEqual(self.errors_for("about.html", "<p>no header</p>"), [])

    def test_checker_reports_it_end_to_end(self):
        self.write("index.html", page("/", body=header(None) + '<a href="/about">About</a>'))
        self.write("about.html", page("/about", body=header(None)))
        self.write_sitemap(["/", "/about"])
        self.assertFails('about.html: desktop nav link about needs aria-current="page"')


class PublishChecklistTestCase(SyntheticSiteTestCase):
    """The two publish-checklist steps that drift silently: llms.txt and RELATED.

    Both are enforced by check_site.py rather than trusted to a list in the docs,
    because trusting the list is exactly what failed. The dental guide shipped
    satisfying steps 1 through 4, missing step 6 entirely and half of step 5, and
    every check on the site stayed green while it sat at one inbound internal link
    against three to eight for its peers.
    """

    def setUp(self):
        super().setUp()
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

    def write_llms(self, slugs, path="llms.txt"):
        lines = ["# Site"] + [
            "- [{0}]({1}/articles/{0}): a summary".format(slug, SITE) for slug in slugs]
        self.write(path, "\n".join(lines) + "\n")

    def write_related(self, mapping):
        rows = "".join(
            '    "{}": [{}],\n'.format(key, ", ".join('"{}"'.format(t) for t in targets))
            for key, targets in mapping.items())
        self.write("tools/build_related.py", "RELATED = {\n" + rows + "}\n")

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

    def test_llms_txt_may_link_a_real_companion_file(self):
        """llms.txt points at llms-full.txt; that file exists, so it is not a 404."""
        self.write_llms(["guide-one-2026", "an-essay"], path="llms-full.txt")
        self.write_llms(["guide-one-2026", "an-essay"])
        with open(os.path.join(self._tmp.name, "llms.txt"), "a", encoding="utf-8") as handle:
            handle.write("See [llms-full.txt]({}/llms-full.txt).\n".format(SITE))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "a link to an existing .txt file should pass:\n" + output)

    def test_llms_txt_linking_a_missing_companion_file_fails(self):
        self.write_llms(["guide-one-2026", "an-essay"])
        with open(os.path.join(self._tmp.name, "llms.txt"), "a", encoding="utf-8") as handle:
            handle.write("See [llms-full.txt]({}/llms-full.txt).\n".format(SITE))
        self.assertFails("llms-full.txt, which no longer exists")

    def test_a_missing_llms_txt_is_skipped_not_failed(self):
        os.remove(os.path.join(self._tmp.name, "llms.txt"))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "absent llms.txt should skip:\n" + output)

    # --- llms-full.txt is held to the same standard -----------------------------

    def test_a_complete_llms_full_txt_passes(self):
        self.write_llms(["guide-one-2026", "an-essay"], path="llms-full.txt")
        self.assertPasses("both files complete should pass")

    def test_an_article_missing_from_llms_full_txt_fails(self):
        self.write_llms(["an-essay"], path="llms-full.txt")
        output = self.assertFails("articles/guide-one-2026.html is not listed in llms-full.txt")
        self.assertNotIn("not listed in llms.txt", output)

    def test_llms_full_txt_naming_a_deleted_page_fails(self):
        self.write_llms(["guide-one-2026", "an-essay", "gone-2026"], path="llms-full.txt")
        output = self.assertFails("llms-full.txt: lists {}/articles/gone-2026, which no longer "
                                  "exists".format(SITE))
        self.assertNotIn("llms.txt: lists", output)

    def test_each_file_is_reported_under_its_own_name(self):
        self.write_llms(["an-essay"])
        self.write_llms(["guide-one-2026"], path="llms-full.txt")
        output = self.assertFails("not listed in llms.txt")
        self.assertIn("articles/an-essay.html is not listed in llms-full.txt", output)

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

    def test_a_guide_listing_itself_does_not_count_as_an_inbound_link(self):
        """A self-reference would satisfy the check while nothing links in.

        That is the dental bug wearing a hat: the key exists, the target list is
        non-empty, and the page still has zero inbound links.
        """
        # guide-one's ONLY reference is its own. an-essay still has a real inbound
        # link from guide-one, so only guide-one should be reported.
        self.write_related({
            "guide-one": ["guide-one", "an-essay"], "an-essay": ["an-essay"]})
        code, output = self.run_checker()
        self.assertEqual(code, 1, "a self-reference must not count:\n" + output)
        self.assertIn("'guide-one' is a RELATED key", output)
        self.assertNotIn("'an-essay' is a RELATED key", output)

    def test_a_stale_root_url_in_llms_txt_fails(self):
        """llms.txt lists 14 root pages too, and a stale one cites a 404 just as well."""
        self.write("llms.txt",
                   "# Site\n"
                   "- [g]({0}/articles/guide-one-2026): x\n"
                   "- [e]({0}/articles/an-essay): x\n"
                   "- [gone]({0}/a-page-that-was-deleted): x\n".format(SITE))
        self.assertFails("which no longer exists")

    def test_a_slug_that_is_a_prefix_of_another_is_not_satisfied_by_the_longer_entry(self):
        """The forward check is anchored, so a prefix cannot ride on a longer slug.

        No collision exists on the real site today, but the four year-free essays are
        exactly the shape that creates one, so the check is anchored rather than trusting
        that nobody ever adds a slug containing another.
        """
        self.write("articles/an-essay-part-two.html", page("/articles/an-essay-part-two"))
        self.write("index.html", page("/", body=(
            '<a href="/articles/guide-one-2026">One</a>'
            '<a href="/articles/an-essay">Essay</a>'
            '<a href="/articles/an-essay-part-two">Two</a>')))
        self.write("sitemap.xml", sitemap([
            "/", "/articles/guide-one-2026", "/articles/an-essay", "/articles/an-essay-part-two"]))
        self.write_related({
            "guide-one": ["an-essay"],
            "an-essay": ["guide-one"],
            "an-essay-part-two": ["guide-one"]})
        # Only the LONGER slug is listed. The shorter one must still be reported.
        self.write("llms.txt",
                   "# Site\n"
                   "- [g]({0}/articles/guide-one-2026): x\n"
                   "- [two]({0}/articles/an-essay-part-two): x\n".format(SITE))
        self.assertFails("articles/an-essay.html is not listed")

    def test_a_missing_related_map_is_skipped_not_failed(self):
        os.remove(os.path.join(self._tmp.name, "tools", "build_related.py"))
        code, output = self.run_checker()
        self.assertEqual(code, 0, "absent build_related.py should skip:\n" + output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
