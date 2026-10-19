#!/usr/bin/env python3
"""Tests for the RELATED map in tools/build_related.py.

    python3 tools/test_build_related.py

The map is curated by hand, so these tests pin the shape rules check_site.py
cannot see on its own (a list's length, a guide naming itself, a root page with
no title to render) and the intent-cluster edits that point each search intent
at one winning page. The two sector pages, /industrials-ma-advisor and
/business-services-ma-advisor, must be led to by their own sector guides, the
way /msp-ma-advisor is led to by the MSP guides.

Pure dictionary checks: nothing is read from or written to articles/. Stdlib
only, to match the rest of tools/.
"""
import importlib.util
import os
import unittest

TOOLS = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location(
    "build_related", os.path.join(TOOLS, "build_related.py"))
build_related = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_related)

RELATED = build_related.RELATED
ROOT_PAGE_TITLES = build_related.ROOT_PAGE_TITLES

MAX_TARGETS = 6

INDUSTRIALS = "/industrials-ma-advisor"
BUSINESS_SERVICES = "/business-services-ma-advisor"

# The intent-cluster edits, exactly as the research report specified them.
EXPECTED = {
    "ebitda-and-business-valuation-basics": [
        "ebitda-add-backs", "quality-of-earnings-report",
        "best-business-valuation-firms-lower-middle-market",
        "ma-glossary-lower-middle-market", "dental-practice-valuation-multiples",
        "how-to-value-accounting-cpa-firm-before-sale"],
    "ma-deal-structure": [
        "earnouts-escrow-holdbacks", "seller-risk-protection-deal-structuring",
        "working-capital-peg-ma", "what-you-keep-after-selling-a-business",
        "asset-sale-vs-stock-sale", "strategic-buyer-vs-private-equity-buyer"],
    "when-to-start-exit-planning": [
        "family-business-succession-planning", "best-exit-planning-advisors-consultants",
        "lower-middle-market-ma-process", "what-buyers-look-for-in-an-acquisition-target",
        "lower-middle-market-ma-outlook", "best-ma-advisors-accounting-cpa-firms"],
    "due-diligence-checklist-selling-a-business": [
        "quality-of-earnings-report", "working-capital-peg-ma",
        "what-buyers-look-for-in-an-acquisition-target", "asset-sale-vs-stock-sale",
        "ebitda-add-backs", "how-long-does-it-take-to-sell-a-business"],
    "ma-advisor-fees": [
        "how-to-choose-an-ma-advisor", "sell-side-advisor-vs-business-broker",
        "buy-side-ma-advisor", "best-ma-advisors-selling-20-million-company"],
    "prepare-preschool-childcare-business-for-sale": [
        "/preschool-childcare-ma-advisor", "childcare-daycare-valuation-multiples",
        "ma-advisor-early-childhood-education",
        "due-diligence-checklist-selling-a-business", "earnouts-escrow-holdbacks"],
    "manufacturing-valuation-multiples": [
        INDUSTRIALS, "ma-advisor-industrials-manufacturing",
        "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target"],
    "ma-advisor-industrials-manufacturing": [
        INDUSTRIALS, "manufacturing-valuation-multiples", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process", "best-ma-advisors-hvac-companies"],
    "business-services-valuation-multiples": [
        BUSINESS_SERVICES, "ma-advisor-business-services", "msp-valuation-multiples",
        "manufacturing-valuation-multiples", "ebitda-and-business-valuation-basics",
        "hvac-plumbing-valuation-multiples"],
    "ma-advisor-business-services": [
        BUSINESS_SERVICES, "business-services-valuation-multiples",
        "best-ma-advisors-hvac-companies", "best-ma-advisors-plumbing-companies",
        "best-ma-advisors-accounting-cpa-firms",
        "best-ma-advisors-msp-managed-service-providers"],
    "best-ma-advisors-hvac-companies": [
        BUSINESS_SERVICES, "hvac-plumbing-valuation-multiples",
        "ma-advisor-business-services", "sell-side-advisor-vs-business-broker",
        "best-ma-advisors-plumbing-companies", "ma-advisor-industrials-manufacturing"],
    "best-ma-advisors-plumbing-companies": [
        BUSINESS_SERVICES, "hvac-plumbing-valuation-multiples",
        "best-ma-advisors-hvac-companies",
        "sell-side-advisor-vs-business-broker", "strategic-buyer-vs-private-equity-buyer"],
    "best-ma-advisors-accounting-cpa-firms": [
        BUSINESS_SERVICES, "how-to-value-accounting-cpa-firm-before-sale",
        "strategic-buyer-vs-private-equity-buyer",
        "sell-side-advisor-vs-business-broker", "ebitda-and-business-valuation-basics",
        "best-ma-advisors-dental-practices"],
}


def all_targets():
    return {t for targets in RELATED.values() for t in targets}


class IntentClusterEditsTest(unittest.TestCase):
    def test_each_edited_key_matches_the_intent_report(self):
        for key, expected in EXPECTED.items():
            with self.subTest(key=key):
                self.assertEqual(RELATED[key], expected)


class SectorPagesTest(unittest.TestCase):
    def test_new_sector_pages_have_titles_to_render(self):
        self.assertEqual(
            ROOT_PAGE_TITLES[INDUSTRIALS], "Industrials & Manufacturing M&A Advisor")
        self.assertEqual(
            ROOT_PAGE_TITLES[BUSINESS_SERVICES], "Business Services M&A Advisor")

    def test_sector_guides_lead_with_their_sector_page(self):
        for key in ("manufacturing-valuation-multiples",
                    "ma-advisor-industrials-manufacturing"):
            with self.subTest(key=key):
                self.assertEqual(RELATED[key][0], INDUSTRIALS)
        for key in ("business-services-valuation-multiples",
                    "ma-advisor-business-services"):
            with self.subTest(key=key):
                self.assertEqual(RELATED[key][0], BUSINESS_SERVICES)

    def test_root_page_links_render_one_level_up(self):
        stamp = lambda target: target  # root pages pass through stamp() unchanged
        block = build_related.render([INDUSTRIALS], ROOT_PAGE_TITLES, stamp)
        self.assertIn(
            '<a href="../industrials-ma-advisor">'
            "Industrials &amp; Manufacturing M&amp;A Advisor", block)


class MapShapeTest(unittest.TestCase):
    def test_no_list_runs_past_six(self):
        for key, targets in RELATED.items():
            with self.subTest(key=key):
                self.assertLessEqual(len(targets), MAX_TARGETS)

    def test_no_list_repeats_a_target_or_names_itself(self):
        for key, targets in RELATED.items():
            with self.subTest(key=key):
                self.assertEqual(len(targets), len(set(targets)))
                self.assertNotIn(key, targets)

    def test_every_root_target_has_a_title(self):
        roots = {t for t in all_targets() if t.startswith("/")}
        self.assertEqual(roots - set(ROOT_PAGE_TITLES), set())

    def test_every_guide_target_is_itself_a_key(self):
        guides = {t for t in all_targets() if not t.startswith("/")}
        self.assertEqual(guides - set(RELATED), set())

    def test_every_key_is_linked_from_another_key(self):
        inbound = {t for key, targets in RELATED.items() for t in targets if t != key}
        self.assertEqual(set(RELATED) - inbound, set())


if __name__ == "__main__":
    unittest.main()
