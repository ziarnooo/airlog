// Entry of the public Airlog app (built by tools/build-app.mjs): the #account and #pair/<token> routes only.
import {$, $$, ic} from './dom.mjs';
import {renderAccount, renderPair} from './account.mjs';
import {PAIR_RE, pendingPair} from './account-api.mjs';

let current = null;

/* ---- cosmos: seeded star field painted once, tinted per theme via opacity ---- */
function stars() {
  const c = document.createElement('canvas'); c.width = c.height = 640;
  const g = c.getContext('2d'); let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 190; i++) {
    const x = r() * 640, y = r() * 640, a = 0.15 + r() * 0.6, big = r() > 0.94, tint = r();
    g.fillStyle = tint > 0.8 ? `rgba(255,214,170,${a})` : tint > 0.55 ? `rgba(170,210,255,${a})` : `rgba(255,255,255,${a})`;
    g.beginPath(); g.arc(x, y, big ? 1.5 : 0.5 + r() * 0.6, 0, 6.283); g.fill();
    if (big) { const gr = g.createRadialGradient(x, y, 0, x, y, 9); gr.addColorStop(0, 'rgba(180,220,255,.35)'); gr.addColorStop(1, 'rgba(180,220,255,0)'); g.fillStyle = gr; g.fillRect(x - 9, y - 9, 18, 18); }
  }
  document.documentElement.style.setProperty('--stars-img', `url(${c.toDataURL()})`);
}

function parse() {
  const raw = location.hash.slice(1) || 'account';
  if (/^(access_token|error)=/.test(raw)) { const t = pendingPair.get(); return t ? {name: 'pair', token: t} : {name: 'account'}; } // e-mail sign-in link landing: tokens/errors arrive as the bare fragment; a pending pairing goes back to its route
  const p = raw.split('?')[0].split('/');
  if (p[0] === 'pair') return {name: 'pair', token: PAIR_RE.test(p[1] || '') ? p[1] : null};
  return {name: 'account'};
}

function renderCurrent() {
  const r = current, el = $('#v-account');
  $('#crumbs').innerHTML = r.name === 'pair' ? `<a href="#account">Account</a>${ic('arrow')}<b>Set up watch</b>` : '<b>Account</b>';
  $$('[data-nav]').forEach(a => { a.classList.add('on'); a.setAttribute('aria-current', 'page'); });
  r.name === 'pair' ? renderPair(el, null, r.token) : renderAccount(el, null);
  document.title = r.name === 'pair' ? 'Airlog · Set up watch' : 'Airlog';
  el.classList.remove('view-in'); void el.offsetWidth; el.classList.add('view-in');
}

function onHash() { current = parse(); renderCurrent(); window.scrollTo(0, 0); }

/* The magic-link redirect carries `?pair=<token>` (set by the web app itself, so it survives another tab or the mail app's browser): remember it as the pending pairing, strip it from the URL,
   and land on #pair/<token>. The sign-in fragment (#access_token=…) is left for the pair route to adopt. */
function adoptPairQuery() {
  const q = new URLSearchParams(location.search), t = q.get('pair'); if (t === null) return;
  q.delete('pair'); const hash = location.hash;
  if (PAIR_RE.test(t)) pendingPair.set(t);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${PAIR_RE.test(t) && hash.length <= 1 ? `#pair/${t}` : hash}`);
}

adoptPairQuery();
stars();
const pin = $('#side-pin'), setSide = open => { document.documentElement.dataset.side = open ? 'open' : 'rail'; localStorage.setItem('airlog-side', open ? 'open' : 'rail'); pin.setAttribute('aria-pressed', open); pin.setAttribute('aria-label', open ? 'Collapse side panel' : 'Pin side panel open'); };
setSide(localStorage.getItem('airlog-side') === 'open'); pin.onclick = () => setSide(document.documentElement.dataset.side !== 'open');
addEventListener('hashchange', onHash);
onHash();
