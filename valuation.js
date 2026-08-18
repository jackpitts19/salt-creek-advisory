(function () {
  // Earlier versions of this tool appended every submitted lead to localStorage.
  // Purge anything that left behind. Runs on load, so a returning visitor is
  // cleaned up whether or not they submit the form again.
  const STORED_LEADS_KEY = 'sc_valuation_leads';
  function clearStoredLeads() {
    try {
      localStorage.removeItem(STORED_LEADS_KEY);
    } catch (err) {
      // Storage can be unavailable in private mode or when cookies are blocked.
      // There is nothing to recover from and nothing the visitor needs to see.
    }
  }
  clearStoredLeads();

  // Base EBITDA multiple ranges, calibrated to 2025-26 lower middle market
  // transaction data (GF Data, BizBuySell, sector reports). Low end = typical
  // negotiated sale; high end = quality business in a competitive process.
  const MULT = {
    ece:          [3.5, 6.0],
    services:     [4.5, 7.0],
    homeservices: [4.5, 7.5],
    facilities:   [4.0, 6.5],
    manufacturing:[4.5, 6.5],
    distribution: [4.5, 6.5],
    construction: [3.5, 5.5],
    healthcare:   [5.0, 7.5],
    insurance:    [7.0, 10.0],
    itservices:   [5.0, 8.0],
    software:     [6.0, 10.0],
    professional: [4.0, 6.5],
    agency:       [4.0, 6.0],
    transport:    [3.5, 5.5],
    auto:         [4.5, 7.0],
    consumer:     [3.0, 4.5],
    restaurants:  [2.5, 4.0],
    ecommerce:    [3.0, 5.0],
    other:        [3.5, 5.5]
  };
  const NAMES = {
    ece: 'early childhood education', services: 'business services',
    homeservices: 'home services', facilities: 'facility services and landscaping',
    manufacturing: 'manufacturing', distribution: 'distribution and logistics',
    construction: 'construction', healthcare: 'healthcare services',
    insurance: 'insurance agency', itservices: 'IT services',
    software: 'software and technology', professional: 'professional services',
    agency: 'agency', transport: 'transportation', auto: 'auto services',
    consumer: 'consumer', restaurants: 'restaurant and food service',
    ecommerce: 'e-commerce', other: 'comparable'
  };
  // Typical EBITDA margins by industry, used only when profit is left blank.
  const MARGIN = {
    ece: 0.18, services: 0.15, homeservices: 0.12, facilities: 0.12,
    manufacturing: 0.12, distribution: 0.07, construction: 0.10, healthcare: 0.15,
    insurance: 0.25, itservices: 0.15, software: 0.25, professional: 0.20,
    agency: 0.15, transport: 0.08, auto: 0.20, consumer: 0.10,
    restaurants: 0.12, ecommerce: 0.10, other: 0.12
  };
  // What it costs to replace a full-time owner-operator, by revenue. Every
  // multiple in MULT is an EBITDA multiple, so a profit figure that still
  // contains the owner's own pay (SDE) has to give up a market manager's salary
  // before it can be priced against them. Owners routinely report SDE and call
  // it profit, and at the small end the difference is most of the valuation.
  // Tiers are deliberately conservative: overstating the salary here would erase
  // a real business, which is a worse error than understating it slightly.
  const MANAGER_SALARY = [
    [1e6, 65000], [3e6, 85000], [7e6, 115000], [15e6, 150000], [Infinity, 200000]
  ];

  /**
   * Market pay for whoever the buyer hires to do the owner's job.
   * @param {number} revenue annual revenue, used as the size proxy
   * @returns {number} replacement salary in dollars
   */
  function replacementSalary(revenue) {
    const tier = MANAGER_SALARY.find((entry) => revenue < entry[0]);
    return tier[1];
  }

  // Subsector-level multiple/margin overrides. Each industry with real dispersion
  // between its niches gets its own list; industries left out (or the "_other"
  // fallback) use the industry-level MULT/MARGIN/NAMES above instead.
  const SUBSECTORS = {
    ece: [
      {id:'independent', label:'Single-Site Independent Preschool / Daycare', mult:[3.0,5.0], margin:0.15, name:'single-site preschools and daycares'},
      {id:'multisite', label:'Multi-Site Regional Preschool Group', mult:[4.0,6.5], margin:0.18, name:'multi-site preschool groups'},
      {id:'franchise', label:'Franchise-Affiliated Childcare Center', mult:[3.5,5.5], margin:0.16, name:'franchise-affiliated childcare centers'},
      {id:'specialty', label:'Specialty (Montessori, Bilingual, Special Needs)', mult:[4.0,7.0], margin:0.20, name:'specialty early education providers'}
    ],
    services: [
      {id:'staffing', label:'Staffing / Recruiting', mult:[3.5,5.5], margin:0.10, name:'staffing and recruiting firms'},
      {id:'outsourced', label:'Outsourced Back-Office (Payroll, HR, BPO)', mult:[5.5,8.5], margin:0.18, name:'outsourced back-office providers'},
      {id:'inspection', label:'Environmental / Testing / Inspection', mult:[5.0,7.5], margin:0.18, name:'environmental, testing, and inspection firms'},
      {id:'security', label:'Security Services', mult:[4.0,6.0], margin:0.10, name:'security services firms'}
    ],
    homeservices: [
      {id:'hvac', label:'HVAC (Residential)', mult:[5.0,8.0], margin:0.13, name:'residential HVAC companies'},
      {id:'plumbing', label:'Plumbing', mult:[4.5,7.5], margin:0.12, name:'plumbing companies'},
      {id:'electrical', label:'Electrical', mult:[4.5,7.5], margin:0.12, name:'electrical contractors'},
      {id:'multitrade', label:'Multi-Trade / Combo Shop', mult:[5.0,8.5], margin:0.13, name:'multi-trade home services companies'},
      {id:'pest', label:'Pest Control', mult:[5.5,9.0], margin:0.20, name:'pest control companies'}
    ],
    facilities: [
      {id:'landscapemaint', label:'Commercial Landscape Maintenance', mult:[4.5,7.0], margin:0.13, name:'commercial landscape maintenance companies'},
      {id:'landscapedb', label:'Landscape Design / Build', mult:[3.5,5.5], margin:0.10, name:'landscape design/build companies'},
      {id:'janitorial', label:'Janitorial / Commercial Cleaning', mult:[4.0,6.5], margin:0.10, name:'janitorial and commercial cleaning companies'},
      {id:'exterior', label:'Snow Removal / Exterior Services', mult:[3.5,5.5], margin:0.12, name:'snow removal and exterior services companies'}
    ],
    manufacturing: [
      {id:'machining', label:'Precision Machining / Metal Fabrication', mult:[4.5,7.0], margin:0.14, name:'precision machining and metal fabrication shops'},
      {id:'contract', label:'Contract / OEM Manufacturing', mult:[4.0,6.0], margin:0.10, name:'contract and OEM manufacturers'},
      {id:'foodbev', label:'Food & Beverage Manufacturing', mult:[5.0,7.5], margin:0.12, name:'food and beverage manufacturers'},
      {id:'buildingproducts', label:'Building Products Manufacturing', mult:[4.5,6.5], margin:0.12, name:'building products manufacturers'},
      {id:'plastics', label:'Plastics / Injection Molding', mult:[4.5,6.5], margin:0.13, name:'plastics and injection molding companies'}
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
      {id:'roofing', label:'Roofing', mult:[4.0,6.5], margin:0.12, name:'roofing companies'},
      {id:'civil', label:'Civil / Infrastructure', mult:[3.5,5.5], margin:0.09, name:'civil and infrastructure contractors'}
    ],
    healthcare: [
      {id:'dental', label:'Dental Practice', mult:[5.5,8.5], margin:0.20, name:'dental practices'},
      {id:'homehealth', label:'Home Health / Home Care', mult:[5.5,8.0], margin:0.13, name:'home health and home care agencies'},
      {id:'behavioral', label:'Behavioral Health / Therapy', mult:[5.5,8.5], margin:0.15, name:'behavioral health and therapy practices'},
      {id:'pt', label:'Physical / Occupational Therapy', mult:[5.0,7.5], margin:0.15, name:'physical and occupational therapy clinics'},
      {id:'medpractice', label:'Medical Practice (Non-Dental)', mult:[5.0,7.5], margin:0.18, name:'medical practices'},
      {id:'veterinary', label:'Veterinary', mult:[6.0,9.0], margin:0.20, name:'veterinary practices'}
    ],
    insurance: [
      {id:'personal', label:'Personal Lines Agency', mult:[6.0,8.5], margin:0.22, name:'personal lines agencies'},
      {id:'commercial', label:'Commercial P&C Agency', mult:[7.5,10.5], margin:0.28, name:'commercial P&C agencies'},
      {id:'benefits', label:'Employee Benefits Brokerage', mult:[7.5,10.5], margin:0.28, name:'employee benefits brokerages'},
      {id:'mga', label:'MGA / Specialty Program', mult:[8.0,11.0], margin:0.25, name:'MGAs and specialty program businesses'}
    ],
    itservices: [
      {id:'msp', label:'Managed Service Provider (MSP)', mult:[5.5,8.5], margin:0.17, name:'managed service providers'},
      {id:'cyber', label:'Cybersecurity Services', mult:[6.5,9.5], margin:0.18, name:'cybersecurity services firms'},
      {id:'itstaffing', label:'IT Staffing / Consulting', mult:[4.0,6.5], margin:0.10, name:'IT staffing and consulting firms'},
      {id:'cloud', label:'Cloud / Infrastructure Services', mult:[5.5,8.5], margin:0.16, name:'cloud and infrastructure services firms'}
    ],
    software: [
      {id:'verticalsaas', label:'Vertical SaaS', mult:[7.0,11.0], margin:0.28, name:'vertical SaaS companies'},
      {id:'onprem', label:'On-Premise / Legacy Licensed Software', mult:[4.5,7.0], margin:0.22, name:'on-premise and legacy licensed software companies'},
      {id:'fintech', label:'Fintech / Payments Software', mult:[6.5,10.5], margin:0.25, name:'fintech and payments software companies'},
      {id:'devtools', label:'Dev Tools / Infrastructure Software', mult:[6.5,10.5], margin:0.22, name:'dev tools and infrastructure software companies'}
    ],
    professional: [
      {id:'accounting', label:'Accounting / CPA Firm', mult:[5.0,7.5], margin:0.25, name:'accounting and CPA firms'},
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
      {id:'specialtyretail', label:'Specialty Retail (Brick & Mortar)', mult:[2.5,4.0], margin:0.08, name:'specialty retailers'},
      {id:'cpg', label:'Consumer Products / CPG Brand', mult:[4.0,6.5], margin:0.12, name:'consumer products brands'},
      {id:'franchiseretail', label:'Franchise Retail', mult:[3.0,4.5], margin:0.10, name:'franchise retail operators'},
      {id:'beauty', label:'Beauty / Personal Care Services', mult:[3.5,5.5], margin:0.15, name:'beauty and personal care businesses'}
    ],
    restaurants: [
      {id:'qsr', label:'Quick Service / Fast Casual (Multi-Unit)', mult:[4.0,6.0], margin:0.15, name:'multi-unit quick service and fast casual restaurants'},
      {id:'fullservice', label:'Full Service / Casual Dining', mult:[2.0,3.5], margin:0.10, name:'full service and casual dining restaurants'},
      {id:'catering', label:'Catering / Institutional Food Service', mult:[3.0,4.5], margin:0.10, name:'catering and institutional food service companies'},
      {id:'independent', label:'Single High-Performing Independent', mult:[2.0,3.0], margin:0.10, name:'single-location independent restaurants'}
    ],
    ecommerce: [
      {id:'marketplace', label:'Amazon-First / Marketplace Brand', mult:[3.0,5.0], margin:0.15, name:'marketplace-first e-commerce brands'},
      {id:'dtc', label:'DTC Brand (Owned Site)', mult:[3.5,5.5], margin:0.12, name:'direct-to-consumer brands'},
      {id:'subscription', label:'Subscription / Consumables Brand', mult:[4.5,7.0], margin:0.15, name:'subscription and consumables brands'},
      {id:'b2b', label:'B2B E-Commerce', mult:[4.0,6.0], margin:0.10, name:'B2B e-commerce companies'}
    ]
  };

  // Each dropdown below was designed independently (owner dependency, growth,
  // concentration, revenue quality), then rescaled together so the four
  // combined best-case and worst-case totals stay close to the original
  // 4-tier model's combined swing (+1.75 / -2.75). Individually stretching
  // each dimension's own extreme by up to 0.15 is fine; letting all four
  // stretch in the same direction at once is not, since highX/lowX have no
  // cap beyond the multiple floor.
  const OWNER_ADJ = {
    fullTeamAbsentee: 0.50, gmInPlace: 0.28, teamOpsOwnerRelationships: 0.05,
    teamOpsOwnerSales: -0.18, dailyHandsOn: -0.40, irreplaceableDelivery: -0.62,
    allMe: -0.80
  };
  const GROWTH_ADJ = {
    explosive25plus: 0.55, strong10to25: 0.35, steady3to10: 0.18,
    unevenGrowth: 0, roughlyFlat: -0.20, recentDip: -0.42, multiYearDecline: -0.80
  };
  const CONC_ADJ = {
    under5: 0.30, five_ten: 0.15, ten_25: 0, twentyfive_40: -0.30,
    forty_60: -0.55, sixty_80: -0.80, over80: -1.00
  };
  const REC_ADJ = {
    lockedInContracts: 0.55, autoRenewing: 0.35, repeatNoContract: 0.17,
    mixedRevenue: 0, oneTimeProject: -0.20, cyclicalLumpy: -0.40
  };

  // Verified acquirers by industry (publicly reported activity, 2025-26).
  const BUYERS = {
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
    ecommerce: [
      ['Razor Group', 'The surviving consolidator of the aggregator era; merged with Infinite Commerce in 2025 to manage 10,000+ SKUs.'],
      ['Strategic brand acquirers', 'The aggregator wave has cooled. Today’s buyers are selective and pay for profitable, differentiated brands.']
    ]
  };
  const BUYERS_GENERIC = [
    ['PE-backed industry platforms', 'Private equity consolidators building scale in your sector through add-on acquisitions.'],
    ['Strategic acquirers', 'Larger companies in your industry seeking geographic or capability expansion.'],
    ['Family offices & independent sponsors', 'Long-hold buyers who compete well on culture and continuity.']
  ];

  const STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','Washington D.C.','West Virginia','Wisconsin','Wyoming'];

  // Formspree: every submission is emailed to Salt Creek and stored in the
  // Formspree dashboard. Create a form at formspree.io, then paste its ID
  // below so the line reads: const LEAD_ENDPOINT = 'https://formspree.io/f/abcdwxyz';
  const LEAD_ENDPOINT = 'https://formspree.io/f/xzdqavol';

  // Bump this whenever terms.html changes materially. It is stored with each
  // lead so a submission can be matched to the terms that were on screen.
  const TERMS_VERSION = '2026-08-10';

  const $ = (id) => document.getElementById(id);
  const steps = document.querySelectorAll('.val-step');
  const dots = document.querySelectorAll('.val-progress span');
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // analytics.js owns the GA4 guard and exposes this. Absent only if that file
  // failed to load, in which case there is nothing to report to anyway.
  function track(eventName, params) {
    if (typeof window.scTrack === 'function') window.scTrack(eventName, params);
  }

  /**
   * Reports funnel progress as one event carrying a step number, rather than three
   * separate event names, so GA4 funnel exploration reads it without extra setup.
   * Carries no visitor-entered data.
   * @param {number} step the step just completed
   */
  function trackStep(step) {
    track('valuation_step_complete', { step });
  }

  /**
   * Tells the visitor their details did not reach us. The estimate renders either
   * way, so without this the screen implies we received a submission we never got.
   * The mailto fallback below it is already populated with the full lead.
   */
  function showLeadWarning() {
    const el = $('valLeadWarning');
    if (!el) return;
    el.textContent = 'Your estimate is ready, but we could not deliver your details to us ' +
      'automatically. Please use “Email Us This Estimate” below so this actually reaches us. ' +
      'The message is already written for you.';
    el.style.display = 'block';
  }

  function hideLeadWarning() {
    const el = $('valLeadWarning');
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  /**
   * Posts the lead to Formspree. Formspree answers with a non-OK status rather than
   * a network error once the plan's monthly submission quota is spent, so the status
   * is checked explicitly: that is the failure most likely to happen quietly.
   * @param {Object} lead the full submission, sent only to Formspree
   * @param {Object} context non-identifying fields safe to report to GA4
   * @returns {Promise<void>}
   */
  function deliverLead(lead, context) {
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(Object.assign({
        _subject: 'New valuation lead: ' + lead.name + ' (' + lead.industry + ', ' + lead.state + ')'
      }, lead))
    })
      .then((response) => {
        if (!response.ok) throw new Error('lead endpoint returned HTTP ' + response.status);
        track('valuation_lead_delivered', context);
      })
      .catch((error) => {
        showLeadWarning();
        track('valuation_lead_delivery_failed',
          Object.assign({ failure_reason: error.message }, context));
      });
  }

  // populate states
  const stateSel = $('vState');
  STATES.forEach(st => {
    const o = document.createElement('option');
    o.value = st; o.textContent = st;
    stateSel.appendChild(o);
  });

  // Populate subsector options whenever the industry changes.
  const subSel = $('vSubsector');
  $('vIndustry').addEventListener('change', () => {
    const list = SUBSECTORS[$('vIndustry').value];
    if (!list) {
      subSel.innerHTML = '<option value="">Not applicable for this industry</option>';
      subSel.disabled = true;
      return;
    }
    subSel.disabled = false;
    subSel.innerHTML = '<option value="">Select your subsector&hellip;</option>' +
      list.map(s => '<option value="' + s.id + '">' + s.label + '</option>').join('') +
      '<option value="_other">Other / Not Listed</option>';
  });

  function showStep(n) {
    steps.forEach(s => s.classList.toggle('active', s.dataset.step == n));
    dots.forEach((d, i) => d.classList.toggle('on', i < n));
    if (n === 4) $('valResult').classList.add('shown');
  }

  function parseMoney(v) {
    const d = String(v).replace(/[^0-9.]/g, '');
    return d ? Math.round(parseFloat(d)) : 0;
  }
  function fmt(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  ['vRevenue', 'vProfit'].forEach(id => {
    const el = $(id);
    el.addEventListener('input', () => {
      const n = parseMoney(el.value);
      el.value = n ? '$' + n.toLocaleString('en-US') : '';
    });
  });

  function err(id, msg) {
    const el = $(id);
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  $('toStep2').addEventListener('click', () => {
    const ind = $('vIndustry').value;
    const rev = parseMoney($('vRevenue').value);
    const prof = parseMoney($('vProfit').value);
    if (!ind) return err('err1', 'Please select your industry.');
    if (SUBSECTORS[ind] && !$('vSubsector').value) return err('err1', 'Please select your subsector.');
    if (!$('vState').value) return err('err1', 'Please select your state.');
    if (!rev && !prof) return err('err1', 'Give us revenue or profit. A rough number is fine.');
    if (rev && prof && prof > rev) return err('err1', 'Profit can\u2019t be higher than revenue. Double-check those numbers.');
    // Only binding when a profit figure was actually given: a blank profit is
    // estimated from industry margins, which are already net of a manager's pay.
    if (prof && !$('vProfitBasis').value) {
      return err('err1', 'Tell us whether your own pay is still inside that profit number.');
    }
    err('err1', '');
    trackStep(1);
    showStep(2);
  });

  $('toStep3').addEventListener('click', () => {
    if (!$('vOwner').value) return err('err2', 'Tell us how involved you are day to day.');
    if (!$('vGrowth').value) return err('err2', 'Tell us how revenue has trended.');
    if (!$('vConc').value) return err('err2', 'Tell us about your largest customer.');
    if (!$('vRec').value) return err('err2', 'Tell us what kind of revenue you have.');
    err('err2', '');
    trackStep(2);
    showStep(3);
  });

  $('back1').addEventListener('click', () => showStep(1));
  $('back2').addEventListener('click', () => showStep(2));

  function sizeAdj(p) {
    if (p >= 5e6) return 1.5;
    if (p >= 2e6) return 0.75;
    if (p >= 1e6) return 0.25;
    if (p >= 5e5) return 0;
    if (p >= 2.5e5) return -0.5;
    return -1.0;
  }
  function roundSmart(v) {
    const step = v >= 1e7 ? 5e5 : v >= 1e6 ? 1e5 : 2.5e4;
    return Math.round(v / step) * step;
  }
  function countUp(el, target, dur) {
    if (rm) { el.textContent = fmt(target); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(roundSmart(target * eased));
      if (t < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
    };
    requestAnimationFrame(tick);
  }

  function renderBuyers(ind) {
    const list = (BUYERS[ind] || []).concat(BUYERS_GENERIC).slice(0, 3);
    $('valBuyersTitle').textContent = 'Buyers active in ' +
      (NAMES[ind] === 'comparable' ? 'businesses like yours' : NAMES[ind]);
    $('valBuyersList').innerHTML = list.map(b =>
      '<div class="val-buyer"><span class="val-buyer-name">' + b[0] +
      '</span><span class="val-buyer-desc">' + b[1] + '</span></div>'
    ).join('');
  }

  $('calcBtn').addEventListener('click', () => {
    const name = $('vName').value.trim();
    const email = $('vEmail').value.trim();
    if (!name) return err('err3', 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('err3', 'Please enter a valid email address.');
    err('err3', '');

    const ind = $('vIndustry').value;
    const subKey = $('vSubsector').value;
    const subList = SUBSECTORS[ind];
    const sub = subList ? subList.find(s => s.id === subKey) : null;
    const multRange = sub ? sub.mult : MULT[ind];
    const margin = sub ? sub.margin : MARGIN[ind];
    const subName = sub ? sub.name : NAMES[ind];

    const rev = parseMoney($('vRevenue').value);
    let prof = parseMoney($('vProfit').value);
    let estimated = false;
    if (!prof && rev) { prof = Math.round(rev * margin); estimated = true; }

    // An owner who reported SDE handed us a number that still pays them. Buyers
    // price the business without the owner in it, so a market manager's salary
    // comes out before any multiple touches it. The estimated path skips this:
    // MARGIN is already an EBITDA margin, so the salary is spoken for.
    const ownerPayRemoved = (!estimated && $('vProfitBasis').value === 'includesOwnerPay')
      ? replacementSalary(rev || Math.round(prof / margin))
      : 0;
    prof = prof - ownerPayRemoved;

    // Once a manager is paid there is nothing left to put a multiple on. Saying
    // that plainly beats printing a range built on zero or a negative number.
    const belowManagerPay = prof <= 0;

    // Very large businesses get a closer look, not a guess.
    const bigDeal = prof >= 12e6 || rev >= 12e7;
    const showRange = !bigDeal && !belowManagerPay;

    const adj = sizeAdj(prof) + OWNER_ADJ[$('vOwner').value] + GROWTH_ADJ[$('vGrowth').value] +
                CONC_ADJ[$('vConc').value] + REC_ADJ[$('vRec').value];
    const lowX = Math.max(2.0, multRange[0] + adj);
    const highX = Math.max(2.5, multRange[1] + adj);
    const low = roundSmart(prof * lowX);
    const high = roundSmart(prof * highX);

    $('valNumbers').style.display = showRange ? 'block' : 'none';
    $('valBigLook').style.display = bigDeal ? 'block' : 'none';
    $('valSmallLook').style.display = (belowManagerPay && !bigDeal) ? 'block' : 'none';

    if (belowManagerPay && !bigDeal) {
      $('valSmallLookMsg').textContent = 'You told us your own pay is still inside that profit figure. Once we ' +
        'set aside about ' + fmt(ownerPayRemoved) + ' to hire someone to do your job, there is not enough left ' +
        'for a multiple to mean anything. That is more common than you would think, and it does not mean the ' +
        'business has no value. It usually means the value sits in the assets, the customer relationships, or ' +
        'the right buyer, rather than in the earnings. Let us look at it properly before you take any number ' +
        'seriously.';
    }

    const profPhrase = estimated
      ? 'an estimated ' + fmt(prof) + ' of annual profit (you left profit blank, so we applied typical margins for ' + subName + ' to your revenue, which makes this a rougher starting point)'
      : ownerPayRemoved
        ? fmt(prof) + ' of annual profit, after setting aside ' + fmt(ownerPayRemoved) + ' to replace what you do ' +
          '(you told us your own pay was still in that number, and buyers price the business without you in it)'
        : 'your ' + fmt(prof) + ' of annual profit';
    $('valNote').textContent = 'Based on a ' + lowX.toFixed(1) + 'x\u2013' + highX.toFixed(1) +
      'x multiple applied to ' + profPhrase + ', adjusted for size, ' +
      'owner involvement, growth, customer concentration, and revenue quality. That is where ' +
      subName + ' are trading today. Where you land inside the range, or above it, ' +
      'depends almost entirely on whether buyers compete for your business.';

    renderBuyers(ind);

    const sel = (id) => { const e = $(id); return e.options[e.selectedIndex].text; };
    const lead = {
      name, email, phone: $('vPhone').value.trim(), website: $('vWebsite').value.trim(),
      state: $('vState').value,
      industry: sel('vIndustry'), subsector: subSel.disabled ? 'N/A' : sel('vSubsector'),
      ownerInvolvement: sel('vOwner'), revenueTrend: sel('vGrowth'),
      customerConcentration: sel('vConc'), revenueType: sel('vRec'),
      revenue: rev, profit: prof, profitEstimated: estimated, oversized: bigDeal,
      // What the owner said about their own pay, and what we took out because of
      // it. Both travel with the lead so the number in the email can be retraced.
      profitBasis: estimated ? 'N/A (estimated from margins)' : sel('vProfitBasis'),
      ownerPayRemoved: ownerPayRemoved,
      belowManagerPay: belowManagerPay,
      estimateLow: low, estimateHigh: high,
      // A consent clause nobody can prove was shown is worth nothing, so the
      // acceptance travels with the lead. TERMS_VERSION pins each submission to
      // the wording that was actually on screen when it was sent.
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: TERMS_VERSION,
      // TCPA prior express written consent. False means return-contact only:
      // the CRM must not dial or text those, or this field just documents that
      // we knew and did it anyway.
      phoneConsent: $('vConsentPhone').checked,
      date: new Date().toISOString(), source: 'valuation-tool'
    };

    // Non-identifying context for GA4. The visitor's name, email, phone and website
    // stay out of analytics entirely: those go to Formspree and nowhere else.
    const leadContext = {
      industry: lead.industry,
      state: lead.state,
      oversized: bigDeal,
      // Oversized businesses, and ones with nothing left after a manager's pay,
      // get no range on screen, so they carry no comparable value here either.
      value: showRange ? Math.round((low + high) / 2) : 0,
      currency: 'USD'
    };

    // Cleared first so a visitor who steps back and resubmits is not left looking
    // at a stale warning from an earlier attempt.
    hideLeadWarning();
    if (LEAD_ENDPOINT) {
      deliverLead(lead, leadContext);
    } else {
      // No endpoint configured means the lead reaches us only if they mail it.
      showLeadWarning();
    }
    track('valuation_complete', leadContext);
    // Leads are deliberately not persisted in the browser. The old write ran on
    // the visitor's machine, not ours, so we could never read it back: pure
    // exposure with no operational value. An owner quietly exploring a sale
    // should not leave their name, revenue and profit on a shared computer.
    // The lead still reaches us via the POST above and the mailto link below.
    clearStoredLeads();

    const subject = 'Valuation inquiry from ' + name;
    const bodyTxt = 'Hi Jack and Connor,\n\nI just used the valuation tool on your site.\n\n' +
      'Name: ' + name + '\nEmail: ' + email + (lead.phone ? '\nPhone: ' + lead.phone : '') +
      (lead.website ? '\nWebsite: ' + lead.website : '') + '\nState: ' + lead.state +
      '\nIndustry: ' + lead.industry + '\nSubsector: ' + lead.subsector +
      '\nOwner involvement: ' + lead.ownerInvolvement +
      '\nRevenue trend: ' + lead.revenueTrend + '\nLargest customer: ' + lead.customerConcentration +
      '\nRevenue type: ' + lead.revenueType + '\nAnnual revenue: ' + fmt(rev) +
      '\nAnnual profit: ' + fmt(prof) + (estimated ? ' (estimated from margins)' : '') +
      '\nOwn pay still in that number: ' + lead.profitBasis +
      (ownerPayRemoved ? '\nManager salary set aside: ' + fmt(ownerPayRemoved) : '') +
      '\nEstimated range: ' + (bigDeal
        ? 'needs a closer look, large business'
        : belowManagerPay
          ? 'nothing left to price once a manager is paid'
          : fmt(low) + ' to ' + fmt(high)) +
      '\n\nI\u2019d like to talk about what a real number could look like.';
    $('valEmailLink').setAttribute('href',
      'mailto:jack@saltcreekadvisory.com?cc=connor@saltcreekadvisory.com&subject=' +
      encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyTxt));

    showStep(4);
    if (showRange) {
      countUp($('valLow'), low, 1200);
      countUp($('valHigh'), high, 1400);
    }
  });
})();
