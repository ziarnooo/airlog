/**
 * Hero: łuk skoku rysowany przy wejściu, scroll „przewija” skok (playhead + obrót kamery),
 * kursor lekko przesuwa kamerę. prefers-reduced-motion: statyczny apex, bez rAF.
 * Render tylko gdy hero jest w kadrze (IntersectionObserver).
 */
import { APEX_H, JUMP, createJumpScene, type Frame } from './jump-scene';

const hero = document.querySelector<HTMLElement>('[data-hero]');
const svg = hero?.querySelector<SVGSVGElement>('svg.hero-scene');
const watch = hero?.querySelector<SVGSVGElement>('svg.watch');

if (hero && svg && watch) init(hero, svg, watch);

function init(hero: HTMLElement, svg: SVGSVGElement, watch: SVGSVGElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const T = JUMP.T;
  const YAW0 = -0.42;
  const SCROLL_YAW = 0.62;

  const highest = watch.querySelector<SVGTSpanElement>('[data-w="highest"]');
  const last = watch.querySelector<SVGTSpanElement>('[data-w="last"]');
  const speed = watch.querySelector<SVGTSpanElement>('[data-w="speed"]');
  const lastEl = last?.closest('text');
  let lastShown = '';
  let landedPrev = false;
  const PREV_LAST = '3.7';
  if (speed) speed.textContent = (JUMP.vx * 3.6).toFixed(1);

  const setText = (el: SVGTSpanElement | null, s: string) => {
    if (el && el.textContent !== s) el.textContent = s;
  };
  const onFrame = (f: Frame) => {
    const h = f.t >= T / 2 ? APEX_H : f.h;
    setText(highest, h.toFixed(1));
    const l = f.landed ? APEX_H.toFixed(1) : PREV_LAST;
    if (l !== lastShown) {
      setText(last, l);
      lastShown = l;
    }
    if (f.landed && !landedPrev && lastEl) {
      lastEl.classList.remove('flash');
      void (lastEl as SVGElement & { getBBox(): DOMRect }).getBBox();
      lastEl.classList.add('flash');
    }
    landedPrev = f.landed;
  };

  const scene = createJumpScene({
    svg,
    yaw: YAW0,
    pitch: 0.2,
    kite: true,
    annotate: true,
    onFrame,
    fit: (w, h) => {
      const wrap = hero.querySelector<HTMLElement>('.hero-watch-wrap');
      // lewa krawędź obudowy zegarka (12.5 % szerokości SVG) / lewa krawędź paska (32.5 %)
      const caseLeft = wrap ? wrap.offsetLeft + wrap.offsetWidth * 0.125 : w * 0.68;
      const strapLeft = wrap ? wrap.offsetLeft + wrap.offsetWidth * 0.325 : w * 0.64;
      if (w >= 900) {
        // łuk zaczyna się na prawo od kolumny tekstu (nagłówek, lede, przyciski) i kończy przed obudową
        let right = 0;
        for (const el of hero.querySelectorAll<HTMLElement>('.hero-title .hl, .hero-copy .lede, .hero-copy .cta-row > *')) {
          right = Math.max(right, el.getBoundingClientRect().right);
        }
        const x0 = right + 36;
        return { x0, x1: Math.max(x0 + 300, caseLeft - 24), y0: h * 0.2, y1: h * 0.8 };
      }
      return { x0: w * 0.03, x1: Math.max(w * 0.4, strapLeft - 26), y0: h * 0.545, y1: h * 0.77 };
    },
  });

  const scrollRange = () => Math.max(1, hero.offsetHeight - innerHeight);
  let s = 0;
  let intro = reduced ? 1 : 0;
  let px = 0;
  let py = 0;
  let ox = 0;
  let oy = 0;
  let loopRaf = 0;
  let visible = true;
  let started = false;

  const ease = (u: number) => 1 - Math.pow(1 - u, 3);

  const apply = () => {
    const e = ease(intro);
    const target = T / 2 + s * (T / 2);
    scene.set({
      t: Math.max(0.0001, e * target),
      yaw: YAW0 + (1 - e) * -0.36 + s * (innerWidth < 900 ? 0.2 : SCROLL_YAW),
      ox,
      oy,
    });
  };

  const readScroll = () => {
    s = clamp(scrollY / scrollRange());
    hero.style.setProperty('--s', s.toFixed(3));
    apply();
  };

  /* pętla: intro + wygładzanie kursora, zatrzymuje się gdy wszystko osiądzie */
  let introStart = 0;
  const INTRO_MS = 2800;
  const loop = (now: number) => {
    loopRaf = 0;
    let busy = false;
    if (started && intro < 1) {
      intro = clamp((now - introStart) / INTRO_MS);
      busy = true;
    }
    const tx = px * 0.05;
    const ty = py * 0.03;
    ox += (tx - ox) * 0.08;
    oy += (ty - oy) * 0.08;
    if (Math.abs(tx - ox) > 0.0004 || Math.abs(ty - oy) > 0.0004) busy = true;
    apply();
    if (busy && visible) loopRaf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!loopRaf && visible) loopRaf = requestAnimationFrame(loop);
  };

  const begin = () => {
    hero.classList.add('is-ready');
    if (reduced) {
      hero.classList.add('is-awake');
      readScroll();
      return;
    }
    setTimeout(() => {
      introStart = performance.now();
      started = true;
      hero.classList.add('is-awake');
      kick();
    }, 650);
  };

  if (reduced) {
    scene.set({ t: T / 2, yaw: YAW0 });
  } else {
    scene.set({ t: 0.0001, yaw: YAW0 - 0.36 });
    addEventListener(
      'scroll',
      () => {
        readScroll();
        kick();
      },
      { passive: true },
    );
    if (fine) {
      hero.addEventListener(
        'pointermove',
        (e) => {
          const r = hero.getBoundingClientRect();
          px = ((e.clientX - r.left) / r.width) * 2 - 1;
          py = ((e.clientY - r.top) / r.height) * 2 - 1;
          kick();
        },
        { passive: true },
      );
    }
  }
  readScroll();

  if ('ResizeObserver' in window) {
    let rt = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(rt);
      rt = requestAnimationFrame(() => scene.resize());
    }).observe(svg);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      scene.setActive(visible);
      hero.classList.toggle('is-paused', !visible);
      if (visible) kick();
    }).observe(hero);
  }

  const start = () =>
    requestAnimationFrame(() => {
      scene.refit();
      begin();
    });
  if (document.fonts?.ready) document.fonts.ready.then(start);
  else start();
}
