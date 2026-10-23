// Shared by the valuation tool's Node tests, so the estimate tests and the
// result-screen tests build their cases the same way.
//
// valuation-explain.js is the last of the three pricing scripts the page loads.
// Loaded by Node it requires the other two and hands back one API, which is
// what the page reads from window.SCValuationEstimate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const V = require("../valuation-explain.js");

// The answers that carry no adjustment, or almost none, so a case can vary
// one thing at a time.
export const NEUTRAL = Object.freeze({
  owner: "teamOpsOwnerRelationships",
  growth: "unevenGrowth",
  concentration: "ten_25",
  revenueType: "mixedRevenue",
});

/**
 * A full set of answers: the neutral ones, overridden by the case's own.
 * @param {Object} overrides the fields this case cares about
 * @returns {Readonly<Object>} a new inputs object for computeEstimate
 */
export function inputs(overrides) {
  return Object.freeze({ subsector: "", profitBasis: "", ...NEUTRAL, ...overrides });
}

/**
 * valuation.html, read fresh for each test that needs it.
 * @returns {string}
 */
export function pageHtml() {
  return readFileSync(new URL("../valuation.html", import.meta.url), "utf8");
}

/**
 * The option values a select on the real page ships, read from the markup so
 * the tables are checked against the form and not against a copy of it.
 * @param {string} id the select's id
 * @returns {string[]} its non-empty option values
 */
export function shippedOptions(id) {
  const select = pageHtml().match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'));
  assert.ok(select, "valuation.html has no #" + id + " select");
  return Array.from(select[0].matchAll(/<option value="([^"]*)"/g), (m) => m[1]).filter(Boolean);
}

/**
 * True when two numbers agree to well inside a hundredth of a multiple.
 * @param {number} actual
 * @param {number} expected
 * @returns {boolean}
 */
export function near(actual, expected) {
  return Math.abs(actual - expected) < 1e-9;
}

/**
 * Jason's real lead: a dog walker with $112,000 of revenue and $60,000 of
 * profit, his own pay still in it. He picked Home Services because pet care was
 * not offered, so both picks are checked.
 * @param {Object} pick {industry, subsector}
 * @returns {Readonly<Object>} inputs for computeEstimate
 */
export function jasonInputs(pick) {
  return inputs({
    ...pick, revenue: 112000, profit: 60000, profitBasis: "includesOwnerPay",
    owner: "teamOpsOwnerRelationships", growth: "strong10to25",
    concentration: "five_ten", revenueType: "repeatNoContract",
  });
}
