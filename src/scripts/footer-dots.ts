/**
 * Stopka: gigantyczne AIRLOG jako siatka kropek (canvas) z „latarką” pod kursorem.
 *  - kształt liter próbkowany z offscreen canvas (Manrope 800),
 *  - spoczynek: kropki liter odrobinę jaśniejsze od tła (tłoczenie),
 *  - w promieniu kursora (smoothstep) litery zapalają się na niebiesko, w tle migoczą rzadkie cyjanowe kropki,
 *  - dotyk: automatyczny „przejazd” światła po wejściu w widok,
 *  - prefers-reduced-motion: statyczne litery, bez szumu,
 *  - lazy init (IntersectionObserver); rAF stoi poza ekranem i gdy wszystko wygaśnie.
 */
const stage = document.querySelector<HTMLElement>('[data-footer-dots]');
const canvas = stage?.querySelector<HTMLCanvasElement>('canvas.dots');
const ctx = canvas?.getContext('2d');
if (stage && canvas && ctx) init(stage, canvas, ctx);

function init(stage: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none)').matches;
  const WORD = 'AIRLOG';

  let w = 0;
  let h = 0;
  let dpr = 1;
  let cell = 8;
  let cols = 0;
  let rows = 0;
  let mask: Uint8Array = new Uint8Array(0);
  let noise: Float32Array = new Float32Array(0);
  let raf = 0;
  let visible = false;
  let mx = -9999;
  let my = -9999;
  let energy = 0;
  let sweepStart = 0;
  let didSweep = false;

  const build = async () => {
    const r = stage.getBoundingClientRect();
    w = Math.round(r.width);
    h = Math.round(r.height);
    if (!w || !h) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cell = Math.max(5, Math.min(11, Math.round(w / 120)));
    cols = Math.floor(w / cell);
    rows = Math.floor(h / cell);

    try {
      await document.fonts.load('800 200px Manrope Variable');
    } catch {
      /* czcionka systemowa */
    }
    const off = document.createElement('canvas');
    off.width = cols * 4;
    off.height = rows * 4;
    const o = off.getContext('2d', { willReadFrequently: true });
    if (!o) return;
    o.fillStyle = '#000';
    o.textAlign = 'center';
    o.textBaseline = 'alphabetic';
    let size = off.height;
    o.font = `800 ${size}px "Manrope Variable", Manrope, sans-serif`;
    const mw = o.measureText(WORD).width;
    size = Math.min(size * 0.86, (size * off.width * 0.97) / mw);
    o.font = `800 ${size}px "Manrope Variable", Manrope, sans-serif`;
    o.letterSpacing = `${-size * 0.04}px`;
    o.fillText(WORD, off.width / 2, off.height * 0.5 + size * 0.36);
    const data = o.getImageData(0, 0, off.width, off.height).data;
    mask = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let a = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) a += data[(((y * 4 + sy) * off.width) + x * 4 + sx) * 4 + 3];
        mask[y * cols + x] = a / 16 > 110 ? 1 : 0;
      }
    }
    noise = new Float32Array(cols * rows).map(() => Math.random());
    draw(performance.now());
  };

  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  const draw = (now: number) => {
    raf = 0;
    if (!cols) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(260, w * 0.28);
    let sx = mx;
    let sy = my;
    let boost = energy;
    if (coarse && !reduced && sweepStart) {
      const u = (now - sweepStart) / 2600;
      if (u <= 1) {
        sx = -R + (w + R * 2) * u;
        sy = h * 0.5;
        boost = Math.sin(u * Math.PI);
      }
    }
    const rad = 1.3 + cell * 0.12;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const cx = x * cell + cell / 2;
        const cy = y * cell + cell / 2;
        const d = Math.hypot(cx - sx, cy - sy);
        const near = reduced ? 0 : smooth(R, 0, d) * boost;
        if (mask[i]) {
          const base = reduced ? 0.4 : 0.16;
          const a = base + near * 0.84;
          ctx.fillStyle = `rgba(${Math.round(60 + near * 60)},${Math.round(92 + near * 80)},255,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, 6.2832);
          ctx.fill();
        } else if (!reduced) {
          ctx.fillStyle = 'rgba(255,255,255,.045)';
          ctx.fillRect(cx - 0.7, cy - 0.7, 1.4, 1.4);
          if (near > 0.06 && noise[i] > 0.93) {
            const tw = 0.5 + 0.5 * Math.sin(now / 260 + noise[i] * 40);
            ctx.fillStyle = `rgba(134,230,255,${(near * tw * 0.8).toFixed(3)})`;
            ctx.fillRect(cx - 1, cy - 1, 2, 2);
          }
        }
      }
    }
    const sweeping = coarse && sweepStart && now - sweepStart < 2600;
    if (!reduced && visible && (sweeping || energy > 0.01)) {
      if (mx < -999) energy *= 0.94;
      else energy = Math.max(energy * 0.985, 0.0);
      raf = requestAnimationFrame(draw);
    }
  };
  const kick = () => {
    if (!raf && visible) raf = requestAnimationFrame(draw);
  };

  if (!reduced) {
    stage.addEventListener(
      'pointermove',
      (e) => {
        const r = stage.getBoundingClientRect();
        mx = e.clientX - r.left;
        my = e.clientY - r.top;
        energy = 1;
        kick();
      },
      { passive: true },
    );
    stage.addEventListener('pointerleave', () => {
      mx = -9999;
      my = -9999;
      kick();
    });
  }

  let ro: ResizeObserver | undefined;
  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      if (visible) {
        if (!cols) {
          build().then(() => {
            if (coarse && !reduced && !didSweep) {
              didSweep = true;
              sweepStart = performance.now();
              kick();
            }
          });
          ro = new ResizeObserver(() => build());
          ro.observe(stage);
        } else kick();
      }
    },
    { rootMargin: '20% 0px' },
  ).observe(stage);
}
