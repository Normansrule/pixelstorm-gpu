/* ui.js — behaviour for the component layer in ui.css. No dependencies;
 * uses GSAP when it is loaded, and falls back to CSS transitions otherwise. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const UI = {};
  // nav background after scrolling
  UI.nav = () => {
    const n = document.querySelector('.unav'); if (!n) return;
    const f = () => n.classList.toggle('scrolled', scrollY > 20); f(); addEventListener('scroll', f, { passive: true });
  };
  // cursor-following spotlight
  UI.spotlights = () => document.querySelectorAll('.spotlight').forEach(el => {
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`); });
  });
  // reveal on scroll
  UI.reveals = () => {
    const els = document.querySelectorAll('[data-reveal]');
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach(en => { if (en.isIntersecting) { const d = +en.target.dataset.reveal || 0; setTimeout(() => en.target.classList.add('in'), d); io.unobserve(en.target); } }), { threshold: 0.15 });
    els.forEach(e => io.observe(e));
  };
  // number tickers: <span data-ticker="1234" data-suffix="%">0</span>
  UI.tickers = () => {
    const fmt = (v, el) => Math.round(v).toLocaleString('en-US') + (el.dataset.suffix || '');
    const run = (el) => {
      const to = +el.dataset.ticker; if (reduce) { el.textContent = fmt(to, el); return; }
      const t0 = performance.now(), dur = 1600;
      const step = (now) => { const k = Math.min(1, (now - t0) / dur); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)), el); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((es) => es.forEach(en => { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } }), { threshold: 0.6 });
    document.querySelectorAll('[data-ticker]').forEach(e => io.observe(e));
  };
  // copy buttons for terminals: <div class="uterm" data-copy> ... <pre>
  UI.copy = () => document.querySelectorAll('.uterm[data-copy]').forEach(t => {
    const b = document.createElement('button'); b.className = 'ucopy'; b.type = 'button'; b.textContent = 'Copy';
    b.onclick = async () => {
      const txt = t.querySelector('pre').innerText.split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/\s+#.*$/, '')).join('\n').trim();
      try { await navigator.clipboard.writeText(txt); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Select and copy'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1600);
    };
    t.appendChild(b);
  });
  // duplicate marquee content so the loop is seamless
  UI.marquees = () => document.querySelectorAll('.marquee-track').forEach(t => { t.innerHTML += t.innerHTML; });
  UI.init = () => { UI.nav(); UI.spotlights(); UI.reveals(); UI.tickers(); UI.copy(); };
  UI.reduce = reduce;
  window.PSUI = UI;
})();
