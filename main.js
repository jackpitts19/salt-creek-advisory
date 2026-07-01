// Salt Creek Advisory — shared site behavior
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
window.closeDrawer = function () {
  if (hamburger) hamburger.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
};

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

// Page transitions between internal pages
if (!reduceMotion) {
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') ||
        href.startsWith('mailto') || href.startsWith('tel') || a.target === '_blank') return;
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      document.body.classList.add('page-exit');
      setTimeout(() => { window.location.href = href; }, 300);
    });
  });
}
window.addEventListener('pageshow', (e) => {
  if (e.persisted) document.body.classList.remove('page-exit');
});

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
