/**
 * Buyer list form on /investors.
 *
 * Without this file the form is a plain POST to Formspree, the same path the
 * contact form falls back to, so a buyer is never left with a form that cannot
 * send; that path cannot carry a file, so the upload stays hidden. With it, the
 * upload appears and the form posts multipart data to /api/buyer-list on this
 * origin, where the Worker (src/buyer-intake.js, src/buyer-criteria.js) checks
 * it and puts the buyer straight onto the buyer list in HelmIQ with what they
 * buy filled in, ready for deal matching. The Worker repeats every check below;
 * these exist so the buyer hears about a problem next to the field, before
 * anything is sent.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/buyer-list';
  // Longer than the Worker's worst case (two HelmIQ attempts, then the fallback),
  // so the page never reports a failure for a sign-up that went through.
  var REQUEST_TIMEOUT_MS = 60000;
  var MAX_ONE_PAGER_BYTES = 4 * 1024 * 1024;
  var TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  var form = document.getElementById('buyerForm');
  if (!form) return;
  // Same gate as contact.js: past this point submit is intercepted, so bail
  // while the native POST still works if the browser cannot finish the job.
  if (typeof window.fetch !== 'function' || typeof window.Promise !== 'function') return;

  function el(id) { return document.getElementById(id); }

  var statusEl = el('buyerStatus');
  var submitBtn = el('buyerSubmit');
  var doneEl = el('buyerDone');
  var turnstileSlot = el('buyerTurnstile');
  if (!statusEl || !submitBtn || !doneEl || !turnstileSlot) return;

  form.noValidate = true;

  // The upload only works through this file, so it appears only now.
  var uploadField = el('bUploadField');
  var fileInput = el('bOnePager');
  if (uploadField && fileInput) uploadField.hidden = false;

  // Fund size and vintage are asked of buyers who raise a fund, and an EBITDA
  // band of everyone but strategics. Same lists as src/buyer-criteria.js.
  var FUND_TYPES = ['private_equity', 'family_office'];
  var EBITDA_OPTIONAL_TYPES = ['strategic'];
  var typeSelect = el('bType');
  var fundFields = el('bFundFields');
  var ebitdaHint = el('bEbitdaHint');

  function isFundBuyer() { return FUND_TYPES.indexOf(value('bType')) !== -1; }
  function ebitdaRequired() { return EBITDA_OPTIONAL_TYPES.indexOf(value('bType')) === -1; }

  function syncToBuyerType() {
    // Shown until a type is chosen that does not raise a fund, so a buyer who
    // has not picked yet still sees every question.
    if (fundFields) fundFields.hidden = value('bType') !== '' && !isFundBuyer();
    if (ebitdaHint) ebitdaHint.textContent = ebitdaRequired() ? '' : '(optional)';
  }
  if (typeSelect) {
    typeSelect.addEventListener('change', syncToBuyerType);
    syncToBuyerType();
  }

  // Server field name -> the element an error about it should point at.
  var FIELD_TARGETS = {
    fullName: 'bName', email: 'bEmail', firmName: 'bFirm', firmWebsite: 'bWebsite',
    buyerType: 'bType', onePager: 'bOnePager', whatYouBuy: 'bWhatYouBuy',
    consent: 'bConsent', turnstile: 'buyerTurnstile', sectors: 'bSectors',
    ebitdaMinM: 'bEbitdaMin', ebitdaMaxM: 'bEbitdaMax', revenueMinM: 'bRevenueMin', revenueMaxM: 'bRevenueMax',
    addOnEbitdaMinM: 'bAddOnMin', addOnEbitdaMaxM: 'bAddOnMax',
    currentFundSizeM: 'bFundSize', currentFundVintage: 'bFundVintage'
  };

  // [form field, min input, max input, words for the message]
  var RANGES = [
    ['ebitdaMinM', 'bEbitdaMin', 'bEbitdaMax', 'EBITDA'],
    ['revenueMinM', 'bRevenueMin', 'bRevenueMax', 'revenue'],
    ['addOnEbitdaMinM', 'bAddOnMin', 'bAddOnMax', 'add-on EBITDA']
  ];
  var MONEY = /^\$?\d[\d,]*(\.\d+)?\s*(m|mm|million)?$/i;

  var turnstileWidget = null;

  function track(eventName, params) {
    if (typeof window.scTrack === 'function') window.scTrack(eventName, params);
  }

  function value(id) {
    var node = el(id);
    return node ? node.value.trim() : '';
  }

  function chosenFile() {
    return fileInput && fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
  }

  function clearErrors() {
    statusEl.className = 'contact-status';
    statusEl.textContent = '';
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (node) {
      node.removeAttribute('aria-invalid');
    });
  }

  /**
   * Prints the problem above the button and moves focus to the field it is about.
   * One status line rather than a slot per field: the form is long, and the line
   * sits next to the button the buyer just pressed.
   */
  function fail(message, field) {
    var target = el(FIELD_TARGETS[field] || '');
    // A tick-box group is marked as a whole; focus goes to its first box.
    if (target && target.tagName === 'FIELDSET') {
      target.setAttribute('aria-invalid', 'true');
      target = target.querySelector('input');
    }
    statusEl.className = 'contact-status contact-status--error';
    statusEl.textContent = message;
    if (target && target.tagName !== 'DIV') {
      target.setAttribute('aria-invalid', 'true');
      target.focus({ preventScroll: true });
      (target.closest('.val-field') || target).scrollIntoView({ block: 'center' });
    } else {
      statusEl.focus();
    }
  }

  function checked(name) {
    return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (box) {
      return box.value;
    });
  }

  function amount(id) {
    var text = value(id);
    return text === '' ? null : MONEY.test(text) ? parseFloat(text.replace(/[$,]/g, '')) : NaN;
  }

  /** The first problem with the what-you-buy answers, as [field, message], or null. */
  function criteriaProblem() {
    if (checked('sectors').length === 0) return ['sectors', 'Please tick at least one sector you buy in.'];
    for (var i = 0; i < RANGES.length; i++) {
      var range = RANGES[i];
      var min = amount(range[1]);
      var max = amount(range[2]);
      if (isNaN(min)) return [range[0], 'Please enter the ' + range[3] + ' range in $ millions, for example 5.'];
      if (isNaN(max)) return [range[0].replace('Min', 'Max'), 'Please enter the ' + range[3] + ' range in $ millions, for example 5.'];
      if (min !== null && max !== null && max < min) {
        return [range[0].replace('Min', 'Max'), 'The top of the ' + range[3] + ' range is below the bottom.'];
      }
      if (i === 0 && min === null && max === null && ebitdaRequired()) {
        return ['ebitdaMinM', 'Please enter the EBITDA range you buy, in $ millions.'];
      }
    }
    if (isFundBuyer()) {
      var size = amount('bFundSize');
      if (isNaN(size) || size === 0) return ['currentFundSizeM', 'Please enter the fund size in $ millions, for example 450.'];
      var vintage = value('bFundVintage');
      if (vintage && !/^(19[89]\d|20\d\d)$/.test(vintage)) {
        return ['currentFundVintage', 'Please enter the year the fund closed, for example 2023.'];
      }
    }
    return null;
  }

  function firstProblem() {
    var file = chosenFile();
    if (!value('bName')) return ['fullName', 'Please enter your name.'];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('bEmail'))) return ['email', 'Please enter a valid work email.'];
    if (!value('bFirm')) return ['firmName', "Please enter your firm's name."];
    if (!value('bType')) return ['buyerType', 'Please choose what kind of buyer you are.'];
    var criteria = criteriaProblem();
    if (criteria) return criteria;
    if (file && file.size > MAX_ONE_PAGER_BYTES) {
      return ['onePager', 'That file is over 4 MB. Please upload a smaller PDF, or email it to us.'];
    }
    if (file && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      return ['onePager', 'Please upload your one-pager as a PDF.'];
    }
    if (!el('bConsent').checked) return ['consent', 'Please tick the box so we can email you opportunities.'];
    if (turnstileWidget !== null && !(window.turnstile && window.turnstile.getResponse(turnstileWidget))) {
      return ['turnstile', 'Please complete the check above the button.'];
    }
    return null;
  }

  function collect() {
    var data = new FormData();
    data.append('fullName', value('bName'));
    data.append('email', value('bEmail'));
    data.append('firmName', value('bFirm'));
    data.append('firmWebsite', value('bWebsite'));
    data.append('buyerType', value('bType'));
    checked('sectors').forEach(function (sector) { data.append('sectors', sector); });
    checked('geography').forEach(function (region) { data.append('geography', region); });
    RANGES.forEach(function (range) {
      data.append(range[0], value(range[1]));
      data.append(range[0].replace('Min', 'Max'), value(range[2]));
    });
    if (isFundBuyer()) {
      data.append('currentFundSizeM', value('bFundSize'));
      data.append('currentFundVintage', value('bFundVintage'));
    }
    data.append('whatYouBuy', value('bWhatYouBuy'));
    data.append('consent', el('bConsent').checked ? 'yes' : '');
    data.append('website_confirm', value('bConfirmUrl'));
    data.append('turnstileToken', turnstileWidget !== null && window.turnstile ? window.turnstile.getResponse(turnstileWidget) : '');
    var file = chosenFile();
    if (file) data.append('onePager', file, file.name);
    return data;
  }

  var isSending = false;

  function setSending(sending) {
    isSending = sending;
    if (sending) {
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.textContent = 'Sending…';
    } else {
      submitBtn.removeAttribute('aria-disabled');
      submitBtn.removeAttribute('aria-busy');
      submitBtn.textContent = 'Join the Buyer List';
    }
  }

  function showDone() {
    form.hidden = true;
    doneEl.hidden = false;
    doneEl.focus();
    track('buyer_list_signup');
  }

  function resetTurnstile() {
    if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (isSending) return;
    clearErrors();

    var problem = firstProblem();
    if (problem) {
      fail(problem[1], problem[0]);
      return;
    }

    setSending(true);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch(ENDPOINT, {
      method: 'POST',
      // No Content-Type: the browser writes the multipart boundary itself.
      headers: { Accept: 'application/json' },
      body: collect(),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        return { status: response.status, body: body };
      });
    }).then(function (result) {
      clearTimeout(timer);
      setSending(false);
      if (result.status === 200 && result.body.ok) {
        showDone();
        return;
      }
      resetTurnstile();
      // The Worker wants a bot check this page never drew (blocked by an ad
      // blocker, or the check failed to load): asking for it again is a dead end.
      if (result.body.field === 'turnstile' && turnstileWidget === null) {
        fail('The security check could not load in this browser. Please email jack@saltcreekadvisory.com and we will add you.', 'form');
        return;
      }
      fail(result.body.error || 'We could not send this just now. Please try again in a moment.', result.body.field || 'form');
    }).catch(function () {
      clearTimeout(timer);
      setSending(false);
      resetTurnstile();
      fail('We could not reach the server. Please try again, or email jack@saltcreekadvisory.com.', 'form');
    });
  });

  // The bot check is drawn only when the Worker says a site key is configured,
  // so the form keeps working, without it, until Turnstile is set up.
  fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.ok ? response.json() : {}; })
    .then(function (config) {
      if (!config || !config.turnstileSiteKey) return;
      var script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = function () {
        if (!window.turnstile) return;
        turnstileWidget = window.turnstile.render(turnstileSlot, {
          sitekey: config.turnstileSiteKey,
          theme: 'dark',
          size: 'flexible'
        });
      };
      document.head.appendChild(script);
    })
    .catch(function () { /* No config: the form still sends; the Worker decides. */ });
})();
