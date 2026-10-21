/**
 * What a buyer told us they buy, typed into the buyer list form.
 *
 * These answers become HelmIQ's `criteria` object (wire contract v3) and land in
 * the exact columns HelmIQ's "Match buyers" scores a deal against: sectors,
 * EBITDA, revenue, add-on size and geography, plus fund size and vintage for the
 * Buyer Universe list. Nothing here is read by AI; the buyer's own numbers are
 * the data.
 *
 * The lists are HelmIQ's canonical vocabulary, sent exactly as written. HelmIQ
 * drops any value it does not know, so a typo here would silently lose a
 * buyer's answer. Change them only together with HelmIQ's list.
 */

// HelmIQ's 14 top-level sectors. The form offers only these, not the 102
// sub-sectors, to keep it short; HelmIQ's matcher expands a sector to its parts.
export const SECTORS = Object.freeze([
  "Agriculture",
  "Business Services",
  "Consumer",
  "Education",
  "Energy & Utilities",
  "Financial Services",
  "Government & Defense",
  "Healthcare",
  "Hospitality & Leisure",
  "Industrial & Manufacturing",
  "Media & Telecommunications",
  "Real Estate & Construction",
  "Technology",
  "Transportation & Logistics",
]);

export const GEOGRAPHY = Object.freeze([
  "United States",
  "Northeast",
  "Southeast",
  "Midwest",
  "Southwest",
  "West",
  "Canada",
  "North America",
  "Global",
]);

// Buyers who raise a fund. Fund size and vintage are asked of these only; from
// anyone else they are hidden on the form and ignored here.
export const FUND_BUYER_TYPES = new Set(["private_equity", "family_office"]);

// Strategics rarely state an EBITDA band (HelmIQ's matcher weighs them on sector
// and geography only), so the band is required of every other buyer type.
const EBITDA_OPTIONAL_TYPES = new Set(["strategic"]);

const MAX_RANGE_M = 10000;
const MAX_FUND_M = 100000;
const FIRST_VINTAGE = 1980;

// Form field name -> the criteria key HelmIQ expects, for each range.
const RANGES = [
  { label: "EBITDA", min: "ebitdaMinM", max: "ebitdaMaxM" },
  { label: "revenue", min: "revenueMinM", max: "revenueMaxM" },
  { label: "add-on EBITDA", min: "addOnEbitdaMinM", max: "addOnEbitdaMaxM" },
];

/**
 * A money answer in $ millions. Accepts what people type ("5", "$5", "5M",
 * "1,200") and nothing else. Blank is `null`; anything unreadable is `NaN`.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseMillions(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^\$/, "").replace(/,/g, "").replace(/\s*(m|mm|million)$/i, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Keeps only the values on the list, once each, in the list's order. */
function pick(values, allowed) {
  const chosen = new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()));
  return allowed.filter((value) => chosen.has(value));
}

function checkRange(raw, range) {
  const min = parseMillions(raw[range.min]);
  const max = parseMillions(raw[range.max]);
  // A range's top must be above 0 (HelmIQ's rule); its bottom may be 0.
  for (const [key, amount, floor] of [[range.min, min, 0], [range.max, max, Number.MIN_VALUE]]) {
    if (amount !== null && !(amount >= floor && amount <= MAX_RANGE_M)) {
      return { error: { field: key, message: `Please enter the ${range.label} range in $ millions, for example 5.` } };
    }
  }
  if (min !== null && max !== null && max < min) {
    return { error: { field: range.max, message: `The top of the ${range.label} range is below the bottom.` } };
  }
  return { values: { ...(min !== null && { [range.min]: min }), ...(max !== null && { [range.max]: max }) } };
}

function checkFund(raw, year) {
  const size = parseMillions(raw.currentFundSizeM);
  if (size !== null && !(size > 0 && size <= MAX_FUND_M)) {
    return { error: { field: "currentFundSizeM", message: "Please enter the fund size in $ millions, for example 450." } };
  }
  const vintageText = typeof raw.currentFundVintage === "string" ? raw.currentFundVintage.trim() : "";
  // Four digits only: Number() alone would also read "2e3" or "0x7E0" as a year.
  const vintage = vintageText ? (/^\d{4}$/.test(vintageText) ? Number(vintageText) : Number.NaN) : null;
  if (vintage !== null && !(Number.isInteger(vintage) && vintage >= FIRST_VINTAGE && vintage <= year + 1)) {
    return { error: { field: "currentFundVintage", message: "Please enter the year the fund closed, for example 2023." } };
  }
  return {
    values: {
      ...(size !== null && { currentFundSizeM: size }),
      ...(vintage !== null && { currentFundVintage: vintage }),
    },
  };
}

/**
 * Checks the criteria answers and returns HelmIQ's `criteria` object, with every
 * blank answer left out (the contract forbids sending null or 0 for blank).
 * @param {{ sectors?: unknown[], geography?: unknown[], [key: string]: unknown }} raw
 * @param {string} buyerType a value already checked against BUYER_TYPES
 * @param {number} year the current year, for the vintage check
 * @returns {{ ok: true, criteria: Record<string, unknown> } | { ok: false, field: string, error: string }}
 */
export function validateCriteria(raw, buyerType, year) {
  const bad = (field, error) => ({ ok: false, field, error });

  const sectors = pick(Array.isArray(raw.sectors) ? raw.sectors : [], SECTORS);
  if (sectors.length === 0) return bad("sectors", "Please tick at least one sector you buy in.");

  let criteria = { sectors };
  for (const range of RANGES) {
    const checked = checkRange(raw, range);
    if (checked.error) return bad(checked.error.field, checked.error.message);
    criteria = { ...criteria, ...checked.values };
  }
  const hasEbitda = "ebitdaMinM" in criteria || "ebitdaMaxM" in criteria;
  if (!hasEbitda && !EBITDA_OPTIONAL_TYPES.has(buyerType)) {
    return bad("ebitdaMinM", "Please enter the EBITDA range you buy, in $ millions.");
  }

  const geography = pick(Array.isArray(raw.geography) ? raw.geography : [], GEOGRAPHY);
  if (geography.length > 0) criteria = { ...criteria, geography };

  if (FUND_BUYER_TYPES.has(buyerType)) {
    const fund = checkFund(raw, year);
    if (fund.error) return bad(fund.error.field, fund.error.message);
    criteria = { ...criteria, ...fund.values };
  }

  return { ok: true, criteria };
}

function money(amount) {
  return amount >= 1000 ? `$${amount / 1000}B` : `$${amount}M`;
}

function rangeText(min, max) {
  if (min !== undefined && max !== undefined) return `${money(min)} to ${money(max)}`;
  if (min !== undefined) return `${money(min)} and up`;
  if (max !== undefined) return `up to ${money(max)}`;
  return "";
}

/**
 * The criteria as plain lines for the fallback email, so a banker reading it
 * gets the same answers HelmIQ would have stored.
 * @param {Record<string, any>} criteria
 * @returns {string}
 */
export function describeCriteria(criteria) {
  const fund = [
    criteria.currentFundSizeM !== undefined ? money(criteria.currentFundSizeM) : "",
    criteria.currentFundVintage !== undefined ? String(criteria.currentFundVintage) : "",
  ].filter(Boolean).join(", ");
  const lines = [
    ["Sectors", (criteria.sectors || []).join(", ")],
    ["EBITDA", rangeText(criteria.ebitdaMinM, criteria.ebitdaMaxM)],
    ["Revenue", rangeText(criteria.revenueMinM, criteria.revenueMaxM)],
    ["Add-on EBITDA", rangeText(criteria.addOnEbitdaMinM, criteria.addOnEbitdaMaxM)],
    ["Regions", (criteria.geography || []).join(", ")],
    ["Current fund", fund],
  ];
  return lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n");
}
