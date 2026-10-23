#!/usr/bin/env python3
"""Tests for tools/build_valuation_band.py.

    python3 tools/test_build_valuation_band.py

Every guide ended on its only valuation link, up to twenty-five screens down on
a phone. The tool puts one band near the top of each guide. These tests pin the
three placement rules in the order they apply, that a rerun changes nothing,
that the four essays are left alone, and that a sector guide's link names an
industry the valuation form really offers.

The placement tests run on small synthetic guides so that each rule is tested
on its own. The last class runs against this checkout, because a map of slugs
and option values is only right while the files it names still exist. Stdlib
only, to match the rest of tools/.
"""
import importlib.util
import os
import sys
import tempfile
import unittest

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TOOLS)

_spec = importlib.util.spec_from_file_location(
    "build_valuation_band", os.path.join(TOOLS, "build_valuation_band.py"))
band = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(band)

ANSWER = """    <div class="article-answer">
      <span class="article-answer-label">Direct Answer</span>
      <p>The short version.</p>
    </div>

"""

TABLE = """      <div class="article-table-wrap">
      <table>
        <tr><td><div class="cell">nested</div></td></tr>
      </table>
      </div>

"""

GUIDE = """<main>
<section class="article">
  <div class="wrap">
{answer}    <div class="article-body">

      <h2>First heading</h2>
      <p>Opening paragraph.</p>

{table}      <h2>Second heading</h2>
      <p>More.</p>

      <h2>Third heading</h2>
      <p>End.</p>

    </div>
  </div>
</section>
<section class="next-cta">
  <a href="../valuation" class="btn-primary">Value My Business</a>
</section>
</main>
"""

VALUATION_PAGE = """<select id="vIndustry" class="val-select">
  <option value="">Select your industry&hellip;</option>
  <option value="ece">Early Childhood Education / Preschool</option>
  <option value="itservices">IT Services / MSP</option>
</select>
<select id="vOther"><option value="notanindustry">Unrelated</option></select>
"""


def guide(answer=False, table=False):
    return GUIDE.format(answer=ANSWER if answer else "", table=TABLE if table else "")


def lines_between(html, first, second):
    """The non-blank lines strictly between two markers, stripped."""
    middle = html[html.index(first) + len(first):html.index(second)]
    return [line.strip() for line in middle.splitlines() if line.strip()]


class Placement(unittest.TestCase):
    def test_band_goes_directly_after_the_direct_answer_box(self):
        updated = band.apply(guide(answer=True, table=True), "../valuation")

        self.assertEqual(
            lines_between(updated, "<p>The short version.</p>", band.START), ["</div>"])
        self.assertEqual(lines_between(updated, band.END, "<h2>First heading</h2>"),
                         ['<div class="article-body">'])

    def test_band_follows_the_first_table_when_there_is_no_answer_box(self):
        updated = band.apply(guide(table=True), "../valuation")

        self.assertEqual(lines_between(updated, "</table>", band.START), ["</div>"])
        self.assertEqual(lines_between(updated, band.END, "<h2>Second heading</h2>"), [])

    def test_table_wrapper_is_closed_at_its_own_div_not_a_nested_one(self):
        updated = band.apply(guide(table=True), "../valuation")

        self.assertLess(updated.index("</table>"), updated.index(band.START))

    def test_band_precedes_the_second_h2_when_there_is_no_answer_or_table(self):
        updated = band.apply(guide(), "../valuation")

        self.assertEqual(lines_between(updated, band.END, "<h2>Second heading</h2>"), [])
        self.assertLess(updated.index("<p>Opening paragraph.</p>"), updated.index(band.START))

    def test_second_h2_is_counted_inside_the_article_body_only(self):
        hero_h2 = guide().replace("<main>", "<main>\n<h2>Not the body</h2>")

        updated = band.apply(hero_h2, "../valuation")

        self.assertEqual(lines_between(updated, band.END, "<h2>Second heading</h2>"), [])

    def test_guide_with_no_place_for_the_band_is_refused(self):
        one_heading = "<div class=\"article-body\">\n  <h2>Only heading</h2>\n</div>\n"

        self.assertIsNone(band.apply(one_heading, "../valuation"))


def late_table_guide(answer=False):
    """A guide whose only table sits past the halfway point of its body."""
    padding = "      <p>" + "Padding sentence. " * 40 + "</p>\n\n"
    return guide(answer=answer).replace(
        "      <p>End.</p>\n\n", "      <p>End.</p>\n\n" + padding + TABLE, 1)


class LateTable(unittest.TestCase):
    """A first table past halfway would bury the band, so the heading rule takes over."""

    def test_late_table_gives_way_to_the_second_heading(self):
        updated = band.apply(late_table_guide(), "../valuation")

        self.assertEqual(lines_between(updated, band.END, "<h2>Second heading</h2>"), [])
        self.assertLess(updated.index(band.START), updated.index("article-table-wrap"))

    def test_answer_box_still_wins_over_a_late_table(self):
        updated = band.apply(late_table_guide(answer=True), "../valuation")

        self.assertEqual(
            lines_between(updated, "<p>The short version.</p>", band.START), ["</div>"])

    def test_late_table_is_still_used_when_there_is_no_second_heading(self):
        one_heading = late_table_guide().replace("<h2>Second heading</h2>", "").replace(
            "<h2>Third heading</h2>", "")

        updated = band.apply(one_heading, "../valuation")

        self.assertEqual(lines_between(updated, "</table>", band.START), ["</div>"])

    def test_rerun_on_a_late_table_guide_changes_nothing(self):
        once = band.apply(late_table_guide(), "../valuation")

        self.assertEqual(band.apply(once, "../valuation"), once)
        self.assertEqual(band.strip(once), late_table_guide())

    def test_band_left_after_a_late_table_is_moved_not_duplicated(self):
        old_place = late_table_guide().replace(
            TABLE, TABLE + band.render("../valuation", "      "), 1)

        moved = band.apply(old_place, "../valuation")

        self.assertEqual(moved.count(band.START), 1)
        self.assertEqual(moved.count(band.END), 1)
        self.assertEqual(moved, band.apply(late_table_guide(), "../valuation"))


class Idempotency(unittest.TestCase):
    def test_second_run_changes_nothing(self):
        for shape in (guide(answer=True), guide(table=True), guide()):
            once = band.apply(shape, "../valuation")
            twice = band.apply(once, "../valuation")

            self.assertEqual(once, twice)
            self.assertEqual(twice.count(band.START), 1)

    def test_stripping_the_band_restores_the_original_file(self):
        for shape in (guide(answer=True), guide(table=True), guide()):
            once = band.apply(shape, "../valuation")

            self.assertEqual(band.strip(once), shape)

    def test_marker_without_its_pair_is_refused_rather_than_stripped(self):
        # Stripping from a stray start marker to the real band's end marker
        # would delete every line of the guide in between.
        torn = band.apply(guide(answer=True), "../valuation").replace(
            "<main>", "<main>\n" + band.START, 1)

        self.assertIsNone(band.apply(torn, "../valuation"))

    def test_class_that_only_starts_like_the_answer_box_is_not_the_answer_box(self):
        lookalike = guide(table=True).replace(
            '    <div class="article-body">',
            '    <div class="article-answer-note">Not it.</div>\n\n    <div class="article-body">')

        updated = band.apply(lookalike, "../valuation")

        self.assertEqual(lines_between(updated, "</table>", band.START), ["</div>"])

    def test_changed_link_replaces_the_band_instead_of_adding_one(self):
        once = band.apply(guide(answer=True), "../valuation")

        twice = band.apply(once, "../valuation?industry=ece")

        self.assertEqual(twice.count(band.START), 1)
        self.assertIn('href="../valuation?industry=ece"', twice)


class Links(unittest.TestCase):
    def test_sector_guide_links_with_its_industry_preselected(self):
        self.assertEqual(band.href_for("msp-valuation-multiples"),
                         "../valuation?industry=itservices")

    def test_general_guide_links_to_the_plain_valuation_page(self):
        self.assertEqual(band.href_for("ma-advisor-fees"), "../valuation")

    def test_pet_care_guides_link_with_pet_care_preselected(self):
        for slug in ("dog-daycare-pet-care-valuation-multiples", "best-ma-advisors-pet-care-dog-daycare-businesses",
                     "prepare-dog-daycare-business-for-sale", "evaluate-pet-care-acquisition-offer"):
            self.assertEqual(band.href_for(slug), "../valuation?industry=petcare", slug)

    def test_mixed_sector_roll_up_guide_still_links_plain(self):
        self.assertEqual(band.href_for("roll-ups-legal-services-pet-care"), "../valuation")

    def test_year_is_split_from_a_guide_slug_whatever_the_year(self):
        self.assertEqual(band.split_year("articles/msp-valuation-multiples-2026.html"),
                         ("msp-valuation-multiples", "2026"))
        self.assertEqual(band.split_year("articles/msp-valuation-multiples-2027.html"),
                         ("msp-valuation-multiples", "2027"))

    def test_essay_has_no_year(self):
        self.assertEqual(band.split_year("articles/how-ai-is-actually-changing-business.html"),
                         ("how-ai-is-actually-changing-business", None))

    def test_only_the_industry_select_supplies_option_values(self):
        self.assertEqual(band.industry_options(VALUATION_PAGE), {"ece", "itservices"})

    def test_band_copy_makes_no_promise_the_form_does_not_keep(self):
        copy = band.render("../valuation", "").lower()

        for claim in ("instant", "no email", "no contact"):
            self.assertNotIn(claim, copy)

    def test_band_carries_a_modifier_class_so_it_does_not_read_as_a_second_tldr(self):
        # Three identical copper boxes (Direct Answer, band, TL;DR) stacked before
        # the body read as a template. The modifier lets the stylesheet slim the
        # band without touching the TL;DR it borrows its base styles from.
        rendered = band.render("../valuation", "")

        self.assertIn('<div class="article-tldr article-tldr--band">', rendered)
        self.assertNotIn('<div class="article-tldr">', rendered)


class Build(unittest.TestCase):
    """build() on a throwaway site."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        os.mkdir(os.path.join(self.root, "articles"))
        self.write("valuation.html", VALUATION_PAGE)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, text):
        with open(os.path.join(self.root, name), "w", encoding="utf-8") as handle:
            handle.write(text)

    def read(self, name):
        with open(os.path.join(self.root, name), encoding="utf-8") as handle:
            return handle.read()

    def build(self, industries=None):
        with open(os.devnull, "w") as quiet:
            return band.build(self.root, industries=industries, out=quiet, err=quiet)

    def test_essays_are_skipped(self):
        self.write("articles/a-family-essay.html", guide(answer=True))
        self.write("articles/some-guide-2026.html", guide(answer=True))

        status = self.build(industries={})

        self.assertEqual(status, 0)
        self.assertEqual(self.read("articles/a-family-essay.html"), guide(answer=True))
        self.assertEqual(self.read("articles/some-guide-2026.html").count(band.START), 1)

    def test_band_left_in_an_essay_is_removed(self):
        self.write("articles/a-family-essay.html",
                   band.apply(guide(answer=True), "../valuation"))

        self.build(industries={})

        self.assertEqual(self.read("articles/a-family-essay.html"), guide(answer=True))

    def test_essay_with_a_torn_marker_is_left_untouched_and_fails_the_run(self):
        torn = guide(answer=True).replace("<main>", "<main>\n" + band.START, 1)
        torn = torn.replace("</main>", band.END + "\n</main>", 1).replace(band.END, "", 1)
        self.write("articles/a-family-essay.html", band.START + "\n" + guide() + band.END + "\n")
        self.write("articles/other-essay.html", torn)

        status = self.build(industries={})

        self.assertEqual(status, 1)
        self.assertEqual(self.read("articles/other-essay.html"), torn)

    def test_sector_guide_is_written_with_its_industry(self):
        self.write("articles/msp-guide-2026.html", guide(table=True))

        self.build(industries={"msp-guide": "itservices"})

        self.assertIn('href="../valuation?industry=itservices"',
                      self.read("articles/msp-guide-2026.html"))

    def test_industry_the_form_does_not_offer_fails_before_writing(self):
        self.write("articles/msp-guide-2026.html", guide(table=True))

        status = self.build(industries={"msp-guide": "petcare"})

        self.assertEqual(status, 1)
        self.assertEqual(self.read("articles/msp-guide-2026.html"), guide(table=True))

    def test_mapped_slug_with_no_guide_behind_it_fails_before_writing(self):
        self.write("articles/msp-guide-2026.html", guide(table=True))

        status = self.build(industries={"renamed-guide": "itservices"})

        self.assertEqual(status, 1)
        self.assertEqual(self.read("articles/msp-guide-2026.html"), guide(table=True))

    def test_guide_with_no_place_for_the_band_fails_the_run(self):
        self.write("articles/thin-guide-2026.html", "<div class=\"article-body\"></div>\n")
        self.write("articles/good-guide-2026.html", guide())

        status = self.build(industries={})

        self.assertEqual(status, 1)
        self.assertEqual(self.read("articles/good-guide-2026.html").count(band.START), 1)

    def test_run_outside_the_repository_root_fails(self):
        empty = tempfile.TemporaryDirectory()
        self.addCleanup(empty.cleanup)
        with open(os.devnull, "w") as quiet:
            self.assertEqual(band.build(empty.name, out=quiet, err=quiet), 1)


class ThisCheckout(unittest.TestCase):
    """The map and the committed guides, checked against the real files."""

    def articles(self):
        folder = os.path.join(REPO, "articles")
        return sorted(os.path.join(folder, name) for name in os.listdir(folder)
                      if name.endswith(".html"))

    def read(self, path):
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def test_every_mapped_industry_is_an_option_on_the_valuation_form(self):
        options = band.industry_options(self.read(os.path.join(REPO, "valuation.html")))

        self.assertTrue(options)
        self.assertEqual(set(band.SECTOR_INDUSTRY.values()) - options, set())

    def test_every_mapped_slug_is_a_guide_on_disk(self):
        guides = {base for base, year in map(band.split_year, self.articles()) if year}

        self.assertEqual(set(band.SECTOR_INDUSTRY) - guides, set())

    def test_there_are_exactly_four_essays(self):
        essays = [path for path in self.articles() if not band.split_year(path)[1]]

        self.assertEqual(len(essays), 4)

    def test_every_guide_carries_one_current_band_and_no_essay_does(self):
        for path in self.articles():
            html = self.read(path)
            base, year = band.split_year(path)
            with self.subTest(article=os.path.basename(path)):
                if not year:
                    self.assertNotIn(band.START, html)
                    continue
                self.assertEqual(html.count(band.START), 1)
                self.assertEqual(band.apply(html, band.href_for(base)), html)


if __name__ == "__main__":
    unittest.main()
