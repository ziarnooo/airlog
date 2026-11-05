/**
 * Mała scenka na ekranie zegarka: START → szukanie GPS → nagrywanie (skoki rosną) → SESSION SAVED.
 * Pętla działa tylko, gdy zegarek jest w kadrze; reduced-motion = statyczny ekran nagrywania.
 */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Beat {
  at: number;
  scene: 'start' | 'gps' | 'rec' | 'saved';
}
const CYCLE = 17;
const BEATS: Beat[] = [
  { at: 0, scene: 'start' },
  { at: 3, scene: 'gps' },
  { at: 5.6, scene: 'rec' },
  { at: 13.2, scene: 'saved' },
];
const JUMPS = [
  { at: 8, v: 3.1 },
  { at: 10.3, v: 4.4 },
  { at: 12.2, v: 5.9 },
];

const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

for (const svg of document.querySelectorAll<SVGSVGElement>('svg.watch[data-scene="story"]')) {
  const scenes = {
    start: svg.querySelector('.sc-start'),
    gps: svg.querySelector('.sc-gps'),
    rec: svg.querySelector('.sc-rec'),
    saved: svg.querySelector('.sc-saved'),
  };
  const q = (n: string) => svg.querySelectorAll<SVGTSpanElement>(`[data-st="${n}"]`);
  const fields = { time: q('time'), dist: q('dist'), speed: q('speed'), last: q('last'), highest: q('highest') };
  const btnStart = svg.querySelector('.w-btn-start');
  const set = (list: NodeListOf<SVGTSpanElement>, v: string) => {
    for (const el of list) if (el.textContent !== v) el.textContent = v;
  };
  const show = (name: Beat['scene']) => {
    for (const [k, el] of Object.entries(scenes)) el?.classList.toggle('is-on', k === name);
  };
  const press = (el: Element | null) => {
    if (!el) return;
    el.classList.add('is-pressed');
    setTimeout(() => el.classList.remove('is-pressed'), 260);
  };

  if (reduced) {
    show('rec');
    set(fields.last, '5.9');
    set(fields.highest, '5.9');
    continue;
  }

  let timer = 0;
  let t0 = 0;
  let current: Beat['scene'] | '' = '';
  let pressedFor = -1;
  const tick = () => {
    const t = ((performance.now() - t0) / 1000) % CYCLE;
    let beat = BEATS[0];
    for (const b of BEATS) if (t >= b.at) beat = b;
    if (beat.scene !== current) {
      current = beat.scene;
      show(current);
    }
    // przyciski: START tuż przed GPS, STOP tuż przed zapisem
    const pressKey = t > 2.6 && t < 3.1 ? 1 : t > 12.8 && t < 13.3 ? 2 : 0;
    if (pressKey && pressKey !== pressedFor) {
      pressedFor = pressKey;
      press(btnStart);
    }
    if (!pressKey) pressedFor = -1;

    if (current === 'gps') set(fields.time, mmss(t - 3 + 8));
    if (current === 'rec') {
      const u = (t - 5.6) / (13.2 - 5.6);
      set(fields.time, mmss(12 * 60 + 41 + u * (42 * 60 + 18 - 12 * 60 - 41)));
      set(fields.dist, (3.12 + u * (12.84 - 3.12)).toFixed(2));
      set(fields.speed, (24.6 + Math.sin(t * 1.7) * 6 + Math.sin(t * 0.6) * 3).toFixed(1));
      let last = '--';
      let high = 0;
      for (const j of JUMPS) {
        if (t >= j.at) {
          last = j.v.toFixed(1);
          high = Math.max(high, j.v);
        }
      }
      set(fields.last, last);
      set(fields.highest, high ? high.toFixed(1) : '--');
    }
  };

  const run = (on: boolean) => {
    if (on && !timer) {
      t0 = performance.now();
      current = '';
      tick();
      timer = window.setInterval(tick, 140);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
  show('start');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => run(e.isIntersecting), { rootMargin: '5% 0px' }).observe(svg);
  } else run(true);
}
