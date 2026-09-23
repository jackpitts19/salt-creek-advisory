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
    "/preschool-childcare-ma-advisor": "Sell Your Preschool: Childcare M&A Advisor",
}

# Three destinations per guide. Sector guides lead with their sell-side page,
# which is what a reader in that sector actually wants next.
RELATED = {
    # Fundamentals.
    #
    # These two carry the valuation-firms guide, which was reachable only from
    # articles.html and from prose inside ma-advisor-fees: no Keep Reading block
    # on the site pointed at it, which is the one way a reader who just finished
    # a guide could have arrived. Both already link to it in the other
    # direction, so this closes the loop rather than inventing a pairing. The
    # slot comes from what-buyers-look-for both times because it is the
    # best-linked target here at eight inbound; ma-glossary has one and cannot
    # spare its.
    "ebitda-and-business-valuation-basics": [
        "quality-of-earnings-report", "best-business-valuation-firms-lower-middle-market",
        "ma-glossary-lower-middle-market", "best-ma-advisors-dental-practices",
        "dental-practice-valuation-multiples"],
    "ma-glossary-lower-middle-market": [
        "ebitda-and-business-valuation-basics", "working-capital-peg-ma",
        "lower-middle-market-ma-process"],
    "quality-of-earnings-report": [
        "working-capital-peg-ma", "ebitda-and-business-valuation-basics",
        "best-business-valuation-firms-lower-middle-market",
        "due-diligence-checklist-selling-a-business"],
    "working-capital-peg-ma": [
        "quality-of-earnings-report", "ma-deal-structure",
        "earnouts-escrow-holdbacks",
        "seller-risk-protection-deal-structuring"],

    # Reading an offer. Sits between the fundamentals and the buyer guides: the
    # peg is one of its six structures, and the buyer-type guide explains who
    # asks for rollover equity and why. The earnout guide leads the deal
    # structure list and closes the peg list for the same reason: both are
    # post-closing arithmetic run on books the buyer controls, so a reader who
    # just learned the price can still move wants the other half of that.
    "ma-deal-structure": [
        "earnouts-escrow-holdbacks", "working-capital-peg-ma",
        "strategic-buyer-vs-private-equity-buyer",
        "best-ma-advisors-plumbing-companies", "asset-sale-vs-stock-sale"],
    "earnouts-escrow-holdbacks": [
        "ma-deal-structure", "working-capital-peg-ma",
        "strategic-buyer-vs-private-equity-buyer",
        "seller-risk-protection-deal-structuring"],

    # Post-closing risk. The earnout guide answers "will I be paid the rest of
    # the price"; this one answers "how much of what I was already paid can be
    # taken back". Same reader, one question later, so each leads the other's
    # list, and the peg carries it too because both are arithmetic run after
    # the wire clears.
    "seller-risk-protection-deal-structuring": [
        "earnouts-escrow-holdbacks", "ma-deal-structure",
        "working-capital-peg-ma", "asset-sale-vs-stock-sale"],

    # The structure question that sits underneath every offer: which legal form
    # the sale takes and what that moves between buyer and seller. Its own four
    # are the three Salt Creek guides its body already links (deal structure,
    # the peg, the diligence checklist) plus the seller-protection guide, which
    # covers the indemnity, escrow and insurance terms its closing section
    # describes. It is carried by the three pages whose readers are closest to
    # that choice: deal structure (the offer's shape, fifth), seller protection
    # (the same risk-allocation terms, fourth) and diligence (whose contract and
    # employee sections split on asset against equity, fourth).
    "asset-sale-vs-stock-sale": [
        "ma-deal-structure", "working-capital-peg-ma",
        "due-diligence-checklist-selling-a-business",
        "seller-risk-protection-deal-structuring"],

    # Sector: IT managed services. Same shape as pet care below, for the same
    # reason: a reader on multiples is closer to picking a firm than to another
    # explainer, so the advisor comparison sits second rather than last.
    "msp-valuation-multiples": [
        "/msp-ma-advisor", "best-ma-advisors-msp-managed-service-providers",
        "business-services-valuation-multiples", "msp-sale-readiness-checklist"],
    "best-ma-advisors-msp-managed-service-providers": [
        "/msp-ma-advisor", "msp-valuation-multiples",
        "how-to-choose-an-ma-advisor", "msp-sale-readiness-checklist"],
    # The readiness checklist is the page an MSP owner reads before either of the
    # two above is useful, and both carry it as a fourth destination rather than
    # displacing one. Its body already links both of them by name, so its own
    # list runs to the pages the body describes without linking: diligence, which
    # is what its six-month section prepares for, and the earnout and escrow
    # guide, which is where every unresolved issue in it ends up.
    "msp-sale-readiness-checklist": [
        "/msp-ma-advisor", "due-diligence-checklist-selling-a-business",
        "earnouts-escrow-holdbacks"],

    # Sector: pet care. The advisor comparison sits in the middle of both other
    # pet care guides rather than at the end: a reader on multiples or roll-ups
    # is closer to picking a firm than to reading another sector explainer.
    "dog-daycare-pet-care-valuation-multiples": [
        "/pet-care-ma-advisor", "best-ma-advisors-pet-care-dog-daycare-businesses",
        "roll-ups-legal-services-pet-care", "prepare-dog-daycare-business-for-sale"],
    "roll-ups-legal-services-pet-care": [
        "/pet-care-ma-advisor", "best-ma-advisors-pet-care-dog-daycare-businesses",
        "dog-daycare-pet-care-valuation-multiples",
        "roll-up-buy-and-build-acquisition-advisory"],
    "best-ma-advisors-pet-care-dog-daycare-businesses": [
        "/pet-care-ma-advisor", "dog-daycare-pet-care-valuation-multiples",
        "roll-ups-legal-services-pet-care", "prepare-dog-daycare-business-for-sale"],
    # The pet care readiness guide is the counterpart to the MSP checklist above
    # and is wired the same way: the two sector guides a reader would already be
    # on carry it as a fourth destination rather than displacing one. Its body
    # links the advisor page and the multiples guide by name, so its own list
    # runs to what the body only describes: the diligence request its three-to-six
    # month section prepares for, and the earnout and escrow guide, which is where
    # an unresolved add-back or license question ends up in the terms.
    "prepare-dog-daycare-business-for-sale": [
        "/pet-care-ma-advisor", "due-diligence-checklist-selling-a-business",
        "earnouts-escrow-holdbacks"],

    # Sector: accounting and CPA firms. No accounting multiples guide exists, so
    # this one leads with the buyer-type guide: the article's spine is a PE
    # platform versus a regional or internal buyer, and that guide is the long
    # form of the same question. Broker-versus-advisor sits second because the
    # comparison itself spans a listing marketplace and a targeted process, and
    # the EBITDA explainer closes it for the normalized-earnings arithmetic.
    "best-ma-advisors-accounting-cpa-firms": [
        "strategic-buyer-vs-private-equity-buyer", "sell-side-advisor-vs-business-broker",
        "ebitda-and-business-valuation-basics", "best-ma-advisors-dental-practices"],

    # Sector: dental and orthodontics. The dental multiples guide leads: it is
    # the long form of the SDE-versus-EBITDA distinction the whole comparison
    # turns on once a DSO and an individual dentist bid on the same practice.
    # Then the EBITDA explainer, the broker-versus-advisor piece, since three of
    # the seven firms are brokers rather than sell-side advisors, and the
    # how-to-choose guide for the evaluation itself.
    "best-ma-advisors-dental-practices": [
        "dental-practice-valuation-multiples", "ebitda-and-business-valuation-basics",
        "sell-side-advisor-vs-business-broker", "how-to-choose-an-ma-advisor"],

    # Sector: dental and orthodontics, the multiples guide. Leads with the dental
    # advisor comparison, which asks the same buyer-type question from the
    # advisor side, then the EBITDA explainer for the replacement-compensation
    # arithmetic, then earnouts, because a DSO offer at 60% to 70% cash at
    # closing leaves the rest deferred.
    "dental-practice-valuation-multiples": [
        "best-ma-advisors-dental-practices", "ebitda-and-business-valuation-basics",
        "earnouts-escrow-holdbacks"],

    # Sector: HVAC and field services. There is no HVAC multiples guide yet, so
    # this one leans on the two guides that already carry the trade (HVAC is a
    # named vertical in business services and the busiest sub-sector in the
    # industrials table), then the broker-versus-advisor explainer, which is the
    # distinction the comparison itself turns on once a buyer-paid firm is in
    # the field.
    "best-ma-advisors-hvac-companies": [
        "ma-advisor-business-services", "sell-side-advisor-vs-business-broker",
        "how-to-choose-an-ma-advisor", "best-ma-advisors-plumbing-companies"],

    # Sector: plumbing. Leads with HVAC, which is the nearest trade and shares
    # three of the seven firms compared, then the broker-versus-advisor guide the
    # article's own "Advisor type" test is the short form of. Buyer types closes
    # it because the spine of this one is the three paths out (PE platform,
    # strategic, individual) rather than a multiple. Its two inbound links come
    # from HVAC and from ma-deal-structure, both of which had three and can carry
    # a fourth, the way the accounting guide was wired in.
    "best-ma-advisors-plumbing-companies": [
        "best-ma-advisors-hvac-companies", "sell-side-advisor-vs-business-broker",
        "strategic-buyer-vs-private-equity-buyer"],

    # Sector: early childhood education. The readiness guide is wired the way the
    # MSP and pet care checklists above are: the two guides an owner is already
    # reading carry it as a fourth destination rather than displacing one, and its
    # own list runs to what its body only describes. The body already names the
    # valuation guide, the advisor comparison and the sell-side page, so Keep
    # Reading goes to the diligence request its three-to-six month section
    # prepares for, and to the earnout and escrow guide, which is where an
    # unsupported add-back or a late licensing approval ends up in the terms.
    "childcare-daycare-valuation-multiples": [
        "ma-advisor-early-childhood-education", "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target",
        "prepare-preschool-childcare-business-for-sale"],
    "ma-advisor-early-childhood-education": [
        "childcare-daycare-valuation-multiples", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process",
        "prepare-preschool-childcare-business-for-sale"],
    "prepare-preschool-childcare-business-for-sale": [
        "/preschool-childcare-ma-advisor", "due-diligence-checklist-selling-a-business",
        "earnouts-escrow-holdbacks"],

    # Sector: manufacturing
    "manufacturing-valuation-multiples": [
        "ma-advisor-industrials-manufacturing", "ebitda-and-business-valuation-basics",
        "what-buyers-look-for-in-an-acquisition-target"],
    "ma-advisor-industrials-manufacturing": [
        "manufacturing-valuation-multiples", "how-to-choose-an-ma-advisor",
        "lower-middle-market-ma-process", "best-ma-advisors-hvac-companies"],

    # Sector: business services
    "business-services-valuation-multiples": [
        "ma-advisor-business-services", "msp-valuation-multiples",
        "ebitda-and-business-valuation-basics"],
    "ma-advisor-business-services": [
        "business-services-valuation-multiples", "how-to-choose-an-ma-advisor",
        "best-ma-advisors-msp-managed-service-providers",
        "best-ma-advisors-hvac-companies"],

    # Choosing an advisor. The fee guide sits second in the two comparisons that
    # quote a percentage without deriving it: a reader just told a $20M sale runs
    # 3.4%-3.9% wants the bracket arithmetic sitting behind that number.
    "how-to-choose-an-ma-advisor": [
        "sell-side-advisor-vs-business-broker", "ma-advisor-fees",
        "top-lower-middle-market-investment-banks", "best-boutique-ma-firms",
        "best-exit-planning-advisors-consultants"],
    # The buy-side guide replaces the $20M comparison here, which is already
    # reachable from top-lower-middle-market-investment-banks. Fee guide to fee
    # guide is the strongest bridge on the site: this page derives the sell-side
    # arithmetic, and the buy-side one explains why a buyer cannot use it.
    "ma-advisor-fees": [
        "how-to-choose-an-ma-advisor", "sell-side-advisor-vs-business-broker",
        "buy-side-ma-advisor"],
    "sell-side-advisor-vs-business-broker": [
        "how-to-choose-an-ma-advisor", "ma-advisor-fees",
        "top-lower-middle-market-investment-banks",
        "best-ma-advisors-accounting-cpa-firms"],
    "top-lower-middle-market-investment-banks": [
        "best-ma-advisors-selling-20-million-company", "best-ma-advisors-chicago",
        "how-to-choose-an-ma-advisor", "best-boutique-ma-firms"],

    # The only geography-scoped comparison. It leans on the national league-table
    # guide for the fee arithmetic it quotes rather than re-deriving it, so that
    # sits first; advisor selection and the broker distinction are what a reader
    # who has just narrowed to a shortlist wants next.
    "best-ma-advisors-chicago": [
        "top-lower-middle-market-investment-banks", "how-to-choose-an-ma-advisor",
        "sell-side-advisor-vs-business-broker", "best-boutique-ma-firms"],

    # The only national comparison scoped to "boutique" positioning rather than
    # geography or size alone. The league-table guide is the natural sibling for
    # the deal-size lens; Chicago is the other named-firm comparison a reader
    # narrowing a shortlist would want; how-to-choose closes the loop back to
    # picking one.
    "best-boutique-ma-firms": [
        "top-lower-middle-market-investment-banks", "best-ma-advisors-chicago",
        "how-to-choose-an-ma-advisor"],
    # Chicago takes the how-to-choose slot rather than a new one: that guide is
    # the hub of this whole group at twelve inbound links and can spare one,
    # and a reader sizing advisors for a $20M sale is the same reader who wants
    # the named-firm shortlist one geography down.
    "best-ma-advisors-selling-20-million-company": [
        "top-lower-middle-market-investment-banks", "ma-advisor-fees",
        "best-ma-advisors-chicago"],
    "best-business-valuation-firms-lower-middle-market": [
        "ebitda-and-business-valuation-basics", "quality-of-earnings-report",
        "how-to-choose-an-ma-advisor"],

    # The only comparison scoped to the transition rather than to the sale: it
    # ranges across an M&A advisor, a family-succession consultant, a brokerage
    # franchise and a credentialing body, which is the set an owner who has not
    # yet decided between an internal transfer and an outside sale is choosing
    # from. Its own three run back toward that decision: the succession guide it
    # cites twice in its own prose, advisor selection for the sale path, and the
    # broker-versus-advisor distinction, since two of the six profiled are
    # brokerage or consulting models rather than sell-side advisors.
    "best-exit-planning-advisors-consultants": [
        "when-to-start-exit-planning", "how-to-choose-an-ma-advisor",
        "sell-side-advisor-vs-business-broker",
        "family-business-succession-planning"],

    # The only guide addressed to the buyer rather than the owner, so its three
    # destinations are the sell-side mirrors of its own sections: the broker
    # comparison it points at by name, the fee guide holding the Lehman
    # arithmetic it contrasts buy-side pricing against, and advisor selection.
    "buy-side-ma-advisor": [
        "sell-side-advisor-vs-business-broker", "ma-advisor-fees",
        "roll-up-buy-and-build-acquisition-advisory"],

    # The buyer running a program rather than a single deal. It takes the
    # how-to-choose slot above rather than a new one: that guide is the hub of
    # the whole advisor cluster at fourteen inbound and can spare one, and a
    # reader who has just finished the one-deal buy-side guide is exactly the
    # reader for the multi-deal version. Its own three go back to that guide,
    # to the sector article on the same phenomenon, and to quality of earnings,
    # which is the section this guide leans on hardest: applying one earnings
    # policy across a pipeline is the difference between arbitrage and a
    # platform built on unverified numbers.
    "roll-up-buy-and-build-acquisition-advisory": [
        "buy-side-ma-advisor", "roll-ups-legal-services-pet-care",
        "quality-of-earnings-report"],

    # Process and timing. The auction guide takes one slot from each of the two
    # process guides rather than a new one: what-buyers-look-for is the best-linked
    # target in this cluster at six inbound and quality-of-earnings has five, so
    # both can spare one, and a reader who has just learned the sequence or the
    # timeline is the reader deciding between a multi-buyer process and one buyer.
    "lower-middle-market-ma-process": [
        "how-long-does-it-take-to-sell-a-business", "when-to-start-exit-planning",
        "m-and-a-auction-process-explained", "due-diligence-checklist-selling-a-business"],
    "how-long-does-it-take-to-sell-a-business": [
        "lower-middle-market-ma-process", "when-to-start-exit-planning",
        "m-and-a-auction-process-explained"],
    # Its own three run outward rather than back into the pair above: the process
    # guide for the sequence it compresses, then the two pages a reader comparing
    # bids needs next, which are who the bidders are and what their terms mean.
    "m-and-a-auction-process-explained": [
        "lower-middle-market-ma-process", "strategic-buyer-vs-private-equity-buyer",
        "ma-deal-structure", "due-diligence-checklist-selling-a-business",
        "evaluate-unsolicited-offer-buy-business"],
    # The inbound-approach guide. An owner who has just received an offer is
    # deciding whether to answer it, test the market, or run a process, so its
    # own four are the Salt Creek guides its body already links for those paths:
    # the auction explainer, the buyer types, the deal terms and the advisor fee.
    # It is carried by the three pages whose readers are closest to that moment:
    # the auction guide (one buyer against many, fifth), the family-business
    # guide (its argument about unsolicited offers is this reader, fourth) and
    # the outlook guide (which says one offer cannot show the broader market,
    # fifth). when-to-start-exit-planning also mentions unsolicited offers but
    # already carries six destinations, so it does not get a seventh.
    "evaluate-unsolicited-offer-buy-business": [
        "m-and-a-auction-process-explained", "strategic-buyer-vs-private-equity-buyer",
        "ma-deal-structure", "ma-advisor-fees"],
    # The branch of the succession question where no family member or employee
    # is ready. It reads as the next page after the general succession guide, so
    # that guide carries it second, and the family-business essay (whose reader
    # is this owner) and the transition-scoped advisor comparison carry it last.
    # Its first three: the general guide it cites for timing, the buyer-type guide
    # it cites twice, and the auction explainer for the competitive process its
    # whole argument about unsolicited offers rests on, which the body never
    # links, so the Keep Reading block is the only path there. The fourth is the
    # guide for the owner who has already had that approach.
    "family-business-succession-planning": [
        "when-to-start-exit-planning", "strategic-buyer-vs-private-equity-buyer",
        "m-and-a-auction-process-explained", "evaluate-unsolicited-offer-buy-business"],
    "when-to-start-exit-planning": [
        "best-exit-planning-advisors-consultants", "family-business-succession-planning",
        "lower-middle-market-ma-process",
        "what-buyers-look-for-in-an-acquisition-target",
        "lower-middle-market-ma-outlook", "best-ma-advisors-accounting-cpa-firms"],
    # Diligence. Sits immediately after the LOI in the sequence the two process
    # guides describe and after the bid comparison the auction guide ends on, so
    # all three carry it as a fourth destination rather than displacing one of
    # their existing three. Its own list runs into the financial workstream: the
    # QoE guide is one part of the review this page places in context, the peg is
    # the number diligence sets, and what-buyers-look-for is the same reader one
    # step earlier, before there is an LOI to diligence.
    "due-diligence-checklist-selling-a-business": [
        "quality-of-earnings-report", "working-capital-peg-ma",
        "what-buyers-look-for-in-an-acquisition-target", "asset-sale-vs-stock-sale"],

    # Market conditions. Grouped with timing rather than valuation because the
    # question it answers is sell now or wait. Its multiples are context for that
    # decision rather than a price, and the guide itself says so at length.
    "lower-middle-market-ma-outlook": [
        "when-to-start-exit-planning", "ma-deal-structure",
        "roll-up-buy-and-build-acquisition-advisory",
        "best-exit-planning-advisors-consultants",
        "evaluate-unsolicited-offer-buy-business"],

    # Buyers
    "what-buyers-look-for-in-an-acquisition-target": [
        "strategic-buyer-vs-private-equity-buyer", "quality-of-earnings-report",
        "ebitda-and-business-valuation-basics"],
    # This is the one page whose whole subject is who the buyer is, so it is the
    # reader closest to wanting the buy-side view. Deal structure yields the slot
    # rather than outlook: ma-deal-structure already links back here, so the pair
    # stays connected either way, whereas outlook lost its ma-deal-structure slot
    # to the earnout guide and dropping it here too would leave it with one
    # inbound Keep Reading link on the whole site.
    "strategic-buyer-vs-private-equity-buyer": [
        "what-buyers-look-for-in-an-acquisition-target", "buy-side-ma-advisor",
        "lower-middle-market-ma-outlook", "best-ma-advisors-accounting-cpa-firms",
        "best-ma-advisors-dental-practices"],

    # Essays. Kept with each other: a sell-side guide under a family piece reads
    # as mechanical, which is the one thing this block must not do.
    "why-we-built-salt-creek-around-relationships": [
        "community-midwest-selling-a-family-business",
        "coming-home-family-midwest-fourth-of-july", "how-to-choose-an-ma-advisor"],
    "community-midwest-selling-a-family-business": [
        "why-we-built-salt-creek-around-relationships",
        "coming-home-family-midwest-fourth-of-july", "when-to-start-exit-planning",
        "family-business-succession-planning"],
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
        print("No articles found. Run this from the repository root.", file=sys.stderr)
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
