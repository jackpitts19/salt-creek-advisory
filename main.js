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
  // The drawer covers the page but did not own focus: Tab after its last
  // link landed on the hero buttons underneath it, with no visible ring and
  // the menu still open. inert takes the page out of the tab order and the
  // accessibility tree while the menu is up. The nav stays live so the
  // hamburger itself remains reachable.
  document.querySelectorAll('main, footer').forEach((el) => { el.inert = open; });
  // Locks page scroll behind the drawer (styles.css, html.nav-open).
  document.documentElement.classList.toggle('nav-open', open);
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
  // A srcset would outrank src, so drop it or the fallback never shows.
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.src = fallback;
};
document.querySelectorAll('img[data-fallback]').forEach(img => {
  img.addEventListener('error', () => applyImageFallback(img), { once: true });
  // The error may already have fired before this script ran.
  if (img.complete && img.naturalWidth === 0) applyImageFallback(img);
});

// Guide tables sit in an .article-table-wrap that scrolls sideways on a phone,
// but nothing said so: a reader saw the fourth column clipped to "PRIN / DRIV"
// and no hint that the rest was a swipe away. Mark the wraps that actually
// overflow, and styles.css draws a sticky "Swipe" cue above those alone.
const tableWraps = Array.from(document.querySelectorAll('.article-table-wrap'));
// Sub-pixel column widths can leave a table 1px wider than its wrap, which
// scrolls in name only. Below this much overflow nothing a reader needs is hidden.
const SCROLL_CUE_MIN_PX = 4;
const markScrollableTables = () => {
  tableWraps.forEach((wrap) => {
    const isScrollable = wrap.scrollWidth - wrap.clientWidth >= SCROLL_CUE_MIN_PX;
    wrap.classList.toggle('is-scrollable', isScrollable);
    // A scrolling table is a keyboard tab stop with a name, but only while it
    // scrolls, and never over a tabindex the page itself authored.
    if (wrap.dataset.a11yAuthored === undefined) {
      wrap.dataset.a11yAuthored = wrap.hasAttribute('tabindex') ? '1' : '0';
    }
    if (wrap.dataset.a11yAuthored === '1') return;
    if (isScrollable) {
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Comparison table, scrollable');
    } else {
      wrap.removeAttribute('tabindex');
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-label');
    }
  });
};
if (tableWraps.length) {
  markScrollableTables();
  // Webfonts settle after this script runs and can change a column's width.
  window.addEventListener('load', markScrollableTables, { once: true });
  window.addEventListener('resize', markScrollableTables, { passive: true });
}

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

// Articles index topic filter. The markup is a plain bar of jump links over a
// fully stacked index, so without this script every guide is still listed and
// each link still scrolls to its group. When it runs, each link becomes a
// toggle button (aria-pressed): one shows only its group, "All" shows them all.
// Real <button>s, so Tab, Enter and Space work with no key handling of our own.
const articlesSection = document.querySelector('.articles-list');
const articlesFilterBar = articlesSection && articlesSection.querySelector('.articles-jump');
if (articlesFilterBar) {
  const links = Array.from(articlesFilterBar.querySelectorAll('a[href^="#"]'));
  const groups = links.map(link => document.getElementById(link.getAttribute('href').slice(1)));

  // Bail out rather than hide anything if a link points at a group that is not
  // there, otherwise a stale link would blank out part of the index.
  if (links.length > 1 && groups.every(Boolean)) {
    const ALL = '';
    const makeChip = (label, target) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = label;
      chip.dataset.filter = target;
      chip.setAttribute('aria-pressed', 'false');
      if (target) chip.setAttribute('aria-controls', target);
      return chip;
    };
    const chips = [makeChip('All', ALL)].concat(
      links.map((link, i) => makeChip(link.textContent.trim(), groups[i].id))
    );
    articlesFilterBar.replaceChildren(...chips);
    articlesFilterBar.setAttribute('role', 'group');
    articlesFilterBar.setAttribute('aria-label', 'Filter guides by topic');
    articlesSection.classList.add('articles-filter-on');

    const applyFilter = (target) => {
      chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.filter === target)));
      groups.forEach(group => { group.hidden = target !== ALL && group.id !== target; });
      articlesSection.classList.toggle('articles-filtered', target !== ALL);
    };

    const filterFromHash = () => {
      const id = window.location.hash.slice(1);
      return groups.some(group => group.id === id) ? id : null;
    };

    articlesFilterBar.addEventListener('click', (e) => {
      const chip = e.target.closest('button[data-filter]');
      if (!chip) return;
      const target = chip.dataset.filter;
      applyFilter(target);
      // replaceState keeps a filtered view shareable without stacking a history
      // entry per click, and without the jump that assigning location.hash causes.
      const url = window.location.pathname + window.location.search + (target ? '#' + target : '');
      window.history.replaceState(null, '', url);
      if (articlesFilterBar.getBoundingClientRect().top < 72) {
        articlesFilterBar.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });

    const initialHash = window.location.hash;
    const initial = filterFromHash();

    // A deep link makes the browser scroll to the group it names, which is now
    // the top of the filtered list, so the scroll only pushes the bar out of
    // view. Remove the fragment before the browser scrolls and put it back once
    // the page has loaded, which keeps the URL shareable. replaceState never scrolls.
    if (initial) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const restoreHash = () => window.history.replaceState(null, '', initialHash);
      if (document.readyState === 'complete') restoreHash();
      else window.addEventListener('load', restoreHash, { once: true });
    }

    applyFilter(initial || ALL);

    window.addEventListener('hashchange', () => {
      const target = filterFromHash();
      if (target) applyFilter(target);
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

