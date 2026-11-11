// Account backend behind one interface: LIVE (supabase-js v2 vendored in ./vendor + the Edge Functions) or MOCK (in-memory, persisted in localStorage).
// MOCK is used when config.js is missing / still has placeholders, or when the page is opened with ?mock=1. Nothing here talks to Strava directly.
// Build markers (tools/build-app.mjs, the public build): block comments written @demo … @end wrap demo-only code that the build strips; an @app block comment holds code the build uncomments. In the source they are plain comments, so the demo keeps working.
// `STRAVA_ENABLED: false` in config.js hides every Strava entry point (the backend's /strava/* is not configured yet); anything else counts as enabled.
// Strava data kept client-side: the athlete's display name from the OAuth callback URL (sessionStorage, tab-scoped) and nothing else.

/** Exact block format of the contract (EN, no link, v1). `jumps` is always plural, as the server writes it. */
export const blockText = ({jumps, highest, avgSpeed}) => `🪁 Airlog · ${jumps} jumps\nHighest ${highest.toFixed(1)} m · avg speed ${avgSpeed.toFixed(0)} km/h`;

export class ApiError extends Error {
  constructor(status, code, message) { super(message || code || `HTTP ${status}`); this.status = status; this.code = code; }
}

/** A pair token is 128 random bits, base64url (22 chars). The QR on the watch encodes `<web app>#pair/<token>`. */
export const PAIR_RE = /^[A-Za-z0-9_-]{22}$/;
const PENDING_KEY = 'airlog.pendingPair';
/** The pairing link opened while signed out: `{token, exp}` in localStorage (10-minute expiry, like the token), so a magic link opened in another tab or the mail app's browser can still route back to `#pair/<token>`.
 *  The primary path is `?pair=<token>` in the magic-link redirect itself; this is the second path. */
const PENDING_TTL = 10 * 60e3;
export const pendingPair = {
  get() {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (v && PAIR_RE.test(v.token || '') && v.exp > Date.now()) return v.token;
      if (v) localStorage.removeItem(PENDING_KEY);
    } catch { /* unreadable: treated as none */ }
    return '';
  },
  set(t) { try { if (this.get() !== t) localStorage.setItem(PENDING_KEY, JSON.stringify({token: t, exp: Date.now() + PENDING_TTL})); } catch { /* storage blocked: only the ?pair= path remains */ } },
  clear() { try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing stored */ } },
};

const usable = c => c && /^https?:\/\/[^\s]+$/.test(c.SUPABASE_URL || '') && !!c.SUPABASE_ANON_KEY && !/YOUR[-_]/i.test(`${c.SUPABASE_URL}${c.SUPABASE_ANON_KEY}`);

async function readConfig() {
  try { const m = await import('./config.js'); const c = m.default ?? m.config ?? {SUPABASE_URL: m.SUPABASE_URL, SUPABASE_ANON_KEY: m.SUPABASE_ANON_KEY}; return usable(c) ? c : null; } catch { return null; }
}

let supabaseJs = null;
function loadSupabaseJs() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return (supabaseJs ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('vendor/supabase.js', import.meta.url).href;
    s.onload = () => res(window.supabase); s.onerror = () => { supabaseJs = null; rej(new Error('Could not load the vendored supabase-js.')); };
    document.head.append(s);
  }));
}

/* ---------------------------------------------------------------- live */
async function createLive(cfg) {
  const sb = await loadSupabaseJs();
  const client = sb.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit'}});
  const base = `${cfg.SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;
  const jwt = async () => (await client.auth.getSession()).data.session?.access_token ?? null;
  const api = async (method, path, {query, body} = {}) => {
    const token = await jwt(); if (!token) throw new ApiError(401, 'not_signed_in', 'Your session expired. Sign in again.');
    let res;
    try {
      res = await fetch(`${base}/${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {method, headers: {authorization: `Bearer ${token}`, apikey: cfg.SUPABASE_ANON_KEY, ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    } catch { throw new ApiError(0, 'network', 'Can’t reach Airlog. Check your connection and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || data.code, data.message);
    return data;
  };
  const call = (path, body) => api('POST', path, {body: body ?? {}});
  const userOf = s => (s?.user ? {id: s.user.id, email: s.user.email ?? ''} : null);
  return {
    mode: 'live',
    stravaEnabled: cfg.STRAVA_ENABLED !== false,
    async getUser() { return userOf((await client.auth.getSession()).data.session); },
    onAuthChange(cb) {
      const {data} = client.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => cb(userOf(s)), 0); });
      return () => data.subscription.unsubscribe();
    },
    async adoptSession({access_token, refresh_token}) {
      const {data, error} = await client.auth.setSession({access_token, refresh_token});
      if (error) throw new ApiError(401, 'bad_session', error.message);
      return userOf(data.session);
    },
    async signInEmail(email, pairToken) {
      const emailRedirectTo = `${location.origin}${location.pathname}${pairToken ? `?pair=${encodeURIComponent(pairToken)}` : ''}`;
      const {error} = await client.auth.signInWithOtp({email, options: {emailRedirectTo, shouldCreateUser: true}});
      if (error) throw new ApiError(error.status ?? 400, error.code, error.message);
    },
    async signOut() { await client.auth.signOut(); },
    async load(user) {
      const [c, w] = await Promise.all([
        client.from('strava_connections').select('descriptions_enabled,scope,revoked_at').eq('user_id', user.id).is('revoked_at', null).maybeSingle(),
        client.from('watches').select('id,device_part,paired_at').eq('user_id', user.id).order('paired_at', {ascending: false}),
      ]);
      if (c.error) throw new ApiError(500, 'load_failed', c.error.message);
      if (w.error) throw new ApiError(500, 'load_failed', w.error.message);
      return {strava: c.data ? {descriptions_enabled: !!c.data.descriptions_enabled, scope: c.data.scope ?? []} : null, watches: w.data ?? []};
    },
    /** Top-level navigation target. `connect` needs the user's JWT as a query param because a browser redirect cannot carry an Authorization header.
     *  `ret` (sign-in only, `pair/<token>`) makes the callback land back on that route instead of #account. */
    async stravaUrl(mode, ret) {
      if (mode === 'signin') return `${base}/strava/connect?mode=signin${ret ? `&return=${encodeURIComponent(ret)}` : ''}`;
      const token = await jwt(); if (!token) throw new ApiError(401, 'not_signed_in');
      return `${base}/strava/connect?mode=connect&access_token=${encodeURIComponent(token)}`;
    },
    pairInfo: token => api('GET', 'pair/info', {query: {pair_token: token}}),
    claim: (token, move) => call('pair/claim', move ? {pair_token: token, move: true} : {pair_token: token}),
    setDescriptions: enabled => call('strava/settings', {descriptions_enabled: enabled}),
    disconnect: () => call('strava/disconnect'),
  };
}

/** Pick the backend once per page load. ?mock=1 forces the mock even when config.js is present. The public build always runs live. */
let cached = null;
export function getBackend() {
  return (cached ??= (async () => {
    const cfg = await readConfig(); if (!cfg) throw new Error('Airlog is not configured: config.js is missing.'); return createLive(cfg);
  })());
}

/* ---------------------------------------------------------------- tab-scoped athlete name (from the callback URL only) */
export const athleteName = {
  get: () => sessionStorage.getItem('airlog-strava-athlete') || '',
  set: n => (n ? sessionStorage.setItem('airlog-strava-athlete', n) : sessionStorage.removeItem('airlog-strava-athlete')),
};
