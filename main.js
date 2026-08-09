// Salt Creek Advisory, shared site behavior
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mobile hamburger
const hamburger = document.getElementById('hamburger');
const drawer = document.getElementById('mobileDrawer');
if (hamburger && drawer) {
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    drawer.classList.toggle('open');
  });
}
const closeDrawer = () => {
  if (hamburger) hamburger.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
};
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

// Reveal animations
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
revealEls.forEach(el => revealObserver.observe(el));

// Nav scrolled state
const navEl = document.getElementById('nav');
if (navEl) {
  const onScroll = () => navEl.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// FAQ accordion
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-a');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(other => {
      if (other !== item) {
        other.classList.remove('open');
        other.querySelector('.faq-a').style.maxHeight = null;
        other.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      }
    });
    item.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
    answer.style.maxHeight = !isOpen ? answer.scrollHeight + 'px' : null;
  });
});

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

    const selectTab = (index, { moveFocus = false, forceReveal = true } = {}) => {
      tabs.forEach((tab, i) => {
        const isActive = i === index;
        tab.setAttribute('aria-selected', String(isActive));
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
        panels[i].classList.toggle('is-active', isActive);
      });
      // A panel that was display:none never tripped the reveal observer, so its
      // cards would sit at opacity 0 when switched to. On first paint we leave
      // them alone and let the observer run its normal staggered entrance.
      if (forceReveal) {
        panels[index].querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      }
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

    selectTab(initial === -1 ? 0 : initial, { forceReveal: false });

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

// Stat count-up
const statNums = document.querySelectorAll('.impact-stat-num');
if (!reduceMotion && statNums.length) {
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      statObserver.unobserve(entry.target);
      const el = entry.target;
      const raw = el.textContent.trim();
      const match = raw.match(/^([^0-9]*)(\d+)(.*)$/);
      if (!match) return;
      const prefix = match[1], target = parseInt(match[2], 10), suffix = match[3];
      if (target === 0) return;
      const duration = 1300;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + Math.round(target * eased) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      el.textContent = prefix + '0' + suffix;
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  statNums.forEach(el => statObserver.observe(el));
}

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
