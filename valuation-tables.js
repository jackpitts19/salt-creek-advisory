(function () {
  // The valuation tool's tables: every multiple, margin, salary and answer the
  // pricing in valuation-estimate.js reads, with the words the result screen
  // uses for each answer. Data only, frozen, so a number can change in one
  // place and the tests in tools/ can pin all of them.

  /**
   * Freezes an object and everything inside it, so a shared table cannot be
   * changed by whoever happens to be holding it.
   * @param {Object} value an object or array
   * @returns {Object} the same value, frozen all the way down
   */
  function deepFreeze(value) {
    Object.values(value).forEach((child) => {
      if (child && typeof child === 'object') deepFreeze(child);
    });
    return Object.freeze(value);
  }

  // Base EBITDA multiple ranges for a business priced on EBITDA. Set from the
  // firm's own *-valuation-multiples-2026 guides and public sources (First
  // Page Sage, Peak Business Valuation, FISART, CT Acquisitions, Capstone
  // Partners, summaries of GF Data), checked against a verified sources pass
  // in October 2026. Most are published ranges and averages from advisers,
  // brokers and valuation firms, not a closed-deal database, and valuation.html
  // lists every source. Low end = typical negotiated sale; high end = quality
  // business in a competitive process.
  const MULT = deepFreeze({
    ece:          [3.5, 6.0],
    services:     [4.5, 7.0],
    homeservices: [4.5, 7.5],
    facilities:   [4.0, 6.5],
    manufacturing:[4.5, 6.5],
    distribution: [4.5, 6.5],
    construction: [3.5, 5.5],
    healthcare:   [5.0, 7.5],
    insurance:    [7.0, 11.0],
    itservices:   [5.0, 8.0],
    software:     [6.0, 10.0],
    professional: [4.0, 6.5],
    agency:       [4.0, 6.0],
    transport:    [3.5, 5.5],
    auto:         [4.5, 7.0],
    consumer:     [3.0, 4.5],
    restaurants:  [2.5, 4.0],
    ecommerce:    [3.0, 5.0],
    other:        [3.5, 5.5],
    petcare:      [3.5, 5.5]
  });
  const NAMES = deepFreeze({
    ece: 'early childhood education', services: 'business services',
    homeservices: 'home services', facilities: 'facility services and landscaping',
    manufacturing: 'manufacturing', distribution: 'distribution and logistics',
    construction: 'construction', healthcare: 'healthcare services',
    insurance: 'insurance agency', itservices: 'IT services',
    software: 'software and technology', professional: 'professional services',
    agency: 'agency', transport: 'transportation', auto: 'auto services',
    consumer: 'consumer', restaurants: 'restaurant and food service',
    ecommerce: 'e-commerce', other: 'comparable', petcare: 'pet care'
  });
  // Typical EBITDA margins by industry, used only when profit is left blank.
  const MARGIN = deepFreeze({
    ece: 0.15, services: 0.15, homeservices: 0.12, facilities: 0.12,
    manufacturing: 0.12, distribution: 0.07, construction: 0.10, healthcare: 0.15,
    insurance: 0.25, itservices: 0.15, software: 0.25, professional: 0.20,
    agency: 0.15, transport: 0.08, auto: 0.20, consumer: 0.10,
    restaurants: 0.12, ecommerce: 0.10, other: 0.12, petcare: 0.15
  });
  // What it costs to replace a full-time owner-operator, by revenue. On the
  // EBITDA path a profit figure that still contains the owner's own pay has to
  // give up a market manager's salary before it is priced. On the small-business
  // path the same salary is added back to a profit the owner already took their
  // pay out of. Tiers are deliberately conservative: overstating the salary here
  // would erase a real business, which is a worse error than understating it.
  const MANAGER_SALARY = deepFreeze([
    [1e6, 65000], [3e6, 85000], [7e6, 115000], [15e6, 150000], [Infinity, 200000]
  ]);

  // Subsector-level multiple/margin overrides. Each industry with real dispersion
  // between its niches gets its own list; industries left out (or the "_other"
  // fallback) use the industry-level MULT/MARGIN/NAMES above instead.
  const SUBSECTORS = deepFreeze({
    ece: [
      {id:'independent', label:'Single-Site Independent Preschool / Daycare', mult:[3.0,5.0], margin:0.13, name:'single-site preschools and daycares'},
      {id:'multisite', label:'Multi-Site Regional Preschool Group', mult:[4.0,6.5], margin:0.15, name:'multi-site preschool groups'},
      {id:'franchise', label:'Franchise-Affiliated Childcare Center', mult:[3.5,5.5], margin:0.14, name:'franchise-affiliated childcare centers'},
      {id:'specialty', label:'Specialty (Montessori, Bilingual, Special Needs)', mult:[4.0,6.5], margin:0.17, name:'specialty early education providers'}
    ],
    services: [
      {id:'staffing', label:'Staffing / Recruiting', mult:[3.5,6.0], margin:0.10, name:'staffing and recruiting firms'},
      {id:'outsourced', label:'Outsourced Back-Office (Payroll, HR, BPO)', mult:[5.5,8.5], margin:0.18, name:'outsourced back-office providers'},
      {id:'inspection', label:'Environmental / Testing / Inspection', mult:[5.5,8.0], margin:0.18, name:'environmental, testing, and inspection firms'},
      {id:'security', label:'Security Services', mult:[4.0,6.0], margin:0.10, name:'security services firms'}
    ],
    homeservices: [
      {id:'hvac', label:'HVAC (Residential)', mult:[5.0,8.0], margin:0.13, name:'residential HVAC companies'},
      {id:'plumbing', label:'Plumbing', mult:[4.0,7.0], margin:0.12, name:'plumbing companies'},
      {id:'electrical', label:'Electrical', mult:[4.5,7.5], margin:0.12, name:'electrical contractors'},
      {id:'multitrade', label:'Multi-Trade / Combo Shop', mult:[5.0,8.5], margin:0.13, name:'multi-trade home services companies'},
      {id:'pest', label:'Pest Control', mult:[5.5,9.0], margin:0.20, name:'pest control companies'}
    ],
    facilities: [
      {id:'landscapemaint', label:'Commercial Landscape Maintenance', mult:[4.0,6.5], margin:0.13, name:'commercial landscape maintenance companies'},
      {id:'landscapedb', label:'Landscape Design / Build', mult:[3.5,5.5], margin:0.10, name:'landscape design/build companies'},
      {id:'janitorial', label:'Janitorial / Commercial Cleaning', mult:[3.5,6.0], margin:0.10, name:'janitorial and commercial cleaning companies'},
      {id:'exterior', label:'Snow Removal / Exterior Services', mult:[3.5,5.5], margin:0.12, name:'snow removal and exterior services companies'}
    ],
    manufacturing: [
      {id:'machining', label:'Precision Machining / Metal Fabrication', mult:[4.5,7.0], margin:0.14, name:'precision machining and metal fabrication shops'},
      {id:'contract', label:'Contract / OEM Manufacturing', mult:[4.0,6.0], margin:0.10, name:'contract and OEM manufacturers'},
      {id:'foodbev', label:'Food & Beverage Manufacturing', mult:[5.0,7.5], margin:0.12, name:'food and beverage manufacturers'},
      {id:'buildingproducts', label:'Building Products Manufacturing', mult:[4.5,6.5], margin:0.12, name:'building products manufacturers'},
      {id:'plastics', label:'Plastics / Injection Molding', mult:[4.0,6.0], margin:0.13, name:'plastics and injection molding companies'}
    ],
    distribution: [
      {id:'wholesale', label:'Wholesale Distribution (Durable Goods)', mult:[4.5,6.5], margin:0.07, name:'wholesale distributors'},
      {id:'foodbevdist', label:'Food & Beverage Distribution', mult:[4.0,6.0], margin:0.06, name:'food and beverage distributors'},
      {id:'industrial', label:'Industrial / MRO Distribution', mult:[5.0,7.0], margin:0.09, name:'industrial and MRO distributors'},
      {id:'logistics', label:'3PL / Warehousing & Logistics', mult:[5.0,7.5], margin:0.10, name:'3PL and warehousing companies'}
    ],
    construction: [
      {id:'general', label:'General Contracting', mult:[3.0,5.0], margin:0.08, name:'general contractors'},
      {id:'specialty', label:'Specialty Mechanical / Electrical Contracting', mult:[4.0,6.0], margin:0.10, name:'specialty mechanical and electrical contractors'},
      {id:'roofing', label:'Roofing', mult:[3.5,6.0], margin:0.12, name:'roofing companies'},
      {id:'civil', label:'Civil / Infrastructure', mult:[4.0,6.0], margin:0.09, name:'civil and infrastructure contractors'}
    ],
    healthcare: [
      {id:'dental', label:'Dental Practice', mult:[5.5,8.5], margin:0.20, name:'dental practices'},
      {id:'homehealth', label:'Home Health / Home Care', mult:[4.5,7.0], margin:0.13, name:'home health and home care agencies'},
      {id:'behavioral', label:'Behavioral Health / Therapy', mult:[4.5,7.5], margin:0.15, name:'behavioral health and therapy practices'},
      {id:'pt', label:'Physical / Occupational Therapy', mult:[5.0,7.5], margin:0.15, name:'physical and occupational therapy clinics'},
      {id:'medpractice', label:'Medical Practice (Non-Dental)', mult:[5.0,7.5], margin:0.18, name:'medical practices'},
      {id:'veterinary', label:'Veterinary', mult:[5.5,9.0], margin:0.20, name:'veterinary practices'}
    ],
    insurance: [
      {id:'personal', label:'Personal Lines Agency', mult:[6.0,8.5], margin:0.22, name:'personal lines agencies'},
      {id:'commercial', label:'Commercial P&C Agency', mult:[7.5,11.5], margin:0.28, name:'commercial P&C agencies'},
      {id:'benefits', label:'Employee Benefits Brokerage', mult:[7.5,10.5], margin:0.28, name:'employee benefits brokerages'},
      {id:'mga', label:'MGA / Specialty Program', mult:[8.0,11.0], margin:0.25, name:'MGAs and specialty program businesses'}
    ],
    itservices: [
      {id:'msp', label:'Managed Service Provider (MSP)', mult:[5.0,8.0], margin:0.17, name:'managed service providers'},
      {id:'cyber', label:'Cybersecurity Services', mult:[6.5,9.5], margin:0.18, name:'cybersecurity services firms'},
      {id:'itstaffing', label:'IT Staffing / Consulting', mult:[5.0,8.0], margin:0.10, name:'IT staffing and consulting firms'},
      {id:'cloud', label:'Cloud / Infrastructure Services', mult:[5.5,8.5], margin:0.16, name:'cloud and infrastructure services firms'}
    ],
    software: [
      {id:'verticalsaas', label:'Vertical SaaS', mult:[7.0,11.0], margin:0.28, name:'vertical SaaS companies'},
      {id:'onprem', label:'On-Premise / Legacy Licensed Software', mult:[4.5,7.0], margin:0.22, name:'on-premise and legacy licensed software companies'},
      {id:'fintech', label:'Fintech / Payments Software', mult:[6.5,10.5], margin:0.25, name:'fintech and payments software companies'},
      {id:'devtools', label:'Dev Tools / Infrastructure Software', mult:[6.5,10.5], margin:0.22, name:'dev tools and infrastructure software companies'}
    ],
    professional: [
      {id:'accounting', label:'Accounting / CPA Firm', mult:[4.5,7.5], margin:0.25, name:'accounting and CPA firms'},
      {id:'engineering', label:'Engineering Firm', mult:[5.0,7.5], margin:0.18, name:'engineering firms'},
      {id:'consulting', label:'Management Consulting', mult:[4.0,6.5], margin:0.20, name:'management consulting firms'},
      {id:'architecture', label:'Architecture', mult:[3.5,5.5], margin:0.15, name:'architecture firms'}
    ],
    agency: [
      {id:'digital', label:'Digital Marketing / Performance', mult:[4.0,6.5], margin:0.15, name:'digital marketing and performance agencies'},
      {id:'creative', label:'Creative / Branding', mult:[3.5,5.5], margin:0.14, name:'creative and branding agencies'},
      {id:'pr', label:'PR / Communications', mult:[3.5,5.5], margin:0.14, name:'PR and communications agencies'},
      {id:'mediabuying', label:'Media Buying', mult:[4.0,6.0], margin:0.10, name:'media buying agencies'}
    ],
    transport: [
      {id:'truckload', label:'Truckload Carrier', mult:[3.0,5.0], margin:0.07, name:'truckload carriers'},
      {id:'ltl', label:'LTL / Regional Carrier', mult:[4.0,6.0], margin:0.08, name:'LTL and regional carriers'},
      {id:'specialized', label:'Specialized Freight (Tanker, Flatbed, Refrigerated)', mult:[3.5,5.5], margin:0.09, name:'specialized freight carriers'},
      {id:'brokerage', label:'Freight Brokerage', mult:[4.0,6.5], margin:0.06, name:'freight brokerages'}
    ],
    auto: [
      {id:'carwash', label:'Express Car Wash', mult:[6.0,9.0], margin:0.30, name:'express car wash businesses'},
      {id:'repair', label:'Auto Repair / Collision', mult:[4.0,6.0], margin:0.16, name:'auto repair and collision shops'},
      {id:'quicklube', label:'Quick Lube / Tire', mult:[4.5,6.5], margin:0.18, name:'quick lube and tire shops'},
      {id:'glass', label:'Auto Glass / Detailing', mult:[4.0,6.0], margin:0.15, name:'auto glass and detailing businesses'}
    ],
    consumer: [
      {id:'specialtyretail', label:'Specialty Retail (Brick & Mortar)', mult:[3.0,4.5], margin:0.08, name:'specialty retailers'},
      {id:'cpg', label:'Consumer Products / CPG Brand', mult:[4.0,6.5], margin:0.12, name:'consumer products brands'},
      {id:'franchiseretail', label:'Franchise Retail', mult:[3.0,4.5], margin:0.10, name:'franchise retail operators'},
      {id:'beauty', label:'Beauty / Personal Care Services', mult:[3.5,5.0], margin:0.15, name:'beauty and personal care businesses'}
    ],
    restaurants: [
      {id:'qsr', label:'Quick Service / Fast Casual (Multi-Unit)', mult:[4.0,6.0], margin:0.10, name:'multi-unit quick service and fast casual restaurants'},
      {id:'fullservice', label:'Full Service / Casual Dining', mult:[2.5,3.5], margin:0.10, name:'full service and casual dining restaurants'},
      {id:'catering', label:'Catering / Institutional Food Service', mult:[2.5,4.5], margin:0.10, name:'catering and institutional food service companies'},
      {id:'independent', label:'Single High-Performing Independent', mult:[2.5,3.5], margin:0.10, name:'single-location independent restaurants'}
    ],
    ecommerce: [
      {id:'marketplace', label:'Amazon-First / Marketplace Brand', mult:[3.0,5.0], margin:0.15, name:'marketplace-first e-commerce brands'},
      {id:'dtc', label:'DTC Brand (Owned Site)', mult:[3.5,5.5], margin:0.12, name:'direct-to-consumer brands'},
      {id:'subscription', label:'Subscription / Consumables Brand', mult:[4.5,7.0], margin:0.15, name:'subscription and consumables brands'},
      {id:'b2b', label:'B2B E-Commerce', mult:[3.5,5.5], margin:0.10, name:'B2B e-commerce companies'}
    ],
    // Pet care has no transaction database behind it; daycare, grooming and
    // retail lean on vendor and broker-published bands (Peak Business
    // Valuation, BridgeBook, Praxis Rock) and the firm's own pet care guide.
    // Dog walking has one thin walking-specific source (DealFlow-OS, an undated
    // 2026 page, 2.5x-4.5x EBITDA) and BizBuySell's Pet Services SDE average;
    // with no facility to sell, it takes 2.5x-4.0x, the low-confidence end of
    // that. There is no multi-site niche: an owner with several sites picks
    // daycare and the size adjustment does the rest. Veterinary practices stay
    // in healthcare.
    petcare: [
      {id:'daycare', label:'Dog Daycare / Boarding / Pet Resort', mult:[3.5,5.5], margin:0.18, name:'dog daycare and boarding facilities'},
      {id:'grooming', label:'Pet Grooming / Training', mult:[3.0,4.5], margin:0.15, name:'pet grooming and training businesses'},
      {id:'walking', label:'Dog Walking / Pet Sitting', mult:[2.5,4.0], margin:0.12, name:'dog walking and pet sitting businesses'},
      {id:'retail', label:'Pet Retail / Supply Store', mult:[3.0,4.5], margin:0.08, name:'pet retail and supply stores'}
    ]
  });

  // Small-business starting ranges, as multiples of seller's discretionary
  // earnings (SDE: profit with the owner's own pay still in it). Set at roughly
  // 0.75x and 1.2x of the average SDE multiple published for sold businesses in
  // each industry (BizBuySell's Q1 2021 to Q4 2025 averages, read from archived
  // copies; the IBBA and M&A Source Market Pulse; Peak Business Valuation),
  // then checked against the October 2026 sources pass. "_all" is the fallback
  // for industries without enough industry-specific evidence, insurance among
  // them: only one verified source gave an insurance-specific SDE figure.
  const SDE_MULT = deepFreeze({
    _all: [2.0, 3.1],
    homeservices: [2.0, 3.3], ece: [2.4, 3.8], petcare: [1.9, 3.1],
    facilities: [2.0, 3.1], manufacturing: [2.3, 3.6], distribution: [2.2, 3.5],
    healthcare: [1.8, 3.3], itservices: [2.3, 3.8], software: [2.5, 3.9],
    professional: [1.8, 3.1], transport: [2.0, 3.3], auto: [2.2, 3.5],
    consumer: [1.8, 2.9], restaurants: [1.6, 2.7], ecommerce: [2.6, 4.1]
  });
  // Niches whose small-business range differs from their industry's. Dental
  // follows BizBuySell's sold-practice data and Peak, not the 4-6x figure some
  // advisers repeat. Car washes: Auxo and CT Acquisitions both publish 3x-5x
  // SDE for a single owner-operated wash, and Peak's 2.39x-4.24x sits just
  // below it. Pet care
  // splits because grooming sells well below daycare and boarding.
  const SDE_SUBSECTORS = deepFreeze({
    healthcare: { dental: [2.5, 4.0] },
    auto: { carwash: [3.0, 5.0] },
    petcare: { daycare: [2.4, 3.8], grooming: [1.7, 2.7], retail: [2.0, 3.2], walking: [1.9, 3.1] }
  });

  // Each dropdown below was designed independently (owner dependency, growth,
  // concentration, revenue quality), then rescaled together so the four
  // combined best-case and worst-case totals stay close to the original
  // 4-tier model's combined swing (+1.75 / -2.75). Individually stretching
  // each dimension's own extreme by up to 0.15 is fine; letting all four
  // stretch in the same direction at once is not, since highX/lowX have no
  // cap beyond the multiple floor.
  const OWNER_ADJ = deepFreeze({
    fullTeamAbsentee: 0.50, gmInPlace: 0.28, teamOpsOwnerRelationships: 0.05,
    teamOpsOwnerSales: -0.18, dailyHandsOn: -0.40, irreplaceableDelivery: -0.62,
    allMe: -0.80
  });
  const GROWTH_ADJ = deepFreeze({
    explosive25plus: 0.55, strong10to25: 0.35, steady3to10: 0.18,
    unevenGrowth: 0, roughlyFlat: -0.20, recentDip: -0.42, multiYearDecline: -0.80
  });
  const CONC_ADJ = deepFreeze({
    under5: 0.30, five_ten: 0.15, ten_25: 0, twentyfive_40: -0.30,
    forty_60: -0.55, sixty_80: -0.80, over80: -1.00
  });
  const REC_ADJ = deepFreeze({
    lockedInContracts: 0.55, autoRenewing: 0.35, repeatNoContract: 0.17,
    mixedRevenue: 0, oneTimeProject: -0.20, cyclicalLumpy: -0.40
  });

  // The four answers that move the multiple, in the order the form asks them.
  // The order matters twice: it is the order the adjustments are summed in,
  // which keeps every total identical to the float sum the tool always did, and
  // it is the tiebreak when two answers move the number by the same amount.
  const ANSWER_KEYS = Object.freeze(['owner', 'growth', 'concentration', 'revenueType']);
  const ADJUSTMENTS = Object.freeze({
    owner: OWNER_ADJ, growth: GROWTH_ADJ, concentration: CONC_ADJ, revenueType: REC_ADJ
  });

  // What each line of the breakdown and the ranked list is called.
  const CATEGORY_NAMES = Object.freeze({
    size: 'Your size', owner: 'Owner involvement', growth: 'Revenue trend',
    concentration: 'Largest customer', revenueType: 'Revenue type'
  });

  // Short versions of each dropdown answer. The form's own option text is
  // written to be chosen, not re-read, and is too long for a result line.
  const ANSWER_LABELS = deepFreeze({
    owner: {
      fullTeamAbsentee: 'Full management team; you could step away for months',
      gmInPlace: 'A general manager or president runs day to day',
      teamOpsOwnerRelationships: 'Team runs operations; you hold key relationships',
      teamOpsOwnerSales: 'Team runs operations; you are the main salesperson',
      dailyHandsOn: 'Hands-on every day, running key operations',
      irreplaceableDelivery: 'You personally do the skilled work customers pay for',
      allMe: 'The business is entirely you'
    },
    growth: {
      explosive25plus: 'Growing 25%+ a year',
      strong10to25: 'Growing 10–25% a year',
      steady3to10: 'Growing about 3–10% a year',
      unevenGrowth: 'Growing, but unevenly',
      roughlyFlat: 'Roughly flat',
      recentDip: 'A slight recent dip after years of growth',
      multiYearDecline: 'Declining several years in a row'
    },
    concentration: {
      under5: 'Under 5% of revenue',
      five_ten: '5–10% of revenue',
      ten_25: '10–25% of revenue',
      twentyfive_40: '25–40% of revenue',
      forty_60: '40–60% of revenue',
      sixty_80: '60–80% of revenue',
      over80: 'More than 80% of revenue'
    },
    revenueType: {
      lockedInContracts: 'Multi-year contracts',
      autoRenewing: 'Auto-renewing contracts or memberships',
      repeatNoContract: 'Repeat customers, no formal contracts',
      mixedRevenue: 'Mix of repeat and one-time work',
      oneTimeProject: 'Mostly one-time or project work',
      cyclicalLumpy: 'Cyclical, unpredictable project work'
    }
  });

  // One plain-English reason per answer, told from the buyer's side of the
  // table. Kept beside the adjustment tables so a new option cannot ship
  // without a reason; the tests fail if one is missing. No statistics: these
  // explain why buyers react, not by how much the market does.
  const BASELINE_WHY = 'This tool treats this answer as its baseline, so it neither raises nor lowers your number.';
  const WHY = deepFreeze({
    owner: {
      fullTeamAbsentee: 'A business that runs without you is the easiest kind to buy: the buyer gets a working company on day one, not a handoff plan.',
      gmInPlace: 'With a manager already running the day to day, a buyer is not betting the business on finding your replacement.',
      teamOpsOwnerRelationships: 'Your team runs the work, which buyers like. Key relationships still sit with you, so they will want a plan to hand those over.',
      teamOpsOwnerSales: 'If you bring in most new business, a buyer worries growth slows when you leave, and prices in that risk.',
      dailyHandsOn: 'When the owner runs most key operations, a buyer has to replace you and hope nothing breaks in the handoff.',
      irreplaceableDelivery: 'If customers are paying for your personal skill, a buyer cannot be sure what is left once you step back.',
      allMe: 'When relationships, sales and delivery all run through you, much of the value leaves with you, and buyers discount heavily for that.'
    },
    growth: {
      explosive25plus: 'Fast growth means a buyer expects more profit next year than this year, so they will pay more for today’s.',
      strong10to25: 'Strong growth tells a buyer the business is gaining ground, which supports a higher multiple.',
      steady3to10: 'Steady growth shows demand is holding up without the buyer having to take your word for it.',
      unevenGrowth: BASELINE_WHY + ' Expect buyers to ask about the soft years.',
      roughlyFlat: 'Flat revenue gives a buyer no growth to pay for, so they price on today’s earnings alone.',
      recentDip: 'A recent dip makes buyers ask whether it is a blip or a trend, and they price in that doubt until it is explained.',
      multiYearDecline: 'Several years of decline suggest profit may keep shrinking after the sale, so buyers pay for less than today’s earnings.'
    },
    concentration: {
      under5: 'No customer is big enough to hurt you if they leave, which is exactly what buyers want to see.',
      five_ten: 'Your revenue is well spread out, so losing any one customer would not change the business much.',
      ten_25: BASELINE_WHY,
      twentyfive_40: 'When one customer is a quarter or more of revenue, a buyer has to price in what happens if they leave.',
      forty_60: 'With one customer near half your revenue, losing them would change the business, so buyers discount for it and may tie part of the price to keeping them.',
      sixty_80: 'When most revenue comes from one customer, a buyer is partly buying that one relationship and prices it that way.',
      over80: 'With nearly all revenue from one customer, the business rests on a single relationship, and buyers discount heavily for that.'
    },
    revenueType: {
      lockedInContracts: 'Multi-year contracts show a buyer how much revenue is coming before they buy, and that certainty is worth paying for.',
      autoRenewing: 'Revenue that renews on its own is predictable, and predictable revenue earns a higher multiple.',
      repeatNoContract: 'Customers who keep coming back show loyalty, though without contracts a buyer cannot be sure they will stay.',
      mixedRevenue: BASELINE_WHY,
      oneTimeProject: 'When most work is one-time, the business has to win its revenue again every year, and buyers price in that effort.',
      cyclicalLumpy: 'Lumpy, unpredictable revenue makes next year’s profit hard to forecast, and buyers pay less for what they cannot forecast.'
    }
  });

  // How size moves the EBITDA multiple, by earnings after any manager's salary.
  // The tool used to step at $250K, $500K, $1M, $2M and $5M, so a business $1
  // over a line jumped half a turn. It now slides in a straight line between the
  // middle of each old step, through the same six values, and stays flat beyond
  // the ends. The result is rounded to hundredths so the breakdown adds up.
  const SIZE_POINTS = deepFreeze([
    [150000, -1.0], [375000, -0.5], [750000, 0], [1.5e6, 0.25], [3.5e6, 0.75], [7e6, 1.5]
  ]);
  // The same idea on the small-business path, by SDE: about -0.4 under $75K,
  // -0.15 from $75K to $150K, and nothing from there up, smoothed the same way.
  const SDE_SIZE_POINTS = deepFreeze([[50000, -0.4], [112500, -0.15], [175000, 0]]);

  // Why size moves the multiple, chosen by where earnings sit and which way
  // size moved them. No statistics: these explain who buys at each size.
  const SIZE_WHY = deepFreeze({
    baseline: 'This tool treats this size as its baseline, so size neither adds nor subtracts.',
    tiny: 'At this size most buyers are individuals buying a job as much as a business, and they pay lower multiples for that risk.',
    small: 'Smaller businesses are usually bought by individuals and smaller firms, and they pay less because one bad year hits a small business harder.',
    nearMillion: 'Earnings approaching $1 million start to draw more institutional buyers than smaller businesses see.',
    million: 'Crossing $1 million in earnings opens the door to more institutional buyers than smaller businesses see.',
    twoMillion: 'Earnings at this level put you on the radar of many private equity buyers, which widens the field of bidders.',
    fiveMillion: 'At this size, private equity firms and larger companies can compete for you, and more competition supports a higher multiple.',
    sdeBaseline: 'This tool treats this size as its small-business baseline, so size neither adds nor subtracts.',
    sdeTiny: 'At this size the buyer is usually an individual buying a job as much as a business, and financing is hardest to arrange, so multiples run lowest.',
    sdeSmall: 'Small businesses usually sell to individual buyers, and a smaller earnings base leaves them less cushion, which they price in.'
  });

  // Verified acquirers by industry (publicly reported activity, 2025-26), shown
  // on the result screen. Text only; the page builds it with DOM calls.
  const BUYERS = deepFreeze({
    ece: [
      ['Cadence Education', 'PE-backed national platform with 300+ schools across 30 states; has acquired more than 100 preschools. Connor spent three years inside Cadence, working through more than 40 of those acquisitions.'],
      ['KinderCare Learning Companies', 'One of the largest early education providers in the country.'],
      ['Busy Bees / BrightPath', 'Global operator backed by the Ontario Teachers’ Pension Plan, growing across North America.']
    ],
    services: [
      ['Springdale Industries', 'Long-term holding company with 375+ partner businesses nationwide; buys majority stakes and keeps management in place. We know their team well.'],
      ['Alpine Investors', 'One of the biggest names in business services; backs Apex, Ascend, Trilon, and Evergreen, among the most acquisitive platforms in the country.'],
      ['Shore Capital Partners', 'Ranked #1 in U.S. private equity deal volume 2015–2024 (PitchBook); built around buying founder-owned businesses our size.']
    ],
    homeservices: [
      ['Apex Service Partners', 'The most active home services consolidator: roughly 60 acquisitions in 2025 across HVAC, plumbing and electrical. An Alpine Investors platform.'],
      ['Multi-trade PE platforms', 'Dozens of private equity-backed regional platforms are actively acquiring residential trades businesses.']
    ],
    facilities: [
      ['BrightView', 'The largest commercial landscaper in the country, actively acquiring again.'],
      ['SiteOne Landscape Supply', 'Serial acquirer in the landscape supply chain: seven acquisitions in 2025 alone.'],
      ['PE-backed facility services platforms', 'Consolidators in landscaping, janitorial and facility maintenance remain highly active.']
    ],
    manufacturing: [
      ['Marmon Holdings (Berkshire Hathaway)', 'A long-time home for family-owned niche manufacturers; more than 100 autonomous businesses.'],
      ['PE-backed manufacturing platforms', 'Industrial-focused private equity firms actively acquire precision, specialty, and contract manufacturers.']
    ],
    distribution: [
      ['Watsco', 'The largest HVAC distributor in North America and a serial acquirer of family-owned distributors.'],
      ['SiteOne Landscape Supply', 'Completed seven distribution acquisitions in 2025; dozens over the last decade.']
    ],
    construction: [
      ['Comfort Systems USA', 'Public mechanical and electrical contractor that completed five acquisitions in 2025.'],
      ['Specialty trade consolidators', 'PE-backed platforms in fire and life safety, roofing, paving, and mechanical trades are acquiring aggressively.']
    ],
    healthcare: [
      ['Shore Capital Partners', 'The most active healthcare investor in the lower middle market; ranked #1 in U.S. PE deal volume 2015–2024.'],
      ['Heartland Dental', 'The largest dental support organization in the country, supporting 1,700+ offices.'],
      ['MSO and DSO platforms', 'PE-backed physician, dental, and therapy groups are consolidating nearly every specialty.']
    ],
    insurance: [
      ['BroadStreet Partners', 'The most active agency acquirer in the country, with 69 deals in 2025.'],
      ['Hub International', 'Top-five broker, 49 agency acquisitions in 2025.'],
      ['Inszone Insurance Services', '45 agency acquisitions in 2025 and accelerating.']
    ],
    itservices: [
      ['Evergreen Services Group (Lyra)', 'The most acquisitive MSP buyer in the world: 47 acquisitions in 2025. An Alpine Investors company.'],
      ['PE-backed MSP platforms', 'A deep field of platforms actively consolidating managed IT services.']
    ],
    software: [
      ['Constellation Software', 'Famously acquires hundreds of small vertical software companies and holds them forever.'],
      ['Vertical SaaS consolidators', 'PE-backed software platforms compete aggressively for niche products with sticky customers.']
    ],
    professional: [
      ['Ascend', 'Alpine-backed accounting platform; dozens of CPA firm mergers, including Top 200 firms.'],
      ['Trilon Group', 'The most prolific acquirer in engineering and infrastructure consulting: eight acquisitions in 2025.'],
      ['PE-backed professional services platforms', 'Accounting, engineering, and consulting roll-ups are among the hottest areas in private equity.']
    ],
    agency: [
      ['Accenture', 'Has acquired dozens of marketing and creative agencies at the larger end of the market.'],
      ['PE-backed agency platforms', 'Digital marketing and creative agency roll-ups actively acquire specialized shops with retainer revenue.']
    ],
    transport: [
      ['TFI International', 'One of the most acquisitive trucking consolidators in North America, with well over 100 acquisitions in its history.'],
      ['Knight-Swift', 'Top-five carrier that has grown through acquisition, including U.S. Xpress and Dependable Highway Express.']
    ],
    auto: [
      ['Mammoth Holdings', 'Express car wash platform with 200+ locations in 17 states. Its founding CEO has been a guest on our podcast.'],
      ['Mister Car Wash', 'The largest U.S. car wash operator, taken private by Leonard Green in 2026.'],
      ['Crash Champions', 'PE-backed collision repair consolidator with hundreds of locations.']
    ],
    consumer: [
      ['Shore Capital Partners', 'Closed a $450M+ food and beverage fund in 2025; built around buying founder-owned consumer businesses.'],
      ['Strategic and franchise acquirers', 'Category leaders and franchise groups actively acquire proven consumer concepts and locations.']
    ],
    restaurants: [
      ['Flynn Group', 'The largest multi-brand franchise operator in the world, with thousands of locations across seven brands.'],
      ['Savory Fund', 'Private equity fund built specifically to buy and scale emerging restaurant brands; $750M+ in assets.'],
      ['Shore Capital Partners', 'Closed a $450M+ food and beverage fund in 2025.']
    ],
    // Named on our pet care sector page, in its own words.
    petcare: [
      ['Digs Dog Care', 'Frontenac-backed; acquired 17 pet resorts across Digs-branded and partner facilities, closing roughly 15 add-ons in 2025 alone.'],
      ['Pet Resort Hospitality Group', 'Formed by Trivest and Queens Court Capital; reported 23 facilities as of January 2026.'],
      ['Village Pet Care', 'Backed by General Atlantic; runs 17 centers across six states.']
    ],
    ecommerce: [
      ['Razor Group', 'The surviving consolidator of the aggregator era; merged with Infinite Commerce in 2025 to manage 10,000+ SKUs.'],
      ['Strategic brand acquirers', 'The aggregator wave has cooled. Today’s buyers are selective and pay for profitable, differentiated brands.']
    ]
  });
  const BUYERS_GENERIC = deepFreeze([
    ['PE-backed industry platforms', 'Private equity consolidators building scale in your sector through add-on acquisitions.'],
    ['Strategic acquirers', 'Larger companies in your industry seeking geographic or capability expansion.'],
    ['Family offices & independent sponsors', 'Long-hold buyers who compete well on culture and continuity.']
  ]);

  const api = Object.freeze({
    deepFreeze, MULT, NAMES, MARGIN, MANAGER_SALARY, SUBSECTORS, SDE_MULT, SDE_SUBSECTORS,
    ANSWER_KEYS, ADJUSTMENTS, CATEGORY_NAMES, ANSWER_LABELS, WHY,
    SIZE_POINTS, SDE_SIZE_POINTS, SIZE_WHY, BUYERS, BUYERS_GENERIC
  });

  // Node loads this file to test it; the page reads it from window.
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  window.SCValuationTables = api;
})();
