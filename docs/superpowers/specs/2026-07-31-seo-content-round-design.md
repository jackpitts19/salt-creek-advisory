# SEO Content Round — Sector Valuation Guides + Deal Mechanics

**Date:** 2026-07-31
**Branch:** `content-sector-valuations`
**Approved by:** Jack, 2026-07-31

## Goal

Extend saltcreekadvisory.com's organic reach by (a) giving every one of the five declared
sectors a "what does it sell for" page and (b) filling the two largest holes in the
deal-mechanics cluster. Then run a technical pass so the new pages are linked, indexed,
and schema-complete.

## Scope

### Flagships (written first, reviewed before the batch)

| File | Target query family | Author |
|---|---|---|
| `articles/childcare-daycare-valuation-multiples.html` | daycare/childcare valuation multiple, what is my daycare worth | Connor Pitts |
| `articles/quality-of-earnings-report.html` | quality of earnings report, QoE cost, sell-side QoE | Jack Pitts |

### Batch (after flagship review)

3. `articles/dog-daycare-pet-care-valuation-multiples.html`
4. `articles/manufacturing-valuation-multiples.html`
5. `articles/business-services-valuation-multiples.html`
6. `articles/working-capital-peg-ma.html`

### Out of scope this round

Geographic/local pages (Chicago, Illinois, Midwest). Considered and deliberately deferred:
thin geo pages are the classic helpful-content casualty and need real local substance to
justify existing. Earnouts and tax-on-sale guides also deferred; tax content is
advice-adjacent and carries liability the other topics do not.

> **Stale paths below.** Guide URLs now carry the year, so every
> `articles/<slug>.html` named in this document is `articles/<slug>-2026.html`
> on disk. This file is kept as the record of that content round; see
> [url-scheme.md](../../url-scheme.md) for the current scheme, how to add a
> guide, and the January rollover.

## Templates

**Sector valuation guides** clone `articles/msp-valuation-multiples.html`:

```
H1 → .article-answer (Direct Answer) → .article-tldr → How X Is Valued (revenue vs
adj. EBITDA) → cited transaction data by size → Who This Article Is For → 3–5 market
segments → Comparison at a Glance (.article-table-wrap) → what moves you inside the
band → how X compares across the LMM → .article-fit (honest limits) → getting a
specific range → .article-disclaimer → 10 FAQs → .next-cta
```

**Deal-mechanics guides** use the owner-guide shape: TL;DR box opening `.article-body`,
cited market data early, at least one comparison table, a by-sector cross-link block,
honest limits in `.article-fit`, 9–10 FAQs.

**Schema on every page:** `Article` (with `Person` author, `Organization` publisher,
`citation[]` of `CreativeWork` entries) + `BreadcrumbList` + `FAQPage`. FAQ schema text
must be generated from the rendered FAQ copy so the two cannot drift.

## Sourcing rules

Carried from `article-citation-playbook`. Every figure is attributed to the publishing
body and verified this session, not taken from a search snippet.

**Verified sources for the childcare guide:**

- Navagant, *Early Childhood Education Industry Report Q3 2024* (citing PitchBook) —
  global ECE M&A volume 2019–Jun 2024; 2022 record of 342 transactions; buyer splits;
  "eight of the eleven largest US childcare chains by capacity are now owned by private
  equity groups"; Procare/Roper $1.86B; Benesse/BPEA EQT $1.37B.
- Ankura, Jan 29 2025 — $71.8B industry revenue (2024); ~95% independent operators;
  11.0% average profit margin; staffing 47.8% of revenue; average wage $23,964; 70%
  occupancy threshold; Learning Care Group + KinderCare = 4.6% combined share.
- Tyton Partners, May 17 2024 — PE-backed chains ≈10% of market by students served
  (~750,000 daily); for-profit share +8% 2020–2022.
- multiples.vc KinderCare comps (May 2026) — $424M market cap, $3B revenue, 10.5x
  EV/EBITDA.

**Corrections caught during research (do not repeat the wrong versions):**

- Search snippets claimed "nine of the eleven largest US childcare chains" are PE-owned.
  The Navagant report says **eight**. Use eight.
- Snippets attributed the "342 transactions in 2022" figure and the PE-ownership claim to
  Tyton Partners and Ankura respectively. Neither piece contains them on direct fetch.
  Both belong to Navagant.
- The "28.3% valuation expectations / 24.5% diligence findings" deal-failure split could
  not be confirmed at any primary source. **Do not cite it.**
- Ankura's $71.8B and IBISWorld's $22.6B describe different industry definitions (all
  childcare incl. home-based vs. Early Childhood Learning Centers). Say so rather than
  picking one silently.

**Broker-published multiple ladders** (single-site 2–4x, 2–4 centers 3–5x, 5–15 centers
4–6x, 20+ centers 6–9x) come from brokerage marketing pages, not transaction databases.
Label them as such every time they appear.

## Technical pass

- Wire all six articles into `sectors.html`, the five sector blocks, `articles.html`, and
  related-article links in existing guides
- Fix the four 1-inbound-link orphans (the brand/personal pieces)
- Sitemap entries + `lastmod`; IndexNow ping for new URLs
- Validate schema; confirm FAQ schema matches rendered text
- Re-check CLS against the fix in `6540b38`

## Expectations

Indexing is fast (IndexNow + GSC, days). Ranking is not — new pages typically take 8–16
weeks to settle, and these query families are contested. The technical pass shortens
time-to-indexed, not time-to-ranked.

## Deploy safety

All work stays on `content-sector-valuations`. `main` is live-on-push via Cloudflare
(~30–60s), so nothing reaches prospective sellers until Jack merges.
