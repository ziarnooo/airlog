/**
 * Scena skoku 3D – czysty SVG, ręczna projekcja perspektywiczna (bez bibliotek).
 *
 * Wspólny silnik dla hero i sekcji „3D replay”:
 *  - fizyka: lot paraboliczny h(t) = g·t·(T−t)/2, stała prędkość pozioma,
 *  - kamera: yaw/pitch + perspektywa, siatka wody, ślad na wodzie, łuk (duch + podświetlony),
 *  - wektory prędkości wzdłuż łuku, linka miernicza (taśma) z wysokością, latawiec w 3D,
 *  - render tylko gdy „brudny” i aktywny (IntersectionObserver po stronie wywołującego).
 * Dane to demo: T = 2.2 s, vx = 9.4 m/s → apex ≈ 5.9 m, dystans ≈ 21 m.
 */

export const G = 9.81;
export const JUMP = { T: 2.2, vx: 9.4, zAmp: 7 };
export const APEX_H = (G * JUMP.T * JUMP.T) / 8;
export const DIST = JUMP.vx * JUMP.T;

const NS = 'http://www.w3.org/2000/svg';
const T0 = -1.9; // początek podejścia (s)
const T1 = JUMP.T + 1.9; // koniec lądowania
const KITE_OFFSET = { x: 2.4, y: 4.6, z: -3.2 };

type V3 = [number, number, number];

export interface Frame {
  t: number;
  h: number;
  hMax: number;
  speed: number;
  vy: number;
  air: number;
  landed: boolean;
}

export interface SceneOptions {
  svg: SVGSVGElement;
  /** prostokąt (px) w którym ma zmieścić się takeoff–apex–landing przy bazowym yaw */
  fit: (w: number, h: number) => { x0: number; y0: number; x1: number; y1: number };
  yaw: number;
  pitch: number;
  yExag?: number;
  kite?: boolean;
  accel?: boolean;
  /** czy pokazać etykiety (takeoff / dystans) */
  annotate?: boolean;
  onFrame?: (f: Frame) => void;
}

const pos = (t: number): V3 => {
  const { T, vx, zAmp } = JUMP;
  const y = t >= 0 && t <= T ? (G * t * (T - t)) / 2 : 0;
  return [vx * t, y, -zAmp * Math.tanh((t - T / 2) * 0.3)];
};
const vel = (t: number): V3 => {
  const { T, vx, zAmp } = JUMP;
  const vy = t >= 0 && t <= T ? G * (T / 2 - t) : 0;
  const c = Math.cosh((t - T / 2) * 0.3);
  return [vx, vy, (-zAmp * 0.3) / (c * c)];
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

function mk<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  parent?.appendChild(el);
  return el;
}

export interface SceneState {
  t: number;
  yaw: number;
  pitch: number;
  ox: number;
  oy: number;
}

export interface JumpScene {
  resize(): void;
  render(): void;
  set(next: Partial<SceneState>): void;
  get(): SceneState;
  setActive(on: boolean): void;
}

export function createJumpScene(opts: SceneOptions): JumpScene {
  const { svg } = opts;
  const yExag = opts.yExag ?? 1.25;
  const D = 46; // odległość kamery (m) – im mniej, tym mocniejsza perspektywa
  const cx0 = (JUMP.vx * JUMP.T) / 2;

  const state = { t: JUMP.T / 2, yaw: opts.yaw, pitch: opts.pitch, ox: 0, oy: 0 };
  let W = 0;
  let H = 0;
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let active = true;
  let dirty = true;
  let raf = 0;

  /* ── DOM ─────────────────────────────────────────────────── */
  svg.replaceChildren();
  const defs = mk('defs', {}, svg);
  const uid = `js${Math.random().toString(36).slice(2, 7)}`;
  defs.innerHTML = `
    <linearGradient id="${uid}-arc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f7bff"/><stop offset=".55" stop-color="#7aa2ff"/><stop offset="1" stop-color="#8be9ff"/>
    </linearGradient>
    <radialGradient id="${uid}-fade" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="${uid}-mask" maskUnits="userSpaceOnUse"><rect class="${uid}-mrect" fill="url(#${uid}-fade)"/></mask>
    <filter id="${uid}-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const mrect = defs.querySelector(`.${uid}-mrect`) as SVGRectElement;

  const gGrid = mk('g', { class: 'js-grid', mask: `url(#${uid}-mask)` }, svg);
  const gridX = mk('path', { class: 'js-gridline' }, gGrid);
  const gridZ = mk('path', { class: 'js-gridline' }, gGrid);
  const wake = mk('path', { class: 'js-wake', pathLength: 1 }, svg);
  const wakeAir = mk('path', { class: 'js-wake-air' }, svg);
  const gMarks = mk('g', { class: 'js-marks' }, svg);
  const takeoffRing = mk('ellipse', { class: 'js-ring' }, gMarks);
  const landRing = mk('ellipse', { class: 'js-ring' }, gMarks);
  const distLine = mk('path', { class: 'js-dim' }, gMarks);
  const labels: Record<string, SVGGElement> = {};
  const labelTxt: Record<string, SVGTextElement> = {};
  const labelBox: Record<string, SVGRectElement> = {};
  const makeLabel = (key: string, cls = '') => {
    const g = mk('g', { class: `js-label ${cls}` }, svg);
    labelBox[key] = mk('rect', { rx: 7, height: 22 }, g);
    labelTxt[key] = mk('text', { y: 15 }, g);
    labels[key] = g;
  };
  const setLabel = (key: string, text: string, x: number, y: number, anchor: 'start' | 'end' | 'middle' = 'start') => {
    const w = Math.round(text.length * 6.5 + 16);
    const raw = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    const left = Math.min(Math.max(raw, 6), Math.max(6, W - w - 6));
    labels[key].setAttribute('transform', `translate(${left.toFixed(1)} ${(y - 11).toFixed(1)})`);
    labelBox[key].setAttribute('width', String(w));
    labelTxt[key].setAttribute('x', '8');
    if (labelTxt[key].textContent !== text) labelTxt[key].textContent = text;
  };
  if (opts.annotate) {
    makeLabel('takeoff', 'is-dim js-takeoff');
    makeLabel('dist', 'is-dim');
  }

  const gTape = mk('g', { class: 'js-tape' }, svg);
  const tapeBase = mk('path', { class: 'js-tape-base' }, gTape);
  const tapeFill = mk('path', { class: 'js-tape-fill' }, gTape);
  const tapeTicks = mk('path', { class: 'js-tape-ticks' }, gTape);
  const tapeNums: SVGTextElement[] = [2, 4, 6].map(() => mk('text', { class: 'js-tape-num' }, gTape));
  const peak = mk('path', { class: 'js-peak' }, gTape);
  const gauge = mk('path', { class: 'js-gauge' }, gTape);

  const gKite = mk('g', { class: 'js-kite' }, svg);
  const kiteLines = mk('path', { class: 'js-kite-lines' }, gKite);
  const kiteBody = mk('path', { class: 'js-kite-body' }, gKite);

  const arcGhost = mk('path', { class: 'js-arc-ghost' }, svg);
  const arcLit = mk('path', { class: 'js-arc-lit', stroke: `url(#${uid}-arc)`, filter: `url(#${uid}-glow)` }, svg);
  const vecs = Array.from({ length: 9 }, () => mk('path', { class: 'js-vec' }, svg));
  const live = mk('path', { class: 'js-live' }, svg);
  const accel = opts.accel ? mk('path', { class: 'js-accel' }, svg) : null;
  const board = mk('path', { class: 'js-board' }, svg);
  const halo = mk('circle', { class: 'js-halo', r: 14 }, svg);
  const dot = mk('circle', { class: 'js-dot', r: 5 }, svg);
  makeLabel('read');
  makeLabel('h', 'is-h');
  if (accel) makeLabel('acc', 'is-acc');

  /* ── projekcja ───────────────────────────────────────────── */
  let cyaw = 1;
  let syaw = 0;
  let cp = 1;
  let sp = 0;
  const setCam = () => {
    cyaw = Math.cos(state.yaw + state.ox);
    syaw = Math.sin(state.yaw + state.ox);
    cp = Math.cos(state.pitch + state.oy);
    sp = Math.sin(state.pitch + state.oy);
  };
  const proj = (p: V3, o: [number, number] = [0, 0]): void => {
    const x = p[0] - cx0;
    const y = p[1] * yExag;
    const z = p[2];
    const x1 = x * cyaw + z * syaw;
    const z1 = -x * syaw + z * cyaw;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const k = scale / Math.max(6, D - z2);
    o[0] = offX + x1 * k * D;
    o[1] = offY - y2 * k * D;
  };
  const P = (p: V3): [number, number] => {
    const o: [number, number] = [0, 0];
    proj(p, o);
    return o;
  };
  const path = (pts: V3[]) => {
    let d = '';
    const o: [number, number] = [0, 0];
    for (let i = 0; i < pts.length; i++) {
      proj(pts[i], o);
      d += `${i ? 'L' : 'M'}${o[0].toFixed(1)} ${o[1].toFixed(1)}`;
    }
    return d;
  };
  const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

  const arrow = (a: V3, b: V3, head = 7) => {
    const pa = P(a);
    const pb = P(b);
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const hx = (s: number) => pb[0] - head * (ux * Math.cos(s) - uy * Math.sin(s));
    const hy = (s: number) => pb[1] - head * (uy * Math.cos(s) + ux * Math.sin(s));
    const a1 = 0.45;
    return `M${pa[0].toFixed(1)} ${pa[1].toFixed(1)}L${pb[0].toFixed(1)} ${pb[1].toFixed(1)}M${hx(a1).toFixed(1)} ${hy(a1).toFixed(1)}L${pb[0].toFixed(1)} ${pb[1].toFixed(1)}L${hx(-a1).toFixed(1)} ${hy(-a1).toFixed(1)}`;
  };

  /* ── dopasowanie do prostokąta ───────────────────────────── */
  const fit = () => {
    const rect = opts.fit(W, H);
    const yaw0 = state.yaw;
    const save = { ox: state.ox, oy: state.oy };
    state.ox = 0;
    state.oy = 0;
    state.yaw = opts.yaw;
    setCam();
    scale = 1;
    offX = 0;
    offY = 0;
    const keys: V3[] = [pos(0), pos(JUMP.T), pos(JUMP.T / 2), [cx0, APEX_H + 0.6, 0]];
    if (opts.kite) {
      keys.push(add(pos(JUMP.T / 2), [KITE_OFFSET.x, KITE_OFFSET.y, KITE_OFFSET.z]));
      keys.push(add(pos(0.3), [KITE_OFFSET.x, KITE_OFFSET.y, KITE_OFFSET.z]));
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const k of keys) {
      const [x, y] = P(k);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    scale = Math.min((rect.x1 - rect.x0) / bw, (rect.y1 - rect.y0) / bh);
    offX = (rect.x0 + rect.x1) / 2 - ((minX + maxX) / 2) * scale;
    offY = (rect.y0 + rect.y1) / 2 - ((minY + maxY) / 2) * scale;
    state.yaw = yaw0;
    state.ox = save.ox;
    state.oy = save.oy;
    setCam();
  };

  /* ── render ──────────────────────────────────────────────── */
  const N = 90;
  const airPts: V3[] = [];
  for (let i = 0; i <= N; i++) airPts.push(pos((JUMP.T * i) / N));
  const wakePts: V3[] = [];
  for (let i = 0; i <= 120; i++) wakePts.push(pos(T0 + ((T1 - T0) * i) / 120));
  const wakeAirPts: V3[] = airPts.map((p) => [p[0], 0, p[2]] as V3);
  const vecT = Array.from({ length: vecs.length }, (_, i) => 0.06 + (JUMP.T - 0.12) * (i / (vecs.length - 1)));
  const tapeTop = 7.6;

  const render = () => {
    raf = 0;
    dirty = false;
    if (!W) return;
    setCam();
    const t = Math.min(T1, Math.max(0, state.t));
    const T = JUMP.T;
    const p = pos(t);
    const v = vel(t);
    const h = p[1];

    /* siatka wody */
    let dx = '';
    let dz = '';
    const o1: [number, number] = [0, 0];
    const o2: [number, number] = [0, 0];
    for (let z = -20; z <= 20; z += 4) {
      proj([-26, 0, z], o1);
      proj([46, 0, z], o2);
      dx += `M${o1[0].toFixed(1)} ${o1[1].toFixed(1)}L${o2[0].toFixed(1)} ${o2[1].toFixed(1)}`;
    }
    for (let x = -24; x <= 44; x += 4) {
      proj([x, 0, -20], o1);
      proj([x, 0, 20], o2);
      dz += `M${o1[0].toFixed(1)} ${o1[1].toFixed(1)}L${o2[0].toFixed(1)} ${o2[1].toFixed(1)}`;
    }
    gridX.setAttribute('d', dx);
    gridZ.setAttribute('d', dz);

    wake.setAttribute('d', path(wakePts));
    wakeAir.setAttribute('d', path(wakeAirPts));

    /* ślad łuku */
    arcGhost.setAttribute('d', path(airPts));
    const litN = Math.max(1, Math.min(N, Math.round((Math.min(t, T) / T) * N)));
    arcLit.setAttribute('d', path(airPts.slice(0, litN + 1)));

    /* wektory prędkości */
    for (let i = 0; i < vecs.length; i++) {
      const ti = vecT[i];
      const lit = t >= ti - 0.02;
      const pi = pos(ti);
      const vi = vel(ti);
      vecs[i].setAttribute('d', arrow(pi, add(pi, vi, 0.2)));
      vecs[i].classList.toggle('is-lit', lit);
    }

    /* playhead */
    const [px, py] = P(p);
    dot.setAttribute('cx', px.toFixed(1));
    dot.setAttribute('cy', py.toFixed(1));
    halo.setAttribute('cx', px.toFixed(1));
    halo.setAttribute('cy', py.toFixed(1));
    live.setAttribute('d', arrow(p, add(p, v, 0.34), 9));
    // deska: odcinek 1.3 m wzdłuż wektora prędkości
    const vn = Math.hypot(v[0], v[1], v[2]) || 1;
    const bdir: V3 = [(v[0] / vn) * 0.7, (v[1] / vn) * 0.7, (v[2] / vn) * 0.7];
    board.setAttribute('d', path([add(p, bdir, -1), add(p, bdir, 1)]));
    if (accel) {
      const [ax, ay] = P(add(p, [0, -G * 0.3, 0]));
      accel.setAttribute('d', arrow(p, add(p, [0, -G * 0.3, 0]), 8));
      setLabel('acc', 'a −9.81 m/s²', ax + 10, ay + 4);
      accel.style.opacity = t > 0 && t < T ? '1' : '0';
      labels.acc.style.opacity = t > 0 && t < T ? '1' : '0';
    }

    /* taśma mierznicza (przy apexie) */
    const foot: V3 = [cx0, 0, 0];
    const top: V3 = [cx0, tapeTop, 0];
    tapeBase.setAttribute('d', path([foot, top]));
    const hh = Math.min(h, tapeTop);
    tapeFill.setAttribute('d', path([foot, [cx0, hh, 0]]));
    let ticks = '';
    for (let m = 0; m <= 7; m++) {
      const a = P([cx0, m, 0]);
      const len = m % 2 === 0 ? 9 : 5;
      ticks += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}h${-len}`;
    }
    tapeTicks.setAttribute('d', ticks);
    tapeNums.forEach((n, i) => {
      const a = P([cx0, (i + 1) * 2, 0]);
      n.setAttribute('x', (a[0] - 14).toFixed(1));
      n.setAttribute('y', (a[1] + 3.5).toFixed(1));
      if (!n.textContent) n.textContent = `${(i + 1) * 2}`;
    });
    const gp = P([cx0, h, 0]);
    gauge.setAttribute('d', `M${gp[0].toFixed(1)} ${gp[1].toFixed(1)}L${px.toFixed(1)} ${py.toFixed(1)}`);
    gauge.style.opacity = h > 0.05 ? '1' : '0';
    const pk = P([cx0, APEX_H, 0]);
    peak.setAttribute('d', `M${(pk[0] - 12).toFixed(1)} ${pk[1].toFixed(1)}h24`);
    const passed = t > T / 2 + 0.02;
    peak.style.opacity = passed ? '1' : '0';

    /* etykiety */
    const atApex = Math.abs(t - T / 2) < 0.035 * T;
    setLabel('h', `${atApex ? 'APEX ' : ''}${f1(h)} m`, gp[0] + 14, gp[1] + (atApex ? -2 : 0));
    labels.h.classList.toggle('is-apex', atApex);
    const air = Math.min(Math.max(t, 0), T);
    if (W < 600) setLabel('read', `AIR ${air.toFixed(1)} s`, px - 14, py - 26, 'end');
    else setLabel('read', `AIR ${air.toFixed(1)} s · ${f1(vn)} m/s`, px + 16, py - 24);
    labels.read.style.opacity = '1';

    if (opts.annotate) {
      const a = P(pos(0));
      const b = P(pos(T));
      takeoffRing.setAttribute('cx', a[0].toFixed(1));
      takeoffRing.setAttribute('cy', a[1].toFixed(1));
      takeoffRing.setAttribute('rx', '7');
      takeoffRing.setAttribute('ry', '2.8');
      landRing.setAttribute('cx', b[0].toFixed(1));
      landRing.setAttribute('cy', b[1].toFixed(1));
      landRing.setAttribute('rx', '7');
      landRing.setAttribute('ry', '2.8');
      const off: V3 = [0, 0, 3.6];
      const pa = add(pos(0), off);
      const pb = add(pos(T), off);
      distLine.setAttribute('d', `${path([pa, pb])}${path([pos(0), pa])}${path([pos(T), pb])}`);
      const mid = P([cx0, 0, 3.6]);
      setLabel('dist', `${Math.round(DIST)} m`, mid[0], mid[1] + 18, 'middle');
      setLabel('takeoff', 'TAKEOFF', a[0] - 4, a[1] + 22, 'end');
    }

    /* latawiec */
    if (opts.kite) {
      const base = add(p, [KITE_OFFSET.x, KITE_OFFSET.y + v[1] * 0.05, KITE_OFFSET.z]);
      const s: V3 = [0.93, 0, 0.36];
      const up: V3 = [-0.25, 0.97, 0];
      const lead: V3[] = [];
      const trail: V3[] = [];
      for (let i = 0; i <= 20; i++) {
        const u = (i / 20) * 2 - 1;
        const w = 1 - u * u;
        lead.push(add(add(base, s, 2.7 * u), up, 1.5 * w));
        trail.push(add(add(base, s, 2.7 * u), up, 0.4 * w));
      }
      kiteBody.setAttribute('d', `${path(lead)}${path(trail.slice().reverse()).replace('M', 'L')}Z`);
      const harness = add(p, [0, 1.1, 0]);
      kiteLines.setAttribute(
        'd',
        `${path([harness, lead[6]])}${path([harness, lead[14]])}${path([harness, trail[10]])}`,
      );
    }

    opts.onFrame?.({ t, h, hMax: t > T / 2 ? APEX_H : h, speed: vn, vy: v[1], air, landed: t >= T - 0.01 });
  };

  const schedule = () => {
    dirty = true;
    if (!raf && active) raf = requestAnimationFrame(render);
  };

  const resize = () => {
    const r = svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === W && h === H) return;
    W = w;
    H = h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    mrect.setAttribute('width', String(W));
    mrect.setAttribute('height', String(H));
    const rect = opts.fit(W, H);
    mrect.setAttribute('x', String(rect.x0 - (rect.x1 - rect.x0) * 0.35));
    mrect.setAttribute('width', String((rect.x1 - rect.x0) * 1.7));
    mrect.setAttribute('y', String(rect.y0 - (rect.y1 - rect.y0) * 0.6));
    mrect.setAttribute('height', String((rect.y1 - rect.y0) * 2.6));
    fit();
    schedule();
  };

  resize();

  return {
    resize,
    render: () => {
      resize();
      render();
    },
    set(next) {
      let changed = false;
      for (const k of Object.keys(next) as Array<keyof SceneState>) {
        const val = next[k];
        if (val !== undefined && state[k] !== val) {
          state[k] = val;
          changed = true;
        }
      }
      if (changed) schedule();
    },
    get: () => ({ ...state }),
    setActive(on: boolean) {
      active = on;
      if (on && dirty) schedule();
      if (!on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}

