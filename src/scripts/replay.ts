/**
 * Sekcja „3D replay”: ten sam silnik sceny co w hero + wektory przyspieszenia.
 * Auto-odtwarzanie w pętli (slow-mo), przeciąganie obraca kamerę, suwak przewija skok.
 * Poza kadrem nic nie jest renderowane; reduced-motion: zatrzymane na apexie.
 */
import { JUMP, createJumpScene, type Frame } from './jump-scene';

const root = document.querySelector<HTMLElement>('[data-replay]');
const svg = root?.querySelector<SVGSVGElement>('svg.replay-scene');
if (root && svg) init(root, svg);

function init(root: HTMLElement, svg: SVGSVGElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = JUMP.T;
  const YAW0 = -0.5;
  const PITCH0 = 0.24;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const range = root.querySelector<HTMLInputElement>('[data-range]');
  const playBtn = root.querySelector<HTMLButtonElement>('[data-play]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-reset]');
  const out = (k: string) => document.querySelector<HTMLElement>(`[data-r="${k}"]`);
  const r = { h: out('h'), v: out('v'), vy: out('vy'), air: out('air') };

  const onFrame = (f: Frame) => {
    const put = (el: HTMLElement | null, s: string) => {
      if (el && el.textContent !== s) el.textContent = s;
    };
    put(r.h, f.h.toFixed(1));
    put(r.v, f.speed.toFixed(1));
    put(r.vy, f.vy.toFixed(1));
    put(r.air, f.air.toFixed(1));
  };

  const scene = createJumpScene({
    svg,
    yaw: YAW0,
    pitch: PITCH0,
    kite: true,
    accel: true,
    annotate: true,
    onFrame,
    fit: (w, h) =>
      w >= 700
        ? { x0: w * 0.05, x1: w * 0.95, y0: h * 0.1, y1: h * 0.76 }
        : { x0: w * 0.1, x1: w * 0.88, y0: h * 0.16, y1: h * 0.66 },
  });

  let t = T / 2;
  let yaw = YAW0;
  let pitch = PITCH0;
  let playing = !reduced;
  let visible = false;
  let dragging = false;
  let hold = 0;
  let last = 0;
  let raf = 0;
  let sway = 0;

  const syncUI = () => {
    if (range) range.value = String(Math.round(clamp(t / T, 0, 1) * 1000));
    if (playBtn) {
      playBtn.setAttribute('aria-pressed', String(playing));
      playBtn.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
      playBtn.classList.toggle('is-paused', !playing);
    }
  };
  const draw = () => scene.set({ t: Math.max(0.0001, t), yaw: yaw + (dragging || reduced ? 0 : Math.sin(sway) * 0.28), pitch });

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    sway += dt * 0.55;
    if (playing) {
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) t = 0;
      } else {
        t += dt * 0.5;
        if (t >= T) {
          t = T;
          hold = 1.1;
        }
      }
      if (range && !range.matches(':active')) range.value = String(Math.round(clamp(t / T, 0, 1) * 1000));
    }
    draw();
    if (visible && !reduced && (playing || !dragging)) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && visible) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  range?.addEventListener('input', () => {
    playing = false;
    hold = 0;
    t = (Number(range.value) / 1000) * T;
    syncUI();
    draw();
    kick();
  });
  playBtn?.addEventListener('click', () => {
    playing = !playing;
    if (playing && t >= T) t = 0;
    syncUI();
    kick();
  });
  resetBtn?.addEventListener('click', () => {
    yaw = YAW0;
    pitch = PITCH0;
    draw();
  });

  /* przeciąganie = obrót kamery (pionowy scroll zostaje dla przeglądarki) */
  let px = 0;
  let py = 0;
  svg.style.touchAction = 'pan-y';
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    svg.setPointerCapture(e.pointerId);
    root.classList.add('is-dragging');
    yaw += Math.sin(sway) * 0.28;
    draw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px) * 0.008;
    pitch = clamp(pitch + (e.clientY - py) * 0.004, 0.02, 0.7);
    px = e.clientX;
    py = e.clientY;
    draw();
  });
  const end = () => {
    dragging = false;
    root.classList.remove('is-dragging');
    kick();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  if ('ResizeObserver' in window) new ResizeObserver(() => scene.resize()).observe(svg);
  syncUI();
  draw();

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    scene.setActive(visible);
    if (visible) {
      scene.resize();
      kick();
    }
  });
  io.observe(root);
}
