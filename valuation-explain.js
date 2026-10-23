(function () {
  // The words on the valuation tool's result screen, built from an estimate.
  //
  // "How we got your number" walks every step from the owner's profit to the
  // range on screen, on whichever path priced the business. "What's moving
  // your number" ranks the owner's answers by how far each moves the range.
  // Pure, like the pricing it reads: Node loads this file to test that the
  // steps add up and the ranking is right. The page loads it last and reads
  // the whole API from window.SCValuationEstimate.
  const isNode = typeof module === 'object' && module.exports;
  const M = isNode ? require('./valuation-estimate.js') : window.SCValuationMath;
  const T = isNode ? require('./valuation-tables.js') : window.SCValuationTables;
  const { NAMES, SUBSECTORS, LIMITS, fmt, formatMultiple, formatRange, formatAdjustment, formatSignedMoney,
    roundingStep, sizeWhy, sdeSizeWhy } = M;
  const { CATEGORY_NAMES, ANSWER_LABELS, WHY } = T;

  const EN_DASH = ' – ';
  const SDE_PRICED = 'Businesses this size usually sell to an individual who runs it themselves, so buyers price ' +
    'your total owner earnings (SDE) rather than subtracting a manager.';
  // The window between the two paths: some buyers run it, some hire a manager.
  const BLEND_PRICED = 'At this size some buyers will run it themselves and some will hire a manager, so we price ' +
    'it both ways and blend them below.';
  const COMPETE = ' Where you land inside the range, or above it, depends almost entirely on whether buyers ' +
    'compete for your business.';

  // Jack's words for every owner the small-business path prices. A small
  // business never gets a dead end: harder to sell is not impossible to sell.
  const SMALL_BUSINESS_NOTE = 'Businesses this size are harder to sell: most buyers are individuals, and ' +
    'financing is tighter. We’d still love to talk. If we’re not the right fit, we work with referral ' +
    'partners and are glad to point you somewhere good.';
  // Shown when the owner says they own the property the business runs from.
  const REAL_ESTATE_NOTE = 'You own the real estate, so it is valued separately, on top of this range, and it ' +
    'could add meaningful value. If the business pays you below-market rent, or none, a buyer will adjust ' +
    'profit for market rent, so expect that to be part of the conversation.';

  /**
   * One line of the breakdown, frozen.
   * @param {string} term what the line is
   * @param {string} value its figure
   * @param {string} detail one sentence on where it came from
   * @param {string} [kind] 'step', 'subtotal' or 'total'
   * @returns {Readonly<{term: string, value: string, detail: string, kind: string}>}
   */
  function row(term, value, detail, kind) {
    return Object.freeze({ term, value, detail, kind: kind || 'step' });
  }

  /**
   * Two dollar figures as one range, such as "$1,200,000 – $2,000,000".
   * @param {number} low
   * @param {number} high
   * @returns {string}
   */
  function moneyRange(low, high) {
    return fmt(low) + EN_DASH + fmt(high);
  }

  /**
   * True when the business was priced on owner earnings, in full or in part.
   * @param {Object} est an estimate
   * @returns {boolean}
   */
  function usesSde(est) {
    return est.method === 'sde' || est.method === 'blend';
  }

  /**
   * The EBITDA path's first lines: what the owner reported or what we
   * estimated, and any salary set aside.
   * @param {Object} est an estimate from computeEstimate
   * @returns {Array} rows
   */
  function earningsRows(est) {
    if (est.estimated) {
      return [row('Estimated profit', fmt(est.reportedProfit),
        'You left profit blank, so we applied a typical ' + Math.round(est.margin * 100) +
        '% margin for ' + est.subName + ' to your ' + fmt(est.revenue) + ' in revenue.')];
    }
    if (!est.ownerPayRemoved) return [];
    return [
      row('Profit you reported', fmt(est.reportedProfit), 'Your own pay is still inside this number.'),
      row('Set aside to replace your role', formatSignedMoney(-est.ownerPayRemoved),
        'A buyer has to pay someone to do your job, so a market manager’s salary comes out first.')
    ];
  }

  /**
   * The SDE path's first lines, ending on the owner earnings it prices.
   * @param {Object} est an estimate whose sde is set
   * @returns {Array} rows
   */
  function sdeEarningsRows(est) {
    const priced = est.method === 'blend' ? BLEND_PRICED : SDE_PRICED;
    const total = (detail) => row('Owner earnings a buyer prices (SDE)', formatSignedMoney(est.sde), detail, 'subtotal');
    if (est.sdeSource === 'reported') {
      return [total('The profit you reported, with your own pay still in it. ' + priced)];
    }
    if (est.sdeSource === 'addedBack') {
      return [
        row('Profit you reported', fmt(est.reportedProfit), 'You told us your own pay is already taken out of this number.'),
        row('Added back: a typical owner’s pay', '+' + fmt(est.ownerPayAddedBack),
          'Businesses this size are priced with the owner’s pay still in the earnings, so we add back a typical ' +
          'market salary for running a business your size.'),
        total(priced)
      ];
    }
    return [
      row('Estimated owner earnings', fmt(est.sde), 'You left profit blank, so we applied a typical ' +
        Math.round(est.margin * 100) + '% margin for ' + est.subName + ' to your ' + fmt(est.revenue) +
        ' in revenue and added a typical owner’s salary' + (est.sdeCapped ? ', capped at 35% of revenue.' : '.')),
      total(priced)
    ];
  }

  /**
   * The breakdown for a business with no range on screen: the money lines
   * only. No multiples, because a multiple of nothing would say a good answer
   * costs money.
   * @param {Object} est an estimate from computeEstimate
   * @returns {ReadonlyArray} frozen rows, empty when there is nothing to show
   */
  function buildEarningsRows(est) {
    if (est.method === 'none' || usesSde(est)) return Object.freeze(sdeEarningsRows(est));
    if (!est.ownerPayRemoved) return Object.freeze([]);
    return Object.freeze(earningsRows(est).concat(row('Left to put a multiple on', formatSignedMoney(est.prof),
      'Once a manager is paid, there is not enough profit left for a multiple to mean anything.', 'total')));
  }

  /**
   * What the starting-multiple line is called, for a subsector, an industry
   * or "Other".
   * @param {Object} est an estimate
   * @param {string} lead 'Starting multiple for ' or 'Starting SDE multiple for '
   * @returns {string}
   */
  function startingTerm(est, lead) {
    if (est.subsectorMatched) return lead + est.subName;
    return lead + (est.industry === 'other' ? 'comparable' : NAMES[est.industry]) + ' businesses';
  }

  /**
   * What the SDE range was published for, at the level it was actually taken
   * from: the niche, the industry, or small businesses as a whole. Never names
   * a niche whose own SDE figure was not used.
   * @param {Object} est an estimate with an SDE leg
   * @returns {string}
   */
  function sdeBasisName(est) {
    if (est.sdeLeg.level === 'subsector') return est.subName;
    if (est.sdeLeg.level === 'industry') return NAMES[est.industry] + ' businesses';
    return 'small businesses across industries';
  }

  /**
   * On the SDE path, a note when the range is broader than the owner's niche.
   * @param {Object} est an estimate with an SDE leg
   * @returns {string}
   */
  function sdeLevelNote(est) {
    if (est.sdeLeg.level === 'subsector') return '';
    if (est.sdeLeg.level === '_all') {
      return ' There is not enough published SDE data for this industry alone, so we used the range for small ' +
        'businesses across industries.';
    }
    return est.subsectorMatched ? ' There is no separate published SDE figure for ' + est.subName +
      ', so we used the range for ' + NAMES[est.industry] + ' as a whole.' : unlistedNote(est);
  }

  /**
   * A note when a niche was not listed, so the owner knows the range is broad.
   * @param {Object} est an estimate
   * @returns {string}
   */
  function unlistedNote(est) {
    return !est.subsectorMatched && Object.prototype.hasOwnProperty.call(SUBSECTORS, est.industry)
      ? ' Your niche is not listed, so we used the range for the industry as a whole.' : '';
  }

  /**
   * The minimum-multiple line for one leg, or null when neither end was raised.
   * @param {Object} leg a priced leg
   * @param {boolean} isSde whether this is the small-business path
   * @returns {Readonly<Object>|null} a row
   */
  function floorRow(leg, isSde) {
    if (!leg.lowClamped && !leg.highClamped) return null;
    const lowLift = 'Low end +' + formatMultiple(leg.lowX - leg.lowXRaw);
    const value = leg.highClamped ? lowLift + ', high end +' + formatMultiple(leg.highX - leg.highXRaw) : lowLift;
    return row('Minimum multiple', value,
      'This tool never goes below ' + formatMultiple(leg.minLow) + ' at the low end or ' +
      formatMultiple(leg.minHigh) + ' at the high end for a profitable business' +
      (isSde ? ' on the small-business path' : '') + ', so that end is raised to the minimum.');
  }

  /**
   * The size and answer lines for one leg.
   * @param {Object} leg a priced leg
   * @param {string} sizeDetail what the size line says about earnings
   * @returns {Array} rows
   */
  function adjustmentRows(leg, sizeDetail) {
    return leg.adjustments.map((a) => row(CATEGORY_NAMES[a.key], formatAdjustment(a.adj),
      a.key === 'size' ? sizeDetail : ANSWER_LABELS[a.key][a.answer]));
  }

  /**
   * The EBITDA path's lines, up to earnings times the multiple.
   * @param {Object} est an estimate
   * @returns {Array} rows
   */
  function ebitdaRows(est) {
    const leg = est.ebitdaLeg;
    const first = earningsRows(est);
    const priced = row('Earnings a buyer prices', fmt(est.prof),
      first.length ? 'What is left to put a multiple on.'
        : 'The profit you reported, with your own pay already taken out.', 'subtotal');
    const starting = row(startingTerm(est, 'Starting multiple for '), formatRange(leg.multRange),
      'From published industry transaction multiple ranges. The low end is a typical negotiated sale; ' +
      'the high end is a quality business in a competitive process.' + unlistedNote(est));
    return first.concat(priced, starting, adjustmentRows(leg, fmt(est.prof) + ' in earnings'), floorRow(leg, false) || [],
      row('Your multiple', formatRange([leg.lowX, leg.highX]), 'Your starting range, moved by your answers.', 'subtotal'),
      row('Earnings × multiple', moneyRange(leg.exactLow, leg.exactHigh), fmt(est.prof) + ' times each end of your multiple.'));
  }

  /**
   * The SDE path's lines, up to owner earnings times the multiple.
   * @param {Object} est an estimate with an SDE leg
   * @returns {Array} rows
   */
  function sdeRows(est) {
    const leg = est.sdeLeg;
    const like = est.method === 'blend' ? 'businesses priced on owner earnings' : 'small businesses like yours';
    const starting = row('Starting SDE multiple for ' + sdeBasisName(est), formatRange(leg.multRange),
      'Set around published average sale multiples of owner earnings for ' + like + '. The low end is a typical ' +
      'sale; the high end is a strong business with more than one interested buyer.' + sdeLevelNote(est));
    const product = est.method === 'blend'
      ? row('Value on owner earnings (SDE method)', moneyRange(leg.exactLow, leg.exactHigh), 'The small-business method: ' +
        fmt(est.sde) + ' times each end of your SDE multiple.')
      : row('Owner earnings × multiple', moneyRange(leg.exactLow, leg.exactHigh), fmt(est.sde) + ' times each end of your multiple.');
    return sdeEarningsRows(est).concat(starting, adjustmentRows(leg, fmt(est.sde) + ' in owner earnings'), floorRow(leg, true) || [],
      row('Your SDE multiple', formatRange([leg.lowX, leg.highX]), 'Your starting range, moved by your answers. On this ' +
        'path each answer counts for ' + Math.round(LIMITS.SDE_ANSWER_WEIGHT * 100) + '% of its weight for a larger ' +
        'business, because SDE multiples are smaller numbers and a full swing would overstate what one answer does to ' +
        'a small business’s price.', 'subtotal'),
      product);
  }

  /**
   * Where the EBITDA method's earnings came from, said in one sentence.
   * @param {Object} est an estimate
   * @returns {string}
   */
  function blendEarningsDetail(est) {
    if (est.estimated) return 'The larger-business method starts from profit at a typical margin, which already pays a manager.';
    if (est.ownerPayRemoved) {
      return 'The larger-business method takes a market manager’s salary of ' + fmt(est.ownerPayRemoved) +
        ' out of your owner earnings, because a buyer at that size hires someone to run the business.';
    }
    return 'The larger-business method prices the profit you reported, with your own pay already out.';
  }

  /**
   * The blend's lines after the SDE method: the EBITDA method in brief, then
   * how the two are weighted.
   * @param {Object} est a blended estimate
   * @returns {Array} rows
   */
  function blendRows(est) {
    const leg = est.ebitdaLeg;
    const size = leg.adjustments[0].adj;
    const held = leg.lowClamped || leg.highClamped ? ', held at this tool’s minimum' : '';
    const pct = Math.round(est.ebitdaWeight * 100);
    return [
      row('Earnings after a manager’s salary', fmt(est.prof), blendEarningsDetail(est)),
      row('Larger-business multiple', formatRange([leg.lowX, leg.highX]), 'Starting ' + formatRange(leg.multRange) +
        ' for ' + est.subName + ', moved by size (' + formatAdjustment(size) + ') and your answers at full weight' + held + '.'),
      row('Value after a manager’s salary (EBITDA method)', moneyRange(leg.exactLow, leg.exactHigh),
        fmt(est.prof) + ' times each end of that multiple.'),
      row('Blended range', moneyRange(est.exactLow, est.exactHigh), 'At ' + fmt(est.sde) + ' of owner earnings you ' +
        'sit between the two ways businesses are priced, so we weight the EBITDA method ' + pct + '% and the SDE method ' +
        (100 - pct) + '%. Below ' + fmt(LIMITS.SDE_ONLY_BELOW) + ' of owner earnings this tool uses SDE alone; from ' +
        fmt(LIMITS.EBITDA_FROM) + ', EBITDA alone.', 'subtotal')
    ];
  }

  /**
   * The rounding line's explanation, naming both steps when the ends differ.
   * @param {Object} est an estimate from computeEstimate
   * @returns {string}
   */
  function roundingDetail(est) {
    const lowStep = roundingStep(est.exactLow);
    const highStep = roundingStep(est.exactHigh);
    const steps = lowStep === highStep ? fmt(lowStep)
      : fmt(lowStep) + ' at the low end and ' + fmt(highStep) + ' at the high end';
    return 'Rounded to the nearest ' + steps + ', so it does not look more precise than an estimate can be.';
  }

  /**
   * "How we got your number": every step from the owner's profit to the range
   * on screen. Dollar lines and multiple lines are kept apart so each column
   * adds up: the starting range plus each adjustment (plus any minimum) is the
   * multiple, earnings times the multiple is the value, and in the blend the
   * two values weighted are the range before rounding.
   * @param {Object} est an estimate from computeEstimate, with showRange true
   * @returns {ReadonlyArray} frozen rows
   */
  function buildBreakdownRows(est) {
    const body = est.method === 'sde' ? sdeRows(est)
      : est.method === 'blend' ? sdeRows(est).concat(blendRows(est)) : ebitdaRows(est);
    return Object.freeze(body.concat(
      row('Your range, rounded', moneyRange(est.low, est.high), roundingDetail(est), 'total'),
      row('Midpoint', fmt(est.midpoint), 'Halfway between the two ends.')));
  }

  /**
   * An impact rounded for display: to $1,000, or $10,000 from $1 million up.
   * Rounds half away from zero on both sides, where Math.round(-182.5) would
   * give -182 and make a cost read smaller than the same-sized gain.
   * @param {number} value dollars, signed
   * @returns {number}
   */
  function roundImpact(value) {
    const step = Math.abs(value) >= 1e6 ? 1e4 : 1e3;
    return Math.sign(value) * Math.round(Math.abs(value) / step) * step;
  }

  /**
   * What one answer does to the number, in words, so the direction never
   * depends on colour alone.
   * @param {number} adj the answer's adjustment (or, in the blend, its impact)
   * @param {number} impact what it does to the range, in dollars
   * @param {boolean} inMultiples true once both minimums apply and dollars stop meaning anything
   * @returns {string}
   */
  function amountText(adj, impact, inMultiples) {
    if (adj === 0) return 'No change';
    if (inMultiples) return (adj > 0 ? 'Raises' : 'Lowers') + ' your multiple by ' + formatMultiple(Math.abs(adj));
    const rounded = Math.abs(roundImpact(impact));
    if (!rounded) return adj > 0 ? 'Adds less than $1,000' : 'Costs less than $1,000';
    return (adj > 0 ? 'Adds about ' : 'Costs about ') + fmt(rounded);
  }

  /**
   * One ranked answer, frozen.
   * @param {Object} a the adjustment {key, answer, adj}
   * @param {number} signal what decides direction and wording: adj, or impact in the blend
   * @param {number} impact dollars
   * @param {{sizeLabel: string, sizeReason: string, inMultiples: boolean}} ctx
   * @returns {Readonly<Object>}
   */
  function move(a, signal, impact, ctx) {
    const isSize = a.key === 'size';
    return Object.freeze({
      key: a.key, adj: a.adj, impact,
      direction: signal > 0 ? 'up' : signal < 0 ? 'down' : 'neutral',
      label: CATEGORY_NAMES[a.key] + ': ' + (isSize ? ctx.sizeLabel : ANSWER_LABELS[a.key][a.answer]),
      amountText: amountText(signal, impact, ctx.inMultiples),
      why: isSize ? ctx.sizeReason : WHY[a.key][a.answer]
    });
  }

  /**
   * "What's moving your number" on one path: size and each answer, ranked
   * by adjustment rather than dollars so float noise cannot reorder equal
   * moves. Answers that change nothing stay in the list, last.
   * @param {Object} leg the priced leg
   * @param {{sizeLabel: string, sizeReason: string}} ctx
   * @returns {ReadonlyArray} frozen moves
   */
  function legMoves(leg, ctx) {
    const full = Object.assign({ inMultiples: leg.lowClamped && leg.highClamped }, ctx);
    const moves = leg.adjustments.map((a) => move(a, a.adj, a.adj * leg.earnings, full));
    // Array.prototype.sort is stable, so ties keep the form's order.
    return Object.freeze(moves.slice().sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj)));
  }

  /**
   * One answer's average effect on a leg's two ends, in dollars. An end held
   * at the minimum does not move with the answer, so it counts as nothing.
   * @param {Object} leg a priced leg
   * @param {number} adj the answer's adjustment on that leg
   * @returns {number}
   */
  function legEffect(leg, adj) {
    const movingEnds = (leg.lowClamped ? 0 : 1) + (leg.highClamped ? 0 : 1);
    return adj * leg.earnings * movingEnds / 2;
  }

  /**
   * The blend's ranked answers: each one's effect on both methods, weighted
   * the way the range is, ranked by whole dollars.
   * @param {Object} est a blended estimate
   * @returns {ReadonlyArray} frozen moves
   */
  function blendMoves(est) {
    const w = est.ebitdaWeight;
    const sde = est.sdeLeg;
    const ebitda = est.ebitdaLeg;
    const inMultiples = sde.lowClamped && sde.highClamped && ebitda.lowClamped && ebitda.highClamped;
    const ctx = { sizeLabel: fmt(est.sde) + ' in owner earnings', sizeReason: sizeWhy(est.prof), inMultiples };
    const moves = sde.adjustments.map((a, i) => {
      const impact = (1 - w) * legEffect(sde, a.adj) + w * legEffect(ebitda, ebitda.adjustments[i].adj);
      if (inMultiples) return move(a, a.adj, impact, ctx);
      return move(a, Math.round(impact) === 0 ? 0 : impact, impact, ctx);
    });
    const size = (m) => (inMultiples ? Math.abs(m.adj) : Math.round(Math.abs(m.impact)));
    return Object.freeze(moves.slice().sort((a, b) => size(b) - size(a)));
  }

  /**
   * "What's moving your number" for whichever path priced the business.
   * @param {Object} est an estimate from computeEstimate, with showRange true
   * @returns {ReadonlyArray} frozen moves
   */
  function rankMoves(est) {
    if (est.method === 'blend') return blendMoves(est);
    if (est.method === 'sde') {
      return legMoves(est.sdeLeg, { sizeLabel: fmt(est.sde) + ' in owner earnings', sizeReason: sdeSizeWhy(est.sde) });
    }
    return legMoves(est.ebitdaLeg, { sizeLabel: fmt(est.prof) + ' in earnings', sizeReason: sizeWhy(est.prof) });
  }

  /**
   * The leg whose multiple the range is, or null in the blend.
   * @param {Object} est an estimate
   * @returns {Object|null}
   */
  function shownLeg(est) {
    return est.method === 'sde' ? est.sdeLeg : est.method === 'ebitda' ? est.ebitdaLeg : null;
  }

  /**
   * In the blend, how many of the four ends (two per method) are held at a
   * minimum multiple. 0 outside the blend.
   * @param {Object} est an estimate
   * @returns {number} 0 to 4
   */
  function blendHeldEnds(est) {
    if (est.method !== 'blend') return 0;
    return [est.sdeLeg.lowClamped, est.sdeLeg.highClamped, est.ebitdaLeg.lowClamped, est.ebitdaLeg.highClamped]
      .filter(Boolean).length;
  }

  /**
   * The line above the ranked list, saying what the amounts mean.
   * @param {Object} est an estimate from computeEstimate
   * @returns {string}
   */
  function movesIntro(est) {
    const leg = shownLeg(est);
    if ((leg && leg.lowClamped && leg.highClamped) || blendHeldEnds(est) === 4) {
      return 'Your answers, ranked by how much each one moves your multiple.';
    }
    const lead = 'Your answers, ranked by how much each one moves your range. ';
    if (est.method === 'blend') {
      return lead + 'Each amount combines that answer’s effect on both methods, weighted the way your range is.';
    }
    const base = est.method === 'sde' ? fmt(est.sde) + ' in owner earnings' : fmt(est.prof) + ' in earnings';
    return lead + 'Each amount is that answer’s piece of the multiple, applied to your ' + base + '.';
  }

  /**
   * Any caution the ranked list needs, or '' when it needs none.
   * @param {Object} est an estimate from computeEstimate
   * @returns {string}
   */
  function movesNote(est) {
    const notes = [];
    if (est.estimated) {
      notes.push(usesSde(est) ? 'These are based on estimated owner earnings, so treat them as rough.'
        : 'These are based on an estimated profit, so treat them as rough.');
    }
    const leg = shownLeg(est);
    if (leg && leg.lowClamped && leg.highClamped) {
      notes.push('Together these answers push your multiple below the minimum this tool uses, so your range sits at ' +
        formatMultiple(leg.minLow) + ' to ' + formatMultiple(leg.minHigh) +
        ' your earnings. Improving the biggest ones is what would lift it.');
    } else if (leg && leg.lowClamped) {
      notes.push('Your low end is held at the ' + formatMultiple(leg.minLow) +
        ' minimum, so these amounts apply in full to the high end of your range.');
    }
    const held = blendHeldEnds(est);
    if (held === 4) {
      notes.push('Together these answers push both methods below the minimum multiples this tool uses, so your ' +
        'range sits at those minimums. Improving the biggest ones is what would lift it.');
    } else if (held) {
      notes.push('Part of your range is held at this tool’s minimum multiples and does not move with your answers, ' +
        'so each amount is that answer’s effect on the middle of your range.');
    }
    return notes.join(' ');
  }

  /**
   * How the SDE path describes the owner earnings it priced.
   * @param {Object} est an estimate with an SDE leg
   * @returns {string}
   */
  function sdePhrase(est) {
    if (est.sdeSource === 'estimated') {
      return 'an estimated ' + fmt(est.sde) + ' of owner earnings (you left profit blank, so this is a rougher starting point)';
    }
    if (est.sdeSource === 'addedBack') {
      return fmt(est.sde) + ' of owner earnings (your profit plus a typical owner’s salary of ' + fmt(est.ownerPayAddedBack) + ')';
    }
    return 'your ' + fmt(est.sde) + ' of owner earnings (profit with your own pay still in it)';
  }

  /**
   * The EBITDA path's sentence under the range.
   * @param {Object} est an estimate
   * @returns {string}
   */
  function ebitdaNote(est) {
    const leg = est.ebitdaLeg;
    const profPhrase = est.estimated
      ? 'an estimated ' + fmt(est.prof) + ' of annual profit (you left profit blank, so we applied typical margins for ' + est.subName + ' to your revenue, which makes this a rougher starting point)'
      : est.ownerPayRemoved
        ? fmt(est.prof) + ' of annual profit, after setting aside ' + fmt(est.ownerPayRemoved) + ' to replace what you do ' +
          '(you told us your own pay was still in that number, and buyers price the business without you in it)'
        : 'your ' + fmt(est.prof) + ' of annual profit';
    return 'Based on a ' + formatMultiple(leg.lowX) + '–' + formatMultiple(leg.highX) + ' multiple applied to ' + profPhrase +
      ', adjusted for size, owner involvement, growth, customer concentration, and revenue quality. That starts from published ' +
      'transaction multiple ranges for ' + est.subName + ' and adjusts for your answers.';
  }

  /**
   * The sentence under the range, naming the method that produced it.
   * Multiples use the same two-place format as the breakdown below it.
   * @param {Object} est an estimate, with showRange true
   * @returns {string}
   */
  function rangeNote(est) {
    if (est.method === 'sde') {
      const leg = est.sdeLeg;
      return 'Based on a ' + formatMultiple(leg.lowX) + '–' + formatMultiple(leg.highX) + ' multiple of ' + sdePhrase(est) +
        ', adjusted for size, owner involvement, growth, customer concentration, and revenue quality. Businesses this size ' +
        'are usually priced on owner earnings (SDE), so nothing is set aside for a manager. That starts from published ' +
        'average SDE multiples for ' + sdeBasisName(est) + '.' + COMPETE;
    }
    if (est.method === 'blend') {
      const pct = Math.round(est.ebitdaWeight * 100);
      return 'Your ' + fmt(est.sde) + ' of owner earnings sits between the two ways businesses are priced, so this range ' +
        'is a blend: ' + pct + '% on earnings after a manager’s salary at ' + formatRange([est.ebitdaLeg.lowX, est.ebitdaLeg.highX]) +
        ', and ' + (100 - pct) + '% on owner earnings at ' + formatRange([est.sdeLeg.lowX, est.sdeLeg.highX]) +
        '. The breakdown below shows both.' + COMPETE;
    }
    return ebitdaNote(est) + COMPETE;
  }

  /**
   * The warm note for a business the small-business path priced, or ''.
   * @param {Object} est an estimate
   * @returns {string}
   */
  function smallBusinessNote(est) {
    return usesSde(est) || (est.method === 'none' && est.sde !== null) ? SMALL_BUSINESS_NOTE : '';
  }

  const api = Object.freeze(Object.assign({}, M, {
    ANSWER_LABELS, WHY, CATEGORY_NAMES, SMALL_BUSINESS_NOTE, REAL_ESTATE_NOTE,
    buildBreakdownRows, buildEarningsRows, rankMoves, movesIntro, movesNote, rangeNote, smallBusinessNote
  }));

  // Node loads this file to test it; the page reads it from window.
  if (isNode) {
    module.exports = api;
    return;
  }
  window.SCValuationEstimate = api;
})();
