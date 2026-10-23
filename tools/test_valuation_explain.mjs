// Tests the valuation tool's result screen and the page copy that quotes it.
//
//     node tools/test_valuation_explain.mjs
//
// "How we got your number" has to add up, on whichever path priced the
// business: the EBITDA path, the small-business SDE path, or the blend of the
// two. "What's moving your number" has to rank the owner's answers by how far
// they move the range. The explainer, the FAQ and its JSON-LD, the multiples
// table and the sources list on valuation.html all repeat what the tool does,
// so each is checked against the tool rather than against a copy.
//
// Node's own test runner, no dependencies, matching the tools alongside.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { V, inputs, jasonInputs, near, pageHtml } from "./valuation_test_helpers.mjs";

const require = createRequire(import.meta.url);
const S = require("../valuation-sources.js");

/**
 * The machine shop the page walks through: EBITDA path, owner pay set aside.
 * @param {Object} [overrides] answers to change
 * @returns {Object} its estimate
 */
function machineShop(overrides) {
  return V.computeEstimate(inputs({
    industry: "manufacturing", subsector: "machining", revenue: 6e6, profit: 9e5,
    profitBasis: "includesOwnerPay", owner: "teamOpsOwnerSales", growth: "steady3to10",
    concentration: "twentyfive_40", revenueType: "repeatNoContract", ...overrides,
  }));
}

/** @returns {Object} the HVAC estimate, a third of the way into the blend */
function hvacEstimate() {
  return V.computeEstimate(inputs({
    industry: "homeservices", subsector: "hvac", revenue: 2.5e6, profit: 450000,
    profitBasis: "includesOwnerPay", owner: "dailyHandsOn", growth: "strong10to25",
    concentration: "under5", revenueType: "repeatNoContract",
  }));
}

/** @returns {Object} the MSP estimate from the pricing tests */
function mspEstimate() {
  return V.computeEstimate(inputs({
    industry: "itservices", subsector: "msp", revenue: 8e6, profit: 1.2e6,
    profitBasis: "excludesOwnerPay", owner: "gmInPlace", growth: "steady3to10",
    concentration: "forty_60", revenueType: "autoRenewing",
  }));
}

/** @returns {Object} a restaurant where every answer is the worst one */
function flooredEstimate() {
  return V.computeEstimate(inputs({
    industry: "restaurants", subsector: "fullservice", revenue: 5e6, profit: 900000,
    profitBasis: "excludesOwnerPay", owner: "allMe", growth: "multiYearDecline",
    concentration: "over80", revenueType: "cyclicalLumpy",
  }));
}

const walker = () => V.computeEstimate(jasonInputs({ industry: "petcare", subsector: "walking" }));
const pairs = (rows) => rows.map((r) => [r.term, r.value]);

// ---------------------------------------------------------------------------
// How we got your number
// ---------------------------------------------------------------------------

test("walks the EBITDA path from reported profit to the rounded range", () => {
  const rows = V.buildBreakdownRows(machineShop());

  assert.deepEqual(pairs(rows), [
    ["Profit you reported", "$900,000"],
    ["Set aside to replace your role", "−$115,000"],
    ["Earnings a buyer prices", "$785,000"],
    ["Starting multiple for precision machining and metal fabrication shops", "4.5x – 7.0x"],
    ["Your size", "+0.01x"],
    ["Owner involvement", "−0.18x"],
    ["Revenue trend", "+0.18x"],
    ["Largest customer", "−0.3x"],
    ["Revenue type", "+0.17x"],
    ["Your multiple", "4.38x – 6.88x"],
    ["Earnings × multiple", "$3,438,300 – $5,400,800"],
    ["Your range, rounded", "$3,400,000 – $5,400,000"],
    ["Midpoint", "$4,400,000"],
  ]);
  assert.ok(Object.isFrozen(rows) && rows.every(Object.isFrozen));
});

test("walks the SDE path and says why owner earnings are priced whole", () => {
  const rows = V.buildBreakdownRows(walker());

  assert.deepEqual(pairs(rows), [
    ["Owner earnings a buyer prices (SDE)", "$60,000"],
    ["Starting SDE multiple for dog walking and pet sitting businesses", "1.9x – 3.1x"],
    ["Your size", "−0.36x"],
    ["Owner involvement", "+0.02x"],
    ["Revenue trend", "+0.14x"],
    ["Largest customer", "+0.06x"],
    ["Revenue type", "+0.07x"],
    ["Your SDE multiple", "1.83x – 3.03x"],
    ["Owner earnings × multiple", "$109,800 – $181,800"],
    ["Your range, rounded", "$100,000 – $175,000"],
    ["Midpoint", "$137,500"],
  ]);
  assert.match(rows[0].detail, /sell to an individual who runs it themselves/);
  assert.match(rows[0].detail, /rather than subtracting a manager/);
  assert.match(rows[7].detail, /40%/);
});

test("shows the pay it added back, or how it estimated owner earnings", () => {
  const added = V.buildBreakdownRows(V.computeEstimate(inputs({
    industry: "other", revenue: 400000, profit: 50000, profitBasis: "excludesOwnerPay" })));
  const estimated = V.buildBreakdownRows(V.computeEstimate(inputs({
    industry: "homeservices", subsector: "_other", revenue: 150000, profit: 0 })));

  assert.deepEqual(pairs(added).slice(0, 3), [
    ["Profit you reported", "$50,000"], ["Added back: a typical owner’s pay", "+$65,000"],
    ["Owner earnings a buyer prices (SDE)", "$115,000"]]);
  assert.equal(estimated[0].term, "Estimated owner earnings");
  assert.match(estimated[0].detail, /capped at 35% of revenue/);
});

test("walks the blend: both methods, then the weighting", () => {
  const rows = V.buildBreakdownRows(hvacEstimate());
  const byTerm = Object.fromEntries(rows.map((r) => [r.term, r]));

  assert.equal(byTerm["Owner earnings a buyer prices (SDE)"].value, "$450,000");
  assert.equal(byTerm["Value on owner earnings (SDE method)"].value, "$976,500 – $1,561,500");
  assert.equal(byTerm["Earnings after a manager’s salary"].value, "$365,000");
  assert.equal(byTerm["Larger-business multiple"].value, "4.9x – 7.9x");
  assert.equal(byTerm["Value after a manager’s salary (EBITDA method)"].value, "$1,788,500 – $2,883,500");
  assert.equal(byTerm["Blended range"].value, "$1,247,167 – $2,002,167");
  assert.match(byTerm["Blended range"].detail, /EBITDA method 33% and the SDE method 67%/);
  assert.equal(byTerm["Your range, rounded"].value, "$1,200,000 – $2,000,000");
});

test("the adjustment steps add up to the multiple on every path", () => {
  for (const est of [mspEstimate(), hvacEstimate(), walker(), flooredEstimate(), machineShop()]) {
    for (const leg of [est.ebitdaLeg, est.sdeLeg].filter(Boolean)) {
      const total = leg.adjustments.reduce((sum, a) => sum + a.adj, 0);
      assert.ok(near(Math.max(leg.minLow, leg.multRange[0] + total), leg.lowX));
      assert.ok(near(Math.max(leg.minHigh, leg.multRange[1] + total), leg.highX));
    }
  }
});

test("explains an estimated profit and skips the salary step", () => {
  const rows = V.buildBreakdownRows(V.computeEstimate(inputs({ industry: "ece", subsector: "multisite", revenue: 4e6, profit: 0 })));

  assert.equal(rows[0].term, "Estimated profit");
  assert.match(rows[0].detail, /15% margin for multi-site preschool groups/);
  assert.ok(!rows.some((r) => r.term === "Set aside to replace your role"));
});

test("shows the minimum-multiple step only when a minimum applies", () => {
  const floor = V.buildBreakdownRows(flooredEstimate()).find((r) => r.term === "Minimum multiple");
  const sdeFloor = V.buildBreakdownRows(V.computeEstimate(inputs({
    industry: "restaurants", subsector: "_other", revenue: 200000, profit: 50000, profitBasis: "includesOwnerPay",
    owner: "allMe", growth: "multiYearDecline", concentration: "over80", revenueType: "cyclicalLumpy",
  }))).find((r) => r.term === "Minimum multiple");

  assert.equal(floor.value, "Low end +2.45x, high end +1.95x");
  assert.match(sdeFloor.detail, /1\.0x at the low end or 1\.5x at the high end/);
  assert.ok(!V.buildBreakdownRows(machineShop()).some((r) => r.term === "Minimum multiple"));
});

test("does not show a minimum when the low end lands exactly on it", () => {
  // 3.5 - 0.4 - 0.8 - 0.3 is exactly 2.0x, though the float sum comes out a
  // hair under it. The owner should see no minimum line and no clamp note.
  const est = V.computeEstimate(inputs({
    industry: "ece", subsector: "_other", revenue: 4e6, profit: 750000,
    profitBasis: "excludesOwnerPay", owner: "dailyHandsOn", growth: "multiYearDecline",
    concentration: "twentyfive_40", revenueType: "mixedRevenue",
  }));

  assert.equal(est.ebitdaLeg.lowX, 2);
  assert.equal(est.ebitdaLeg.lowClamped, false);
  assert.ok(!V.buildBreakdownRows(est).some((r) => r.term === "Minimum multiple"));
  assert.doesNotMatch(V.movesNote(est), /minimum/);
});

test("names both rounding steps when the two ends round differently", () => {
  const rounded = V.buildBreakdownRows(mspEstimate()).find((r) => r.term === "Your range, rounded");

  assert.match(rounded.detail, /\$100,000 at the low end and \$500,000 at the high end/);
});

test("the no-range breakdown shows only money lines and never a multiple", () => {
  const rows = V.buildEarningsRows(V.computeEstimate(inputs({
    industry: "other", revenue: 100000, profit: -10000, profitBasis: "includesOwnerPay" })));

  assert.ok(rows.every((r) => !/x$/.test(r.value)));
});

// ---------------------------------------------------------------------------
// What's moving your number
// ---------------------------------------------------------------------------

test("ranks every answer by how much it moves the range", () => {
  const moves = V.rankMoves(mspEstimate());

  assert.deepEqual(moves.map((m) => [m.key, m.amountText]), [
    ["concentration", "Costs about $660,000"],
    ["revenueType", "Adds about $420,000"],
    ["owner", "Adds about $336,000"],
    ["growth", "Adds about $216,000"],
    ["size", "Adds about $180,000"],
  ]);
  assert.equal(moves[0].label, "Largest customer: 40–60% of revenue");
  assert.ok(moves.every((m) => m.why.length > 20));
  assert.ok(Object.isFrozen(moves));
});

test("rounds a half-thousand impact away from zero", () => {
  const conc = V.rankMoves(machineShop()).find((m) => m.key === "concentration");

  assert.equal(conc.amountText, "Costs about $236,000");
  assert.equal(conc.direction, "down");
});

test("puts answers that change nothing last, in form order", () => {
  const moves = V.rankMoves(V.computeEstimate(inputs({ industry: "ece", subsector: "multisite", revenue: 4e6, profit: 0 })));

  assert.deepEqual(moves.map((m) => m.key), ["size", "owner", "growth", "concentration", "revenueType"]);
  assert.equal(moves[4].amountText, "No change");
  assert.equal(moves[4].direction, "neutral");
});

test("speaks in multiples, not dollars, once both minimums apply", () => {
  const est = flooredEstimate();

  assert.equal(V.rankMoves(est)[0].amountText, "Lowers your multiple by 1.0x");
  assert.match(V.movesNote(est), /2\.0x to 2\.5x/);
});

test("ranks SDE-path answers on owner earnings, size first for a tiny business", () => {
  const moves = V.rankMoves(walker());

  assert.deepEqual(moves.map((m) => [m.key, m.amountText]), [
    ["size", "Costs about $22,000"],
    ["growth", "Adds about $8,000"],
    ["revenueType", "Adds about $4,000"],
    ["concentration", "Adds about $4,000"],
    ["owner", "Adds about $1,000"],
  ]);
  assert.equal(moves[0].label, "Your size: $60,000 in owner earnings");
  assert.match(V.movesIntro(walker()), /\$60,000 in owner earnings/);
});

test("ranks blended answers by their weighted effect on both methods", () => {
  const moves = V.rankMoves(hvacEstimate());

  assert.deepEqual(moves.map((m) => [m.key, m.amountText]), [
    ["owner", "Costs about $97,000"],
    ["growth", "Adds about $85,000"],
    ["concentration", "Adds about $73,000"],
    ["size", "Costs about $63,000"],
    ["revenueType", "Adds about $42,000"],
  ]);
  assert.match(V.movesIntro(hvacEstimate()), /both methods/);
});

test("adds a caution when the profit was estimated", () => {
  const ebitda = V.computeEstimate(inputs({ industry: "ece", subsector: "multisite", revenue: 4e6, profit: 0 }));
  const small = V.computeEstimate(inputs({ industry: "homeservices", subsector: "_other", revenue: 500000, profit: 0 }));

  assert.match(V.movesNote(ebitda), /estimated profit/);
  assert.match(V.movesNote(small), /estimated owner earnings/);
  assert.equal(V.movesNote(mspEstimate()), "");
});

test("ranking and breakdown never change the estimate they were handed", () => {
  const est = hvacEstimate();
  const before = JSON.stringify(est);

  V.rankMoves(est);
  V.buildBreakdownRows(est);
  V.rangeNote(est);

  assert.equal(JSON.stringify(est), before);
});

// ---------------------------------------------------------------------------
// The notes around the number
// ---------------------------------------------------------------------------

test("the warm small-business note appears on the SDE path and the blend only", () => {
  assert.match(V.smallBusinessNote(walker()), /referral partners/);
  assert.match(V.smallBusinessNote(walker()), /We’d still love to talk/);
  assert.match(V.smallBusinessNote(hvacEstimate()), /referral partners/);
  assert.equal(V.smallBusinessNote(mspEstimate()), "");
  assert.match(V.smallBusinessNote(V.computeEstimate(inputs({
    industry: "other", revenue: 100000, profit: -10000, profitBasis: "includesOwnerPay" }))), /referral partners/);
});

test("the sentence under the range names the method it used", () => {
  assert.match(V.rangeNote(machineShop()), /4\.38x–6\.88x multiple/);
  assert.match(V.rangeNote(walker()), /owner earnings \(SDE\)/);
  assert.match(V.rangeNote(hvacEstimate()), /blend/);
});

test("the SDE path names the level its range was published at, never a niche it did not use", () => {
  const agency = V.computeEstimate(inputs({ industry: "insurance", subsector: "personal", revenue: 0, profit: 150000,
    profitBasis: "includesOwnerPay" }));
  const hvac = V.computeEstimate(inputs({ industry: "homeservices", subsector: "hvac", revenue: 0, profit: 150000,
    profitBasis: "includesOwnerPay" }));
  const starting = (est) => V.buildBreakdownRows(est).find((r) => /^Starting SDE/.test(r.term)).term;

  assert.equal(agency.sdeLeg.level, "_all");
  assert.match(V.rangeNote(agency), /average SDE multiples for small businesses across industries\./);
  assert.doesNotMatch(V.rangeNote(agency), /personal lines/);
  assert.equal(starting(agency), "Starting SDE multiple for small businesses across industries");
  assert.match(V.rangeNote(hvac), /SDE multiples for home services businesses\./);
  assert.equal(starting(hvac), "Starting SDE multiple for home services businesses");
  assert.equal(starting(walker()), "Starting SDE multiple for dog walking and pet sitting businesses");
});

test("the blend never says the buyer is an individual who runs it themselves", () => {
  const rows = V.buildBreakdownRows(hvacEstimate());
  const text = rows.map((r) => r.term + " " + r.detail).join(" ");

  assert.doesNotMatch(text, /usually sell to an individual/);
  assert.match(text, /some buyers will run it themselves and some will hire a manager/);
  assert.match(text, /for businesses priced on owner earnings/);
});

test("blended amounts count an end held at a minimum as not moving", () => {
  const worst = { owner: "allMe", growth: "multiYearDecline", concentration: "over80", revenueType: "cyclicalLumpy" };
  const base = { industry: "restaurants", subsector: "", revenue: 3e6, profit: 6e5, profitBasis: "includesOwnerPay" };
  const est = V.computeEstimate(inputs({ ...base, ...worst }));
  const moves = V.rankMoves(est);
  const customer = moves.find((m) => m.key === "concentration");
  const fixed = V.computeEstimate(inputs({ ...base, ...worst, concentration: "under5" }));

  assert.equal(est.method, "blend");
  assert.ok(est.sdeLeg.lowClamped && est.ebitdaLeg.lowClamped && est.ebitdaLeg.highClamped);
  // No answer can claim more than the whole range moves when it is fixed.
  assert.ok(Math.abs(customer.impact) <= Math.max(fixed.exactLow - est.exactLow, fixed.exactHigh - est.exactHigh) + 1);
  const total = moves.reduce((sum, m) => sum + Math.abs(m.impact), 0);
  // Before held ends were counted, these summed to more than the whole value.
  assert.ok(total < est.low, "the amounts add up to " + total);
  assert.match(V.movesNote(est), /held at this tool’s minimum multiples/);
});

test("the real-estate note says it is valued separately and may add value", () => {
  assert.match(V.REAL_ESTATE_NOTE, /valued separately/);
  assert.match(V.REAL_ESTATE_NOTE, /market rent/);
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

test("every industry the tool prices has dated sources with real links", () => {
  for (const industry of [...Object.keys(V.MULT), "_all"]) {
    const list = S.SOURCES[industry];
    assert.ok(list && list.length >= 2, industry + " needs at least two sources");
    for (const source of list) {
      assert.match(source.url, /^https:\/\//, industry);
      assert.ok(source.publisher && source.title && source.date, industry);
      if (source.archiveUrl) assert.match(source.archiveUrl, /^https:\/\/web\.archive\.org\//);
    }
    const keys = list.map((s) => s.sortKey);
    assert.deepEqual(keys, keys.slice().sort().reverse(), industry + " is not newest first");
  }
});

test("the result line takes the newest few basis sources for the industry", () => {
  const picked = S.resultSources("petcare", "blend");

  const publishers = picked.map((s) => s.publisher);
  const basis = S.SOURCES.petcare.filter((s) => s.kind === "basis");
  const firstOfEach = basis.filter((s, i, all) => all.findIndex((t) => t.publisher === s.publisher) === i);

  assert.ok(picked.length >= 2 && picked.length <= 4);
  assert.equal(new Set(publishers).size, publishers.length, "one source per publisher");
  assert.deepEqual(picked, firstOfEach.slice(0, picked.length), "the newest from each publisher, newest first");
  assert.deepEqual(S.resultSources("constructor", "sde"), S.resultSources("_all", "sde"));
});

test("the result line never offers asking prices, public companies or a figure we did not adopt", () => {
  for (const industry of Object.keys(S.SOURCES)) {
    for (const method of ["sde", "blend", "ebitda"]) {
      for (const source of S.resultSources(industry, method)) {
        assert.equal(source.kind, "basis", industry + " " + method + ": " + source.publisher);
      }
    }
  }
  const pet = S.resultSources("petcare", "sde").map((s) => s.publisher);
  assert.ok(!pet.includes("Multiples.vc") && !pet.includes("Fulkerson Advisors"), pet.join(", "));
  assert.ok(!S.resultSources("healthcare", "sde").some((s) => s.publisher === "Patient Prism"));
});

test("on the SDE path the result line names sources that publish SDE figures", () => {
  for (const industry of ["petcare", "other", "insurance", "homeservices"]) {
    const picked = S.resultSources(industry, "sde");
    assert.ok(picked.length >= 2, industry);
    for (const source of picked) assert.match(source.metric, /SDE/, industry + ": " + source.publisher);
  }
});

test("each source says what kind of figure it gives, and the page labels the ones that are not a basis", () => {
  const kinds = new Set(["basis", "asking", "ceiling", "contrary", "context"]);
  for (const list of Object.values(S.SOURCES)) {
    for (const source of list) assert.ok(kinds.has(source.kind), source.publisher);
  }
  const fisart = S.SOURCES.services.find((s) => s.publisher === "FISART");
  assert.equal(fisart.metric, "EBITDA and SDE", "FISART backs the staffing EBITDA change");
  assert.equal(S.SOURCES.healthcare.find((s) => s.publisher === "Patient Prism").kind, "contrary");
  assert.equal(S.SOURCES.petcare.find((s) => s.publisher === "Multiples.vc").kind, "ceiling");
  const ibba = Object.values(S.SOURCES).flat().filter((s) => /^IBBA/.test(s.publisher));
  assert.deepEqual([...new Set(ibba.map((s) => s.publisher))], ["IBBA / M&A Source (Market Pulse)"]);

  const section = pageHtml().match(/<section[^>]*id="sources"[\s\S]*?<\/section>/)[0];
  const tagged = (section.match(/class="val-source-tag"/g) || []).length;
  const notBasis = Object.values(S.SOURCES).flat().filter((s) => ["asking", "ceiling", "contrary"].includes(s.kind)).length;
  assert.equal(tagged, notBasis);
  assert.match(section, /Patient Prism[\s\S]*?higher figure we did not adopt/);
});

test("the sources section on the page lists exactly the sources in the data", () => {
  const section = pageHtml().match(/<section[^>]*id="sources"[\s\S]*?<\/section>/);
  assert.ok(section, "valuation.html has no #sources section");
  for (const [industry, list] of Object.entries(S.SOURCES)) {
    const block = section[0].match(new RegExp('<details[^>]*data-industry="' + industry + '"[\\s\\S]*?</details>'));
    assert.ok(block, industry + " has no block");
    const urls = Array.from(block[0].matchAll(/<a href="([^"]+)" class="val-source-link"/g), (m) => m[1]);
    assert.deepEqual(urls, list.map((s) => s.url.replace(/&/g, "&amp;")), industry);
  }
  for (const link of section[0].match(/<a [^>]*href="https?:[^"]*"[^>]*>/g)) {
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener"/);
  }
});

test("the thin-evidence niches are labelled on the page", () => {
  const section = pageHtml().match(/<section[^>]*id="sources"[\s\S]*?<\/section>/)[0];

  for (const [industry, ids] of Object.entries(S.LIMITED_EVIDENCE)) {
    const block = section.match(new RegExp('<details[^>]*data-industry="' + industry + '"[\\s\\S]*?</details>'))[0];
    for (const id of ids) {
      const sub = V.SUBSECTORS[industry].find((s) => s.id === id);
      assert.ok(sub, industry + "." + id);
      assert.ok(block.includes("Limited published evidence") && block.includes(sub.label.replace(/&/g, "&amp;")),
        industry + "." + id + " is not labelled");
    }
  }
});

// ---------------------------------------------------------------------------
// The explainer below the tool quotes the tool, so it must keep agreeing.
// ---------------------------------------------------------------------------

/**
 * Text with tags removed and the handful of entities the page uses decoded,
 * so visible copy can be compared with the JSON-LD that repeats it.
 * @param {string} fragment HTML
 * @returns {string}
 */
function plainText(fragment) {
  const entities = { "&rsquo;": "’", "&amp;": "&", "&ndash;": "–", "&minus;": "−", "&hellip;": "…" };
  return fragment.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, (e) => entities[e] || e);
}

test("the worked example on the page is what the tool actually shows", () => {
  const table = pageHtml().match(/<table id="valExampleTable"[\s\S]*?<\/table>/);
  assert.ok(table, "valuation.html has no #valExampleTable");

  for (const line of V.buildBreakdownRows(machineShop())) {
    assert.ok(table[0].includes(">" + line.term + "<"), line.term);
    assert.ok(table[0].includes(">" + line.value + "<"), line.term + " should read " + line.value);
  }
});

test("the worked example's ranked answers and what-ifs match the tool", () => {
  const html = pageHtml();
  const tenToTwentyFive = machineShop({ concentration: "ten_25" });
  const withManager = machineShop({ owner: "gmInPlace" });
  const asIfEbitda = machineShop({ profitBasis: "excludesOwnerPay" });

  for (const move of V.rankMoves(machineShop())) {
    assert.ok(html.includes(move.label + ".</strong> " + move.amountText + "."), move.label);
  }
  assert.deepEqual([tenToTwentyFive.low, tenToTwentyFive.high], [3.7e6, 5.6e6]);
  assert.deepEqual([withManager.low, withManager.high], [3.8e6, 5.8e6]);
  assert.deepEqual([asIfEbitda.low, asIfEbitda.high], [4e6, 6.2e6]);
  assert.ok(html.includes("about $3.7 million to $5.6 million"));
  assert.ok(html.includes("about $3.8 million to $5.8 million"));
  assert.ok(html.includes("$4.0 million to $6.2 million"));
});

/**
 * An industry's SDE range widened to cover any niche with its own, which is
 * what the table's last column shows.
 * @param {string} industry an industry key
 * @returns {number[]} [low, high]
 */
function sdeSpan(industry) {
  const niches = Object.values(V.SDE_SUBSECTORS[industry] || {});
  const all = [V.sdeRange(industry, "")].concat(niches);
  return [Math.min(...all.map((r) => r[0])), Math.max(...all.map((r) => r[1]))];
}

test("the multiples table on the page matches the tool's own starting ranges", () => {
  const table = pageHtml().match(/<table id="valMultiplesTable"[\s\S]*?<\/table>/);
  assert.ok(table, "valuation.html has no #valMultiplesTable");
  const rows = Array.from(table[0].matchAll(/<tr data-industry="([^"]+)">([\s\S]*?)<\/tr>/g));

  assert.deepEqual(rows.map((m) => m[1]).sort(), Object.keys(V.MULT).sort());
  for (const [, industry, cells] of rows) {
    const span = V.subsectorSpan(industry);
    for (const expected of [V.formatRange(V.MULT[industry]), span ? V.formatRange(span) : "No subsectors",
      V.formatRange(sdeSpan(industry))]) {
      assert.ok(cells.includes(expected), industry + " should show " + expected);
    }
  }
});

test("the FAQ schema says exactly what the visible FAQ says", () => {
  const html = pageHtml();
  const visible = Array.from(
    html.matchAll(/<button class="faq-q" aria-expanded="false">([\s\S]*?)<span[\s\S]*?<div class="faq-a-inner">([\s\S]*?)<\/div><\/div>/g),
    (m) => [plainText(m[1]), plainText(m[2])]);
  const faqPage = Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
    .map((m) => JSON.parse(m[1])).find((node) => node["@type"] === "FAQPage");
  const schema = faqPage.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);

  assert.ok(visible.length >= 14, "expected the full FAQ");
  assert.deepEqual(schema, visible);
});

test("the page carries the disclosure by the number and never promises a price", () => {
  const html = pageHtml();
  const result = html.match(/<div class="val-step val-result"[\s\S]*?<p class="val-disclaimer">/)[0];

  assert.match(result, /class="val-disclosure"/);
  assert.match(result, /not an appraisal/);
  assert.match(result, /It could be worth more, or less/);
  assert.doesNotMatch(html.toLowerCase(), /we guarantee|guaranteed (price|value|range)/);
});
