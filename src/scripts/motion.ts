/**
 * Ruch strony – vanilla, bez zależności (te same techniki co w Si-skin).
 *  - [data-reveal] / [data-inview] → klasa .is-in (raz); [data-stagger] układa kolejność (--i)
 *  - html[data-scrolled]           → szklany nagłówek po przewinięciu
 *  - [data-magnetic]               → delikatne „przyciąganie” (tylko mysz, max 6 px)
 *  - [data-tilt]                   → pochylenie za kursorem (max 6°), --mx/--my dla poświaty
 *  - [data-glint]                  → szkło urządzenia: odblask przesuwany za kursorem (--gx)
 *  - [data-run]                    → klasa .is-running tylko w kadrze (pauza animacji CSS poza ekranem)
 * Wszystko poza odsłanianiem wyłączone przy prefers-reduced-motion.
 */

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

/* ── Odsłanianie ─────────────────────────────────────────────── */
function initReveal() {
  for (const parent of $$('[data-stagger]')) {
    const step = Number(parent.dataset.stagger) || 1;
    let i = 0;
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasAttribute('data-reveal') && !child.style.getPropertyValue('--i')) {
        child.style.setProperty('--i', String(i * step));
      }
      i++;
    }
  }
  const targets = $$('[data-reveal], [data-inview]');
  if (!targets.length) return;
  if (reduced || !('IntersectionObserver' in window)) {
    for (const el of targets) el.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  for (const el of targets) io.observe(el);
}

/* ── Stan nagłówka ───────────────────────────────────────────── */
function initScrollState() {
  let ticking = false;
  const apply = () => {
    ticking = false;
    root.toggleAttribute('data-scrolled', scrollY > 12);
  };
  addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    },
    { passive: true },
  );
  apply();
}

/* ── Animacje CSS tylko w kadrze ─────────────────────────────── */
function initRun() {
  const els = $$('[data-run]');
  if (!els.length) return;
  if (reduced || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.target.classList.toggle('is-running', e.isIntersecting);
    },
    { rootMargin: '10% 0px' },
  );
  for (const el of els) io.observe(el);
}

/* ── Kursor ──────────────────────────────────────────────────── */
function initMagnetic() {
  const MAX = 6;
  for (const el of $$('[data-magnetic]')) {
    let rect: DOMRect | null = null;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const tick = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      if (Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        if (tx === 0 && ty === 0) el.style.removeProperty('transform');
      }
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') rect = el.getBoundingClientRect();
    });
    el.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse' || !rect) return;
        tx = clamp((e.clientX - rect.left) / rect.width) * 2 - 1;
        ty = clamp((e.clientY - rect.top) / rect.height) * 2 - 1;
        tx *= MAX;
        ty *= MAX;
        run();
      },
      { passive: true },
    );
    el.addEventListener('pointerleave', () => {
      rect = null;
      tx = 0;
      ty = 0;
      run();
    });
  }
}

function initTilt() {
  const MAX = 6;
  for (const el of $$('[data-tilt]')) {
    let rect: DOMRect | null = null;
    let rx = 0;
    let ry = 0;
    let trx = 0;
    let try_ = 0;
    let raf = 0;
    const glint = el.hasAttribute('data-glint');
    let gx = 0;
    let tgx = 0;
    const tick = () => {
      rx += (trx - rx) * 0.12;
      ry += (try_ - ry) * 0.12;
      gx += (tgx - gx) * 0.12;
      el.style.transform = `perspective(1100px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      if (glint) el.style.setProperty('--gx', gx.toFixed(1));
      if (Math.abs(trx - rx) > 0.02 || Math.abs(try_ - ry) > 0.02 || Math.abs(tgx - gx) > 0.2) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        if (trx === 0 && try_ === 0) el.style.removeProperty('transform');
      }
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const host = (el.closest('[data-tilt-host]') as HTMLElement | null) ?? el;
    host.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      rect = host.getBoundingClientRect();
      el.style.willChange = 'transform';
    });
    host.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse' || !rect) return;
        const nx = clamp((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = clamp((e.clientY - rect.top) / rect.height) * 2 - 1;
        try_ = nx * MAX;
        trx = -ny * MAX;
        tgx = nx * 70;
        el.style.setProperty('--mx', `${((nx + 1) * 50).toFixed(1)}%`);
        el.style.setProperty('--my', `${((ny + 1) * 50).toFixed(1)}%`);
        run();
      },
      { passive: true },
    );
    host.addEventListener('pointerleave', () => {
      rect = null;
      trx = 0;
      try_ = 0;
      tgx = 0;
      run();
      el.style.removeProperty('will-change');
    });
  }
}

/* Poświata kart (bento) śledząca kursor – tylko zmienne CSS */
function initSpotlight() {
  for (const el of $$('[data-spot]')) {
    el.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--sx', `${(e.clientX - r.left).toFixed(0)}px`);
        el.style.setProperty('--sy', `${(e.clientY - r.top).toFixed(0)}px`);
      },
      { passive: true },
    );
  }
}

initReveal();
initScrollState();
initRun();
if (!reduced && finePointer) {
  initMagnetic();
  initTilt();
  initSpotlight();
}
