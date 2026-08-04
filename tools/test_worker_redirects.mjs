// Tests the Worker's URL handling through its real entry point.
//
//     node tools/test_worker_redirects.mjs
//
// Every guide URL now carries a year, which means the Worker is the only thing
// standing between an old inbound link and a 404. That made it the one file in
// this repo with real consequences and no test at all.
//
// These drive `worker.fetch` rather than reaching for internals, so what gets
// asserted is what a crawler actually receives: a status, a Location, and how
// many hops it took to get there. Hop counts are asserted explicitly because
// the whole design goal is that a chain never forms.
//
// Node's own test runner, no dependencies, matching the Python tools alongside.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const SITE = "https://saltcreekadvisory.com";

const env = {
  ASSETS: {
    fetch() {
      return new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  },
};

const get = (url) => worker.fetch(new Request(url, { method: "GET" }), env);

/** The Location of a single response, or null when it is not a redirect. */
async function hop(url) {
  const response = await get(url);
  if (response.status < 300 || response.status >= 400) return null;
  return { status: response.status, location: response.headers.get("location") };
}

/** Follows redirects to exhaustion so chain length is measured, not assumed. */
async function followAll(url, limit = 10) {
  const chain = [];
  let current = url;
  for (let i = 0; i < limit; i++) {
    const next = await hop(current);
    if (!next) return { chain, final: current };
    chain.push(next);
    current = next.location;
  }
  throw new Error(`redirect loop starting at ${url}`);
}

test("a bare guide slug redirects to the current year", async () => {
  const { chain, final } = await followAll(`${SITE}/articles/msp-valuation-multiples`);
  assert.equal(chain.length, 1, "should take exactly one hop");
  assert.equal(chain[0].status, 301);
  assert.equal(final, `${SITE}/articles/msp-valuation-multiples-2026`);
});

test("a guide already on the current year is served, not redirected", async () => {
  const response = await get(`${SITE}/articles/msp-valuation-multiples-2026`);
  assert.equal(response.status, 200);
});

test("a stale year resolves forward in one hop, never a chain", async () => {
  for (const year of ["2019", "2024", "2025"]) {
    const { chain, final } = await followAll(`${SITE}/articles/working-capital-peg-ma-${year}`);
    assert.equal(chain.length, 1, `${year} should take exactly one hop`);
    assert.equal(final, `${SITE}/articles/working-capital-peg-ma-2026`);
  }
});

test("a future year resolves back to the year actually published", async () => {
  // Someone guessing at /...-2031 gets the newest guide that exists rather
  // than a 404, which is the friendlier failure and costs nothing.
  const { final } = await followAll(`${SITE}/articles/ma-deal-structure-2031`);
  assert.equal(final, `${SITE}/articles/ma-deal-structure-2026`);
});

test("the legacy .html form and the year resolve together in one hop", async () => {
  const { chain, final } = await followAll(`${SITE}/articles/quality-of-earnings-report.html`);
  assert.equal(chain.length, 1, "normalization and year must not cost two hops");
  assert.equal(final, `${SITE}/articles/quality-of-earnings-report-2026`);
});

test("www and http collapse into the same single hop", async () => {
  const { chain, final } = await followAll(
    "http://www.saltcreekadvisory.com/articles/when-to-start-exit-planning",
  );
  assert.equal(chain.length, 1, "host, scheme and year must resolve together");
  assert.equal(final, `${SITE}/articles/when-to-start-exit-planning-2026`);
});

test("a slug containing a number is not mistaken for a year", async () => {
  // "-20-million-company": a year suffix needs four digits, this has one.
  const { final } = await followAll(`${SITE}/articles/best-ma-advisors-selling-20-million-company`);
  assert.equal(final, `${SITE}/articles/best-ma-advisors-selling-20-million-company-2026`);
});

test("the essays carry no year and are served untouched", async () => {
  for (const slug of [
    "coming-home-family-midwest-fourth-of-july",
    "community-midwest-selling-a-family-business",
    "why-we-built-salt-creek-around-relationships",
    "how-ai-is-actually-changing-business",
  ]) {
    const response = await get(`${SITE}/articles/${slug}`);
    assert.equal(response.status, 200, `${slug} should be served, not redirected`);
  }
});

test("non-guide pages are left alone", async () => {
  for (const path of ["/", "/about", "/articles", "/sectors", "/valuation", "/contact"]) {
    const response = await get(SITE + path);
    assert.equal(response.status, 200, `${path} should not redirect`);
  }
});

test("an unknown article is not invented into a year-stamped URL", async () => {
  // It must fall through to the assets binding and 404 there rather than
  // bouncing a visitor to a -2026 URL that was never published. The stub
  // answers 200; the assertion is that no redirect fired.
  const response = await get(`${SITE}/articles/does-not-exist`);
  assert.equal(response.status, 200);
});

test("campaign parameters survive the redirect", async () => {
  // Every old inbound link is now a redirect, so dropping the query string
  // here would silently break utm attribution and Google Ads click tracking
  // for all of them at once. `target` is cloned from the request URL and only
  // its protocol/host/pathname are reassigned, which is what preserves this.
  const { final } = await followAll(
    `${SITE}/articles/msp-valuation-multiples?utm_source=newsletter&utm_medium=email`,
  );
  assert.equal(
    final,
    `${SITE}/articles/msp-valuation-multiples-2026?utm_source=newsletter&utm_medium=email`,
  );

  // Also across the combined http + www + .html + year collapse, since that is
  // the shape a forwarded newsletter link actually arrives in.
  const legacy = await followAll(
    "http://www.saltcreekadvisory.com/articles/working-capital-peg-ma.html?gclid=abc123",
  );
  assert.equal(legacy.chain.length, 1);
  assert.equal(legacy.final, `${SITE}/articles/working-capital-peg-ma-2026?gclid=abc123`);
});

test("redirects still carry the security headers", async () => {
  const response = await get(`${SITE}/articles/msp-valuation-multiples`);
  assert.equal(response.status, 301);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
