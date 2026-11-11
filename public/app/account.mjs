// Account screen (#account): sign-in / sign-up (e-mail link, Strava), Strava card (connect, consent + live block preview, disconnect), Watch card (linked watches).
// Pairing screen (#pair/<token>): the first thing a new user sees after scanning the QR code on their watch (sign in or create an account, then link the watch).
// Backend: see account-api.mjs (live supabase-js or mock). Strava data shown here is only the athlete name from the callback URL, to its owner.
import {ic, $} from './dom.mjs';
import {getBackend, blockText, ApiError, athleteName, pendingPair} from './account-api.mjs';

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dateFmt = iso => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
const timeFmt = iso => new Date(iso).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
// Strava is offered only when the backend says so (STRAVA_ENABLED in config.js; the demo mock always does).
const stravaOn = () => !!S.be?.stravaEnabled;
const ALREADY_LINKED = 'This Strava account is already connected to another Airlog account. Sign in with Strava instead.';

let S = null, run = 0, offAuth = null;

/* ------------------------------------------------------------ callback (#account?strava=…, #pair/<token>?strava=…, magic-link fragment) */
function readCallback(prefix) {
  const raw = location.hash.slice(1), qi = raw.indexOf('?'), own = raw.startsWith(prefix);
  const q = new URLSearchParams(own ? (qi >= 0 ? raw.slice(qi + 1) : '') : raw);
  const out = {kind: q.get('strava') || '', athlete: (q.get('athlete') || '').trim().slice(0, 80), tokens: null, authError: null};
  if (q.get('access_token') && q.get('refresh_token')) out.tokens = {access_token: q.get('access_token'), refresh_token: q.get('refresh_token')};
  if (q.get('error') || q.get('error_code')) out.authError = {code: q.get('error_code') || q.get('error'), text: q.get('error_description') || ''};
  out.had = !!(out.kind || out.tokens || out.authError || qi >= 0 || !own);
  return out;
}
const cleanUrl = target => history.replaceState(null, '', `${location.pathname}${location.search}#${target}`);

function noticeFor(cb, user) {
  if (cb.authError) {
    const expired = /otp_expired|expired/i.test(cb.authError.code + cb.authError.text);
    return {kind: 'err', title: expired ? 'That sign-in link has expired' : 'Sign-in didn’t complete', text: expired ? 'Links work once and last an hour. Request a new one below.' : 'Request a new sign-in link below.'};
  }
  const end = s => (/[.!?]$/.test(s) ? ' ' : '. ');
  if (cb.kind === 'connected' && user) return {kind: 'ok', title: 'Strava connected', text: `${cb.athlete ? `Connected as ${cb.athlete}${end(cb.athlete)}` : ''}Choose below whether Airlog adds stats to your activities.`};
  if (cb.kind === 'signed_in') return user ? {kind: 'ok', title: 'Signed in with Strava', text: `${cb.athlete ? `Signed in as ${cb.athlete}${end(cb.athlete)}` : ''}To log sessions, link a watch: open Airlog on it and scan the QR code.`} : {kind: 'err', title: 'Sign-in didn’t complete', text: 'Try Continue with Strava again.'};
  if (cb.kind === 'already_linked_other' && user) return {kind: 'warn', title: 'Strava account already in use', text: ALREADY_LINKED, action: {act: 'strava-signin', label: 'Sign in with Strava'}};
  if (cb.kind === 'error' || cb.kind === 'denied') return {kind: 'err', title: 'Strava didn’t connect', text: cb.kind === 'denied' ? 'Access was declined, so nothing changed. You can try again any time.' : 'The request failed or expired. Nothing changed; try again.'};
  return null;
}

/* ------------------------------------------------------------ markup */
const prefix = html => `<div class="ac-in">${html}</div>`;

function noticeHtml() {
  const n = S.notice; if (!n) return '';
  const icon = {ok: 'check', warn: 'warn', err: 'warn'}[n.kind];
  return `<div class="ac-notice ${n.kind}" role="${n.kind === 'ok' ? 'status' : 'alert'}"><span class="ac-ni">${ic(icon)}</span><div><b>${esc(n.title)}</b><p>${esc(n.text)}</p>${n.action ? `<button class="btn sm" type="button" data-act="${n.action.act}">${esc(n.action.label)}</button>` : ''}</div><button class="btn ghost sm icon" type="button" data-act="notice-x" aria-label="Dismiss">${ic('x')}</button></div>`;
}


const stravaBtn = (act, label) => `<button class="btn lg ac-strava" type="button" data-act="${act}"${S.busy.strava ? ' disabled' : ''}><span>${label}</span>${ic('arrow')}</button>`;

/** The e-mail form + Strava button, shared by #account and #pair. */
function authFormHtml(emailLabel) {
  return `<form class="ac-form" data-form="email" novalidate><label for="ac-email">Email</label>
      <input id="ac-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(S.emailDraft)}" required${S.busy.email ? ' disabled' : ''}>
      <p class="ac-err" id="ac-email-err" role="alert">${esc(S.emailErr)}</p>
      <button class="btn pri lg" type="submit"${S.busy.email ? ' disabled' : ''}>${ic('send')}${S.busy.email ? 'Sending…' : emailLabel}</button></form>`;
}

function sentHtml(narrow, tail) {
  return `<section class="card ac-card ac-narrow"><div class="ac-sent"><span class="ac-bigic">${ic('mail-open')}</span><h2>Check your inbox</h2><p>We sent a sign-in link to <b>${esc(S.sentTo)}</b>. ${tail}The link works once and expires in an hour.</p>
    <div class="ac-row">${[
      '<button class="btn ghost lg" type="button" data-act="mail-other">Use a different email</button>'].join('')}</div></div></section>`;
}

function signedOutHtml() {
  if (S.sentTo) return prefix(sentHtml(true, 'Open it on this device. '));
  return prefix(`<section class="card ac-card ac-narrow"><h2>Sign in to Airlog</h2><p class="ac-lead">Create an account or sign in, it’s the same step. No password: we email you a one-time link.</p>
    ${authFormHtml('Email me a sign-in link')}
    ${stravaOn() ? `<div class="ac-or"><span>or</span></div>
    ${stravaBtn('strava-signin', 'Continue with Strava')}
    <p class="ac-fine">With Strava, Airlog matches your sessions to your activities. If that Strava account is already connected to an Airlog account, you’re signed in to it. You never get a second account.</p>` : ''}</section>`);
}

function previewHtml() {
  const on = S.strava.descriptions_enabled;
  return `<div class="ac-prev" data-on="${on}"><div class="ac-prev-h"><span class="eyebrow">Preview · ${esc(S.preview.label)}</span><span class="tag ac-prev-tag ${on ? 'acc' : ''}"><i></i><span>${on ? 'Will be added' : 'Off, nothing is written'}</span></span></div>
    <div class="ac-desc"><div class="ac-desc-h">Activity description</div><pre class="ac-block">${esc(blockText(S.preview))}</pre><p class="ac-own">Your own description stays right below, untouched.</p></div></div>`;
}

function stravaCardHtml() {
  const st = S.strava;
  if (!st) return `<section class="card ac-card"><header class="ac-h"><span class="ac-ic">${ic('plug')}</span><h2>Strava</h2><span class="tag"><i></i>Not connected</span></header>
    <p class="ac-lead">Connect Strava and Airlog can add your jump stats to your activity description after each session. Strava data stays private to you; it is never shown to other riders.</p>
    ${stravaBtn('strava-connect', 'Connect Strava')}<p class="ac-fine">Permissions requested: view and update your activities. You can disconnect any time.</p></section>`;
  const name = athleteName.get(), canWrite = (st.scope || []).includes('activity:write');
  return `<section class="card ac-card"><header class="ac-h"><span class="ac-ic">${ic('plug')}</span><h2>Strava</h2><span class="tag ok"><i></i>Connected</span></header>
    <p class="ac-lead">${name ? `Connected as <b>${esc(name)}</b>` : 'Your Strava account is connected.'}</p>
    ${canWrite ? '' : `<div class="ac-inline warn"><span>${ic('warn')}</span><p>Strava access is missing permission to update activities, so nothing can be written. Reconnect and allow it.</p><button class="btn sm" type="button" data-act="strava-connect">Reconnect</button></div>`}
    <div class="ac-sw"><div class="ac-sw-t"><b id="ac-sw-l">Add Airlog stats to my Strava activities</b><p>Off by default. After each session, once Airlog has re-checked the jumps, a short block is added above your description. Turn it off any time: no new blocks are written, and blocks already added stay until you delete them in Strava. If you delete one, Airlog won’t add it back.</p></div>
      <button class="ac-switch" type="button" role="switch" aria-checked="${st.descriptions_enabled}" aria-labelledby="ac-sw-l" data-act="toggle"><i></i></button></div>
    ${previewHtml()}
    ${S.confirmDisc ? `<div class="ac-confirm" role="alertdialog" aria-label="Disconnect Strava"><p><b>Disconnect Strava?</b> Airlog deletes your Strava connection and stops writing to your activities. Blocks already added stay until you remove them in Strava.</p><div class="ac-row"><button class="btn lg" type="button" data-act="disc-cancel">Keep connected</button><button class="btn lg ac-danger" type="button" data-act="disc-do"${S.busy.disc ? ' disabled' : ''}>${S.busy.disc ? 'Disconnecting…' : 'Disconnect'}</button></div></div>`
      : `<div class="ac-foot"><button class="btn ghost sm" type="button" data-act="strava-connect">${ic('swap')}Reconnect</button><button class="btn ghost sm ac-dangertxt" type="button" data-act="disc-ask">${ic('unplug')}Disconnect</button></div>`}</section>`;
}

function watchCardHtml() {
  const list = S.watches.length ? `<div class="rows ac-watches">${S.watches.map(w => `<div class="row ac-w"><span class="ac-wi">${ic('watch')}</span><span class="ac-wn"><b>Garmin watch</b><i class="mono">${esc(w.device_part)}</i></span><em>Linked ${esc(dateFmt(w.paired_at))}</em></div>`).join('')}</div>` : '<p class="ac-empty">No watch linked yet.</p>';
  return `<section class="card ac-card"><header class="ac-h"><span class="ac-ic">${ic('watch')}</span><h2>Watch</h2>${S.watches.length ? `<span class="tag ok"><i></i>${S.watches.length} linked</span>` : '<span class="tag"><i></i>Not linked</span>'}</header>
    <p class="ac-lead">To link a watch, open Airlog on it and scan the QR code with your phone.</p>
    ${list}</section>`;
}

function signedInHtml() {
  const ini = (S.user.email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 2) || '·').toUpperCase();
  return prefix(`<div class="card ac-me"><span class="av lg" style="--h:176">${esc(ini)}</span><div class="who"><b>${esc(S.user.email || 'Your account')}</b><i>Signed in</i></div><button class="btn sm" type="button" data-act="signout">${ic('signout')}Sign out</button></div>
    <div class="ac-grid">${stravaOn() ? stravaCardHtml() : ''}${watchCardHtml()}</div>`);
}

/* ------------------------------------------------------------ pairing screen (#pair/<token>) */
const PAIR_TEXT = {
  expired: ['Code expired', 'Your watch will show a new QR code — scan it again.'],
  unknown: ['That QR code isn’t valid', 'Open Airlog on your watch and scan the QR code it shows.'],
};
const pairHead = (icon, tone, title, eyebrow) => `<span class="ac-bigic ${tone}">${ic(icon)}</span>${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h1 class="ac-h1" id="ac-pair-h" tabindex="-1">${title}</h1>`;
const deviceRow = info => `<div class="rows ac-watches"><div class="row ac-w ac-dev"><span class="ac-wi">${ic('watch')}</span><span class="ac-wn"><b>${esc(info.device_name || info.device_part)}</b><i class="mono">${esc(info.device_part)}</i></span></div></div>`;

function pairSignedOutHtml() {
  if (S.sentTo) return prefix(sentHtml(true, 'Open it on any device: it brings you straight back here to link your watch. '));
  return prefix(`<section class="card ac-card ac-narrow ac-hero">${pairHead('watch', '', 'Set up Airlog', 'New watch · step 1 of 2')}
    <p class="ac-lead">Create an account or sign in, then link your watch. Your rides sync to Airlog automatically once it’s linked.</p>
    <ol class="ac-steps"><li class="on"><i>1</i>Sign in or create an account</li><li><i>2</i>Link your watch</li><li><i>3</i>Start riding</li></ol>
    ${stravaOn() ? `${stravaBtn('strava-signin', 'Continue with Strava')}<div class="ac-or"><span>or</span></div>` : ''}
    ${authFormHtml('Email me a sign-in link')}
    <p class="ac-fine">One account per rider, no password.${stravaOn() ? ' If your Strava account already has an Airlog account, you’re signed in to it.' : ''}</p></section>`);
}

function pairSignedInHtml() {
  const p = S.pair, info = p.info, who = `Signed in as <b>${esc(S.user.email)}</b>`;
  const out = `<button class="btn ghost sm" type="button" data-act="signout">${ic('signout')}Not you? Sign out</button>`;
  const go = (href, label, cls = '') => `<a class="btn lg ${cls}" href="${href}">${label}</a>`;
  let body;
  switch (p.view) {
    case 'loading': return `<p class="ac-loading" role="status">Loading…</p>`;
    case 'ready': {
      const name = esc(info.device_name || info.device_part);
      body = `${pairHead('watch', '', `Link ${name} to your account`, 'New watch · step 2 of 2')}<p class="ac-lead">${who}. Sessions from this watch will upload to your profile.</p>${deviceRow(info)}
        <div class="ac-row"><button class="btn pri lg" type="button" data-act="pair-link"${S.busy.claim ? ' disabled' : ''}>${ic('link')}${S.busy.claim ? 'Linking…' : 'Link watch'}</button></div>
        <p class="ac-fine">${p.error ? `<span class="ac-err" role="alert">${esc(p.error)}</span> ` : ''}QR code valid until ${esc(timeFmt(info.expires_at))}. ${out}</p>`;
      break;
    }
    case 'move':
      body = `${pairHead('swap', 'warn', 'This watch is linked to another account', 'One watch, one account')}<p class="ac-lead">${who}.</p>${deviceRow(info)}
        <div class="ac-confirm" role="alertdialog" aria-labelledby="ac-pair-h"><p><b>Move ${esc(info.device_name || 'this watch')} to this account?</b> A watch belongs to one account, so linking it here unlinks it from the other one.</p>
        <div class="ac-row"><button class="btn lg" type="button" data-act="move-cancel">Cancel</button><button class="btn lg acc" type="button" data-act="move-ok"${S.busy.claim ? ' disabled' : ''}>${S.busy.claim ? 'Moving…' : 'Move watch'}</button></div></div>`;
      break;
    case 'cancelled':
      body = `${pairHead('check', '', 'Nothing changed')}<p class="ac-lead">The watch stays linked to its other account. To link it here, scan its QR code again.</p><div class="ac-row">${go('#account', 'Go to my account')}</div>`;
      break;
    case 'mine':
      body = `${pairHead('check', 'ok', 'This watch is already linked to you.')}<p class="ac-lead">${who}. Open Airlog on the watch and start riding.</p>${info ? deviceRow(info) : ''}<div class="ac-row">${go('#account', 'Go to my account', 'acc')}</div>`;
      break;
    case 'done': {
      const name = esc(p.deviceName || 'Your watch');
      body = `${pairHead('check', 'ok', 'Watch linked — you can start riding')}<p class="ac-lead">${name} is now linked to <b>${esc(S.user.email)}</b>. Keep Airlog open on the watch for a few seconds to finish.</p>
        ${p.pending ? `<p class="ac-pending" role="status">${ic('info')}<span>Rides recorded before linking will sync in a few minutes.</span></p>` : ''}
        ${S.strava || !stravaOn() ? `<div class="ac-row">${go('#account', 'Go to my account', 'acc')}</div>`
          : `<div class="ac-next"><span class="eyebrow">Next step · optional</span><div class="ac-next-b"><span class="ac-ic">${ic('plug')}</span><div><b>Connect Strava</b><p>Add your jump stats to your Strava activities. You choose what gets written and can turn it off any time.</p></div></div>
          <a class="btn lg ac-strava" href="#account"><span>Connect Strava</span>${ic('arrow')}</a><a class="btn ghost lg" href="#feed">Not now</a></div>`}`;
      break;
    }
    case 'expired': case 'unknown': {
      const [t, d] = PAIR_TEXT[p.view];
      body = `${pairHead('warn', 'bad', t)}<p class="ac-lead">${d}</p><div class="ac-row">${go('#account', 'Go to my account')}</div><p class="ac-fine">${who}. ${out}</p>`;
      break;
    }
    default:
      body = `${pairHead('warn', 'bad', 'Couldn’t reach your watch link')}<p class="ac-lead">${esc(p.error || 'Something went wrong. Try again.')}</p><div class="ac-row"><button class="btn lg acc" type="button" data-act="pair-retry">Try again</button></div>`;
  }
  return prefix(`<section class="card ac-card ac-narrow ac-hero">${body}</section>`);
}

function pairBodyHtml() {
  if (S.loading) return '<p class="ac-loading" role="status">Loading…</p>';
  if (!S.pair.token) return prefix(`<section class="card ac-card ac-narrow ac-hero">${pairHead('warn', 'bad', PAIR_TEXT.unknown[0])}<p class="ac-lead">${PAIR_TEXT.unknown[1]}</p><div class="ac-row"><a class="btn lg" href="#account">Go to my account</a></div></section>`);
  return S.user ? pairSignedInHtml() : pairSignedOutHtml();
}

function paint() {
  const r = S.root;
  $('#ac-notice', r).innerHTML = noticeHtml();
  if (S.pair) { $('#ac-body', r).innerHTML = pairBodyHtml(); return; }
  $('#ac-meta', r).textContent = S.user ? S.user.email : `Sign in to connect your watch${stravaOn() ? ' and Strava' : ''}`;
  $('#ac-body', r).innerHTML = S.loading ? '<p class="ac-loading" role="status">Loading…</p>' : S.user ? signedInHtml() : signedOutHtml();
}

/* in-place update of the consent toggle + preview (keeps the switch animation) */
function syncConsent() {
  const on = S.strava.descriptions_enabled, r = S.root;
  const sw = $('.ac-switch', r), pv = $('.ac-prev', r); if (!sw || !pv) return;
  sw.setAttribute('aria-checked', on); pv.dataset.on = on;
  $('.ac-prev-tag', pv).classList.toggle('acc', on); $('.ac-prev-tag span', pv).textContent = on ? 'Will be added' : 'Off, nothing is written';
}

/* ------------------------------------------------------------ data + actions */
async function refresh() {
  try { const d = await S.be.load(S.user); S.strava = d.strava; S.watches = d.watches; }
  catch (e) { S.notice = {kind: 'err', title: 'Couldn’t load your account', text: e.message || 'Try again in a moment.'}; }
}

const failText = (e, fallback) => (e instanceof ApiError && e.status === 0 ? e.message : fallback);

async function sendMail(email) {
  S.busy.email = true; S.emailErr = ''; S.emailDraft = email; paint();
  try { await S.be.signInEmail(email, S.pair?.token || undefined); S.sentTo = email; }
  catch (e) { S.emailErr = e.status === 429 || /rate/i.test(e.code || '') ? 'A link was just sent. Wait a minute before asking for another.' : failText(e, e.message || 'Couldn’t send the link. Check the address and try again.'); }
  S.busy.email = false; paint();
  if (S.emailErr) $('#ac-email', S.root)?.focus();
}

async function startStrava(mode) {
  S.busy.strava = true; try {
    const url = await S.be.stravaUrl(mode, mode === 'signin' && S.pair?.token ? `pair/${S.pair.token}` : undefined);
    if (url.startsWith('#')) { S.busy.strava = false; location.hash = url; return; }
    location.assign(url);
  } catch (e) { S.busy.strava = false; S.notice = {kind: 'err', title: 'Couldn’t start Strava', text: e.message || 'Try again.'}; paint(); }
}

/** Show a pairing view and move focus to its heading so screen readers announce the change. */
function pairView(view, error = '') {
  S.pair.view = view; S.pair.error = error; paint();
  if (view !== 'loading') $('#ac-pair-h', S.root)?.focus({preventScroll: true});
}

/** Map a /pair/info or /pair/claim failure onto a view. Returns after painting. */
async function pairFail(e) {
  if (e.status === 410) { pendingPair.clear(); return pairView('expired'); }
  if (e.status === 404) { pendingPair.clear(); return pairView('unknown'); }
  if (e.status === 409) return pairView('move');
  if (e.status === 401) { S.user = await S.be.getUser(); S.notice = {kind: 'err', title: 'Your session expired', text: 'Sign in again to link your watch.'}; S.pair.view = 'loading'; return paint(); }
  pairView(S.pair.view === 'ready' ? 'ready' : 'error', failText(e, 'Couldn’t reach Airlog. Try again in a moment.'));
}

async function loadPair() {
  const s = S, p = s.pair; p.view = 'loading'; p.error = ''; paint();
  try {
    const info = await s.be.pairInfo(p.token); if (S !== s) return;
    p.info = info; await refresh();
    pairView(info.already_yours ? 'mine' : info.paired_to_other ? 'move' : 'ready');
  } catch (e) { if (S === s) await pairFail(e); }
}

async function claimPair(move) {
  const s = S, p = s.pair; s.busy.claim = true; p.error = ''; paint();
  try {
    const r = await s.be.claim(p.token, move); if (S !== s) return;
    p.deviceName = r.device_name || p.info?.device_name; p.pending = Number(r.pending_sessions) > 0 || Number(p.info?.pending_sessions) > 0;
    pendingPair.clear(); await refresh(); s.busy.claim = false; pairView('done');
  } catch (e) { if (S !== s) return; s.busy.claim = false; await pairFail(e); }
}

async function toggleConsent() {
  const next = !S.strava.descriptions_enabled; S.strava.descriptions_enabled = next; syncConsent();
  try { await S.be.setDescriptions(next); }
  catch (e) { S.strava.descriptions_enabled = !next; syncConsent(); S.notice = {kind: 'err', title: 'Couldn’t save that setting', text: failText(e, 'Nothing changed. Try again.')}; $('#ac-notice', S.root).innerHTML = noticeHtml(); }
}

async function disconnect() {
  S.busy.disc = true; paint();
  try { await S.be.disconnect(); S.strava = null; athleteName.set(''); S.confirmDisc = false; S.notice = {kind: 'ok', title: 'Strava disconnected', text: 'Airlog deleted your Strava connection and won’t write to your activities.'}; }
  catch (e) { S.notice = {kind: 'err', title: 'Couldn’t disconnect', text: failText(e, 'Nothing changed. Try again.')}; }
  S.busy.disc = false; paint();
}

const actions = {
  'strava-signin': () => startStrava('signin'),
  'strava-connect': () => startStrava('connect'),
  'notice-x': () => { S.notice = null; $('#ac-notice', S.root).innerHTML = ''; },
  'mail-other': () => { S.sentTo = ''; paint(); $('#ac-email', S.root)?.focus(); },
  signout: async () => { await S.be.signOut(); athleteName.set(''); },
  toggle: toggleConsent,
  'disc-ask': () => { S.confirmDisc = true; paint(); },
  'disc-cancel': () => { S.confirmDisc = false; paint(); },
  'disc-do': disconnect,
  'pair-link': () => claimPair(false),
  'pair-retry': loadPair,
  'move-ok': () => claimPair(true),
  'move-cancel': () => pairView('cancelled'),
};

function bind(root) {
  root.onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && actions[b.dataset.act]) actions[b.dataset.act](b); };
  root.onsubmit = e => {
    e.preventDefault(); const f = e.target;
    if (f.dataset.form === 'email') {
      const email = f.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.emailDraft = email; S.emailErr = 'Enter a valid email address.'; paint(); $('#ac-email', root).focus(); return; }
      sendMail(email);
    }
  };
}

function previewFrom(db) {
  const r = db?.real;
  return r?.count ? {jumps: r.count, highest: r.highest, avgSpeed: r.avgSpeedKmh, label: 'your latest session'} : {jumps: 12, highest: 4.6, avgSpeed: 27, label: 'an example session'};
}

/* ------------------------------------------------------------ entry */
function start(root, db, pairToken) {
  const gen = ++run, isPair = pairToken !== undefined;
  S = {root, be: null, user: null, strava: null, watches: [], loading: true, notice: null, emailDraft: '', emailErr: '', sentTo: '', confirmDisc: false, busy: {}, preview: previewFrom(db),
    pair: isPair ? {token: pairToken, view: 'loading', info: null, error: '', deviceName: '', pending: false} : null};
  root.innerHTML = isPair ? '<div id="ac-notice"></div><div id="ac-body" class="ac ac-pairing"></div><div id="ac-mock" class="ac-mock-end"></div>' // preview controls sit below the card: the card is the first thing a scanning user sees
    : '<div class="j-head"><h1>Account</h1><span class="meta" id="ac-meta">&nbsp;</span></div><div id="ac-mock"></div><div id="ac-notice"></div><div id="ac-body" class="ac"></div>';
  bind(root); paint();
  (async () => {
    const cb = readCallback(isPair ? 'pair' : 'account'), s = S; let be;
    try { be = await getBackend(); } catch (e) { s.loading = false; s.notice = {kind: 'err', title: 'Account unavailable', text: e.message}; paint(); return; }
    if (gen !== run) return;
    s.be = be;
    if (!be.stravaEnabled) { cb.kind = ''; cb.athlete = ''; }
    if (cb.athlete) athleteName.set(cb.athlete);
    try { if (cb.tokens) await be.adoptSession(cb.tokens); } catch { cb.authError = {code: 'bad_session', text: ''}; }
    if (cb.had) cleanUrl(isPair ? `pair/${pairToken ?? ''}` : 'account');
    if (!isPair && !cb.tokens) pendingPair.clear(); // opening the account page on purpose abandons a half-finished pairing
    s.user = await be.getUser();
    if (gen !== run) return;
    s.notice = noticeFor(cb, s.user) ?? s.notice;
    if (isPair && s.notice?.kind === 'ok') s.notice = null; // the pairing card is the confirmation
    s.loading = false;
    if (isPair && pairToken) {
      if (!s.user) pendingPair.set(pairToken);
      if (s.user) await loadPair(); else paint();
    } else {
      if (s.user) await refresh();
      if (isPair) s.pair.view = 'unknown';
      paint();
    }
    offAuth?.();
    offAuth = be.onAuthChange(async u => {
      if (gen !== run || (u?.id ?? null) === (s.user?.id ?? null)) return;
      s.user = u; s.sentTo = ''; s.loading = false; s.strava = null; s.watches = [];
      if (isPair && pairToken) { if (u) await loadPair(); else { pendingPair.set(pairToken); paint(); } return; }
      if (u) await refresh();
      paint();
    });
  })();
  return {};
}

export const renderAccount = (root, db) => start(root, db);
/** `token` is the 22-char pair token from the route, or null when the link is malformed. */
export const renderPair = (root, db, token) => start(root, db, token);
