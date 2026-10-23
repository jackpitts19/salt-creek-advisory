// The pricing tables the valuation tool ships, written out as literals so a
// change to any multiple, margin or adjustment in valuation-tables.js has to be
// made in two places on purpose. test_valuation_estimate.mjs compares these
// against what the module exports.
//
// October 2026: repriced against the verified sources pass (the firm's own
// *-valuation-multiples-2026 guides plus public sources), with pet care and the
// small-business SDE tables added. Every change from the version before is
// named in the allow-list in test_valuation_estimate.mjs, which also diffs the
// tables against valuation_pricing_build1.mjs, so nothing moves by accident.
//
// Only the numbers live here. Labels, names and reasons are copy, and the
// other tests already check that every option has them.

export const GOLDEN_MULT = Object.freeze({
  ece: [3.5, 6.0],
  services: [4.5, 7.0],
  homeservices: [4.5, 7.5],
  facilities: [4.0, 6.5],
  manufacturing: [4.5, 6.5],
  distribution: [4.5, 6.5],
  construction: [3.5, 5.5],
  healthcare: [5.0, 7.5],
  insurance: [7.0, 11.0],
  itservices: [5.0, 8.0],
  software: [6.0, 10.0],
  professional: [4.0, 6.5],
  agency: [4.0, 6.0],
  transport: [3.5, 5.5],
  auto: [4.5, 7.0],
  consumer: [3.0, 4.5],
  restaurants: [2.5, 4.0],
  ecommerce: [3.0, 5.0],
  other: [3.5, 5.5],
  petcare: [3.5, 5.5],
});

export const GOLDEN_MARGIN = Object.freeze({
  ece: 0.15,
  services: 0.15,
  homeservices: 0.12,
  facilities: 0.12,
  manufacturing: 0.12,
  distribution: 0.07,
  construction: 0.1,
  healthcare: 0.15,
  insurance: 0.25,
  itservices: 0.15,
  software: 0.25,
  professional: 0.2,
  agency: 0.15,
  transport: 0.08,
  auto: 0.2,
  consumer: 0.1,
  restaurants: 0.12,
  ecommerce: 0.1,
  other: 0.12,
  petcare: 0.15,
});

export const GOLDEN_SUBSECTORS = Object.freeze({
  ece: [
    { id: "independent", mult: [3.0, 5.0], margin: 0.13 },
    { id: "multisite", mult: [4.0, 6.5], margin: 0.15 },
    { id: "franchise", mult: [3.5, 5.5], margin: 0.14 },
    { id: "specialty", mult: [4.0, 6.5], margin: 0.17 },
  ],
  services: [
    { id: "staffing", mult: [3.5, 6.0], margin: 0.1 },
    { id: "outsourced", mult: [5.5, 8.5], margin: 0.18 },
    { id: "inspection", mult: [5.5, 8.0], margin: 0.18 },
    { id: "security", mult: [4.0, 6.0], margin: 0.1 },
  ],
  homeservices: [
    { id: "hvac", mult: [5.0, 8.0], margin: 0.13 },
    { id: "plumbing", mult: [4.0, 7.0], margin: 0.12 },
    { id: "electrical", mult: [4.5, 7.5], margin: 0.12 },
    { id: "multitrade", mult: [5.0, 8.5], margin: 0.13 },
    { id: "pest", mult: [5.5, 9.0], margin: 0.2 },
  ],
  facilities: [
    { id: "landscapemaint", mult: [4.0, 6.5], margin: 0.13 },
    { id: "landscapedb", mult: [3.5, 5.5], margin: 0.1 },
    { id: "janitorial", mult: [3.5, 6.0], margin: 0.1 },
    { id: "exterior", mult: [3.5, 5.5], margin: 0.12 },
  ],
  manufacturing: [
    { id: "machining", mult: [4.5, 7.0], margin: 0.14 },
    { id: "contract", mult: [4.0, 6.0], margin: 0.1 },
    { id: "foodbev", mult: [5.0, 7.5], margin: 0.12 },
    { id: "buildingproducts", mult: [4.5, 6.5], margin: 0.12 },
    { id: "plastics", mult: [4.0, 6.0], margin: 0.13 },
  ],
  distribution: [
    { id: "wholesale", mult: [4.5, 6.5], margin: 0.07 },
    { id: "foodbevdist", mult: [4.0, 6.0], margin: 0.06 },
    { id: "industrial", mult: [5.0, 7.0], margin: 0.09 },
    { id: "logistics", mult: [5.0, 7.5], margin: 0.1 },
  ],
  construction: [
    { id: "general", mult: [3.0, 5.0], margin: 0.08 },
    { id: "specialty", mult: [4.0, 6.0], margin: 0.1 },
    { id: "roofing", mult: [3.5, 6.0], margin: 0.12 },
    { id: "civil", mult: [4.0, 6.0], margin: 0.09 },
  ],
  healthcare: [
    { id: "dental", mult: [5.5, 8.5], margin: 0.2 },
    { id: "homehealth", mult: [4.5, 7.0], margin: 0.13 },
    { id: "behavioral", mult: [4.5, 7.5], margin: 0.15 },
    { id: "pt", mult: [5.0, 7.5], margin: 0.15 },
    { id: "medpractice", mult: [5.0, 7.5], margin: 0.18 },
    { id: "veterinary", mult: [5.5, 9.0], margin: 0.2 },
  ],
  insurance: [
    { id: "personal", mult: [6.0, 8.5], margin: 0.22 },
    { id: "commercial", mult: [7.5, 11.5], margin: 0.28 },
    { id: "benefits", mult: [7.5, 10.5], margin: 0.28 },
    { id: "mga", mult: [8.0, 11.0], margin: 0.25 },
  ],
  itservices: [
    { id: "msp", mult: [5.0, 8.0], margin: 0.17 },
    { id: "cyber", mult: [6.5, 9.5], margin: 0.18 },
    { id: "itstaffing", mult: [5.0, 8.0], margin: 0.1 },
    { id: "cloud", mult: [5.5, 8.5], margin: 0.16 },
  ],
  software: [
    { id: "verticalsaas", mult: [7.0, 11.0], margin: 0.28 },
    { id: "onprem", mult: [4.5, 7.0], margin: 0.22 },
    { id: "fintech", mult: [6.5, 10.5], margin: 0.25 },
    { id: "devtools", mult: [6.5, 10.5], margin: 0.22 },
  ],
  professional: [
    { id: "accounting", mult: [4.5, 7.5], margin: 0.25 },
    { id: "engineering", mult: [5.0, 7.5], margin: 0.18 },
    { id: "consulting", mult: [4.0, 6.5], margin: 0.2 },
    { id: "architecture", mult: [3.5, 5.5], margin: 0.15 },
  ],
  agency: [
    { id: "digital", mult: [4.0, 6.5], margin: 0.15 },
    { id: "creative", mult: [3.5, 5.5], margin: 0.14 },
    { id: "pr", mult: [3.5, 5.5], margin: 0.14 },
    { id: "mediabuying", mult: [4.0, 6.0], margin: 0.1 },
  ],
  transport: [
    { id: "truckload", mult: [3.0, 5.0], margin: 0.07 },
    { id: "ltl", mult: [4.0, 6.0], margin: 0.08 },
    { id: "specialized", mult: [3.5, 5.5], margin: 0.09 },
    { id: "brokerage", mult: [4.0, 6.5], margin: 0.06 },
  ],
  auto: [
    { id: "carwash", mult: [6.0, 9.0], margin: 0.3 },
    { id: "repair", mult: [4.0, 6.0], margin: 0.16 },
    { id: "quicklube", mult: [4.5, 6.5], margin: 0.18 },
    { id: "glass", mult: [4.0, 6.0], margin: 0.15 },
  ],
  consumer: [
    { id: "specialtyretail", mult: [3.0, 4.5], margin: 0.08 },
    { id: "cpg", mult: [4.0, 6.5], margin: 0.12 },
    { id: "franchiseretail", mult: [3.0, 4.5], margin: 0.1 },
    { id: "beauty", mult: [3.5, 5.0], margin: 0.15 },
  ],
  restaurants: [
    { id: "qsr", mult: [4.0, 6.0], margin: 0.1 },
    { id: "fullservice", mult: [2.5, 3.5], margin: 0.1 },
    { id: "catering", mult: [2.5, 4.5], margin: 0.1 },
    { id: "independent", mult: [2.5, 3.5], margin: 0.1 },
  ],
  ecommerce: [
    { id: "marketplace", mult: [3.0, 5.0], margin: 0.15 },
    { id: "dtc", mult: [3.5, 5.5], margin: 0.12 },
    { id: "subscription", mult: [4.5, 7.0], margin: 0.15 },
    { id: "b2b", mult: [3.5, 5.5], margin: 0.1 },
  ],
  petcare: [
    { id: "daycare", mult: [3.5, 5.5], margin: 0.18 },
    { id: "grooming", mult: [3.0, 4.5], margin: 0.15 },
    { id: "walking", mult: [2.5, 4.0], margin: 0.12 },
    { id: "retail", mult: [3.0, 4.5], margin: 0.08 },
  ],
});

// Small-business (SDE) starting ranges, by industry. "_all" is the fallback
// for an industry with no row of its own.
export const GOLDEN_SDE_MULT = Object.freeze({
  _all: [2.0, 3.1],
  homeservices: [2.0, 3.3],
  ece: [2.4, 3.8],
  petcare: [1.9, 3.1],
  facilities: [2.0, 3.1],
  manufacturing: [2.3, 3.6],
  distribution: [2.2, 3.5],
  healthcare: [1.8, 3.3],
  itservices: [2.3, 3.8],
  software: [2.5, 3.9],
  professional: [1.8, 3.1],
  transport: [2.0, 3.3],
  auto: [2.2, 3.5],
  consumer: [1.8, 2.9],
  restaurants: [1.6, 2.7],
  ecommerce: [2.6, 4.1],
});

// Subsectors whose SDE range differs from their industry's.
export const GOLDEN_SDE_SUBSECTORS = Object.freeze({
  healthcare: { dental: [2.5, 4.0] },
  auto: { carwash: [3.0, 5.0] },
  petcare: { daycare: [2.4, 3.8], grooming: [1.7, 2.7], retail: [2.0, 3.2], walking: [1.9, 3.1] },
});

export const GOLDEN_ADJUSTMENTS = Object.freeze({
  owner: {
    fullTeamAbsentee: 0.5,
    gmInPlace: 0.28,
    teamOpsOwnerRelationships: 0.05,
    teamOpsOwnerSales: -0.18,
    dailyHandsOn: -0.4,
    irreplaceableDelivery: -0.62,
    allMe: -0.8,
  },
  growth: {
    explosive25plus: 0.55,
    strong10to25: 0.35,
    steady3to10: 0.18,
    unevenGrowth: 0.0,
    roughlyFlat: -0.2,
    recentDip: -0.42,
    multiYearDecline: -0.8,
  },
  concentration: {
    under5: 0.3,
    five_ten: 0.15,
    ten_25: 0.0,
    twentyfive_40: -0.3,
    forty_60: -0.55,
    sixty_80: -0.8,
    over80: -1.0,
  },
  revenueType: {
    lockedInContracts: 0.55,
    autoRenewing: 0.35,
    repeatNoContract: 0.17,
    mixedRevenue: 0.0,
    oneTimeProject: -0.2,
    cyclicalLumpy: -0.4,
  },
});
