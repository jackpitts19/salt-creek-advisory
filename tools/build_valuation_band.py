#!/usr/bin/env python3
"""Insert one valuation band near the top of every guide.

Run from the repository root after adding a guide or editing SECTOR_INDUSTRY:

    python3 tools/build_valuation_band.py

Every guide ended on its only valuation link, in the closing section, which on
a phone sits up to twenty-five screens below where a search visitor lands. The
band puts the same offer where it is read: directly after the Direct Answer box
when the guide has one, otherwise after its first table, otherwise before the
second heading of the body.

It is built from classes the guides already use (the TL;DR box and the text
link), so it looks the same in all three positions. The `article-tldr--band`
modifier lets the stylesheet slim it down, so that it does not read as a second
TL;DR when the two sit together under the Direct Answer box. The copy says only
what valuation.html itself promises.

A guide about one sector links with that industry preselected. The value has to
be one of the options of the industry select in valuation.html, and the run
fails before writing anything if it is not.

The four essays get no band. They are the articles with no year in their file
name, which is how docs/url-scheme.md already tells the two kinds apart.

Idempotent: the band is delimited by HTML comments and rewritten in place, so
re-running after an edit replaces rather than duplicates. Stdlib only.
"""
import glob
import html
import os
import re
import sys

START = "<!-- valuation-band:start -->"
END = "<!-- valuation-band:end -->"

# The band's own lines plus the blank line render() leaves after it, so that
# removing a band gives back the file exactly as it was before.
EXISTING_BAND = re.compile(
    r"[ \t]*" + re.escape(START) + r".*?" + re.escape(END) + r"\n{0,2}", re.DOTALL)


def _div_with_class(name):
    """An opening <div> carrying exactly this class, not one it is a prefix of."""
    return re.compile(
        r'<div\b[^>]*\bclass="(?:[^"]*\s)?' + re.escape(name) + r'(?:\s[^"]*)?"', re.IGNORECASE)


ANSWER_BOX = _div_with_class("article-answer")
TABLE_WRAP = _div_with_class("article-table-wrap")
ARTICLE_BODY = _div_with_class("article-body")
DIV_TOKEN = re.compile(r"<div\b|</div>", re.IGNORECASE)
H2_OPEN = re.compile(r"<h2[\s>]", re.IGNORECASE)
YEAR_SLUG = re.compile(r"(.+)-(\d{4})")
INDUSTRY_SELECT = re.compile(
    r'<select\b[^>]*\bid="vIndustry"[^>]*>(.*?)</select>', re.DOTALL | re.IGNORECASE)
OPTION_VALUE = re.compile(r'<option\b[^>]*\bvalue="([^"]*)"', re.IGNORECASE)

# How far into the article body a first table may start and still host the band.
LATE_SHARE = 0.5
VALUATION_HREF = "../valuation"
INDUSTRY_PARAM = "industry"

# Guides about one sector, by bare slug, and the option of the industry select
# in valuation.html that their reader would pick. Bare slugs, as in
# build_related.py, so nothing here moves when the guide year rolls.
#
# The pet care guides link with Pet Care chosen now that the form offers it.
# The roll-ups guide covers legal services too, so it links to the plain form.
SECTOR_INDUSTRY = {
    "msp-valuation-multiples": "itservices",
    "best-ma-advisors-msp-managed-service-providers": "itservices",
    "msp-sale-readiness-checklist": "itservices",
    "who-buys-msp-businesses": "itservices",
    "childcare-daycare-valuation-multiples": "ece",
    "ma-advisor-early-childhood-education": "ece",
    "prepare-preschool-childcare-business-for-sale": "ece",
    "dental-practice-valuation-multiples": "healthcare",
    "best-ma-advisors-dental-practices": "healthcare",
    "best-ma-advisors-hvac-companies": "homeservices",
    "best-ma-advisors-plumbing-companies": "homeservices",
    "best-ma-advisors-accounting-cpa-firms": "professional",
    "selling-cpa-firm-private-equity": "professional",
    "manufacturing-valuation-multiples": "manufacturing",
    "ma-advisor-industrials-manufacturing": "manufacturing",
    "business-services-valuation-multiples": "services",
    "selling-commercial-landscaping-company": "facilities",
    "ma-advisor-business-services": "services",
    "dog-daycare-pet-care-valuation-multiples": "petcare",
    "best-ma-advisors-pet-care-dog-daycare-businesses": "petcare",
    "prepare-dog-daycare-business-for-sale": "petcare",
    "evaluate-pet-care-acquisition-offer": "petcare",
}

BAND_LINES = (
    START,
    '<div class="article-tldr article-tldr--band">',
    '  <span class="article-tldr-label">Free Valuation Range</span>',
    "  <p>About a dozen quick questions and two minutes get you a ballpark range for your"
    " business, built from published industry transaction multiple ranges, with the math"
    " behind it. It is a directional estimate, not a formal valuation.</p>",
    '  <a href="{href}" class="text-link">Value My Business'
    ' <span aria-hidden="true">&#8594;</span></a>',
    "</div>",
    END,
)


def split_year(path):
    """(bare slug, year) for a guide; (slug, None) for an essay."""
    slug = os.path.basename(path)[: -len(".html")]
    stamped = YEAR_SLUG.fullmatch(slug)
    return (stamped.group(1), stamped.group(2)) if stamped else (slug, None)


def href_for(base, industries=None):
    """The band's link for a guide: plain, or with its sector preselected."""
    industries = SECTOR_INDUSTRY if industries is None else industries
    if base not in industries:
        return VALUATION_HREF
    return "{}?{}={}".format(VALUATION_HREF, INDUSTRY_PARAM, industries[base])


def industry_options(valuation_html):
    """The values a visitor can pick in the industry select of valuation.html."""
    select = INDUSTRY_SELECT.search(valuation_html)
    if not select:
        return set()
    return {value for value in OPTION_VALUE.findall(select.group(1)) if value}


def render(href, indent):
    """The band, indented to sit level with the element it follows."""
    lines = (line.format(href=html.escape(href)) if "{href}" in line else line
             for line in BAND_LINES)
    return "".join(indent + line + "\n" for line in lines) + "\n"


def is_torn(page):
    """True when a band marker has lost its pair.

    strip() removes everything from a start marker to the next end marker. With
    a stray start marker ahead of a real band, that would be the guide's own
    text, so a torn page is refused rather than cleaned.
    """
    return page.count(START) != page.count(END)


def strip(page):
    """The page with any existing band removed. Only safe when not is_torn()."""
    return EXISTING_BAND.sub("", page)


def _line_start(page, index):
    return page.rfind("\n", 0, index) + 1


def _indent_at(page, index):
    return re.match(r"[ \t]*", page[_line_start(page, index):]).group()


def _element_end(page, start):
    """Index just past the </div> closing the <div> that opens at `start`."""
    depth = 0
    for token in DIV_TOKEN.finditer(page, start):
        depth += -1 if token.group().startswith("</") else 1
        if depth == 0:
            return token.end()
    return None


def _next_content_line(page, index):
    """Start of the first non-blank line after the line holding `index`."""
    newline = page.find("\n", index)
    while newline != -1:
        start = newline + 1
        newline = page.find("\n", start)
        line = page[start:] if newline == -1 else page[start:newline]
        if line.strip():
            return start
    return None


def _after(page, opening):
    """Where a band goes to follow the <div> matched by `opening`."""
    end = _element_end(page, opening.start())
    if end is None:
        return None
    position = _next_content_line(page, end)
    if position is None:
        return None
    return position, _indent_at(page, opening.start())


def _before_second_heading(page):
    body = ARTICLE_BODY.search(page)
    if not body:
        return None
    body_end = _element_end(page, body.start())
    if body_end is None:
        return None
    headings = [found for found in H2_OPEN.finditer(page, body.end()) if found.start() < body_end]
    if len(headings) < 2:
        return None
    position = _line_start(page, headings[1].start())
    indent = page[position:headings[1].start()]
    # A heading sharing its line with other markup has no clean line to go above.
    return None if indent.strip() else (position, indent)


def placement(page):
    """(insert position, indent) for a page with no band in it, or None."""
    answer = ANSWER_BOX.search(page)
    if answer:
        return _after(page, answer)
    table = TABLE_WRAP.search(page)
    if table and not _is_late(page, table):
        return _after(page, table)
    # A first table past halfway would bury the band as deep as the closing
    # section it was meant to relieve, so the heading rule takes over. The late
    # table is still better than no band when the body has no second heading.
    heading = _before_second_heading(page)
    return heading if heading or not table else _after(page, table)


def _is_late(page, opening):
    """True when `opening` starts past LATE_SHARE of the article body."""
    body = ARTICLE_BODY.search(page)
    body_end = _element_end(page, body.start()) if body else None
    if body_end is None or opening.start() < body.start():
        return False
    return opening.start() - body.start() > LATE_SHARE * (body_end - body.start())


def apply(page, href):
    """The page with exactly one band, linking to `href`.

    None if the band has no place, or if the page is_torn().
    """
    if is_torn(page):
        return None
    bare = strip(page)
    spot = placement(bare)
    if spot is None:
        return None
    position, indent = spot
    return bare[:position] + render(href, indent) + bare[position:]


def _read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _write(path, text):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def _map_problems(root, industries, guide_bases):
    """Reasons the map cannot be trusted, each fatal. Empty when it can."""
    form = os.path.join(root, "valuation.html")
    if not os.path.exists(form):
        return ["{} not found, cannot check the industry values".format(form)]
    options = industry_options(_read(form))
    if not options:
        return ["{}: no options found in the vIndustry select".format(form)]
    problems = []
    unknown = sorted(set(industries.values()) - options)
    if unknown:
        problems.append("Industries the valuation form does not offer: {}".format(unknown))
    missing = sorted(set(industries) - guide_bases)
    if missing:
        problems.append("Mapped slugs with no guide on disk: {}".format(missing))
    return problems


def build(root=".", industries=None, out=sys.stdout, err=sys.stderr):
    """Write the band into every guide under `root`. Returns a process exit code."""
    industries = SECTOR_INDUSTRY if industries is None else industries
    paths = sorted(glob.glob(os.path.join(root, "articles", "*.html")))
    if not paths:
        print("No articles found. Run this from the repository root.", file=err)
        return 1

    slugs = {path: split_year(path) for path in paths}
    guide_bases = {base for base, year in slugs.values() if year}

    # Fail before writing anything: a mistyped industry would otherwise put a
    # link that preselects nothing into every guide of that sector.
    problems = _map_problems(root, industries, guide_bases)
    if problems:
        for problem in problems:
            print(problem, file=err)
        return 1

    written = unplaced = 0
    for path in paths:
        base, year = slugs[path]
        original = _read(path)
        # An essay is only ever cleaned, in case a band was pasted into one.
        if is_torn(original):
            print("  !! {}: a valuation-band marker has no pair, left untouched".format(path),
                  file=err)
            unplaced += 1
            continue
        updated = apply(original, href_for(base, industries)) if year else strip(original)
        if updated is None:
            print("  !! {}: no answer box, table or second heading to place the band by".format(
                path), file=err)
            unplaced += 1
            continue
        if updated != original:
            _write(path, updated)
            written += 1

    print("valuation band current in {} guides, {} rewritten, {} essays left alone".format(
        len(guide_bases) - unplaced, written, len(paths) - len(guide_bases)), file=out)
    return 1 if unplaced else 0


if __name__ == "__main__":
    sys.exit(build())
