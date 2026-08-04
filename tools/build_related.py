#!/usr/bin/env python3
"""Insert the "Keep reading" related-guides block into every article.

Run from the repository root after adding an article or editing RELATED:

    python3 tools/build_related.py

Twenty-seven guides and no way to get from one to the next: a reader who
finished a guide had only the contact CTA or the browser back button. That also
left the sector landing pages starved of internal links while about/contact/faq
collected one from all 45 pages.

The map below is curated by hand rather than computed from keyword overlap.
With this many guides a person can tell that an owner reading about MSP
multiples wants the MSP sell-side page next; a similarity score mostly cannot.
The essays are grouped with each other rather than with the sell-side guides,
because dropping "Quality of Earnings" under a Fourth of July family piece
reads exactly as mechanical as it is.

Idempotent: the block is delimited by HTML comments and rewritten in place, so
re-running after an edit replaces rather than duplicates. Stdlib only.
"""
import glob
import html
import json
import os
import re
import sys

START = "<!-- related-guides:start -->"
END = "<!-- related-guides:end -->"
ANCHOR = '<section class="next-cta">'

JSON_LD = re.compile(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', re.DOTALL)
EXISTING_BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n*", re.DOTALL)

# Pages outside articles/ that guides link to. A leading "/" marks a site-root
# page; everything else is a sibling article slug.
ROOT_PAGE_TITLES = {
    "/msp-ma-advisor": "Sell Your MSP: IT Managed Services M&A",
    "/pet-care-ma-advisor": "Sell Your Dog Daycare or Pet Care Business",
}

# Three destinations per guide. Sector guides lead with their sell-side page,
# which is what a reader in that sector actually wants next.
RELATED = {
    # Fundamentals
    "ebitda-and-business-valuation-basics-2026": [
        "quality-of-earnings-report-2026", "what-buyers-look-for-in-an-acquisition-target-2026",
        "ma-glossary-lower-middle-market-2026"],
    "ma-glossary-lower-middle-market-2026": [
        "ebitda-and-business-valuation-basics-2026", "working-capital-peg-ma-2026",
        "lower-middle-market-ma-process-2026"],
    "quality-of-earnings-report-2026": [
        "working-capital-peg-ma-2026", "ebitda-and-business-valuation-basics-2026",
        "what-buyers-look-for-in-an-acquisition-target-2026"],
    "working-capital-peg-ma-2026": [
        "quality-of-earnings-report-2026", "ma-deal-structure-2026",
        "lower-middle-market-ma-process-2026"],

    # Reading an offer. Sits between the fundamentals and the buyer guides: the
    # peg is one of its six structures, and the buyer-type guide explains who
    # asks for rollover equity and why.
    "ma-deal-structure-2026": [
        "working-capital-peg-ma-2026", "strategic-buyer-vs-private-equity-buyer-2026",
        "lower-middle-market-ma-process-2026"],

    # Sector: IT managed services
    "msp-valuation-multiples-2026": [
        "/msp-ma-advisor", "business-services-valuation-multiples-2026",
        "ebitda-and-business-valuation-basics-2026"],

    # Sector: pet care
    "dog-daycare-pet-care-valuation-multiples-2026": [
        "/pet-care-ma-advisor", "roll-ups-legal-services-pet-care-2026",
        "ebitda-and-business-valuation-basics-2026"],
    "roll-ups-legal-services-pet-care-2026": [
        "/pet-care-ma-advisor", "dog-daycare-pet-care-valuation-multiples-2026",
        "strategic-buyer-vs-private-equity-buyer-2026"],

    # Sector: early childhood education
    "childcare-daycare-valuation-multiples-2026": [
        "ma-advisor-early-childhood-education-2026", "ebitda-and-business-valuation-basics-2026",
        "what-buyers-look-for-in-an-acquisition-target-2026"],
    "ma-advisor-early-childhood-education-2026": [
        "childcare-daycare-valuation-multiples-2026", "how-to-choose-an-ma-advisor-2026",
        "lower-middle-market-ma-process-2026"],

    # Sector: manufacturing
    "manufacturing-valuation-multiples-2026": [
        "ma-advisor-industrials-manufacturing-2026", "ebitda-and-business-valuation-basics-2026",
        "what-buyers-look-for-in-an-acquisition-target-2026"],
    "ma-advisor-industrials-manufacturing-2026": [
        "manufacturing-valuation-multiples-2026", "how-to-choose-an-ma-advisor-2026",
        "lower-middle-market-ma-process-2026"],

    # Sector: business services
    "business-services-valuation-multiples-2026": [
        "ma-advisor-business-services-2026", "msp-valuation-multiples-2026",
        "ebitda-and-business-valuation-basics-2026"],
    "ma-advisor-business-services-2026": [
        "business-services-valuation-multiples-2026", "how-to-choose-an-ma-advisor-2026",
        "/msp-ma-advisor"],

    # Choosing an advisor
    "how-to-choose-an-ma-advisor-2026": [
        "sell-side-advisor-vs-business-broker-2026", "top-lower-middle-market-investment-banks-2026",
        "best-ma-advisors-selling-20-million-company-2026"],
    "sell-side-advisor-vs-business-broker-2026": [
        "how-to-choose-an-ma-advisor-2026", "top-lower-middle-market-investment-banks-2026",
        "lower-middle-market-ma-process-2026"],
    "top-lower-middle-market-investment-banks-2026": [
        "best-ma-advisors-selling-20-million-company-2026", "how-to-choose-an-ma-advisor-2026",
        "sell-side-advisor-vs-business-broker-2026"],
    "best-ma-advisors-selling-20-million-company-2026": [
        "top-lower-middle-market-investment-banks-2026", "how-to-choose-an-ma-advisor-2026",
        "lower-middle-market-ma-process-2026"],
    "best-business-valuation-firms-lower-middle-market-2026": [
        "ebitda-and-business-valuation-basics-2026", "quality-of-earnings-report-2026",
        "how-to-choose-an-ma-advisor-2026"],

    # Process and timing
    "lower-middle-market-ma-process-2026": [
        "how-long-does-it-take-to-sell-a-business-2026", "when-to-start-exit-planning-2026",
        "what-buyers-look-for-in-an-acquisition-target-2026"],
    "how-long-does-it-take-to-sell-a-business-2026": [
        "lower-middle-market-ma-process-2026", "when-to-start-exit-planning-2026",
        "quality-of-earnings-report-2026"],
    "when-to-start-exit-planning-2026": [
        "lower-middle-market-ma-process-2026", "what-buyers-look-for-in-an-acquisition-target-2026",
        "how-long-does-it-take-to-sell-a-business-2026"],

    # Buyers
    "what-buyers-look-for-in-an-acquisition-target-2026": [
        "strategic-buyer-vs-private-equity-buyer-2026", "quality-of-earnings-report-2026",
        "ebitda-and-business-valuation-basics-2026"],
    "strategic-buyer-vs-private-equity-buyer-2026": [
        "what-buyers-look-for-in-an-acquisition-target-2026", "ma-deal-structure-2026",
        "lower-middle-market-ma-process-2026"],

    # Essays. Kept with each other: a sell-side guide under a family piece reads
    # as mechanical, which is the one thing this block must not do.
    "why-we-built-salt-creek-around-relationships": [
        "community-midwest-selling-a-family-business",
        "coming-home-family-midwest-fourth-of-july", "how-to-choose-an-ma-advisor-2026"],
    "community-midwest-selling-a-family-business": [
        "why-we-built-salt-creek-around-relationships",
        "coming-home-family-midwest-fourth-of-july", "when-to-start-exit-planning-2026"],
    "coming-home-family-midwest-fourth-of-july": [
        "community-midwest-selling-a-family-business",
        "why-we-built-salt-creek-around-relationships", "how-ai-is-actually-changing-business"],
    "how-ai-is-actually-changing-business": [
        "why-we-built-salt-creek-around-relationships",
        "what-buyers-look-for-in-an-acquisition-target-2026",
        "community-midwest-selling-a-family-business"],
}


def article_headline(path):
    """The guide's own headline, from the Article JSON-LD build_feed.py also trusts."""
    for raw in JSON_LD.findall(open(path, encoding="utf-8").read()):
        try:
            node = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(node, dict) and node.get("@type") == "Article" and node.get("headline"):
            return node["headline"]
    return None


def href_for(target):
    """Articles are siblings; root pages sit one level up."""
    return ".." + target if target.startswith("/") else target


def render(targets, titles):
    items = "\n".join(
        '        <li><a href="{}">{}<span class="related-guides-arrow" aria-hidden="true">'
        "&#8594;</span></a></li>".format(href_for(t), html.escape(titles[t], quote=False))
        for t in targets
    )
    return (
        START + "\n"
        '<section class="related-guides">\n'
        '  <div class="wrap reveal">\n'
        '    <div class="related-guides-inner">\n'
        '      <span class="eyebrow eyebrow--light">Keep Reading</span>\n'
        '      <ul class="related-guides-list">\n'
        + items + "\n"
        "      </ul>\n"
        "    </div>\n"
        "  </div>\n"
        "</section>\n"
        + END + "\n\n"
    )


def main():
    paths = sorted(glob.glob("articles/*.html"))
    if not paths:
        print("No articles found — run this from the repository root.", file=sys.stderr)
        return 1

    titles = dict(ROOT_PAGE_TITLES)
    for path in paths:
        slug = os.path.basename(path)[: -len(".html")]
        headline = article_headline(path)
        if not headline:
            print("  !! {}: no Article headline, cannot be linked to".format(path), file=sys.stderr)
            continue
        titles[slug] = headline

    # Fail before writing anything: a typo in RELATED would otherwise scatter dead
    # links across 27 files.
    missing = sorted({t for targets in RELATED.values() for t in targets} - set(titles))
    if missing:
        print("Unknown link targets: {}".format(missing), file=sys.stderr)
        return 1
    unmapped = sorted({os.path.basename(p)[: -len(".html")] for p in paths} - set(RELATED))
    if unmapped:
        print("Articles missing from RELATED: {}".format(unmapped), file=sys.stderr)
        return 1

    written = 0
    for path in paths:
        slug = os.path.basename(path)[: -len(".html")]
        original = open(path, encoding="utf-8").read()
        stripped = EXISTING_BLOCK.sub("", original)
        if ANCHOR not in stripped:
            print("  !! {}: no next-cta anchor, skipped".format(path), file=sys.stderr)
            continue
        updated = stripped.replace(ANCHOR, render(RELATED[slug], titles) + ANCHOR, 1)
        if updated != original:
            open(path, "w", encoding="utf-8").write(updated)
            written += 1

    print("related-guides block written to {} of {} articles".format(written, len(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
