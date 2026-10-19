// Tests the valuation tool's industry preselection.
//
//     node tools/test_valuation_prefill.mjs
//
// Sector pages and guides link to the tool as `valuation?industry=<option value>`
// so an owner reading about MSPs does not have to find "IT Services / MSP" in a
// list of nineteen. That link is typed by hand on many pages, and the value in
// it comes straight from the address bar, so the matching is the one part of
// valuation.js that has to be right without a browser to check it in.
//
// valuation.js is a browser script. Loaded by Node it exports its pure helpers
// and stops before touching the page, which is what lets this file require it.
//
// Node's own test runner, no dependencies, matching the tools alongside.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { industryFromQuery } = require("../valuation.js");

const OPTIONS = ["", "ece", "services", "itservices", "other"];

/**
 * The option values the real page ships, read from the markup so the link
 * contract is checked against the select and not against a copy of it.
 * @returns {string[]} every value of #vIndustry, the empty placeholder included
 */
function shippedOptionValues() {
  const html = readFileSync(new URL("../valuation.html", import.meta.url), "utf8");
  const select = html.match(/<select id="vIndustry"[\s\S]*?<\/select>/);
  assert.ok(select, "valuation.html has no #vIndustry select");
  return Array.from(select[0].matchAll(/<option value="([^"]*)"/g), (m) => m[1]);
}

test("returns the option a link asked for", () => {
  assert.equal(industryFromQuery("?industry=itservices", OPTIONS), "itservices");
});

test("finds the parameter among others, such as utm tags", () => {
  const search = "?utm_source=newsletter&industry=ece&utm_medium=email";

  assert.equal(industryFromQuery(search, OPTIONS), "ece");
});

test("returns nothing for a value that is not an option", () => {
  assert.equal(industryFromQuery("?industry=aerospace", OPTIONS), "");
});

test("returns nothing when the parameter is missing or empty", () => {
  assert.equal(industryFromQuery("", OPTIONS), "");
  assert.equal(industryFromQuery("?", OPTIONS), "");
  assert.equal(industryFromQuery("?state=Illinois", OPTIONS), "");
  assert.equal(industryFromQuery("?industry=", OPTIONS), "");
  assert.equal(industryFromQuery("?industry=%20%20", OPTIONS), "");
});

test("never matches the empty placeholder option", () => {
  // "" is a real <option value> in the select. Matching it would be harmless,
  // but returning it as a hit would fire a change event for nothing.
  assert.equal(industryFromQuery("?industry", [""]), "");
});

test("forgives odd casing and stray spaces in a hand-typed link", () => {
  assert.equal(industryFromQuery("?industry=ITServices", OPTIONS), "itservices");
  assert.equal(industryFromQuery("?industry=%20ECE%20", OPTIONS), "ece");
  assert.equal(industryFromQuery("?industry=+services", OPTIONS), "services");
});

test("returns the option's own value, never the visitor's text", () => {
  const picked = industryFromQuery("?industry=ECE", OPTIONS);

  assert.equal(picked, OPTIONS[1]);
});

test("returns nothing for a value containing markup", () => {
  const attacks = [
    "?industry=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "?industry=%3Cb%3Eece%3C%2Fb%3E",
    "?industry=ece%22%20onfocus%3D%22alert(1)",
    "?industry=ece%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E",
  ];

  for (const search of attacks) {
    assert.equal(industryFromQuery(search, OPTIONS), "", search);
  }
});

test("returns nothing for object property names that are not options", () => {
  assert.equal(industryFromQuery("?industry=constructor", OPTIONS), "");
  assert.equal(industryFromQuery("?industry=__proto__", OPTIONS), "");
});

test("survives a malformed percent escape", () => {
  assert.equal(industryFromQuery("?industry=%E0%A4%A", OPTIONS), "");
});

test("returns nothing when handed something other than strings", () => {
  assert.equal(industryFromQuery(undefined, OPTIONS), "");
  assert.equal(industryFromQuery("?industry=ece", undefined), "");
});

test("every industry the page ships can be linked to", () => {
  const shipped = shippedOptionValues().filter(Boolean);

  assert.ok(shipped.length >= 10, "expected the full industry list");
  for (const value of shipped) {
    assert.equal(industryFromQuery("?industry=" + value, shippedOptionValues()), value);
  }
});
