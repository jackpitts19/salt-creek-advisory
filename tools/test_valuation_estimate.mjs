// Tests the valuation tool's pricing math, its tables and the lead's figures.
//
//     node tools/test_valuation_estimate.mjs
//
// The estimate is the number an owner takes away from the site, so the cases
// below pin what the tool produces. A change to any table or rule that moves
// one of these numbers should be a decision, and this file is where it shows.
//
// October 2026 (Build 2): every pinned number here was re-derived when three
// things changed together, and each moved for one of these reasons:
//   1. Size no longer steps. It slides between the old steps' midpoints, so a
//      business $1 over a line no longer jumps half a turn (sizeAdj below).
//   2. Small businesses are priced on owner earnings (SDE) below $300,000 of
//      SDE, and on a blend of SDE and EBITDA up to $750,000. The HVAC, "other",
//      CPA and $290,000 restaurant cases now land in that blend.
//   3. Some starting ranges were repriced against the verified sources pass:
//      the MSP, insurance and restaurant cases use the new ranges. The full
//      list of changed table entries is the allow-list near the bottom.
// The expected values were worked out with an independent reference
// calculation, not read back from the code under test.
//
// test_valuation_explain.mjs covers the result screen built from these.
// Node's own test runner, no dependencies, matching the tools alongside.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  GOLDEN_ADJUSTMENTS,
  GOLDEN_MARGIN,
  GOLDEN_MULT,
  GOLDEN_SDE_MULT,
  GOLDEN_SDE_SUBSECTORS,
  GOLDEN_SUBSECTORS,
} from "./valuation_pricing_golden.mjs";
import {
  BUILD1_ADJUSTMENTS,
  BUILD1_MARGIN,
  BUILD1_MULT,
  BUILD1_NAMES,
  BUILD1_SALARY_PROBES,
  BUILD1_SIZE_PROBES,
  BUILD1_SUBSECTORS,
} from "./valuation_pricing_build1.mjs";
import { V, inputs, jasonInputs, near, shippedOptions } from "./valuation_test_helpers.mjs";

/**
 * The MSP case: plain EBITDA well above the blend window, every answer moving
 * the number, and two different rounding steps at the two ends.
 * @returns {Object} its estimate
 */
function mspEstimate() {
  return V.computeEstimate(inputs({
    industry: "itservices", subsector: "msp", revenue: 8e6, profit: 1.2e6,
    profitBasis: "excludesOwnerPay", owner: "gmInPlace", growth: "steady3to10",
    concentration: "forty_60", revenueType: "autoRenewing",
  }));
}

/**
 * The HVAC case: $450,000 with the owner's pay in it, which now sits a third
 * of the way through the blend window.
 * @returns {Object} its estimate
 */
function hvacEstimate() {
  return V.computeEstimate(inputs({
    industry: "homeservices", subsector: "hvac", revenue: 2.5e6, profit: 450000,
    profitBasis: "includesOwnerPay", owner: "dailyHandsOn", growth: "strong10to25",
    concentration: "under5", revenueType: "repeatNoContract",
  }));
}

// ---------------------------------------------------------------------------
// The EBITDA path: owner earnings of $750,000 or more
// ---------------------------------------------------------------------------

test("prices a plain EBITDA figure with a subsector range", () => {
  const est = mspEstimate();

  assert.equal(est.method, "ebitda");
  assert.equal(est.prof, 1.2e6);
  assert.equal(est.sde, 1.35e6);
  assert.equal(est.ownerPayRemoved, 0);
  assert.equal(est.sdeLeg, null);
  assert.deepEqual([...est.ebitdaLeg.multRange], [5.0, 8.0]);
  assert.ok(near(est.ebitdaLeg.lowX, 5.41));
  assert.ok(near(est.ebitdaLeg.highX, 8.41));
  assert.equal(est.low, 6.5e6);
  assert.equal(est.high, 10e6);
  assert.equal(est.midpoint, 8.25e6);
  assert.equal(est.showRange, true);
});

test("estimates profit from margins when it is left blank above $1 million of revenue", () => {
  const est = V.computeEstimate(inputs({
    industry: "ece", subsector: "multisite", revenue: 4e6, profit: 0,
    profitBasis: "includesOwnerPay",
  }));

  assert.equal(est.estimated, true);
  assert.equal(est.method, "ebitda");
  assert.equal(est.sde, null);
  assert.equal(est.prof, 600000);
  assert.equal(est.ownerPayRemoved, 0);
  assert.equal(est.low, 2.3e6);
  assert.equal(est.high, 3.8e6);
  assert.equal(est.midpoint, 3.05e6);
});

test("raises only the low end to its minimum when only it falls below", () => {
  const est = V.computeEstimate(inputs({
    industry: "restaurants", subsector: "independent", revenue: 5e6, profit: 800000,
    profitBasis: "excludesOwnerPay", owner: "dailyHandsOn", growth: "roughlyFlat",
  }));

  assert.equal(est.method, "ebitda");
  assert.equal(est.ebitdaLeg.lowClamped, true);
  assert.equal(est.ebitdaLeg.highClamped, false);
  assert.equal(est.ebitdaLeg.lowX, 2.0);
  assert.equal(est.low, 1.6e6);
  assert.equal(est.high, 2.3e6);
});

test("raises both ends to their minimums when every answer is negative", () => {
  const est = V.computeEstimate(inputs({
    industry: "restaurants", subsector: "fullservice", revenue: 5e6, profit: 900000,
    profitBasis: "excludesOwnerPay", owner: "allMe", growth: "multiYearDecline",
    concentration: "over80", revenueType: "cyclicalLumpy",
  }));

  assert.equal(est.ebitdaLeg.lowClamped, true);
  assert.equal(est.ebitdaLeg.highClamped, true);
  assert.equal(est.ebitdaLeg.lowX, 2.0);
  assert.equal(est.ebitdaLeg.highX, 2.5);
  assert.equal(est.low, 1.8e6);
  assert.equal(est.high, 2.3e6);
});

test("flags a very large business by profit, and still computes the range", () => {
  const est = V.computeEstimate(inputs({
    industry: "software", subsector: "verticalsaas", revenue: 5e7, profit: 13e6,
    profitBasis: "excludesOwnerPay",
  }));

  assert.equal(est.bigDeal, true);
  assert.equal(est.showRange, false);
  assert.equal(est.low, 111e6);
  assert.equal(est.high, 163e6);
});

test("flags a very large business by revenue alone", () => {
  const est = V.computeEstimate(inputs({
    industry: "distribution", subsector: "wholesale", revenue: 12e7, profit: 6e6,
    profitBasis: "excludesOwnerPay",
  }));

  assert.equal(est.bigDeal, true);
  assert.equal(est.low, 35e6);
  assert.equal(est.high, 47e6);
});

test("uses the industry range for an industry with no subsectors", () => {
  const est = V.computeEstimate(inputs({
    industry: "other", revenue: 3e6, profit: 1e6, profitBasis: "excludesOwnerPay",
  }));

  assert.equal(est.subsectorMatched, false);
  assert.equal(est.subName, "comparable");
  assert.deepEqual([...est.ebitdaLeg.multRange], [3.5, 5.5]);
});

test("falls back to the industry range for an unlisted niche", () => {
  const est = V.computeEstimate(inputs({
    industry: "manufacturing", subsector: "_other", revenue: 10e6, profit: 1.5e6,
    profitBasis: "excludesOwnerPay", owner: "fullTeamAbsentee", growth: "explosive25plus",
    concentration: "five_ten", revenueType: "lockedInContracts",
  }));

  assert.equal(est.subsectorMatched, false);
  assert.equal(est.subName, "manufacturing");
  assert.equal(est.low, 9.8e6);
  assert.equal(est.high, 13e6);
  assert.equal(est.midpoint, 11.4e6);
});

test("rounds large figures to the nearest $500,000", () => {
  const est = V.computeEstimate(inputs({
    industry: "insurance", subsector: "commercial", revenue: 3e7, profit: 5e6,
    profitBasis: "excludesOwnerPay", owner: "fullTeamAbsentee", growth: "strong10to25",
    concentration: "under5", revenueType: "autoRenewing",
  }));

  assert.ok(near(est.ebitdaLeg.lowX, 10.07));
  assert.ok(near(est.ebitdaLeg.highX, 14.07));
  assert.equal(est.low, 50.5e6);
  assert.equal(est.high, 70.5e6);
});

// ---------------------------------------------------------------------------
// The small-business path: SDE below $300,000, a blend up to $750,000
// ---------------------------------------------------------------------------

test("Jason as Home Services gets a positive range on owner earnings", () => {
  const est = V.computeEstimate(jasonInputs({ industry: "homeservices", subsector: "_other" }));

  assert.equal(est.method, "sde");
  assert.equal(est.sde, 60000);
  assert.equal(est.sdeSource, "reported");
  assert.deepEqual([...est.sdeLeg.multRange], [2.0, 3.3]);
  assert.ok(near(est.sdeLeg.lowX, 1.93));
  assert.ok(near(est.sdeLeg.highX, 3.23));
  assert.equal(est.low, 125000);
  assert.equal(est.high, 200000);
  assert.equal(est.midpoint, 162500);
  assert.equal(est.showRange, true);
  assert.equal(est.belowManagerPay, false);
});

test("Jason as a dog walker is priced on the pet-care walking SDE range", () => {
  const est = V.computeEstimate(jasonInputs({ industry: "petcare", subsector: "walking" }));

  assert.equal(est.method, "sde");
  assert.deepEqual([...est.sdeLeg.multRange], [1.9, 3.1]);
  assert.ok(near(est.sdeLeg.lowX, 1.83));
  assert.ok(near(est.sdeLeg.highX, 3.03));
  assert.equal(est.low, 100000);
  assert.equal(est.high, 175000);
});

test("counts each answer at 40% on the SDE path, in hundredths", () => {
  const est = V.computeEstimate(jasonInputs({ industry: "homeservices", subsector: "_other" }));

  assert.deepEqual(est.sdeLeg.adjustments.map((a) => [a.key, a.adj]), [
    ["size", -0.36], ["owner", 0.02], ["growth", 0.14], ["concentration", 0.06], ["revenueType", 0.07],
  ]);
});

test("adds back a typical owner's pay when it was already taken out", () => {
  const est = V.computeEstimate(inputs({
    industry: "other", revenue: 400000, profit: 50000, profitBasis: "excludesOwnerPay",
  }));

  assert.equal(est.sdeSource, "addedBack");
  assert.equal(est.ownerPayAddedBack, 65000);
  assert.equal(est.sde, 115000);
  assert.equal(est.method, "sde");
});

test("estimates owner earnings for a small business with profit left blank", () => {
  const est = V.computeEstimate(inputs({ industry: "homeservices", subsector: "_other", revenue: 500000, profit: 0 }));

  assert.equal(est.sdeSource, "estimated");
  assert.equal(est.sde, 125000);
  assert.equal(est.sdeCapped, false);
  assert.equal(est.low, 250000);
  assert.equal(est.high, 400000);
});

test("caps estimated owner earnings at 35% of revenue", () => {
  const est = V.computeEstimate(inputs({ industry: "homeservices", subsector: "_other", revenue: 150000, profit: 0 }));

  assert.equal(est.sde, 52500);
  assert.equal(est.sdeCapped, true);
  assert.equal(est.low, 75000);
  assert.equal(est.high, 150000);
});

test("holds the SDE path at 1.0x and 1.5x when every answer is negative", () => {
  const est = V.computeEstimate(inputs({
    industry: "restaurants", subsector: "_other", revenue: 200000, profit: 50000,
    profitBasis: "includesOwnerPay", owner: "allMe", growth: "multiYearDecline",
    concentration: "over80", revenueType: "cyclicalLumpy",
  }));

  assert.equal(est.sdeLeg.lowClamped, true);
  assert.equal(est.sdeLeg.highClamped, true);
  assert.equal(est.low, 50000);
  assert.equal(est.high, 75000);
});

test("uses the dental, car wash and pet daycare SDE overrides", () => {
  const dental = V.computeEstimate(inputs({ industry: "healthcare", subsector: "dental", revenue: 900000, profit: 250000, profitBasis: "includesOwnerPay" }));
  const carwash = V.computeEstimate(inputs({ industry: "auto", subsector: "carwash", revenue: 600000, profit: 200000, profitBasis: "includesOwnerPay" }));
  const grooming = V.computeEstimate(inputs({ industry: "petcare", subsector: "grooming", revenue: 300000, profit: 90000, profitBasis: "includesOwnerPay" }));
  const insurance = V.computeEstimate(inputs({ industry: "insurance", subsector: "personal", revenue: 300000, profit: 90000, profitBasis: "includesOwnerPay" }));

  assert.deepEqual([...dental.sdeLeg.multRange], [2.5, 4.0]);
  assert.equal(dental.low, 625000);
  assert.equal(dental.high, 1e6);
  assert.deepEqual([...carwash.sdeLeg.multRange], [3.0, 5.0]);
  assert.equal(carwash.low, 600000);
  assert.deepEqual([...grooming.sdeLeg.multRange], [1.7, 2.7]);
  assert.deepEqual([...insurance.sdeLeg.multRange], [2.0, 3.1], "insurance falls back to all industries");
});

test("blends the two methods by where owner earnings sit in the window", () => {
  const est = hvacEstimate();

  assert.equal(est.method, "blend");
  assert.equal(est.sde, 450000);
  assert.equal(est.prof, 365000);
  assert.equal(est.ownerPayRemoved, 85000);
  assert.ok(near(est.ebitdaWeight, 1 / 3));
  assert.ok(near(est.sdeLeg.lowX, 2.17));
  assert.ok(near(est.ebitdaLeg.lowX, 4.9));
  assert.ok(near(est.exactLow, (2 / 3) * 450000 * 2.17 + (1 / 3) * 365000 * 4.9));
  assert.equal(est.low, 1.2e6);
  assert.equal(est.high, 2e6);
  assert.equal(est.midpoint, 1.6e6);
});

test("keeps a half-step midpoint exact rather than rounding it again", () => {
  const est = V.computeEstimate(inputs({
    industry: "restaurants", subsector: "independent", revenue: 1.5e6, profit: 290000,
    profitBasis: "excludesOwnerPay", owner: "gmInPlace", growth: "steady3to10",
  }));

  assert.equal(est.method, "blend");
  assert.equal(est.low, 675000);
  assert.equal(est.high, 1.1e6);
  assert.equal(est.midpoint, 887500);
});

test("sizes the manager's salary from profit when revenue is blank", () => {
  const est = V.computeEstimate(inputs({
    industry: "professional", subsector: "accounting", revenue: 0, profit: 500000,
    profitBasis: "includesOwnerPay",
  }));

  assert.equal(est.ownerPayRemoved, 85000);
  assert.equal(est.prof, 415000);
  assert.equal(est.method, "blend");
  assert.equal(est.low, 1.3e6);
  assert.equal(est.high, 2.2e6);
});

test("the blend meets each method at the edges of its window", () => {
  const at = (profit) => V.computeEstimate(inputs({
    industry: "manufacturing", subsector: "machining", revenue: 3e6, profit, profitBasis: "includesOwnerPay",
  }));
  const close = (a, b) => Math.abs(a - b) / b < 0.002;

  assert.equal(at(299999).method, "sde");
  assert.equal(at(300000).method, "blend");
  assert.equal(at(749999).method, "blend");
  assert.equal(at(750000).method, "ebitda");
  assert.ok(close(at(299999).exactLow, at(300000).exactLow));
  assert.ok(close(at(749999).exactHigh, at(750000).exactHigh));
});

test("gives no range, and no negative figure, when owner earnings are not positive", () => {
  const est = V.computeEstimate(inputs({
    industry: "other", revenue: 100000, profit: -10000, profitBasis: "includesOwnerPay",
  }));

  assert.equal(est.method, "none");
  assert.equal(est.showRange, false);
  assert.equal(est.low, 0);
  assert.equal(est.high, 0);
});

// ---------------------------------------------------------------------------
// Size: smooth on both paths
// ---------------------------------------------------------------------------

test("size passes through the old steps' midpoints and is flat outside them", () => {
  const anchors = [[150000, -1], [375000, -0.5], [750000, 0], [1.5e6, 0.25], [3.5e6, 0.75], [7e6, 1.5]];

  for (const [profit, adj] of anchors) assert.equal(V.sizeAdj(profit), adj, String(profit));
  assert.equal(V.sizeAdj(-5e6), -1);
  assert.equal(V.sizeAdj(0), -1);
  assert.equal(V.sizeAdj(50e6), 1.5);
});

test("size has no cliffs and never falls as earnings grow", () => {
  let previous = V.sizeAdj(0);
  for (let profit = 1000; profit <= 8e6; profit += 1000) {
    const adj = V.sizeAdj(profit);
    assert.ok(adj >= previous, "falls at " + profit);
    assert.ok(adj - previous <= 0.01 + 1e-9, "jumps at " + profit);
    assert.ok(near(adj * 100, Math.round(adj * 100)), "not in hundredths at " + profit);
    previous = adj;
  }
});

test("the SDE size step is smooth too, and zero from $175,000", () => {
  let previous = V.sdeSizeAdj(0);
  for (let sde = 500; sde <= 400000; sde += 500) {
    const adj = V.sdeSizeAdj(sde);
    assert.ok(adj >= previous && adj - previous <= 0.01 + 1e-9, String(sde));
    previous = adj;
  }
  assert.equal(V.sdeSizeAdj(40000), -0.4);
  assert.equal(V.sdeSizeAdj(112500), -0.15);
  assert.equal(V.sdeSizeAdj(175000), 0);
});

test("prices each manager salary tier from its revenue edge, as Build 1 did", () => {
  for (const [revenue, salary] of BUILD1_SALARY_PROBES) {
    assert.equal(V.replacementSalary(revenue), salary, String(revenue));
  }
});

test("rounds to the same steps it always has", () => {
  const cases = [[24999, 25000], [12500, 25000], [999999, 1e6], [1250000, 1.3e6], [9999999, 10e6]];

  for (const [value, rounded] of cases) {
    assert.equal(V.roundSmart(value), rounded, String(value));
  }
});

// ---------------------------------------------------------------------------
// What the lead carries
// ---------------------------------------------------------------------------

/**
 * Every number anywhere in a value, so a test can check none is negative.
 * @param {*} value
 * @returns {number[]}
 */
function numbersIn(value) {
  if (typeof value === "number") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(numbersIn);
  return [];
}

for (const pick of [{ industry: "homeservices", subsector: "_other" }, { industry: "petcare", subsector: "walking" }]) {
  test("Jason's lead (" + pick.industry + ") shows the range and no negative number", () => {
    const fields = V.leadFigures(V.computeEstimate(jasonInputs(pick)));

    assert.equal(fields.profit, 60000);
    assert.equal(fields.sde, 60000);
    assert.equal(fields.profitAfterManagerPay, 0);
    assert.equal(fields.ownerPayRemoved, 0);
    assert.equal(fields.valuationMethod, "sde");
    assert.equal(fields.rangeShown, true);
    assert.ok(fields.estimateLow > 0 && fields.estimateHigh > fields.estimateLow);
    assert.deepEqual(numbersIn(fields).filter((n) => n < 0), []);
    assert.equal(V.leadSubjectPrefix(V.computeEstimate(jasonInputs(pick))), "Small business (SDE path): ");
  });
}

test("a lead with no range on screen carries no estimate", () => {
  const est = V.computeEstimate(inputs({
    industry: "software", subsector: "verticalsaas", revenue: 5e7, profit: 13e6, profitBasis: "excludesOwnerPay",
  }));

  const fields = V.leadFigures(est);

  assert.equal(fields.rangeShown, false);
  assert.equal(fields.valuationMethod, "none");
  assert.equal(fields.estimateLow, "");
  assert.equal(fields.estimateHigh, "");
  assert.equal(fields.oversized, true);
  assert.equal(V.leadSubjectPrefix(est), "");
});

test("a business too small to round to a real range gets the warm screen, not $0", () => {
  // Owner earnings of a few thousand dollars, times any SDE multiple, round to
  // $0 or to a range with no width at the $25,000 step.
  const cases = [
    { ...jasonInputs({ industry: "petcare", subsector: "walking" }), profit: 5000 },
    inputs({ industry: "homeservices", revenue: 50000, profit: 10000, profitBasis: "includesOwnerPay" }),
    inputs({ industry: "homeservices", revenue: 50000, profit: 8000, profitBasis: "includesOwnerPay" }),
    inputs({ industry: "restaurants", revenue: 20000 }),
    inputs({ industry: "restaurants", revenue: 15000, profit: 1000, profitBasis: "includesOwnerPay" }),
    // Rounds to "$25,000 – $25,000": a range with no width is no range.
    inputs({ industry: "restaurants", revenue: 50000, owner: "allMe", growth: "multiYearDecline",
      concentration: "over80", revenueType: "cyclicalLumpy" }),
  ];
  for (const given of cases) {
    const est = V.computeEstimate(given);
    const fields = V.leadFigures(est);

    assert.equal(est.method, "sde", JSON.stringify(given));
    assert.equal(est.showRange, false, JSON.stringify(given) + " shows " + est.low + " – " + est.high);
    assert.deepEqual([fields.rangeShown, fields.estimateLow, fields.estimateHigh, fields.valuationMethod],
      [false, "", "", "none"]);
    assert.equal(V.leadSubjectPrefix(est), "Small business (SDE path): ");
  }
});

test("a very large business is never labelled a small-business lead", () => {
  const est = V.computeEstimate(inputs({ industry: "consumer", revenue: 1.5e8, profit: 200000, profitBasis: "includesOwnerPay" }));

  assert.equal(est.method, "sde");
  assert.equal(est.bigDeal, true);
  assert.equal(V.leadSubjectPrefix(est), "");
});

test("an end exactly half a step from a round number rounds up, as the breakdown shows it", () => {
  // 3.85x carried float noise (3.8499999999999996), so $962,500 rounded down.
  const est = V.computeEstimate(inputs({
    industry: "homeservices", revenue: 0, profit: 250000, profitBasis: "includesOwnerPay",
    owner: "fullTeamAbsentee", growth: "explosive25plus", concentration: "five_ten", revenueType: "repeatNoContract",
  }));

  assert.deepEqual([est.sdeLeg.lowX, est.sdeLeg.highX], [2.55, 3.85]);
  assert.deepEqual([est.sdeLeg.exactLow, est.sdeLeg.exactHigh], [637500, 962500]);
  assert.deepEqual([est.low, est.high], [650000, 975000]);
});

test("a lead keeps the typed profit and names the method", () => {
  const blend = V.leadFigures(hvacEstimate());
  const ebitda = V.leadFigures(mspEstimate());

  assert.deepEqual([blend.profit, blend.profitAfterManagerPay, blend.sde, blend.valuationMethod],
    [450000, 365000, 450000, "blend"]);
  assert.equal(blend.ownerPayRemoved, 85000);
  assert.equal(V.leadSubjectPrefix(hvacEstimate()), "Small business (SDE path): ");
  assert.deepEqual([ebitda.profit, ebitda.valuationMethod, ebitda.estimateLow, ebitda.estimateHigh],
    [1.2e6, "ebitda", 6.5e6, 10e6]);
});

test("an estimated profit travels as the estimate, with no SDE when none was used", () => {
  const fields = V.leadFigures(V.computeEstimate(inputs({ industry: "ece", subsector: "multisite", revenue: 4e6, profit: 0 })));

  assert.equal(fields.profit, 600000);
  assert.equal(fields.profitEstimated, true);
  assert.equal(fields.sde, "");
});

// ---------------------------------------------------------------------------
// Inputs and outputs are never shared
// ---------------------------------------------------------------------------

test("returns a frozen result and leaves the inputs untouched", () => {
  const answers = inputs({ industry: "other", revenue: 3e6, profit: 400000, profitBasis: "excludesOwnerPay" });
  const before = JSON.stringify(answers);

  const est = V.computeEstimate(answers);

  assert.equal(JSON.stringify(answers), before);
  assert.ok(Object.isFrozen(est));
  assert.ok(Object.isFrozen(est.ebitdaLeg) && Object.isFrozen(est.sdeLeg));
  assert.ok(est.ebitdaLeg.adjustments.every(Object.isFrozen));
  assert.ok(Object.isFrozen(V.leadFigures(est)));
});

test("never reads the selling-timeline or real-estate answers", () => {
  const base = { industry: "other", revenue: 3e6, profit: 400000, profitBasis: "excludesOwnerPay" };

  const withExtras = V.computeEstimate(inputs({ ...base, sellingTimeline: "activelyExploring", ownsRealEstate: "yes" }));
  const without = V.computeEstimate(inputs(base));

  assert.deepEqual(withExtras, without);
  assert.ok(!("sellingTimeline" in withExtras) && !("ownsRealEstate" in withExtras));
});

test("refuses an industry or answer the tables do not know", () => {
  assert.throws(() => V.computeEstimate(inputs({ industry: "aerospace", revenue: 1e6 })), /industry/);
  assert.throws(() => V.computeEstimate(inputs({ industry: "other", revenue: 1e6, owner: "sometimes" })), /owner/);
  assert.throws(() => V.computeEstimate(inputs({ industry: "other", revenue: 1e6, owner: "constructor" })), /owner/);
  assert.throws(() => V.computeEstimate(inputs({ industry: "constructor", revenue: 1e6 })), /industry/);
});

// ---------------------------------------------------------------------------
// The tables: pinned, agreeing with the form, and changed only on purpose
// ---------------------------------------------------------------------------

test("every industry the form offers has a range, a margin, a name and an SDE range", () => {
  for (const industry of shippedOptions("vIndustry")) {
    assert.ok(V.MULT[industry], industry);
    assert.ok(V.MARGIN[industry], industry);
    assert.ok(V.NAMES[industry], industry);
    assert.equal(V.sdeRange(industry, "").length, 2, industry);
  }
});

test("every multiple, margin and adjustment matches the pinned pricing tables", () => {
  const numbersOnly = (lists) => Object.fromEntries(Object.entries(lists).map(
    ([industry, list]) => [industry, list.map(({ id, mult, margin }) => ({ id, mult: [...mult], margin }))]));
  const plain = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(V.MULT), plain(GOLDEN_MULT));
  assert.deepEqual(plain(V.MARGIN), plain(GOLDEN_MARGIN));
  assert.deepEqual(numbersOnly(V.SUBSECTORS), plain(GOLDEN_SUBSECTORS));
  assert.deepEqual(plain(V.ADJUSTMENTS), plain(GOLDEN_ADJUSTMENTS));
  assert.deepEqual(plain(V.SDE_MULT), plain(GOLDEN_SDE_MULT));
  assert.deepEqual(plain(V.SDE_SUBSECTORS), plain(GOLDEN_SDE_SUBSECTORS));
});

// Every table entry that changed from Build 1, each backed in the October 2026
// sources pass by at least two independent publishers, or one plus the firm's
// own guide. A path covers everything beneath it.
const CHANGED_FROM_BUILD1 = Object.freeze([
  "MULT.insurance", "MULT.petcare", "MARGIN.ece", "MARGIN.petcare", "NAMES.petcare", "SUBSECTORS.petcare",
  "SUBSECTORS.ece.independent.margin", "SUBSECTORS.ece.multisite.margin", "SUBSECTORS.ece.franchise.margin",
  "SUBSECTORS.ece.specialty.mult", "SUBSECTORS.ece.specialty.margin",
  "SUBSECTORS.services.staffing.mult", "SUBSECTORS.services.inspection.mult",
  "SUBSECTORS.homeservices.plumbing.mult",
  "SUBSECTORS.facilities.landscapemaint.mult", "SUBSECTORS.facilities.janitorial.mult",
  "SUBSECTORS.manufacturing.plastics.mult",
  "SUBSECTORS.construction.roofing.mult", "SUBSECTORS.construction.civil.mult",
  "SUBSECTORS.healthcare.homehealth.mult", "SUBSECTORS.healthcare.behavioral.mult", "SUBSECTORS.healthcare.veterinary.mult",
  "SUBSECTORS.insurance.commercial.mult",
  "SUBSECTORS.itservices.msp.mult", "SUBSECTORS.itservices.itstaffing.mult",
  "SUBSECTORS.professional.accounting.mult",
  "SUBSECTORS.consumer.specialtyretail.mult", "SUBSECTORS.consumer.beauty.mult",
  "SUBSECTORS.restaurants.qsr.margin", "SUBSECTORS.restaurants.fullservice.mult",
  "SUBSECTORS.restaurants.catering.mult", "SUBSECTORS.restaurants.independent.mult",
  "SUBSECTORS.ecommerce.b2b.mult",
]);

/**
 * Every leaf of a table as "PATH" -> JSON text, with subsector lists keyed by
 * their ids so a reordered or inserted niche does not shift the others.
 * @param {string} prefix the table's name
 * @param {Object} table
 * @returns {Map<string, string>}
 */
function leaves(prefix, table) {
  const out = new Map();
  for (const [key, value] of Object.entries(table)) {
    const path = prefix + "." + key;
    if (Array.isArray(value) && value.length && typeof value[0] === "object") {
      for (const item of value) {
        for (const [field, v] of Object.entries(item)) out.set(path + "." + item.id + "." + field, JSON.stringify(v));
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of leaves(path, value)) out.set(k, v);
    } else {
      out.set(path, JSON.stringify(value));
    }
  }
  return out;
}

test("nothing outside the allow-list moved from Build 1, and everything on it did", () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const before = new Map([...leaves("MULT", BUILD1_MULT), ...leaves("MARGIN", BUILD1_MARGIN), ...leaves("NAMES", BUILD1_NAMES),
    ...leaves("SUBSECTORS", BUILD1_SUBSECTORS), ...leaves("ADJUSTMENTS", BUILD1_ADJUSTMENTS)]);
  const after = new Map([...leaves("MULT", plain(V.MULT)), ...leaves("MARGIN", plain(V.MARGIN)), ...leaves("NAMES", plain(V.NAMES)),
    ...leaves("SUBSECTORS", plain(V.SUBSECTORS)), ...leaves("ADJUSTMENTS", plain(V.ADJUSTMENTS))]);
  const allowed = (path) => CHANGED_FROM_BUILD1.some((entry) => path === entry || path.startsWith(entry + "."));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));

  assert.deepEqual(changed.filter((path) => !allowed(path)), [], "changed without being on the allow-list");
  for (const entry of CHANGED_FROM_BUILD1) {
    assert.ok(changed.some((path) => path === entry || path.startsWith(entry + ".")), entry + " is listed but did not change");
  }
});

test("smoothing kept Build 1's six size values as its anchors", () => {
  const build1Values = [...new Set(BUILD1_SIZE_PROBES.map(([, adj]) => adj))].sort((a, b) => a - b);

  assert.deepEqual(V.SIZE_POINTS.map(([, adj]) => adj), build1Values);
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("formats multiples to two places, dropping one trailing zero", () => {
  assert.equal(V.formatMultiple(6.01), "6.01x");
  assert.equal(V.formatMultiple(6.5), "6.5x");
  assert.equal(V.formatMultiple(2), "2.0x");
  assert.equal(V.formatMultiple(10.5), "10.5x");
  assert.equal(V.formatMultiple(6.05), "6.05x");
  assert.equal(V.formatMultiple(4.919999999999999), "4.92x");
});

test("formats adjustments and money with a true minus sign", () => {
  assert.equal(V.formatAdjustment(0), "No change");
  assert.equal(V.formatAdjustment(0.35), "+0.35x");
  assert.equal(V.formatAdjustment(-0.5), "−0.5x");
  assert.equal(V.formatSignedMoney(-85000), "−$85,000");
});

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

test("every pet care buyer the result screen names is named on the firm's pet care page", () => {
  const page = readFileSync(new URL("../pet-care-ma-advisor.html", import.meta.url), "utf8");
  const { BUYERS } = createRequire(import.meta.url)("../valuation-tables.js");

  assert.equal(BUYERS.petcare.length, 3);
  for (const [name] of BUYERS.petcare) assert.ok(page.includes(name), name);
});
