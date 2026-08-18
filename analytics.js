// Google Analytics 4 initialization and site-wide conversion tracking.
// Extracted from an inline <script> so the site can ship a Content-Security-Policy
// without 'unsafe-inline' on script-src. dataLayer is a queue, so this file and the
// async gtag.js loader may execute in either order.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }

// Consent Mode v2. These are queued ahead of the config command below, which is
// what matters: dataLayer is an ordered queue, so gtag.js applies them to every
// hit no matter which file wins the load race.
//
// Advertising storage is denied everywhere because the firm runs no ads. That
// keeps the privacy policy's "we do not use analytics data for advertising"
// sentence true, which it was not while Google Signals was live.
const CONSENT_REQUIRED_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
];

// EEA, UK and Switzerland: nothing is stored or read. There is no banner to
// grant consent, so these visitors simply go unmeasured. That is the right
// trade for a firm that sells only to US business owners.
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  functionality_storage: 'granted',
  security_storage: 'granted',
  region: CONSENT_REQUIRED_REGIONS,
});

// Everywhere else, which is the actual audience: analytics on, advertising off.
// A US visitor sees and feels no difference; measurement is unchanged.
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted',
  functionality_storage: 'granted',
  security_storage: 'granted',
});

gtag('set', 'ads_data_redaction', true);
gtag('set', 'url_passthrough', true);

// Global Privacy Control. Costs one visitor's pageview and removes the whole GPC
// theory, which is the most actively enforced US privacy claim right now.
if (navigator.globalPrivacyControl === true) {
  gtag('consent', 'update', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
}

gtag('js', new Date());
// allow_google_signals disables the join to signed-in Google ad profiles from
// the tag side. Turn the property-level toggle off in the GA4 console too: this
// flag stops the beacon, the console setting stops the feature.
gtag('config', 'G-YQGFZDGZ2N', {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
});

(function () {
  'use strict';

  // Booking lives on a different origin, so a click leaves no trace in GA4 unless
  // we record it here. It is the most valuable action on the site.
  const BOOKING_HOST_PATH = 'helmiq.net/book';
  // Our own downloadable collateral, as opposed to the third-party research PDFs
  // cited throughout the articles. Only the former says anything about intent.
  const OWN_ASSET_PATH_PREFIX = '/assets/';

  // Which block of the page the clicked link sits in, so the footer booking link
  // can be compared against the one on the valuation result screen. Ordered most
  // specific first: the first match wins.
  const CTA_REGIONS = [
    { selector: '.val-result-actions', name: 'valuation_result' },
    { selector: '.contact-actions', name: 'contact_hero' },
    { selector: '.nav-mobile-drawer', name: 'mobile_menu' },
    { selector: 'nav', name: 'nav' },
    { selector: 'footer', name: 'footer' },
    { selector: '.article-body', name: 'article_body' },
  ];

  /**
   * Sends a GA4 event. Safe to call before gtag.js has loaded (or when an ad
   * blocker stops it loading at all) because gtag only ever queues into dataLayer.
   * @param {string} eventName
   * @param {Object} [params]
   */
  function track(eventName, params) {
    if (!eventName) return;
    gtag('event', eventName, Object.assign({}, params || {}));
  }

  // valuation.js reports its funnel through the same helper rather than
  // re-implementing the guard.
  window.scTrack = track;

  function regionOf(link) {
    const region = CTA_REGIONS.find(({ selector }) => link.closest(selector));
    return region ? region.name : 'page_body';
  }

  /**
   * Resolves a link to an absolute URL. Returns null for hrefs the browser cannot
   * parse and for the in-page "#" placeholder the valuation tool rewrites later.
   * @param {HTMLAnchorElement} link
   * @returns {URL|null}
   */
  function resolveUrl(link) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return null;
    try {
      return new URL(link.href);
    } catch (err) {
      return null;
    }
  }

  /**
   * Classifies a link into a GA4 event name plus parameters, or null when the link
   * is ordinary internal navigation that page_view already covers.
   * @param {HTMLAnchorElement} link
   * @param {URL} url
   * @returns {{name: string, params: Object}|null}
   */
  function classify(link, url) {
    const region = regionOf(link);

    if (url.protocol === 'mailto:') {
      // pathname carries the address; strip any ?subject=/&body= the tool appends.
      return { name: 'contact_email_click', params: { mailbox: url.pathname, cta_region: region } };
    }
    if (url.protocol === 'tel:') {
      return { name: 'contact_phone_click', params: { phone: url.pathname, cta_region: region } };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    if ((url.host + url.pathname).includes(BOOKING_HOST_PATH)) {
      return { name: 'book_call_click', params: { cta_region: region, link_url: url.href } };
    }

    if (url.hostname === window.location.hostname) {
      if (!url.pathname.startsWith(OWN_ASSET_PATH_PREFIX)) return null;
      return {
        name: 'resource_download',
        params: { file_name: url.pathname.split('/').pop(), cta_region: region },
      };
    }

    return {
      name: 'outbound_click',
      params: { outbound_domain: url.hostname, link_url: url.href, cta_region: region },
    };
  }

  // Delegated so no markup changes are needed across the 45 pages, and so links the
  // valuation tool rewrites at runtime are covered too.
  document.addEventListener('click', (event) => {
    const target = event.target;
    const link = target && target.closest ? target.closest('a[href]') : null;
    if (!link) return;
    const url = resolveUrl(link);
    if (!url) return;
    const classified = classify(link, url);
    if (!classified) return;
    track(classified.name, classified.params);
  });
}());
