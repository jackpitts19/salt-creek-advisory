(function () {
  // How a sector page or guide hands over an industry:
  // valuation?industry=<option value>.
  const INDUSTRY_PARAM = 'industry';

  /**
   * The industry option a link asked for, or '' when it asked for none we have.
   *
   * The parameter comes straight from the address bar, so it is only ever used to
   * look up one of the page's own option values, and that value is what comes
   * back. The visitor's text is never returned and never reaches the page.
   * @param {string} search the query string, with or without its leading "?"
   * @param {string[]} optionValues every value the industry select offers
   * @returns {string} one of optionValues, or '' for no usable match
   */
  function industryFromQuery(search, optionValues) {
    if (typeof search !== 'string' || !Array.isArray(optionValues)) return '';
    const asked = (new URLSearchParams(search).get(INDUSTRY_PARAM) || '').trim().toLowerCase();
    if (!asked) return '';
    return optionValues.find((value) => String(value).toLowerCase() === asked) || '';
  }

  // Node loads this file only to test the pure helpers above. There is no page to
  // wire up there, so hand them over and stop before the first document lookup.
  if (typeof document === 'undefined') {
    if (typeof module === 'object' && module.exports) module.exports = { industryFromQuery };
    return;
  }

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

  // The tables, the arithmetic and the result screen's words live in
  // valuation-tables.js, valuation-estimate.js and valuation-explain.js, which
  // the page loads first so Node can test them without a browser. The sources
  // behind the multiples are in valuation-sources.js.
  const E = window.SCValuationEstimate;
  const SRC = window.SCValuationSources;
  const { SUBSECTORS, NAMES, parseMoney, fmt, roundSmart } = E;

  // Named buyers by industry, kept with the other tables in valuation-tables.js.
  const { BUYERS, BUYERS_GENERIC } = window.SCValuationTables;

  const STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','Washington D.C.','West Virginia','Wisconsin','Wyoming'];

  // Formspree: every submission is emailed to Salt Creek and stored in the
  // Formspree dashboard. Create a form at formspree.io, then paste its ID
  // below so the line reads: const LEAD_ENDPOINT = 'https://formspree.io/f/abcdwxyz';
  const LEAD_ENDPOINT = 'https://formspree.io/f/xzdqavol';

  // Bump this whenever terms.html changes materially. It is stored with each
  // lead so a submission can be matched to the terms that were on screen.
  const TERMS_VERSION = '2026-10-09';

  // A US number with area code. Extensions and a leading 1 only add digits.
  const MIN_PHONE_DIGITS = 10;

  const $ = (id) => document.getElementById(id);
  const steps = document.querySelectorAll('.val-step');
  const dots = document.querySelectorAll('.val-progress li');
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
   * @param {string} subject the email subject Formspree sends it under
   * @param {Object} context non-identifying fields safe to report to GA4
   * @returns {Promise<void>}
   */
  function deliverLead(lead, subject, context) {
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(Object.assign({ _subject: subject }, lead))
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

  /**
   * One <option>, built with DOM calls like everything else the page adds.
   * @param {string} value
   * @param {string} text
   * @returns {HTMLOptionElement}
   */
  function option(value, text) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    return node;
  }

  // Populate subsector options whenever the industry changes. Pet care gets a
  // pointer for vets, whose practices are priced as healthcare, not pet care.
  const subSel = $('vSubsector');
  $('vIndustry').addEventListener('change', () => {
    const industry = $('vIndustry').value;
    // Linked only while it shows: a hidden element named in aria-describedby
    // is still read out, so a static link would read the vet hint everywhere.
    const showVetHint = industry === 'petcare';
    $('vSubsectorHint').hidden = !showVetHint;
    if (showVetHint) subSel.setAttribute('aria-describedby', 'vSubsectorHint');
    else subSel.removeAttribute('aria-describedby');
    const list = Object.prototype.hasOwnProperty.call(SUBSECTORS, industry) ? SUBSECTORS[industry] : null;
    if (!list) {
      subSel.replaceChildren(option('', 'Not applicable for this industry'));
      subSel.disabled = true;
      return;
    }
    subSel.disabled = false;
    subSel.replaceChildren(option('', 'Select your subsector\u2026'),
      ...list.map((s) => option(s.id, s.label)), option('_other', 'Other / Not Listed'));
  });

  /**
   * Preselects the industry a sector page or guide linked in with. Runs after the
   * listener above is attached, so the subsector list fills in as if the visitor
   * had picked it by hand. An unknown or missing value leaves the select alone.
   */
  function preselectIndustry() {
    const select = $('vIndustry');
    const values = Array.from(select.options, (option) => option.value);
    const picked = industryFromQuery(window.location.search, values);
    if (!picked) return;
    select.value = picked;
    select.dispatchEvent(new Event('change'));
  }
  preselectIndustry();

  /**
   * The element focus should land on when step n appears: the step title for the
   * three question steps, and whichever result heading is actually showing on the
   * result step (range, closer look, or below manager pay).
   * @param {Element} step the .val-step just shown
   * @param {number} n its step number
   * @returns {Element|null}
   */
  function stepFocusTarget(step, n) {
    if (n !== 4) return step.querySelector('.val-step-title');
    const shown = Array.from(step.querySelectorAll('.val-result-eyebrow'))
      .find((node) => node.offsetParent !== null);
    return shown || null;
  }

  /**
   * Shows step n, then moves focus and the viewport to it.
   *
   * Without this, the step the visitor just left collapses under them: on a phone
   * the page stayed scrolled past the new, shorter step, and focus fell back to
   * BODY because the button that had it was hidden. A screen reader user heard
   * nothing about the new step at all.
   * @param {number} n the step to show, 1 to 4
   */
  function showStep(n) {
    steps.forEach(s => s.classList.toggle('active', s.dataset.step == n));
    dots.forEach((d, i) => {
      d.classList.toggle('on', i < n);
      // The labelled steps are read out as a list, so say which one this is.
      if (i === n - 1) d.setAttribute('aria-current', 'step');
      else d.removeAttribute('aria-current');
    });
    if (n === 4) {
      // The result ships hidden so an unfilled "$0 – $0" never reaches a crawler
      // or a snippet. Reveal it before the focus target is looked up below, which
      // checks offsetParent and would find nothing inside a hidden step.
      const result = $('valResult');
      result.hidden = false;
      result.classList.add('shown');
    }

    const step = document.querySelector('.val-step[data-step="' + n + '"]');
    if (!step) return;
    const target = stepFocusTarget(step, n);
    // preventScroll, because the scroll below decides where the step sits.
    if (target) target.focus({ preventScroll: true });

    // Only scroll when the top of the step is hidden behind the fixed nav or sits
    // low enough that the visitor would have to hunt for it. On a desktop where the
    // card is already in view this leaves the page still.
    const nav = $('nav');
    const navBottom = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
    const top = step.getBoundingClientRect().top;
    if (top < navBottom || top > window.innerHeight / 2) {
      step.scrollIntoView({ block: 'start', behavior: rm ? 'auto' : 'smooth' });
    }
  }

  ['vRevenue', 'vProfit'].forEach(id => {
    const el = $(id);
    el.addEventListener('input', () => {
      const n = parseMoney(el.value);
      el.value = n ? '$' + n.toLocaleString('en-US') : '';
    });
  });

  // The fields each question step can reject. Every one gets its own message
  // slot, and fail() clears the whole step first, so fixing one field and failing
  // on another never leaves a stale message or aria-invalid behind.
  const STEP_FIELDS = {
    1: ['vIndustry', 'vSubsector', 'vState', 'vRevenue', 'vProfit', 'vProfitBasis', 'vWebsite'],
    2: ['vOwner', 'vGrowth', 'vConc', 'vRec'],
    3: ['vName', 'vEmail', 'vPhone']
  };
  const FIELD_ERROR_SUFFIX = 'Error';

  /**
   * Removes a field's message and its invalid mark.
   * @param {string} fieldId the field to clear
   */
  function clearFieldError(fieldId) {
    const field = $(fieldId);
    const slot = $(fieldId + FIELD_ERROR_SUFFIX);
    if (!field || !slot) return;
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    slot.textContent = '';
  }

  /**
   * Adds an empty message slot directly under a field.
   *
   * Each step used to have one slot at the bottom, while focus jumped to the
   * failing field: on a phone the explanation was off screen. The slot is created
   * up front and left empty, because a role="alert" region is only announced
   * reliably when it is already on the page before its text changes.
   * @param {string} fieldId the field the slot belongs to
   */
  function addErrorSlot(fieldId) {
    const field = $(fieldId);
    if (!field) return;
    const slot = document.createElement('p');
    slot.id = fieldId + FIELD_ERROR_SUFFIX;
    slot.className = 'val-field-error';
    slot.setAttribute('role', 'alert');
    field.insertAdjacentElement('afterend', slot);
    // Answering the question is the fix, so the message leaves with it.
    ['input', 'change'].forEach((type) => {
      field.addEventListener(type, () => clearFieldError(fieldId));
    });
  }
  Object.keys(STEP_FIELDS).forEach((step) => STEP_FIELDS[step].forEach(addErrorSlot));

  /**
   * Clears every message and invalid mark on a step.
   * @param {number} step 1, 2 or 3
   */
  function clearStepErrors(step) {
    STEP_FIELDS[step].forEach(clearFieldError);
  }

  /**
   * Explains a rejected field directly beneath it. The slot carries role="alert",
   * so setting the text is announced; the field is marked invalid, pointed at the
   * message, and focused, the same pattern as fail() in contact.js.
   * @param {number} step the step the field is on (1, 2 or 3)
   * @param {string} msg what went wrong, in plain language
   * @param {string} fieldId the field to mark invalid and focus
   */
  function fail(step, msg, fieldId) {
    clearStepErrors(step);
    const field = $(fieldId);
    const slot = $(fieldId + FIELD_ERROR_SUFFIX);
    if (!field || !slot) return;
    slot.textContent = msg;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', slot.id);
    // focus() alone scrolls just far enough to show the field, which parks it
    // under the fixed header with the label hidden and the message flush below
    // the header. Centring the whole field block (label, field, message) keeps
    // all three clear of the header and off the bottom edge of a short screen.
    field.focus({ preventScroll: true });
    (field.closest('.val-field') || field).scrollIntoView({ block: 'center' });
  }

  $('toStep2').addEventListener('click', () => {
    const ind = $('vIndustry').value;
    const rev = parseMoney($('vRevenue').value);
    const prof = parseMoney($('vProfit').value);
    if (!ind) return fail(1, 'Please select your industry.', 'vIndustry');
    if (SUBSECTORS[ind] && !$('vSubsector').value) return fail(1, 'Please select your subsector.', 'vSubsector');
    if (!$('vState').value) return fail(1, 'Please select your state.', 'vState');
    if (!rev && !prof) return fail(1, 'Give us revenue or profit. A rough number is fine.', 'vRevenue');
    if (rev && prof && prof > rev) return fail(1, 'Profit can\u2019t be higher than revenue. Double-check those numbers.', 'vProfit');
    // Only binding when a profit figure was actually given: a blank profit is
    // estimated from industry margins, which are already net of a manager's pay.
    if (prof && !$('vProfitBasis').value) {
      return fail(1, 'Tell us whether your own pay is still inside that profit number.', 'vProfitBasis');
    }
    clearStepErrors(1);
    trackStep(1);
    showStep(2);
  });

  $('toStep3').addEventListener('click', () => {
    if (!$('vOwner').value) return fail(2, 'Tell us how involved you are day to day.', 'vOwner');
    if (!$('vGrowth').value) return fail(2, 'Tell us how revenue has trended.', 'vGrowth');
    if (!$('vConc').value) return fail(2, 'Tell us about your largest customer.', 'vConc');
    if (!$('vRec').value) return fail(2, 'Tell us what kind of revenue you have.', 'vRec');
    clearStepErrors(2);
    trackStep(2);
    showStep(3);
  });

  $('back1').addEventListener('click', () => showStep(1));
  $('back2').addEventListener('click', () => showStep(2));

  function countUp(el, target, dur) {
    if (rm) { el.textContent = fmt(target); return; }
    // The span ships empty, so give it its starting figure now rather than one
    // frame later; otherwise the range reads "–" for an instant.
    el.textContent = fmt(0);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(roundSmart(target * eased));
      if (t < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
    };
    requestAnimationFrame(tick);
  }

  /**
   * The three buyers for an industry, with the generic ones filling in.
   * @param {string} ind an industry key
   */
  function renderBuyers(ind) {
    const own = Object.prototype.hasOwnProperty.call(BUYERS, ind) ? BUYERS[ind] : [];
    const list = own.concat(BUYERS_GENERIC).slice(0, 3);
    $('valBuyersTitle').textContent = 'Buyers active in ' +
      (NAMES[ind] === 'comparable' ? 'businesses like yours' : NAMES[ind]);
    $('valBuyersList').replaceChildren(...list.map((b) => {
      const card = el('div', 'val-buyer');
      card.append(el('span', 'val-buyer-name', b[0]), el('span', 'val-buyer-desc', b[1]));
      return card;
    }));
  }

  /**
   * "Sources for <industry>": the newest few sources behind this industry's
   * multiples, each linking to the publisher, then a link to the full list.
   * Built from valuation-sources.js with DOM calls, never markup strings.
   * @param {string} ind an industry key
   * @param {string} method how the business was priced: 'sde', 'ebitda' or 'blend'
   */
  function renderSourcesLine(ind, method) {
    const line = $('valSourcesLine');
    const picked = SRC ? SRC.resultSources(ind, method) : [];
    line.hidden = !picked.length;
    if (!picked.length) return line.replaceChildren();
    // The industry as the owner picked it ("Consumer / Retail"), which reads
    // better here than the lower-case name the breakdown uses.
    const label = ind === 'other' ? 'Sources for businesses like yours: ' : 'Sources for ' + sel('vIndustry') + ': ';
    const parts = [document.createTextNode(label)];
    picked.forEach((source, i) => {
      const link = el('a', '', source.publisher);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener';
      parts.push(link, document.createTextNode(' (' + source.sortKey.slice(0, 4) + ')' + (i < picked.length - 1 ? ', ' : '. ')));
    });
    const all = el('a', '', 'See every source');
    // The full list lives on the methodology page, not under the calculator.
    // A new tab, so following it never costs the owner their result.
    all.href = 'valuation-methodology#sources';
    all.target = '_blank';
    all.rel = 'noopener';
    line.replaceChildren(...parts, all, document.createTextNode('.'));
  }

  // What the lead and the email say when an optional question is skipped.
  // Always present, so every Formspree submission has the same columns.
  const TIMELINE_UNANSWERED = 'Not answered';

  /**
   * The text a select is showing, which is what the lead and the email carry.
   * @param {string} id the select's id
   * @returns {string}
   */
  function sel(id) {
    const e = $(id);
    return e.options[e.selectedIndex].text;
  }

  /**
   * One element with a class and plain text. Everything the result screen
   * builds goes through textContent, never innerHTML, so no answer or figure
   * can ever be read as markup.
   * @param {string} tag the element to create
   * @param {string} className its class, or '' for none
   * @param {string} [text] its text
   * @returns {HTMLElement}
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * encodeURIComponent that cannot throw. A lone surrogate pasted into the name
   * or phone field makes the plain call throw, which used to happen after the
   * lead had been sent and before the result showed, leaving the visitor stuck.
   * Same approach as safeEncode in contact.js.
   * @param {string} value text for a mailto link
   * @returns {string}
   */
  function safeEncode(value) {
    try {
      return encodeURIComponent(value);
    } catch (err) {
      const cleaned = value
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, '$1');
      try {
        return encodeURIComponent(cleaned);
      } catch (err2) {
        return '';
      }
    }
  }

  /**
   * The owner's answers, in the shape computeEstimate takes. The selling-timeline
   * answer is deliberately left out: it travels with the lead, never the number.
   * @returns {Readonly<Object>}
   */
  function collectInputs() {
    return Object.freeze({
      industry: $('vIndustry').value, subsector: $('vSubsector').value,
      revenue: parseMoney($('vRevenue').value), profit: parseMoney($('vProfit').value),
      profitBasis: $('vProfitBasis').value,
      owner: $('vOwner').value, growth: $('vGrowth').value,
      concentration: $('vConc').value, revenueType: $('vRec').value
    });
  }

  /**
   * Everything that goes to Formspree for one submission. Every field name the
   * CRM already reads is kept; the figures come from E.leadFigures so they can
   * be tested without a browser.
   * @param {Object} est the estimate
   * @param {{name: string, email: string}} contact who it is for
   * @returns {Readonly<Object>}
   */
  function buildLead(est, contact) {
    const figures = E.leadFigures(est);
    return Object.freeze({
      name: contact.name, email: contact.email,
      phone: $('vPhone').value.trim(), website: $('vWebsite').value.trim(),
      state: $('vState').value,
      industry: sel('vIndustry'), subsector: subSel.disabled ? 'N/A' : sel('vSubsector'),
      ownerInvolvement: sel('vOwner'), revenueTrend: sel('vGrowth'),
      customerConcentration: sel('vConc'), revenueType: sel('vRec'),
      // For qualifying the lead only. Neither reaches the estimate, and both stay
      // out of analytics: the privacy policy names what GA4 receives.
      sellingTimeline: $('vTiming').value ? sel('vTiming') : TIMELINE_UNANSWERED,
      ownsRealEstate: $('vRealEstate').value ? sel('vRealEstate') : TIMELINE_UNANSWERED,
      // profit is what the owner typed (or our estimate when blank); the rest
      // say how it was priced, so the number in the email can be retraced.
      revenue: figures.revenue, profit: figures.profit, profitEstimated: figures.profitEstimated,
      oversized: figures.oversized,
      profitBasis: est.estimated ? 'N/A (estimated from margins)' : sel('vProfitBasis'),
      profitAfterManagerPay: figures.profitAfterManagerPay, sde: figures.sde,
      valuationMethod: figures.valuationMethod, rangeShown: figures.rangeShown,
      ownerPayRemoved: figures.ownerPayRemoved,
      belowManagerPay: figures.belowManagerPay,
      estimateLow: figures.estimateLow, estimateHigh: figures.estimateHigh,
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
    });
  }

  /**
   * The prewritten email behind "Email Us This Estimate", the fallback that gets
   * the lead to us when the automatic delivery fails.
   * @param {Object} lead the submission
   * @param {Object} est the estimate
   * @returns {string} a mailto: URL
   */
  function buildMailto(lead, est) {
    const subject = 'Valuation inquiry from ' + lead.name;
    const bodyTxt = 'Hi Jack and Connor,\n\nI just used the valuation tool on your site.\n\n' +
      'Name: ' + lead.name + '\nEmail: ' + lead.email + (lead.phone ? '\nPhone: ' + lead.phone : '') +
      (lead.website ? '\nWebsite: ' + lead.website : '') + '\nState: ' + lead.state +
      (lead.sellingTimeline !== TIMELINE_UNANSWERED ? '\nSelling timeline: ' + lead.sellingTimeline : '') +
      '\nIndustry: ' + lead.industry + '\nSubsector: ' + lead.subsector +
      '\nOwner involvement: ' + lead.ownerInvolvement +
      '\nRevenue trend: ' + lead.revenueTrend + '\nLargest customer: ' + lead.customerConcentration +
      '\nRevenue type: ' + lead.revenueType +
      (lead.ownsRealEstate !== TIMELINE_UNANSWERED ? '\nOwn the real estate: ' + lead.ownsRealEstate : '') +
      mailtoFigures(lead, est) +
      '\n\nI’d like to talk about what a real number could look like.';
    return 'mailto:jack@saltcreekadvisory.com?cc=connor@saltcreekadvisory.com&subject=' +
      safeEncode(subject) + '&body=' + safeEncode(bodyTxt);
  }

  // How the email names each way of pricing a business.
  const METHOD_LABELS = Object.freeze({
    ebitda: 'EBITDA, after a manager’s salary', sde: 'Owner earnings (SDE)',
    blend: 'A blend of owner earnings (SDE) and EBITDA', none: 'No range shown'
  });

  /**
   * The money lines of the prewritten email, mirroring the lead's figures.
   * @param {Object} lead the submission
   * @param {Object} est the estimate
   * @returns {string}
   */
  function mailtoFigures(lead, est) {
    const range = !lead.rangeShown
      ? (est.bigDeal ? 'needs a closer look, large business' : 'none yet; let’s talk it through')
      : fmt(lead.estimateLow) + ' to ' + fmt(lead.estimateHigh);
    return '\nAnnual revenue: ' + fmt(lead.revenue) +
      '\nAnnual profit: ' + fmt(lead.profit) + (lead.profitEstimated ? ' (estimated from margins)' : '') +
      '\nOwn pay still in that number: ' + lead.profitBasis +
      (lead.sde !== '' ? '\nOwner earnings (SDE): ' + fmt(lead.sde) : '') +
      (lead.ownerPayRemoved ? '\nManager salary set aside: ' + fmt(lead.ownerPayRemoved) : '') +
      '\nPriced on: ' + METHOD_LABELS[lead.valuationMethod] +
      '\nEstimated range: ' + range;
  }

  /**
   * One line of a breakdown list: the term, its figure, and where it came from.
   * A figure that is a range keeps each end whole and lets the line break only
   * at the dash, so "$1,795,800 – $2,890,800" never splits mid-number on a phone.
   * @param {{term: string, value: string, detail: string, kind: string}} line
   * @returns {HTMLElement}
   */
  function calcRowElement(line) {
    const parts = line.value.split(' – ');
    const isRange = parts.length > 1;
    const group = el('div', 'val-calc-row' + (line.kind !== 'step' ? ' val-calc-row--' + line.kind : '') +
      (isRange ? ' val-calc-row--range' : ''));
    const value = el('dd', 'val-calc-value');
    parts.forEach((part, i) => {
      if (i) value.appendChild(document.createTextNode(' – '));
      value.appendChild(el('span', 'val-nowrap', part));
    });
    group.append(el('dt', '', line.term), value, el('dd', 'val-calc-detail', line.detail));
    return group;
  }

  /**
   * Fills a breakdown list, replacing whatever an earlier submission left.
   * @param {HTMLElement} list the dl to fill
   * @param {ReadonlyArray} lines rows from valuation-estimate.js
   */
  function fillCalcList(list, lines) {
    list.replaceChildren(...lines.map(calcRowElement));
  }

  /**
   * "What's moving your number": each answer, ranked, with what it does to the
   * range in words and the buyer's reason in one sentence.
   * @param {Object} est the estimate
   */
  function renderMoves(est) {
    $('valMovesIntro').textContent = E.movesIntro(est);
    $('valMovesList').replaceChildren(...E.rankMoves(est).map((move) => {
      const item = el('li', 'val-move val-move--' + move.direction);
      const head = el('div', 'val-move-head');
      // The comma is for screen readers, which would otherwise run the answer
      // and its dollar effect together; on screen the layout already parts them.
      head.append(el('span', 'val-move-name', move.label), el('span', 'sr-only', ', '),
        el('span', 'val-move-amount', move.amountText));
      item.append(head, el('p', 'val-move-why', move.why));
      return item;
    }));
    const note = E.movesNote(est);
    $('valMovesNote').textContent = note;
    $('valMovesNote').hidden = !note;
  }

  /**
   * The notes that sit by the number: the warm word for a small business and,
   * when the owner holds the property, what that means. Hidden when empty.
   * @param {Object} est the estimate
   */
  function renderSideNotes(est) {
    const small = E.smallBusinessNote(est);
    $('valSmallBizNote').textContent = small;
    $('valSmallBizNote').hidden = !small || !est.showRange;
    const ownsProperty = $('vRealEstate').value === 'yes';
    $('valRealEstateNote').textContent = ownsProperty ? E.REAL_ESTATE_NOTE : '';
    $('valRealEstateNote').hidden = !ownsProperty || !est.showRange;
  }

  /**
   * Why a small business got no number yet, in plain words.
   * @param {Object} est the estimate
   * @returns {string}
   */
  function noRangeReason(est) {
    if (est.method === 'none') {
      return 'The numbers you gave leave no owner earnings for a multiple to work on yet. ';
    }
    // Priced on owner earnings, but so small that a multiple rounds to nothing.
    if (est.method === 'sde' || est.method === 'blend') {
      return 'At these owner earnings, a multiple comes to too little for a range to mean much yet: we round to ' +
        'the nearest ' + fmt(E.roundingStep(est.exactHigh)) + '. ';
    }
    // A tiny revenue with profit left blank can estimate to $0 without any pay
    // being set aside, so the message only blames the salary when there was one.
    return est.ownerPayRemoved
      ? 'You told us your own pay is still inside that profit figure. Once we set aside about ' +
        fmt(est.ownerPayRemoved) + ' to hire someone to do your job, there is not enough left for a multiple to mean anything. '
      : 'At the revenue you entered, typical margins leave too little profit for a multiple to mean anything. ';
  }

  /**
   * The two no-number screens: too large for a calculator, or nothing yet to
   * put a multiple on. The second shows the money lines that got it there and,
   * for a small business, never closes the door.
   * @param {Object} est the estimate
   */
  function renderNoRange(est) {
    if (est.bigDeal) {
      $('valBigLookMsg').textContent = 'Honestly? At your size, a calculator range isn’t worth your time. ' +
        'Businesses like yours trade on things a tool can’t see: buyer appetite, sector momentum, deal ' +
        'structure, and how the story gets told. Rather than hand you a number that could be off by tens of ' +
        'millions in either direction, we’d like to take a real look. That conversation is free, ' +
        'confidential, and worth it at your scale.';
      return;
    }
    const warm = E.smallBusinessNote(est);
    $('valSmallLookMsg').textContent = noRangeReason(est) + 'That is more common than you would think, and it ' +
      'does not mean the business has no value. It usually means the value sits in the assets, the customer ' +
      'relationships, or the right buyer, rather than in the earnings. Let us look at it properly before you ' +
      'take any number seriously.' + (warm ? ' ' + warm : '');
    const lines = E.buildEarningsRows(est);
    fillCalcList($('valSmallCalcList'), lines);
    $('valSmallCalc').hidden = !lines.length;
  }

  /**
   * Draws the result screen for one estimate. Every list is rebuilt from scratch,
   * so a visitor who goes back, changes an answer and resubmits never sees rows
   * left over from the first attempt.
   * @param {Object} est the estimate
   */
  function renderResult(est) {
    $('valNumbers').style.display = est.showRange ? 'block' : 'none';
    $('valBigLook').style.display = est.bigDeal ? 'block' : 'none';
    $('valSmallLook').style.display = (!est.showRange && !est.bigDeal) ? 'block' : 'none';
    $('valCalc').hidden = !est.showRange;
    $('valMoves').hidden = !est.showRange;
    renderSideNotes(est);
    if (est.showRange) {
      $('valNote').textContent = E.rangeNote(est);
      fillCalcList($('valCalcList'), E.buildBreakdownRows(est));
      renderMoves(est);
    } else {
      fillCalcList($('valCalcList'), []);
      $('valMovesList').replaceChildren();
      renderNoRange(est);
    }
    renderSourcesLine(est.industry, est.method);
    renderBuyers(est.industry);
  }

  /**
   * Reports the submission and sends the lead. Non-identifying context only goes
   * to GA4: the visitor's name, email, phone and website go to Formspree and
   * nowhere else, and so do the selling-timeline and real-estate answers.
   * @param {Object} lead the submission
   * @param {Object} est the estimate
   */
  function sendLead(lead, est) {
    const leadContext = {
      industry: lead.industry,
      state: lead.state,
      oversized: est.bigDeal,
      // Oversized businesses, and ones with nothing yet to put a multiple on,
      // get no range on screen, so they carry no comparable value here either.
      value: est.showRange ? est.midpoint : 0,
      currency: 'USD'
    };
    // Cleared first so a visitor who steps back and resubmits is not left looking
    // at a stale warning from an earlier attempt.
    hideLeadWarning();
    if (LEAD_ENDPOINT) {
      const subject = E.leadSubjectPrefix(est) + 'New valuation lead: ' + lead.name +
        ' (' + lead.industry + ', ' + lead.state + ')';
      deliverLead(lead, subject, leadContext);
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
  }

  $('calcBtn').addEventListener('click', () => {
    const name = $('vName').value.trim();
    const email = $('vEmail').value.trim();
    if (!name) return fail(3, 'Please enter your name.', 'vName');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(3, 'Please enter a valid email address.', 'vEmail');
    // Phone stays optional, but a typed one has to be dialable: a test lead
    // arrived with letters for a phone number and no way to call back.
    const phone = $('vPhone').value.trim();
    if (phone && (/[a-z]/i.test(phone) || phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS)) {
      return fail(3, 'Please enter a phone number we can call, or leave it blank.', 'vPhone');
    }
    clearStepErrors(3);

    const est = E.computeEstimate(collectInputs());
    const lead = buildLead(est, { name, email });
    renderResult(est);
    sendLead(lead, est);
    $('valEmailLink').setAttribute('href', buildMailto(lead, est));

    showStep(4);
    if (est.showRange) {
      countUp($('valLow'), est.low, 1200);
      countUp($('valHigh'), est.high, 1400);
      countUp($('valMid'), est.midpoint, 1300);
    }
  });
})();
