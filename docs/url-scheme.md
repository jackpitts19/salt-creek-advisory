# Guide URLs, and what to do every January

Guide URLs carry the year they speak for:

```
/articles/msp-valuation-multiples-2026
/articles/working-capital-peg-ma-2026
```

The four personal essays do not, and should not. A year on
`why-we-built-salt-creek-around-relationships` reads as dated rather than
current, which is the opposite of the point.

## Why the year is resolved, not mapped

The obvious way to do this is a redirect table: `msp-valuation-multiples` ->
`msp-valuation-multiples-2026`. It works for one year. In 2027 you add
`-2026` -> `-2027`, and now an inbound link from 2025 takes two hops. By 2029
it takes four, each shedding a little of whatever authority that link carried,
and nobody ever goes back to flatten them.

So `src/index.js` resolves instead. `resolveGuideYear()` takes any form of a
known guide, bare or stamped with any year at all, and returns the current
one. No table, so no chain, and a link from any year lands in a single hop.
That hop also absorbs the `https`, `www` and `.html` normalization, because
all three corrections are applied to one URL object before a single 301 goes
out.

Two constants drive it, both in `src/index.js`:

- `CURRENT_GUIDE_YEAR`: the year the files on disk carry.
- `YEAR_STAMPED_GUIDES`: the base slugs, without any year.

`tools/build_related.py` reads `CURRENT_GUIDE_YEAR` out of that file rather
than hardcoding it, so its `RELATED` map stays in bare slugs and needs no edit
when the year rolls.

## Adding a new guide

1. Create `articles/<slug>-<YEAR>.html`. Clone the closest existing guide for
   structure; the sector valuation guides share a shape.
2. Set `<link rel="canonical">`, `og:url`, and the Article JSON-LD `url` and
   `mainEntityOfPage.@id` to
   `https://saltcreekadvisory.com/articles/<slug>-<YEAR>`. They must agree with
   each other and with the filename.
3. Add the bare base slug to `YEAR_STAMPED_GUIDES` in `src/index.js`. Skip this
   only for an essay, which stays year-free.
4. Add a card to `articles.html`, or the checker fails it as an orphan.
5. Add the bare base slug to `RELATED` in `tools/build_related.py`, both as a
   key and as a target of two or three related guides.
6. Add an entry to `llms.txt`.
7. Run the checks below.

## The January rollover

You no longer have to remember this on your own. The weekly `guide-year`
workflow opens a `Roll the guide year` issue once the calendar passes
`CURRENT_GUIDE_YEAR`, with these steps in it. Nothing breaks while it sits
open: old links still resolve forward in one hop. The guides just read as
stale, which is the whole cost of being late.

Content first. Renaming a 2026 guide to 2027 without refreshing what it says is
the thing that turns a year-stamped URL into a liability rather than a signal.

1. Update the content and the `dateModified` in each guide's Article JSON-LD.
2. `git mv articles/<slug>-2026.html articles/<slug>-2027.html` for each guide
   being carried forward.
3. In each renamed file, replace `-2026` with `-2027` in the canonical,
   `og:url`, Article `url`, `mainEntityOfPage.@id`, BreadcrumbList item and
   FAQPage `url`. Update `<title>`, `og:title` and `twitter:title` too.
4. Update sibling links in other guides, the card hrefs in `articles.html`, and
   the URLs in `llms.txt`.
5. Change `CURRENT_GUIDE_YEAR` in `src/index.js` to `"2027"`. That is the only
   edit needed there; `YEAR_STAMPED_GUIDES` holds bare slugs and does not move.
6. Update the year literals in `tools/test_worker_redirects.mjs`.
7. Run the checks below, then the post-deploy steps.

`tools/build_related.py` needs no edit. Neither do `feed.xml` or `sitemap.xml`,
which are generated.

When rewriting references in bulk, scope the replacement to this site's own
URLs. A previous pass matched on the bare slug and rewrote
`aventis-advisors.com/msp-valuation-multiples/` into a URL that does not exist,
in seven places. `check_site.py` cannot catch that, because it does not follow
external links. Diff the set of external URLs before and after.

`tools/check_links.py` does follow them, and the weekly `link-rot` workflow runs
it. That is a backstop measured in days, not a substitute for diffing the set
before and after a bulk rewrite.

## Checks

```sh
python3 tools/build_related.py     # Keep Reading blocks
python3 tools/build_feed.py        # feed.xml and sitemap.xml, generated
python3 tools/stamp_assets.py      # ?v= cache stamps on css and js
python3 tools/check_site.py        # 0 errors required
python3 tools/test_check_site.py   # the checker's own tests
python3 tools/test_stamp_assets.py
python3 tools/test_submit_indexnow.py
python3 tools/test_check_links.py
python3 tools/test_check_canonical.py
node     tools/test_worker_redirects.mjs
```

Those are all offline. One more needs production to be up, so it is not part of
the pre-push run and does not gate anything:

```sh
python3 tools/check_canonical.py              # every URL form, against production
python3 tools/check_canonical.py --sample 5   # a quick smoke run
```

Run `build_feed.py` **after** committing the renames. It reads each non-article
page's `lastmod` from `git log`, so running it against uncommitted work stamps
the previous commit's date.

`.github/workflows/checks.yml` runs all of the above on every push and pull
request, so forgetting is no longer fatal. Its last step regenerates the three
generated artifacts and fails if the result differs from what is committed,
which is the check that catches a `feed.xml` left a commit behind. That failure
is the workflow enforcing the `build_feed.py` ordering rule above: commit first,
regenerate, amend.

CI is a second pair of eyes, not the first. `main` still deploys to production
within about a minute of a push, and the workflow finishes after the deploy
starts. Run the checks locally before pushing anything you care about.

## Telling the engines

After the deploy is live, not before, because the engines fetch what you
announce:

```sh
python3 tools/submit_indexnow.py --dry-run /midwest-ma-advisor   # see the payload
python3 tools/submit_indexnow.py /midwest-ma-advisor             # one page
python3 tools/submit_indexnow.py --all                           # every URL in the sitemap
```

That covers Bing, Yandex and the other IndexNow participants, which is most of
them except the one that matters most. Google does not participate, so a new
URL still wants a Search Console request-indexing on top of this.

Prefer naming the pages that actually changed. `--all` is for a structural
change such as a rename round, not for routine edits.

### What the guards cover

- `check_site.py` asserts `YEAR_STAMPED_GUIDES` matches the files on disk in
  both directions. A slug listed with no file behind it would redirect into a
  404; a year-stamped file missing from the list would leave its old URL dead.
- It also warns, without failing, when `CURRENT_GUIDE_YEAR` falls behind the
  calendar. Everything can be perfectly self-consistent and still be
  advertising last year, and nothing else would say so.
- That warning is deliberately quiet on a push, which left it easy to miss
  entirely: a warning inside a green build is not a signal. So the weekly
  `guide-year` workflow runs the same check with `--strict-year`, which
  promotes it to an error, and opens a `Roll the guide year` issue the way
  `link-rot` does for dead citations. It gates nothing, so it can afford to
  fail loudly; pushes keep the warning. Reproduce it with
  `python3 tools/check_site.py --strict-year`.
- `test_worker_redirects.mjs` drives the real Worker and asserts hop counts, so
  a chain cannot reappear unnoticed. It also pins query-string preservation,
  because losing it would silently break `utm` attribution on every old link.
- `check_canonical.py` is the only guard that leaves the building. Everything
  above proves the code is right; this one proves the code is reachable, which
  is a different claim and the one a crawler tests. Detach the www custom domain
  in the Cloudflare dashboard, move the Worker route, or half-land a deploy, and
  every check above stays green while production serves each article at two URLs.
  Nothing in the repository changed, so nothing in the repository could notice.
  It fails only on a real split (a non-canonical URL serving 200, a chain, a
  redirect to the wrong page, a dead canonical, or a canonical tag that
  disagrees with the URL it was served at). A timeout or a 429 is reported and
  ignored, because a daily job that cries wolf is a daily job someone mutes.

## After deploying a rename

Step 1 is automated now. The rest is not, and none of it is anyone's job by
default.

1. Verify production, not just the local tests: `python3 tools/check_canonical.py`
   probes every URL form of every page and exits non-zero if any of them serves a
   second copy instead of redirecting. The `canonical-check` workflow runs the
   same command daily and opens an issue, so a regression surfaces within a day
   even if nobody runs it here. For a single URL by hand,
   `curl -sI https://saltcreekadvisory.com/articles/<old-slug>` should still
   return `301` with the new `Location`.
2. Resubmit `sitemap.xml` in Google Search Console, and request indexing on the
   handful of guides that carry the most traffic.
3. Annotate the deploy date in GA4. Every guide's `page_path` changes at once,
   so landing-page reports, Explorations and any audience filtered on the old
   paths will split or silently read zero. Nothing in `analytics.js` needs
   changing; the break is entirely in saved reports.
4. Expect an impressions dip for a week or two while Google reprocesses. Watch
   old URLs move to "Page with redirect" in the Coverage report; that is the
   healthy outcome, not a problem.
5. RSS subscribers will see the renamed guides re-delivered once, because
   `feed.xml` uses the URL as `<guid isPermaLink="true">`. Expected, one-time,
   not worth engineering around.
