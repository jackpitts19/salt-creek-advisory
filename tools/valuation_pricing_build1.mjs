// The pricing tables exactly as Build 1 shipped them (the version before the
// small-business path and the October 2026 sources pass). Generated once from
// that version of valuation-estimate.js and never edited by hand.
//
// test_valuation_estimate.mjs diffs the live tables against these, so any
// multiple, margin, label or name that changes has to be named in that test's
// allow-list. Everything not on the list must stay byte-identical.

export const BUILD1_MULT = Object.freeze({
  "ece": [3.5,6],
  "services": [4.5,7],
  "homeservices": [4.5,7.5],
  "facilities": [4,6.5],
  "manufacturing": [4.5,6.5],
  "distribution": [4.5,6.5],
  "construction": [3.5,5.5],
  "healthcare": [5,7.5],
  "insurance": [7,10],
  "itservices": [5,8],
  "software": [6,10],
  "professional": [4,6.5],
  "agency": [4,6],
  "transport": [3.5,5.5],
  "auto": [4.5,7],
  "consumer": [3,4.5],
  "restaurants": [2.5,4],
  "ecommerce": [3,5],
  "other": [3.5,5.5]
});

export const BUILD1_MARGIN = Object.freeze({
  "ece": 0.18,
  "services": 0.15,
  "homeservices": 0.12,
  "facilities": 0.12,
  "manufacturing": 0.12,
  "distribution": 0.07,
  "construction": 0.1,
  "healthcare": 0.15,
  "insurance": 0.25,
  "itservices": 0.15,
  "software": 0.25,
  "professional": 0.2,
  "agency": 0.15,
  "transport": 0.08,
  "auto": 0.2,
  "consumer": 0.1,
  "restaurants": 0.12,
  "ecommerce": 0.1,
  "other": 0.12
});

export const BUILD1_NAMES = Object.freeze({
  "ece": "early childhood education",
  "services": "business services",
  "homeservices": "home services",
  "facilities": "facility services and landscaping",
  "manufacturing": "manufacturing",
  "distribution": "distribution and logistics",
  "construction": "construction",
  "healthcare": "healthcare services",
  "insurance": "insurance agency",
  "itservices": "IT services",
  "software": "software and technology",
  "professional": "professional services",
  "agency": "agency",
  "transport": "transportation",
  "auto": "auto services",
  "consumer": "consumer",
  "restaurants": "restaurant and food service",
  "ecommerce": "e-commerce",
  "other": "comparable"
});

export const BUILD1_SUBSECTORS = Object.freeze({
  "ece": [
    {"id":"independent","label":"Single-Site Independent Preschool / Daycare","mult":[3,5],"margin":0.15,"name":"single-site preschools and daycares"},
    {"id":"multisite","label":"Multi-Site Regional Preschool Group","mult":[4,6.5],"margin":0.18,"name":"multi-site preschool groups"},
    {"id":"franchise","label":"Franchise-Affiliated Childcare Center","mult":[3.5,5.5],"margin":0.16,"name":"franchise-affiliated childcare centers"},
    {"id":"specialty","label":"Specialty (Montessori, Bilingual, Special Needs)","mult":[4,7],"margin":0.2,"name":"specialty early education providers"}
  ],
  "services": [
    {"id":"staffing","label":"Staffing / Recruiting","mult":[3.5,5.5],"margin":0.1,"name":"staffing and recruiting firms"},
    {"id":"outsourced","label":"Outsourced Back-Office (Payroll, HR, BPO)","mult":[5.5,8.5],"margin":0.18,"name":"outsourced back-office providers"},
    {"id":"inspection","label":"Environmental / Testing / Inspection","mult":[5,7.5],"margin":0.18,"name":"environmental, testing, and inspection firms"},
    {"id":"security","label":"Security Services","mult":[4,6],"margin":0.1,"name":"security services firms"}
  ],
  "homeservices": [
    {"id":"hvac","label":"HVAC (Residential)","mult":[5,8],"margin":0.13,"name":"residential HVAC companies"},
    {"id":"plumbing","label":"Plumbing","mult":[4.5,7.5],"margin":0.12,"name":"plumbing companies"},
    {"id":"electrical","label":"Electrical","mult":[4.5,7.5],"margin":0.12,"name":"electrical contractors"},
    {"id":"multitrade","label":"Multi-Trade / Combo Shop","mult":[5,8.5],"margin":0.13,"name":"multi-trade home services companies"},
    {"id":"pest","label":"Pest Control","mult":[5.5,9],"margin":0.2,"name":"pest control companies"}
  ],
  "facilities": [
    {"id":"landscapemaint","label":"Commercial Landscape Maintenance","mult":[4.5,7],"margin":0.13,"name":"commercial landscape maintenance companies"},
    {"id":"landscapedb","label":"Landscape Design / Build","mult":[3.5,5.5],"margin":0.1,"name":"landscape design/build companies"},
    {"id":"janitorial","label":"Janitorial / Commercial Cleaning","mult":[4,6.5],"margin":0.1,"name":"janitorial and commercial cleaning companies"},
    {"id":"exterior","label":"Snow Removal / Exterior Services","mult":[3.5,5.5],"margin":0.12,"name":"snow removal and exterior services companies"}
  ],
  "manufacturing": [
    {"id":"machining","label":"Precision Machining / Metal Fabrication","mult":[4.5,7],"margin":0.14,"name":"precision machining and metal fabrication shops"},
    {"id":"contract","label":"Contract / OEM Manufacturing","mult":[4,6],"margin":0.1,"name":"contract and OEM manufacturers"},
    {"id":"foodbev","label":"Food & Beverage Manufacturing","mult":[5,7.5],"margin":0.12,"name":"food and beverage manufacturers"},
    {"id":"buildingproducts","label":"Building Products Manufacturing","mult":[4.5,6.5],"margin":0.12,"name":"building products manufacturers"},
    {"id":"plastics","label":"Plastics / Injection Molding","mult":[4.5,6.5],"margin":0.13,"name":"plastics and injection molding companies"}
  ],
  "distribution": [
    {"id":"wholesale","label":"Wholesale Distribution (Durable Goods)","mult":[4.5,6.5],"margin":0.07,"name":"wholesale distributors"},
    {"id":"foodbevdist","label":"Food & Beverage Distribution","mult":[4,6],"margin":0.06,"name":"food and beverage distributors"},
    {"id":"industrial","label":"Industrial / MRO Distribution","mult":[5,7],"margin":0.09,"name":"industrial and MRO distributors"},
    {"id":"logistics","label":"3PL / Warehousing & Logistics","mult":[5,7.5],"margin":0.1,"name":"3PL and warehousing companies"}
  ],
  "construction": [
    {"id":"general","label":"General Contracting","mult":[3,5],"margin":0.08,"name":"general contractors"},
    {"id":"specialty","label":"Specialty Mechanical / Electrical Contracting","mult":[4,6],"margin":0.1,"name":"specialty mechanical and electrical contractors"},
    {"id":"roofing","label":"Roofing","mult":[4,6.5],"margin":0.12,"name":"roofing companies"},
    {"id":"civil","label":"Civil / Infrastructure","mult":[3.5,5.5],"margin":0.09,"name":"civil and infrastructure contractors"}
  ],
  "healthcare": [
    {"id":"dental","label":"Dental Practice","mult":[5.5,8.5],"margin":0.2,"name":"dental practices"},
    {"id":"homehealth","label":"Home Health / Home Care","mult":[5.5,8],"margin":0.13,"name":"home health and home care agencies"},
    {"id":"behavioral","label":"Behavioral Health / Therapy","mult":[5.5,8.5],"margin":0.15,"name":"behavioral health and therapy practices"},
    {"id":"pt","label":"Physical / Occupational Therapy","mult":[5,7.5],"margin":0.15,"name":"physical and occupational therapy clinics"},
    {"id":"medpractice","label":"Medical Practice (Non-Dental)","mult":[5,7.5],"margin":0.18,"name":"medical practices"},
    {"id":"veterinary","label":"Veterinary","mult":[6,9],"margin":0.2,"name":"veterinary practices"}
  ],
  "insurance": [
    {"id":"personal","label":"Personal Lines Agency","mult":[6,8.5],"margin":0.22,"name":"personal lines agencies"},
    {"id":"commercial","label":"Commercial P&C Agency","mult":[7.5,10.5],"margin":0.28,"name":"commercial P&C agencies"},
    {"id":"benefits","label":"Employee Benefits Brokerage","mult":[7.5,10.5],"margin":0.28,"name":"employee benefits brokerages"},
    {"id":"mga","label":"MGA / Specialty Program","mult":[8,11],"margin":0.25,"name":"MGAs and specialty program businesses"}
  ],
  "itservices": [
    {"id":"msp","label":"Managed Service Provider (MSP)","mult":[5.5,8.5],"margin":0.17,"name":"managed service providers"},
    {"id":"cyber","label":"Cybersecurity Services","mult":[6.5,9.5],"margin":0.18,"name":"cybersecurity services firms"},
    {"id":"itstaffing","label":"IT Staffing / Consulting","mult":[4,6.5],"margin":0.1,"name":"IT staffing and consulting firms"},
    {"id":"cloud","label":"Cloud / Infrastructure Services","mult":[5.5,8.5],"margin":0.16,"name":"cloud and infrastructure services firms"}
  ],
  "software": [
    {"id":"verticalsaas","label":"Vertical SaaS","mult":[7,11],"margin":0.28,"name":"vertical SaaS companies"},
    {"id":"onprem","label":"On-Premise / Legacy Licensed Software","mult":[4.5,7],"margin":0.22,"name":"on-premise and legacy licensed software companies"},
    {"id":"fintech","label":"Fintech / Payments Software","mult":[6.5,10.5],"margin":0.25,"name":"fintech and payments software companies"},
    {"id":"devtools","label":"Dev Tools / Infrastructure Software","mult":[6.5,10.5],"margin":0.22,"name":"dev tools and infrastructure software companies"}
  ],
  "professional": [
    {"id":"accounting","label":"Accounting / CPA Firm","mult":[5,7.5],"margin":0.25,"name":"accounting and CPA firms"},
    {"id":"engineering","label":"Engineering Firm","mult":[5,7.5],"margin":0.18,"name":"engineering firms"},
    {"id":"consulting","label":"Management Consulting","mult":[4,6.5],"margin":0.2,"name":"management consulting firms"},
    {"id":"architecture","label":"Architecture","mult":[3.5,5.5],"margin":0.15,"name":"architecture firms"}
  ],
  "agency": [
    {"id":"digital","label":"Digital Marketing / Performance","mult":[4,6.5],"margin":0.15,"name":"digital marketing and performance agencies"},
    {"id":"creative","label":"Creative / Branding","mult":[3.5,5.5],"margin":0.14,"name":"creative and branding agencies"},
    {"id":"pr","label":"PR / Communications","mult":[3.5,5.5],"margin":0.14,"name":"PR and communications agencies"},
    {"id":"mediabuying","label":"Media Buying","mult":[4,6],"margin":0.1,"name":"media buying agencies"}
  ],
  "transport": [
    {"id":"truckload","label":"Truckload Carrier","mult":[3,5],"margin":0.07,"name":"truckload carriers"},
    {"id":"ltl","label":"LTL / Regional Carrier","mult":[4,6],"margin":0.08,"name":"LTL and regional carriers"},
    {"id":"specialized","label":"Specialized Freight (Tanker, Flatbed, Refrigerated)","mult":[3.5,5.5],"margin":0.09,"name":"specialized freight carriers"},
    {"id":"brokerage","label":"Freight Brokerage","mult":[4,6.5],"margin":0.06,"name":"freight brokerages"}
  ],
  "auto": [
    {"id":"carwash","label":"Express Car Wash","mult":[6,9],"margin":0.3,"name":"express car wash businesses"},
    {"id":"repair","label":"Auto Repair / Collision","mult":[4,6],"margin":0.16,"name":"auto repair and collision shops"},
    {"id":"quicklube","label":"Quick Lube / Tire","mult":[4.5,6.5],"margin":0.18,"name":"quick lube and tire shops"},
    {"id":"glass","label":"Auto Glass / Detailing","mult":[4,6],"margin":0.15,"name":"auto glass and detailing businesses"}
  ],
  "consumer": [
    {"id":"specialtyretail","label":"Specialty Retail (Brick & Mortar)","mult":[2.5,4],"margin":0.08,"name":"specialty retailers"},
    {"id":"cpg","label":"Consumer Products / CPG Brand","mult":[4,6.5],"margin":0.12,"name":"consumer products brands"},
    {"id":"franchiseretail","label":"Franchise Retail","mult":[3,4.5],"margin":0.1,"name":"franchise retail operators"},
    {"id":"beauty","label":"Beauty / Personal Care Services","mult":[3.5,5.5],"margin":0.15,"name":"beauty and personal care businesses"}
  ],
  "restaurants": [
    {"id":"qsr","label":"Quick Service / Fast Casual (Multi-Unit)","mult":[4,6],"margin":0.15,"name":"multi-unit quick service and fast casual restaurants"},
    {"id":"fullservice","label":"Full Service / Casual Dining","mult":[2,3.5],"margin":0.1,"name":"full service and casual dining restaurants"},
    {"id":"catering","label":"Catering / Institutional Food Service","mult":[3,4.5],"margin":0.1,"name":"catering and institutional food service companies"},
    {"id":"independent","label":"Single High-Performing Independent","mult":[2,3],"margin":0.1,"name":"single-location independent restaurants"}
  ],
  "ecommerce": [
    {"id":"marketplace","label":"Amazon-First / Marketplace Brand","mult":[3,5],"margin":0.15,"name":"marketplace-first e-commerce brands"},
    {"id":"dtc","label":"DTC Brand (Owned Site)","mult":[3.5,5.5],"margin":0.12,"name":"direct-to-consumer brands"},
    {"id":"subscription","label":"Subscription / Consumables Brand","mult":[4.5,7],"margin":0.15,"name":"subscription and consumables brands"},
    {"id":"b2b","label":"B2B E-Commerce","mult":[4,6],"margin":0.1,"name":"B2B e-commerce companies"}
  ]
});

export const BUILD1_ADJUSTMENTS = Object.freeze({
  "owner": {"fullTeamAbsentee":0.5,"gmInPlace":0.28,"teamOpsOwnerRelationships":0.05,"teamOpsOwnerSales":-0.18,"dailyHandsOn":-0.4,"irreplaceableDelivery":-0.62,"allMe":-0.8},
  "growth": {"explosive25plus":0.55,"strong10to25":0.35,"steady3to10":0.18,"unevenGrowth":0,"roughlyFlat":-0.2,"recentDip":-0.42,"multiYearDecline":-0.8},
  "concentration": {"under5":0.3,"five_ten":0.15,"ten_25":0,"twentyfive_40":-0.3,"forty_60":-0.55,"sixty_80":-0.8,"over80":-1},
  "revenueType": {"lockedInContracts":0.55,"autoRenewing":0.35,"repeatNoContract":0.17,"mixedRevenue":0,"oneTimeProject":-0.2,"cyclicalLumpy":-0.4}
});

// [revenue, salary] probed at each tier edge.
export const BUILD1_SALARY_PROBES = Object.freeze([[0,65000],[999999,65000],[1000000,85000],[2999999,85000],[3000000,115000],[6999999,115000],[7000000,150000],[14999999,150000],[15000000,200000],[1000000000000,200000]]);

// [earnings, size adjustment] probed at each step edge. Build 2 smooths the
// steps, but the six values themselves were not changed.
export const BUILD1_SIZE_PROBES = Object.freeze([[-1000000000,-1],[0,-1],[249999,-1],[250000,-0.5],[499999,-0.5],[500000,0],[999999,0],[1000000,0.25],[1999999,0.25],[2000000,0.75],[4999999,0.75],[5000000,1.5],[1000000000000,1.5]]);
