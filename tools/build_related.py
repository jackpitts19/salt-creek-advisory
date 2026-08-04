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
    "ebitda-and-business-valuation-basics": [
        "quality-of-earnings-report", "what-buyers-look-for-in-an-acquisition-target",
        "ma-glossary-lower-middle-market"],
    "ma-glossary-lower-middle-market": [
        "ebitda-and-business-valuation-basics", "working-capital-peg-ma",
        "lower-middle-market-ma-process"],
    "quality-of-earnings-report": [
        "working-capital-peg-ma", "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target"],
    "working-capital-peg-ma": [
        "quality-of-earnings-report", "ma-deal-structure",
        "lower-middle-market-ma-process"],

    # Reading an offer. Sits between the fundamentals and the buyer guides: the
    # peg is one of its six structures, and the buyer-type guide explains who
    # asks for rollover equity and why.
    "ma-deal-structure": [
        "working-capital-peg-ma", "strategic-buyer-vs-private-equity-buyer",
        "lower-middle-market-ma-process"],

    # Sector: IT managed services
    "msp-valuation-multiples": [
        "/msp-ma-advisor", "business-services-valuation-multiples",
        "ebitda-and-business-valuation-basics"],

    # Sector: pet care
    "dog-daycare-pet-care-valuation-multiples": [
        "/pet-care-ma-advisor", "roll-ups-legal-services-pet-care",
        "ebitda-and-business-valuation-basics"],
    "roll-ups-legal-services-pet-care": [
        "/pet-care-ma-advisor", "dog-daycare-pet-care-valuation-multiples",
        "strategic-buyer-vs-private-equity-buyer"],

    # Sector: early childhood education
    "childcare-daycare-valuation-multiples": [
        "ma-advisor-early-childhood-education", "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target"],
    "ma-advisor-early-childhood-education": [
        "childcare-daycare-valuation-multiples", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process"],

    # Sector: manufacturing
    "manufacturing-valuation-multiples": [
        "ma-advisor-industrials-manufacturing", "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target"],
    "ma-advisor-industrials-manufacturing": [
        "manufacturing-valuation-multiples", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process"],

    # Sector: business services
    "business-services-valuation-multiples": [
        "ma-advisor-business-services", "msp-valuation-multiples",
        "ebitda-and-business-valuation-basics"],
    "ma-advisor-business-services": [
        "business-services-valuation-multiples", "how-to-choose-an-ma-advisor",
        "/msp-ma-advisor"],

    # Choosing an advisor
    "how-to-choose-an-ma-advisor": [
        "sell-side-advisor-vs-business-broker", "top-lower-middle-market-investment-banks",
        "best-ma-advisors-selling-20-million-company"],
    "sell-side-advisor-vs-business-broker": [
        "how-to-choose-an-ma-advisor", "top-lower-middle-market-investment-banks",
        "lower-middle-market-ma-process"],
    "top-lower-middle-market-investment-banks": [
        "best-ma-advisors-selling-20-million-company", "how-to-choose-an-ma-advisor",
        "sell-side-advisor-vs-business-broker"],
    "best-ma-advisors-selling-20-million-company": [
        "top-lower-middle-market-investment-banks", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process"],
    "best-business-valuation-firms-lower-middle-market": [
        "ebitda-and-business-valuation-basics", "quality-of-earnings-report",
        "how-to-choose-an-ma-advisor"],

    # Process and timing
    "lower-middle-market-ma-process": [
        "how-long-does-it-take-to-sell-a-business", "when-to-start-exit-planning",
        "what-buyers-look-for-in-an-acquisition-target"],
    "how-long-does-it-take-to-sell-a-business": [
        "lower-middle-market-ma-process", "when-to-start-exit-planning",
        "quality-of-earnings-report"],
    "when-to-start-exit-planning": [
        "lower-middle-market-ma-process", "what-buyers-look-for-in-an-acquisition-target",
        "how-long-does-it-take-to-sell-a-business"],

    # Buyers
    "what-buyers-look-for-in-an-acquisition-target": [
        "strategic-buyer-vs-private-equity-buyer", "quality-of-earnings-report",
        "ebitda-and-business-valuation-basics"],
    "strategic-buyer-vs-private-equity-buyer": [
        "what-buyers-look-for-in-an-acquisition-target", "ma-deal-structure",
        "lower-middle-market-ma-process"],

    # Essays. Kept with each other: a sell-side guide under a family piece reads
    # as mechanical, which is the one thing this block must not do.
    "why-we-built-salt-creek-around-relationships": [
        "community-midwest-selling-a-family-business",
        "coming-home-family-midwest-fourth-of-july", "how-to-choose-an-ma-advisor"],
    "community-midwest-selling-a-family-business": [
        "why-we-built-salt-creek-around-relationships",
        "coming-home-family-midwest-fourth-of-july", "when-to-start-exit-planning"],
    "coming-home-family-midwest-fourth-of-july": [
        "community-midwest-selling-a-family-business",
        "why-we-built-salt-creek-around-relationships", "how-ai-is-actually-changing-business"],
    "how-ai-is-actually-changing-business": [
        "why-we-built-salt-creek-around-relationships",
        "what-buyers-look-for-in-an-acquisition-target",
        "community-midwest-selling-a-family-business"],
}


GUIDE_YEAR = re.compile(r'const CURRENT_GUIDE_YEAR = "(\d{4})"')


def current_guide_year():
    """The year guide slugs carry, read from the Worker.

    The map above is deliberately written in bare slugs. Storing the year in it
    too would mean editing ninety-odd lines here every January on top of the
    renames, which is exactly the maintenance the resolve-forward design in
    src/index.js exists to avoid. One source of truth, applied at render time.
    """
    path = os.path.join("src", "index.js")
    if not os.path.exists(path):
        print("  !! {} not found, cannot resolve guide year".format(path), file=sys.stderr)
        return None
    found = GUIDE_YEAR.search(open(path, encoding="utf-8").read())
    if not found:
        print("  !! {}: no CURRENT_GUIDE_YEAR".format(path), file=sys.stderr)
        return None
    return found.group(1)


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


def render(targets, titles, stamp):
    """`stamp` turns a bare base slug into the filename actually on disk."""
    items = "\n".join(
        '        <li><a href="{}">{}<span class="related-guides-arrow" aria-hidden="true">'
        "&#8594;</span></a></li>".format(href_for(stamp(t)), html.escape(titles[t], quote=False))
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

    year = current_guide_year()
    if not year:
        return 1
    suffix = "-" + year

    def base_of(path):
        """The map's key for a file: its slug with any year suffix removed."""
        slug = os.path.basename(path)[: -len(".html")]
        return slug[: -len(suffix)] if slug.endswith(suffix) else slug

    # Which bases actually carry the year on disk. Derived rather than listed, so
    # the essays stay bare without needing to be enumerated a second time.
    stamped_bases = {
        base_of(path) for path in paths
        if os.path.basename(path)[: -len(".html")].endswith(suffix)
    }

    def stamp(target):
        """Bare base slug -> the slug on disk. Root pages pass through."""
        if target.startswith("/"):
            return target
        return target + suffix if target in stamped_bases else target

    titles = dict(ROOT_PAGE_TITLES)
    for path in paths:
        headline = article_headline(path)
        if not headline:
            print("  !! {}: no Article headline, cannot be linked to".format(path), file=sys.stderr)
            continue
        titles[base_of(path)] = headline

    # Fail before writing anything: a typo in RELATED would otherwise scatter dead
    # links across 28 files.
    missing = sorted({t for targets in RELATED.values() for t in targets} - set(titles))
    if missing:
        print("Unknown link targets: {}".format(missing), file=sys.stderr)
        return 1
    unmapped = sorted({base_of(p) for p in paths} - set(RELATED))
    if unmapped:
        print("Articles missing from RELATED: {}".format(unmapped), file=sys.stderr)
        return 1

    written = 0
    for path in paths:
        base = base_of(path)
        original = open(path, encoding="utf-8").read()
        stripped = EXISTING_BLOCK.sub("", original)
        if ANCHOR not in stripped:
            print("  !! {}: no next-cta anchor, skipped".format(path), file=sys.stderr)
            continue
        updated = stripped.replace(ANCHOR, render(RELATED[base], titles, stamp) + ANCHOR, 1)
        if updated != original:
            open(path, "w", encoding="utf-8").write(updated)
            written += 1

    print("related-guides block written to {} of {} articles".format(written, len(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
