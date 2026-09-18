// Salt Creek Advisory, shared site behavior
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mobile hamburger. On a phone this is the ONLY navigation control on the page,
// so it has to announce its state and it has to be dismissable the two ways every
// other drawer on the web is: tap away, or press Escape. Previously it did
// neither, and aria-expanded was never set at all, so a screen reader user was
// told nothing about whether the menu was open.
const hamburger = document.getElementById('hamburger');
const drawer = document.getElementById('mobileDrawer');

const setDrawer = (open) => {
  if (!hamburger || !drawer) return;
  hamburger.classList.toggle('open', open);
  drawer.classList.toggle('open', open);
  hamburger.setAttribute('aria-expanded', String(open));
  hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
};

const closeDrawer = () => setDrawer(false);

if (hamburger && drawer) {
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.addEventListener('click', () => {
    setDrawer(!drawer.classList.contains('open'));
  });

  // Tap anywhere outside the drawer and the button that opened it.
  document.addEventListener('click', (e) => {
    if (!drawer.classList.contains('open')) return;
    if (drawer.contains(e.target) || hamburger.contains(e.target)) return;
    closeDrawer();
  });

  // Escape closes and hands focus back to the control that opened it, so a
  // keyboard user is not dropped at the top of the document.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !drawer.classList.contains('open')) return;
    closeDrawer();
    hamburger.focus();
  });
}

// Delegated so the markup needs no inline onclick, which lets the CSP drop
// 'unsafe-inline' from script-src.
if (drawer) {
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a')) closeDrawer();
  });
}

// Image fallbacks for browsers that cannot decode the primary (WebP) source.
// Replaces the former inline onerror handlers.
const applyImageFallback = (img) => {
  const fallback = img.getAttribute('data-fallback');
  if (!fallback || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = 'true';
  img.src = fallback;
};
document.querySelectorAll('img[data-fallback]').forEach(img => {
  img.addEventListener('error', () => applyImageFallback(img), { once: true });
  // The error may already have fired before this script ran.
  if (img.complete && img.naturalWidth === 0) applyImageFallback(img);
});

// The scroll-reveal observer that used to live here is gone. It was the only
// thing that made .reveal content visible, so a failure to reach this line left
// the page blank. Entrances are CSS-only now (see heroRise in styles.css).

// Nav scrolled state
const navEl = document.getElementById('nav');
if (navEl) {
  const onScroll = () => navEl.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// FAQ accordion
function closeFaqItem(item) {
  item.classList.remove('open');
  item.querySelector('.faq-a').style.maxHeight = null;
  item.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
}

/**
 * Opens one answer and closes the others. Shared by the click handler and the
 * deep-link handler below, so an answer reached from a #hash ends up in exactly
 * the same state as one opened by hand.
 * @param {Element} item the .faq-item to open
 */
function openFaqItem(item) {
  document.querySelectorAll('.faq-item.open').forEach(other => {
    if (other !== item) closeFaqItem(other);
  });
  const answer = item.querySelector('.faq-a');
  item.classList.add('open');
  item.querySelector('.faq-q').setAttribute('aria-expanded', 'true');
  answer.style.maxHeight = answer.scrollHeight + 'px';
}

document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    if (item.classList.contains('open')) closeFaqItem(item);
    else openFaqItem(item);
  });
});

/**
 * Opens the answer named in the URL, so faq#what-does-it-cost lands on that
 * answer instead of on thirteen collapsed questions.
 *
 * The answers on this page are the firm's objection handling, and they were
 * reachable only by scrolling and guessing: every item was anchorless, so no
 * page could send a reader to the specific fear it had just raised.
 */
function openFaqFromHash() {
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  // decodeURIComponent throws URIError on a malformed escape, and "#50%" is an
  // ordinary thing to find on the end of a shared or campaign URL. This runs at
  // top level in a non-deferred script, so an uncaught throw here would abort the
  // rest of this file on every page: the articles tabs and the reading progress
  // bar would silently stop existing. An id is usable un-decoded, so fall back.
  let hash;
  try {
    hash = decodeURIComponent(raw);
  } catch (err) {
    hash = raw;
  }
  const item = document.getElementById(hash);
  if (!item || !item.classList.contains('faq-item')) return;

  // Open immediately so the answer is never briefly visible as a collapsed row.
  openFaqItem(item);

  // Everything that touches focus, scroll position or measurement waits for load.
  //
  // Focus has to wait because the browser does its OWN fragment handling after
  // this script has run, and the target here is a <div>, which is not focusable,
  // so the browser resets focus to <body> and silently undoes an earlier focus()
  // call. Measured: focusing during parse left activeElement as BODY on a cold
  // load. Measurement has to wait because scrollHeight taken before the webfonts
  // settle leaves the answer clipped at the wrong height.
  //
  // Checking readyState first matters: a listener added after load has fired never
  // runs, so { once: true } would never remove it either, and every hashchange on
  // an already-loaded page would leave a dead listener holding its closure. Same
  // shape as the articles tabs below.
  const settle = () => {
    const answer = item.querySelector('.faq-a');
    if (!item.classList.contains('open')) return;
    answer.style.maxHeight = answer.scrollHeight + 'px';
    // Focus the question, not the panel, so the next Tab continues into the answer.
    // preventScroll because scrollIntoView below owns the final position.
    const question = item.querySelector('.faq-q');
    question.focus({ preventScroll: true });
    // A programmatic focus generally does NOT match :focus-visible when the visitor
    // arrived by clicking a link on another page, so the global ring would not paint
    // and a sighted keyboard user would not see where focus went. Paint it for this
    // one case, and drop it the moment they take over.
    item.classList.add('faq-item--deeplinked');
    const dropRing = () => item.classList.remove('faq-item--deeplinked');
    document.addEventListener('click', dropRing, { once: true });
    document.addEventListener('keydown', dropRing, { once: true });
    item.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  if (document.readyState === 'complete') settle();
  else window.addEventListener('load', settle, { once: true });
}

openFaqFromHash();
window.addEventListener('hashchange', openFaqFromHash);

// Articles index category tabs. Shows one category at a time so the page lands
// as a single screen instead of a 29-card scroll. Enhancement only: the markup
// is a plain list of anchor links pointing at sections that are all visible by
// default, so if this never runs the page still works as a stacked index.
const articlesSection = document.querySelector('.articles-list');
const articlesTabBar = articlesSection && articlesSection.querySelector('.articles-jump');
if (articlesTabBar) {
  const tabs = Array.from(articlesTabBar.querySelectorAll('a[href^="#"]'));
  const panels = tabs.map(tab => document.querySelector(tab.getAttribute('href')));

  // Bail out rather than hide anything if a tab points at a section that is not
  // there, otherwise a stale link would blank out part of the index.
  if (tabs.length > 1 && panels.every(Boolean)) {
    articlesSection.classList.add('articles-tabs-on');
    articlesTabBar.setAttribute('role', 'tablist');

    tabs.forEach((tab, i) => {
      const panel = panels[i];
      if (!tab.id) tab.id = 'tab-' + panel.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.setAttribute('tabindex', '0');
    });

    const selectTab = (index, { moveFocus = false } = {}) => {
      tabs.forEach((tab, i) => {
        const isActive = i === index;
        tab.setAttribute('aria-selected', String(isActive));
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
        panels[i].classList.toggle('is-active', isActive);
      });
      if (moveFocus) tabs[index].focus();
    };

    const indexFromHash = () =>
      tabs.findIndex(tab => tab.getAttribute('href') === window.location.hash);

    const revealBar = (behavior) => {
      if (articlesTabBar.getBoundingClientRect().top < 72) {
        articlesTabBar.scrollIntoView({ block: 'start', behavior });
      }
    };

    articlesTabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('a[role="tab"]');
      if (!tab || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      selectTab(tabs.indexOf(tab));
      // replaceState keeps a tab shareable without stacking a history entry per
      // click, and without the jump that assigning location.hash would cause.
      window.history.replaceState(null, '', tab.getAttribute('href'));
      revealBar(reduceMotion ? 'auto' : 'smooth');
    });

    articlesTabBar.addEventListener('keydown', (e) => {
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;
      const last = tabs.length - 1;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current === last ? 0 : current + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = current === 0 ? last : current - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === -1) return;
      e.preventDefault();
      selectTab(next, { moveFocus: true });
      window.history.replaceState(null, '', tabs[next].getAttribute('href'));
    });

    const initialHash = window.location.hash;
    const initial = indexFromHash();

    // A deep link makes the browser scroll to the section it names, but that
    // section is now the top of the tab list, so the scroll only pushes the bar
    // out of view and hides that the other categories are one click away.
    // Trying to scroll back afterwards loses a race with the browser, so remove
    // the fragment before it ever scrolls and put it back once the page has
    // loaded, which keeps the URL shareable. replaceState never scrolls.
    if (initial !== -1) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    selectTab(initial === -1 ? 0 : initial);

    if (initial !== -1) {
      // Removing the fragment above is enough on its own: the page then loads at
      // the top, showing the hero and the bar with the linked category already
      // selected. Put the URL back afterwards so it stays shareable.
      const restoreHash = () => window.history.replaceState(null, '', initialHash);
      if (document.readyState === 'complete') restoreHash();
      else window.addEventListener('load', restoreHash, { once: true });
    }

    window.addEventListener('hashchange', () => {
      const index = indexFromHash();
      if (index !== -1) selectTab(index);
    });
  }
}

// The stat count-up that used to live here is gone. Its regex captured only the
// first digit run (/^([^0-9]*)(\d+)(.*)$/), so every decimal stat animated its
// leading digit while the decimals sat frozen as a static suffix: "$1.87B" began
// life as "$0.87B", "8.78%" as "0.78%", "8.9x" as "0.9x". Six of the eight values
// it touched are approximations or ratios ("~$350B", "~60%", "8.9x", "Selective"),
// so ratcheting them added nothing a reader trusts, and the brand system bans
// motion on numbers outright. The figures now render as written.

// Internal links navigate straight away. There used to be an exit
// transition here that called preventDefault and then sat on a 300ms
// timer before setting location.href. Pages on this site arrive in well
// under that, so the timer was the slowest part of every click and it
// made the site feel heavier than it is. The pageIn entrance in
// styles.css still covers the arrival.

// Reading progress bar
const progressBar = document.createElement('div');
progressBar.className = 'scroll-progress';
progressBar.setAttribute('aria-hidden', 'true');
document.body.appendChild(progressBar);
const updateProgress = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
};
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress, { passive: true });
updateProgress();
