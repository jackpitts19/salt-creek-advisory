// Google Analytics 4 initialization and site-wide conversion tracking.
// Extracted from an inline <script> so the site can ship a Content-Security-Policy
// without 'unsafe-inline' on script-src. dataLayer is a queue, so this file and the
// async gtag.js loader may execute in either order.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-YQGFZDGZ2N');

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
