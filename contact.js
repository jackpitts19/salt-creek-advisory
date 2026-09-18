/**
 * Contact page enquiry form.
 *
 * The form in contact.html is a real <form> with a Formspree action and method,
 * so it submits and reaches us even if this file never loads, is not supported,
 * or bails out below. This script is an enhancement only: it takes over the
 * submit, validates in place, and swaps in a confirmation without a page change.
 *
 * Why a form exists here at all: /contact is the most-linked page on the site
 * and until now its only actions were booking a principal's calendar or opening
 * a mail client. An owner who was curious but not ready had nowhere to go.
 */
(function () {
  'use strict';

  // Formspree answers slowly rather than never, but a connection can hang. Without
  // this the promise never settles: the button stays disabled reading "Sending..."
  // and the visitor is given no error and no way to retry.
  var REQUEST_TIMEOUT_MS = 15000;

  var form = document.getElementById('contactForm');
  if (!form) return;

  // Progressive-enhancement gate, and it has to come BEFORE anything that changes
  // the form's behaviour. Past this point the submit handler calls preventDefault,
  // which suppresses the native POST; if we then hit a missing element or a missing
  // fetch, the visitor's message would be lost with nothing on screen to say so.
  // Bailing here instead leaves the form exactly as the markup shipped it: a real
  // POST to Formspree, with the browser's own required-field check intact.
  if (typeof window.fetch !== 'function' || typeof window.Promise !== 'function') return;

  var statusEl = document.getElementById('contactStatus');
  var submitBtn = document.getElementById('contactSubmit');
  var fallbackEl = document.getElementById('contactFallback');
  var fallbackLink = document.getElementById('contactFallbackLink');
  var doneEl = document.getElementById('contactDone');
  if (!statusEl || !submitBtn || !fallbackEl || !fallbackLink || !doneEl) return;

  // Same Formspree project as the valuation tool. Submissions are told apart by
  // _subject. Swap this for a dedicated form id if the two streams need to be
  // separated in the Formspree dashboard; nothing else here depends on it.
  var ENDPOINT = form.getAttribute('action');

  // Hand validation to this file, now that we know this file can finish the job.
  // The required attributes stay in the markup for the no-JavaScript path. With
  // JavaScript the browser's own bubble would fire first and suppress the submit
  // event, which would leave the announced, focus-moving error below as dead code:
  // native bubbles are not reliably read out, which is the exact defect this form
  // exists to avoid repeating.
  form.noValidate = true;

  var FIELDS = [
    { id: 'cName', label: 'your name', required: true },
    { id: 'cEmail', label: 'your email address', required: true, email: true },
    { id: 'cPhone', label: 'your phone number', required: false },
    { id: 'cMessage', label: 'a short message', required: true }
  ];

  // analytics.js owns the GA4 guard and exposes this. Absent only if that file
  // failed to load, in which case there is nothing to report to anyway.
  function track(eventName, params) {
    if (typeof window.scTrack === 'function') window.scTrack(eventName, params);
  }

  function el(id) { return document.getElementById(id); }

  function valueOf(id) {
    var node = el(id);
    return node ? node.value.trim() : '';
  }

  var isSending = false;

  function markSending() {
    isSending = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.textContent = 'Sending…';
  }

  function resetButton() {
    isSending = false;
    submitBtn.removeAttribute('aria-disabled');
    submitBtn.removeAttribute('aria-busy');
    submitBtn.textContent = 'Send Message';
  }

  /**
   * Announces a problem and moves focus to the field that caused it.
   *
   * The valuation tool writes its three validation messages silently, with no
   * role, no aria-live and no focus move, so a screen reader user learns nothing
   * when it rejects them. This form does not repeat that.
   * @param {string} message what went wrong, in plain language
   * @param {string} fieldId the field to mark invalid and focus
   */
  function fail(message, fieldId) {
    statusEl.className = 'contact-status contact-status--error';
    statusEl.textContent = message;
    FIELDS.forEach(function (field) {
      var node = el(field.id);
      if (!node) return;
      var isCulprit = field.id === fieldId;
      node.setAttribute('aria-invalid', String(isCulprit));
      if (isCulprit) node.setAttribute('aria-describedby', 'contactStatus');
      else node.removeAttribute('aria-describedby');
    });
    var target = el(fieldId);
    if (target) target.focus();
  }

  function clearStatus() {
    statusEl.className = 'contact-status';
    statusEl.textContent = '';
    FIELDS.forEach(function (field) {
      var node = el(field.id);
      if (!node) return;
      node.removeAttribute('aria-invalid');
      node.removeAttribute('aria-describedby');
    });
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  /**
   * Announces the first unusable field and reports whether there was one.
   * @returns {boolean} true when the form cannot be submitted
   */
  function announceFirstProblem() {
    for (var i = 0; i < FIELDS.length; i++) {
      var field = FIELDS[i];
      var value = valueOf(field.id);
      if (field.required && !value) {
        fail('Please enter ' + field.label + '.', field.id);
        return true;
      }
      if (field.email && value && !isEmail(value)) {
        fail('That email address does not look right. Please check it.', field.id);
        return true;
      }
    }
    return false;
  }

  /**
   * Percent-encodes a value without ever throwing.
   *
   * encodeURIComponent raises URIError on an unpaired surrogate, which reaches a
   * message box more often than it sounds: a truncated emoji pasted out of a PDF,
   * a CRM or a phone clipboard. JSON.stringify tolerates the same input, so the
   * POST would succeed while the fallback that exists FOR a failed POST is the
   * thing that dies. Strip the stray halves and encode what remains.
   * @param {string} value raw visitor input
   * @returns {string} a percent-encoded string, possibly empty
   */
  function safeEncode(value) {
    try {
      return encodeURIComponent(value);
    } catch (err) {
      var cleaned = value
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
   * Builds the mailto the visitor falls back to when the POST does not land.
   *
   * Every part the visitor typed is percent-encoded. Everything after the "?" in
   * a mailto is parsed as headers, so an unencoded message containing "&bcc=" or
   * "&subject=" would rewrite the message we receive.
   * @param {Object} enquiry the submitted values
   * @returns {string} a mailto href
   */
  function mailtoFor(enquiry) {
    var subject = 'Enquiry from ' + enquiry.name + ' via saltcreekadvisory.com';
    var body = 'Name: ' + enquiry.name +
      '\nEmail: ' + enquiry.email +
      (enquiry.phone ? '\nPhone: ' + enquiry.phone : '') +
      '\n\n' + enquiry.message;
    return 'mailto:jack@saltcreekadvisory.com?cc=connor@saltcreekadvisory.com' +
      '&subject=' + safeEncode(subject) +
      '&body=' + safeEncode(body);
  }

  /**
   * Replaces the form with a confirmation and moves focus to it, so the outcome
   * is announced rather than left to whoever happens to be looking at the screen.
   */
  function succeed() {
    form.hidden = true;
    doneEl.hidden = false;
    doneEl.focus();
    track('contact_form_submit', { outcome: 'delivered' });
  }

  /**
   * Says plainly that the message did not reach us and hands over a pre-written
   * email. Silence here would be the worst outcome: the visitor would believe a
   * message was sent that we never received.
   * @param {Object} enquiry the submitted values
   */
  function offerFallback(enquiry) {
    statusEl.className = 'contact-status contact-status--error';
    statusEl.textContent = 'Your message did not reach us. Please use the email link below, ' +
      'which is already written for you, or write to jack@saltcreekadvisory.com directly.';
    fallbackLink.setAttribute('href', mailtoFor(enquiry));
    fallbackEl.hidden = false;
    fallbackLink.focus();
    track('contact_form_submit', { outcome: 'failed' });
  }

  /**
   * Posts the enquiry and reports the outcome.
   *
   * The rejection handler is paired with succeed rather than chained after it.
   * A trailing .catch would also observe anything succeed itself threw, and would
   * then write the failure message into #contactStatus, which lives inside the
   * form succeed has just hidden: the visitor would see an empty page region
   * after a message that actually arrived.
   * @param {Object} enquiry the submitted values
   */
  function deliver(enquiry) {
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timeoutId = controller
      ? window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS)
      : null;

    var request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: 'New contact enquiry: ' + enquiry.name,
        // Formspree's spam trap only fires on a non-empty _gotcha it actually
        // receives. The field is in the markup, so leaving it out of this body
        // would switch the filter off for every submission that runs this file,
        // which is effectively all of them.
        _gotcha: enquiry.gotcha,
        source: 'contact page',
        name: enquiry.name,
        email: enquiry.email,
        phone: enquiry.phone,
        message: enquiry.message
      })
    };
    if (controller) request.signal = controller.signal;

    // Formspree answers with a non-OK status rather than a network error once the
    // plan's monthly submission quota is spent, so the status is checked
    // explicitly: that is the failure most likely to happen quietly.
    return fetch(ENDPOINT, request).then(function (response) {
      if (!response.ok) throw new Error('Formspree responded ' + response.status);
    }).then(function () {
      succeed();
    }, function () {
      offerFallback(enquiry);
    }).then(settle, settle);

    function settle() {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resetButton();
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (isSending) return;
    try {
      clearStatus();
      fallbackEl.hidden = true;

      if (announceFirstProblem()) return;

      var enquiry = {
        name: valueOf('cName'),
        email: valueOf('cEmail'),
        phone: valueOf('cPhone'),
        message: valueOf('cMessage'),
        gotcha: valueOf('cCompanyUrl')
      };

      markSending();
      // Deliberately not announced in #contactStatus: that region is assertive, and a
      // progress update has no business interrupting whatever the screen reader is
      // mid-sentence on. The button label carries the same information.
      statusEl.className = 'contact-status';
      statusEl.textContent = '';

      deliver(enquiry);
    } catch (err) {
      // preventDefault has already suppressed the native POST, so failing quietly
      // here would lose the message with nothing on screen to show for it.
      resetButton();
      statusEl.className = 'contact-status contact-status--error';
      statusEl.textContent = 'Something went wrong on this page and your message was not sent. ' +
        'Please email jack@saltcreekadvisory.com directly.';
    }
  });
})();
