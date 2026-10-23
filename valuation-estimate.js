(function () {
  // The valuation tool's pricing, kept apart from the page so it can be tested.
  //
  // Everything here is pure: the arithmetic that turns an owner's answers into
  // a range, and the figures the lead carries. The tables it reads live in
  // valuation-tables.js; the words on the result screen are built from what
  // this returns, in valuation-explain.js. Nothing reads the page, so Node can
  // load this file and check every figure the tool shows.
  //
  // There are two ways a business gets priced, as there are in the market:
  //   - Small businesses sell mostly to individuals who will run them, so they
  //     are priced on owner earnings (SDE: profit with the owner's pay in it).
  //   - Larger ones sell to buyers who will hire a manager, so they are priced
  //     on EBITDA after a market salary for whoever replaces the owner.
  // Below $300,000 of SDE the tool uses SDE alone; from $750,000 up, EBITDA
  // alone; in between, a straight-line blend of the two, so nobody falls off a
  // cliff between methods.
  const T = (typeof module === 'object' && module.exports)
    ? require('./valuation-tables.js') : window.SCValuationTables;
  const {
    deepFreeze, MULT, NAMES, MARGIN, MANAGER_SALARY, SUBSECTORS, SDE_MULT, SDE_SUBSECTORS,
    ANSWER_KEYS, ADJUSTMENTS, SIZE_POINTS, SDE_SIZE_POINTS, SIZE_WHY
  } = T;

  // The lowest multiples the tool will show for a profitable business, on
  // each path, and the size past which it gives a conversation, not a number.
  const MIN_LOW_MULTIPLE = 2.0;
  const MIN_HIGH_MULTIPLE = 2.5;
  const SDE_MIN_LOW_MULTIPLE = 1.0;
  const SDE_MIN_HIGH_MULTIPLE = 1.5;
  const BIG_DEAL_PROFIT = 12e6;
  const BIG_DEAL_REVENUE = 12e7;

  // Where the small-business path ends. The window follows advisers who put
  // the switch from SDE to EBITDA somewhere below about $1 million of earnings.
  const SDE_ONLY_BELOW = 300000;
  const EBITDA_FROM = 750000;
  // On the SDE path each answer counts for this share of its EBITDA-path
  // weight: SDE multiples are smaller numbers, and a full swing would overstate
  // what an answer does to a small business's price.
  const SDE_ANSWER_WEIGHT = 0.4;
  // A blank profit is turned into owner earnings only for businesses this
  // small, and never above this share of revenue.
  const ESTIMATE_SDE_BELOW_REVENUE = 1e6;
  const SDE_REVENUE_CAP = 0.35;
  const SMALL_BUSINESS_PREFIX = 'Small business (SDE path): ';

  const MINUS = '−';
  const EN_DASH = ' – ';

  /**
   * True when a plain table object has its own entry for key, so a value like
   * "constructor" from a tampered form never reads something off the prototype.
   * @param {Object} table a lookup table
   * @param {string} key the key asked for
   * @returns {boolean}
   */
  function hasKey(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key);
  }

  /**
   * Market pay for whoever the buyer hires to do the owner's job.
   * @param {number} revenue annual revenue, used as the size proxy
   * @returns {number} replacement salary in dollars
   */
  function replacementSalary(revenue) {
    const tier = MANAGER_SALARY.find((entry) => revenue < entry[0]);
    return tier[1];
  }

  /**
   * A value rounded to hundredths, half away from zero, so a negative and a
   * positive adjustment of the same size always look the same size.
   * @param {number} value
   * @returns {number}
   */
  function toHundredths(value) {
    const rounded = Math.sign(value) * Math.round(Math.abs(value) * 100 + 1e-9) / 100;
    return rounded === 0 ? 0 : rounded;
  }

  /**
   * A straight line between neighbouring points, flat beyond the first and last.
   * @param {ReadonlyArray<number[]>} points [x, y] pairs in rising x
   * @param {number} x
   * @returns {number}
   */
  function interpolate(points, x) {
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    const i = points.findIndex((point) => x < point[0]);
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  /**
   * How far size moves the EBITDA multiple, in turns of earnings.
   * @param {number} profit earnings after any manager's salary
   * @returns {number} in hundredths
   */
  function sizeAdj(profit) {
    return toHundredths(interpolate(SIZE_POINTS, profit));
  }

  /**
   * How far size moves the SDE multiple, in turns of owner earnings.
   * @param {number} sde owner earnings
   * @returns {number} in hundredths
   */
  function sdeSizeAdj(sde) {
    return toHundredths(interpolate(SDE_SIZE_POINTS, sde));
  }

  /**
   * Why size moves the EBITDA multiple the way it does at this level.
   * @param {number} profit earnings after any manager's salary
   * @returns {string}
   */
  function sizeWhy(profit) {
    const adj = sizeAdj(profit);
    if (adj === 0) return SIZE_WHY.baseline;
    if (adj < 0) return profit < 375000 ? SIZE_WHY.tiny : SIZE_WHY.small;
    if (profit >= 5e6) return SIZE_WHY.fiveMillion;
    if (profit >= 2e6) return SIZE_WHY.twoMillion;
    return profit >= 1e6 ? SIZE_WHY.million : SIZE_WHY.nearMillion;
  }

  /**
   * Why size moves the SDE multiple the way it does at this level.
   * @param {number} sde owner earnings
   * @returns {string}
   */
  function sdeSizeWhy(sde) {
    if (sdeSizeAdj(sde) === 0) return SIZE_WHY.sdeBaseline;
    return sde < 75000 ? SIZE_WHY.sdeTiny : SIZE_WHY.sdeSmall;
  }

  /**
   * The step a figure is rounded to, so a range never looks more precise than
   * an estimate can be.
   * @param {number} value a dollar figure
   * @returns {number} 25,000, 100,000 or 500,000
   */
  function roundingStep(value) {
    return value >= 1e7 ? 5e5 : value >= 1e6 ? 1e5 : 2.5e4;
  }

  /**
   * A dollar figure rounded to its step. Whole dollars first, so a value that
   * is exactly half a step apart from float noise still rounds up.
   * @param {number} value a dollar figure
   * @returns {number}
   */
  function roundSmart(value) {
    const step = roundingStep(value);
    return Math.round(Math.round(value) / step) * step;
  }

  /**
   * Whole dollars from whatever the visitor typed, or 0 for nothing usable.
   * @param {string} value raw field text such as "$1,250,000"
   * @returns {number}
   */
  function parseMoney(value) {
    const digits = String(value).replace(/[^0-9.]/g, '');
    return digits ? Math.round(parseFloat(digits)) : 0;
  }

  /**
   * A dollar figure as the page shows it, such as "$1,250,000".
   * @param {number} n dollars
   * @returns {string}
   */
  function fmt(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  /**
   * A dollar figure with a true minus sign when negative, which screen readers
   * read as "minus" where a hyphen is often skipped.
   * @param {number} n dollars
   * @returns {string}
   */
  function formatSignedMoney(n) {
    return (n < 0 ? MINUS : '') + fmt(Math.abs(n));
  }

  /**
   * A multiple to two places, dropping one trailing zero: 6.01x, 6.5x, 2.0x.
   * Two places because the adjustments are in hundredths, and a breakdown that
   * shows 6.05x must not sit under a note that says 6.0x.
   * @param {number} x a multiple
   * @returns {string}
   */
  function formatMultiple(x) {
    const fixed = x.toFixed(2);
    return (fixed.endsWith('0') ? fixed.slice(0, -1) : fixed) + 'x';
  }

  /**
   * A low and high multiple as one range, such as "4.5x – 7.0x".
   * @param {number[]} range [low, high]
   * @returns {string}
   */
  function formatRange(range) {
    return formatMultiple(range[0]) + EN_DASH + formatMultiple(range[1]);
  }

  /**
   * One answer's adjustment with its sign, or "No change" for zero.
   * @param {number} adj turns of earnings
   * @returns {string}
   */
  function formatAdjustment(adj) {
    if (adj === 0) return 'No change';
    return (adj > 0 ? '+' : MINUS) + formatMultiple(Math.abs(adj));
  }

  /**
   * The lowest low and highest high across an industry's subsectors, which is
   * how wide the tool's starting ranges get once a niche is picked.
   * @param {string} industry an industry key
   * @returns {number[]|null} [low, high], or null when it has no subsectors
   */
  function subsectorSpan(industry) {
    const list = hasKey(SUBSECTORS, industry) ? SUBSECTORS[industry] : null;
    if (!list) return null;
    return [Math.min(...list.map((s) => s.mult[0])), Math.max(...list.map((s) => s.mult[1]))];
  }

  /**
   * The EBITDA multiple range, margin and name to price against: the
   * subsector's when one was picked and matched, otherwise the industry's.
   * @param {string} industry an industry key
   * @param {string} subsectorId a subsector id, '_other', or ''
   * @returns {{multRange: number[], margin: number, subName: string, subsectorMatched: boolean}}
   */
  function resolvePricingBasis(industry, subsectorId) {
    if (!hasKey(MULT, industry)) throw new Error('Unknown industry: ' + industry);
    const list = hasKey(SUBSECTORS, industry) ? SUBSECTORS[industry] : null;
    const sub = list ? list.find((s) => s.id === subsectorId) : null;
    if (sub) return { multRange: sub.mult, margin: sub.margin, subName: sub.name, subsectorMatched: true };
    return { multRange: MULT[industry], margin: MARGIN[industry], subName: NAMES[industry], subsectorMatched: false };
  }

  /**
   * The SDE multiple range for an industry and niche, falling back to the
   * industry's own and then to the all-industry range.
   * @param {string} industry an industry key
   * @param {string} subsectorId a matched subsector id, or ''
   * @returns {ReadonlyArray<number>} [low, high]
   */
  function sdeRange(industry, subsectorId) {
    return sdeBasis(industry, subsectorId).range;
  }

  /**
   * The SDE range and the level it was published at: 'subsector' when the
   * niche has its own, 'industry' when the industry does, '_all' when neither
   * does and the all-industry range stands in. The words on the result screen
   * name the level, so they never claim a niche figure that was not used.
   * @param {string} industry an industry key
   * @param {string} subsectorId a matched subsector id, or ''
   * @returns {{range: ReadonlyArray<number>, level: string}}
   */
  function sdeBasis(industry, subsectorId) {
    const subs = hasKey(SDE_SUBSECTORS, industry) ? SDE_SUBSECTORS[industry] : null;
    if (subs && subsectorId && hasKey(subs, subsectorId)) return { range: subs[subsectorId], level: 'subsector' };
    if (hasKey(SDE_MULT, industry)) return { range: SDE_MULT[industry], level: 'industry' };
    return { range: SDE_MULT._all, level: '_all' };
  }

  /**
   * The earnings an EBITDA buyer would price.
   *
   * An owner who reported SDE handed us a number that still pays them. Buyers
   * who will hire a manager price the business without the owner in it, so a
   * market manager's salary comes out before any multiple touches it. The
   * estimated path skips this: MARGIN is already an EBITDA margin.
   * @param {number} revenue annual revenue, 0 if blank
   * @param {number} profit annual profit as entered, 0 if blank
   * @param {string} profitBasis 'includesOwnerPay', 'excludesOwnerPay' or ''
   * @param {number} margin the margin to estimate profit with
   * @returns {{reportedProfit: number, estimated: boolean, ownerPayRemoved: number, prof: number}}
   */
  function earningsBasis(revenue, profit, profitBasis, margin) {
    const estimated = !profit && Boolean(revenue);
    const reportedProfit = estimated ? Math.round(revenue * margin) : profit;
    const ownerPayRemoved = (!estimated && profitBasis === 'includesOwnerPay')
      ? replacementSalary(revenue || Math.round(reportedProfit / margin))
      : 0;
    return { reportedProfit, estimated, ownerPayRemoved, prof: reportedProfit - ownerPayRemoved };
  }

  /**
   * Owner earnings (SDE): what the business pays the person who runs it.
   *
   * Reported with the owner's pay in it, that is the figure itself. Reported
   * without it, a typical owner's salary goes back in, but never more than
   * revenue minus profit: the owner can only have been paid out of what the
   * business spent, so owner earnings never exceed revenue. Left blank, it is
   * estimated only for a business under $1 million of revenue, as profit at a
   * typical margin plus a typical salary, capped at 35% of revenue so a tiny
   * business is never credited with more than it could plausibly earn. A
   * profit typed with no answer to the pay question is read as excluding it,
   * as the EBITDA path always has.
   * @param {Object} inputs the owner's answers, money in dollars
   * @param {number} margin the margin profit was estimated with
   * @param {Object} earnings from earningsBasis
   * @returns {{sde: number|null, sdeSource: string|null, ownerPayAddedBack: number, sdeCapped: boolean, payAddBackCapped: boolean}}
   */
  function ownerEarnings(inputs, margin, earnings) {
    if (earnings.estimated) {
      if (inputs.revenue >= ESTIMATE_SDE_BELOW_REVENUE) {
        return { sde: null, sdeSource: null, ownerPayAddedBack: 0, sdeCapped: false, payAddBackCapped: false };
      }
      const uncapped = earnings.reportedProfit + replacementSalary(inputs.revenue);
      const cap = Math.round(inputs.revenue * SDE_REVENUE_CAP);
      return { sde: Math.min(uncapped, cap), sdeSource: 'estimated', ownerPayAddedBack: 0, sdeCapped: cap < uncapped, payAddBackCapped: false };
    }
    if (inputs.profitBasis === 'includesOwnerPay') {
      return { sde: inputs.profit, sdeSource: 'reported', ownerPayAddedBack: 0, sdeCapped: false, payAddBackCapped: false };
    }
    const typical = replacementSalary(inputs.revenue || Math.round(inputs.profit / margin));
    // Without a revenue figure there is nothing to bound the salary by.
    const room = inputs.revenue ? Math.max(0, inputs.revenue - inputs.profit) : typical;
    const added = Math.min(typical, room);
    return {
      sde: inputs.profit + added, sdeSource: 'addedBack', ownerPayAddedBack: added,
      sdeCapped: false, payAddBackCapped: added < typical
    };
  }

  /**
   * Which way the business is priced, from its owner earnings.
   * @param {number|null} sde owner earnings, or null when none were worked out
   * @returns {string} 'ebitda', 'blend', 'sde' or 'none'
   */
  function pricingMethod(sde) {
    if (sde === null || sde >= EBITDA_FROM) return 'ebitda';
    if (sde <= 0) return 'none';
    return sde < SDE_ONLY_BELOW ? 'sde' : 'blend';
  }

  /**
   * Size plus each answer's adjustment, in the order they are summed. On the
   * SDE path each answer is scaled and kept in hundredths, so the breakdown's
   * column still adds up to the multiple it shows.
   * @param {Object} answers the owner's four answers, keyed as ANSWER_KEYS
   * @param {number} size the size adjustment for this path
   * @param {number} weight 1 on the EBITDA path, SDE_ANSWER_WEIGHT on the SDE path
   * @returns {ReadonlyArray<{key: string, answer: string|null, adj: number}>}
   */
  function answerAdjustments(answers, size, weight) {
    const rest = ANSWER_KEYS.map((key) => {
      const answer = answers[key];
      if (!hasKey(ADJUSTMENTS[key], answer)) throw new Error('Unknown ' + key + ' answer: ' + answer);
      const raw = ADJUSTMENTS[key][answer];
      return Object.freeze({ key, answer, adj: weight === 1 ? raw : toHundredths(raw * weight) });
    });
    return Object.freeze([Object.freeze({ key: 'size', answer: null, adj: size })].concat(rest));
  }

  /**
   * True when a raw multiple really sits below its minimum. Compared in
   * hundredths because adding decimal adjustments in floating point can land a
   * hair under a minimum it actually equals (1.9999999999999998 for 2.0), and
   * that noise must not show the owner a minimum-multiple line.
   * @param {number} raw the multiple before the minimum is applied
   * @param {number} minimum the lowest multiple the tool shows
   * @returns {boolean} whether the minimum actually lifted the multiple
   */
  function isBelowMinimum(raw, minimum) {
    return Math.round(raw * 100) < Math.round(minimum * 100);
  }

  /**
   * One method's pricing: a starting range moved by size and the answers,
   * held at its minimums, times the earnings it applies to. The multiples are
   * snapped to hundredths, which every input is in, so float noise such as
   * 3.8499999999999996 cannot make one end round the other way from the
   * breakdown's own "earnings × multiple" line.
   * @param {{earnings: number, multRange: ReadonlyArray<number>, adjustments: ReadonlyArray,
   *   minLow: number, minHigh: number}} spec
   * @returns {Readonly<Object>} a frozen leg
   */
  function priceLeg(spec) {
    const adjTotal = spec.adjustments.reduce((sum, a) => sum + a.adj, 0);
    const lowXRaw = spec.multRange[0] + adjTotal;
    const highXRaw = spec.multRange[1] + adjTotal;
    const lowX = toHundredths(Math.max(spec.minLow, lowXRaw));
    const highX = toHundredths(Math.max(spec.minHigh, highXRaw));
    return Object.freeze(Object.assign({}, spec, {
      adjTotal, lowXRaw, highXRaw, lowX, highX,
      lowClamped: isBelowMinimum(lowXRaw, spec.minLow),
      highClamped: isBelowMinimum(highXRaw, spec.minHigh),
      exactLow: spec.earnings * lowX, exactHigh: spec.earnings * highX
    }));
  }

  /**
   * The SDE leg, or null when the business is not priced on owner earnings.
   * @param {Object} inputs the owner's answers
   * @param {Object} basis from resolvePricingBasis
   * @param {number} sde owner earnings
   * @param {string} method from pricingMethod
   * @returns {Readonly<Object>|null}
   */
  function sdeLegFor(inputs, basis, sde, method) {
    if (method !== 'sde' && method !== 'blend') return null;
    const sdeSource = sdeBasis(inputs.industry, basis.subsectorMatched ? inputs.subsector : '');
    return priceLeg({
      earnings: sde, multRange: sdeSource.range, level: sdeSource.level,
      adjustments: answerAdjustments(inputs, sdeSizeAdj(sde), SDE_ANSWER_WEIGHT),
      minLow: SDE_MIN_LOW_MULTIPLE, minHigh: SDE_MIN_HIGH_MULTIPLE
    });
  }

  /**
   * How much of the range comes from the EBITDA method: 0 on the SDE path, 1
   * on the EBITDA path, and in the window, how far owner earnings sit across it.
   * @param {string} method from pricingMethod
   * @param {number|null} sde owner earnings
   * @returns {number} 0 to 1
   */
  function ebitdaWeightFor(method, sde) {
    if (method === 'blend') return (sde - SDE_ONLY_BELOW) / (EBITDA_FROM - SDE_ONLY_BELOW);
    return method === 'ebitda' ? 1 : 0;
  }

  /**
   * Prices the owner's answers. This is the whole estimate: everything the
   * result screen and the lead show is read from what this returns.
   *
   * Low and high are computed even when no range will be shown for a very
   * large business, because Jack reads them when following up; the lead itself
   * leaves them blank (leadFigures).
   * @param {Object} inputs {industry, subsector, revenue, profit, profitBasis,
   *   owner, growth, concentration, revenueType}; money already parsed to dollars
   * @returns {Readonly<Object>} a new frozen estimate
   */
  function computeEstimate(inputs) {
    const basis = resolvePricingBasis(inputs.industry, inputs.subsector);
    const earnings = earningsBasis(inputs.revenue, inputs.profit, inputs.profitBasis, basis.margin);
    const owner = ownerEarnings(inputs, basis.margin, earnings);
    const method = pricingMethod(owner.sde);
    const ebitdaLeg = priceLeg({
      earnings: earnings.prof, multRange: basis.multRange,
      adjustments: answerAdjustments(inputs, sizeAdj(earnings.prof), 1),
      minLow: MIN_LOW_MULTIPLE, minHigh: MIN_HIGH_MULTIPLE
    });
    const sdeLeg = sdeLegFor(inputs, basis, owner.sde, method);
    const w = ebitdaWeightFor(method, owner.sde);
    const priced = method !== 'none';
    const exactLow = !priced ? 0 : sdeLeg ? (1 - w) * sdeLeg.exactLow + w * ebitdaLeg.exactLow : ebitdaLeg.exactLow;
    const exactHigh = !priced ? 0 : sdeLeg ? (1 - w) * sdeLeg.exactHigh + w * ebitdaLeg.exactHigh : ebitdaLeg.exactHigh;
    const low = roundSmart(exactLow);
    const high = roundSmart(exactHigh);
    // A tiny business can round to "$0 – $0" or a range with no width. That is
    // no range at all, so it gets the warm no-range screen instead.
    const hasRange = low > 0 && high > low;
    // A business priced on EBITDA with nothing left once a manager is paid has
    // nothing to put a multiple on, and very large ones get a closer look.
    const belowManagerPay = method === 'ebitda' && earnings.prof <= 0;
    const bigDeal = earnings.prof >= BIG_DEAL_PROFIT || inputs.revenue >= BIG_DEAL_REVENUE;
    return Object.freeze(Object.assign({ industry: inputs.industry, revenue: inputs.revenue }, basis, earnings, owner, {
      method, ebitdaWeight: w, ebitdaLeg, sdeLeg, exactLow, exactHigh, low, high,
      midpoint: Math.round((low + high) / 2),
      belowManagerPay, bigDeal, showRange: priced && hasRange && !bigDeal && !belowManagerPay
    }));
  }

  /**
   * The figures a lead carries. Field names are the CRM's and never change.
   *
   * profit is what the owner typed, or the estimate when they left it blank.
   * profitAfterManagerPay never goes below zero: below zero only ever meant
   * "nothing left", and the CRM read the minus sign as a loss. When no range
   * was shown the estimate fields are blank, so nobody follows up on a number
   * the owner never saw.
   * @param {Object} est an estimate from computeEstimate
   * @returns {Readonly<Object>}
   */
  function leadFigures(est) {
    const rangeShown = est.showRange;
    return Object.freeze({
      revenue: est.revenue, profit: est.reportedProfit, profitEstimated: est.estimated,
      profitAfterManagerPay: Math.max(0, est.prof),
      sde: est.sde === null ? '' : est.sde,
      ownerPayRemoved: (est.method === 'ebitda' || est.method === 'blend') ? est.ownerPayRemoved : 0,
      belowManagerPay: est.belowManagerPay, oversized: est.bigDeal,
      valuationMethod: rangeShown ? est.method : 'none', rangeShown,
      estimateLow: rangeShown ? est.low : '', estimateHigh: rangeShown ? est.high : ''
    });
  }

  /**
   * Put in front of the lead email's subject when the small-business path was
   * used, so Jack can see at a glance which leads need the referral answer.
   * @param {Object} est an estimate from computeEstimate
   * @returns {string} the prefix, or ''
   */
  function leadSubjectPrefix(est) {
    // A very large business is never the small-business lead, whatever its profit.
    if (est.bigDeal) return '';
    const small = est.method === 'sde' || est.method === 'blend' || (est.method === 'none' && est.sde !== null);
    return small ? SMALL_BUSINESS_PREFIX : '';
  }

  const api = deepFreeze({
    MULT, NAMES, MARGIN, SUBSECTORS, SDE_MULT, SDE_SUBSECTORS, ADJUSTMENTS, SIZE_POINTS, SDE_SIZE_POINTS,
    LIMITS: {
      MIN_LOW_MULTIPLE, MIN_HIGH_MULTIPLE, SDE_MIN_LOW_MULTIPLE, SDE_MIN_HIGH_MULTIPLE,
      SDE_ONLY_BELOW, EBITDA_FROM, SDE_ANSWER_WEIGHT, SDE_REVENUE_CAP
    },
    replacementSalary, sizeAdj, sdeSizeAdj, sizeWhy, sdeSizeWhy, roundingStep, roundSmart, parseMoney, fmt,
    formatMultiple, formatRange, formatAdjustment, formatSignedMoney, subsectorSpan, sdeRange, sdeBasis,
    resolvePricingBasis, computeEstimate, leadFigures, leadSubjectPrefix
  });

  // Node loads this file to test it; the page reads it from window.
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  window.SCValuationMath = api;
})();
