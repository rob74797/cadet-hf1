// Cadet HF-1 test site.
// Serves the radio from /public and keeps two small tables in D1:
//   feedback  - what testers tell us
//   attempts  - one row per scored mission
// Testers can only add rows. Reading them needs the ADMIN_KEY secret.

const MISSIONS = new Set(['foundation40', 'rit', 'beacon', 'data']);
const ROLES = new Set(['cadet', 'instructor', 'other']);
const MAX_BODY = 12 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        console.error(err);
        return json({ error: 'server_error' }, 500);
      }
    }
    const res = await env.ASSETS.fetch(request);
    return withSecurityHeaders(res, url.pathname);
  },
};

async function api(request, env, url) {
  const { pathname } = url;
  if (request.method === 'POST' && pathname === '/api/feedback') return addFeedback(request, env);
  if (request.method === 'POST' && pathname === '/api/attempt') return addAttempt(request, env);
  if (request.method === 'GET' && pathname === '/api/admin/data') return adminData(request, env, url);
  return json({ error: 'not_found' }, 404);
}

async function readBody(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

async function addFeedback(request, env) {
  const b = await readBody(request);
  if (!b) return json({ error: 'bad_request' }, 400);
  if (b.website) return json({ ok: true }); // honeypot: bots fill hidden fields
  const good = str(b.good, 1500), bad = str(b.bad, 1500), rating = int(b.rating, 0, 5);
  if (!good && !bad && !rating) return json({ error: 'empty' }, 400);
  const role = ROLES.has(b.role) ? b.role : 'other';
  const state = JSON.stringify(b.state || {}).slice(0, 4000);
  await env.DB.prepare(
    'INSERT INTO feedback (at, version, name, role, rating, good, bad, device, screen, state) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(new Date().toISOString(), str(b.v, 20), str(b.name, 40), role, rating, good, bad, str(b.device, 200), str(b.screen, 40), state).run();
  return json({ ok: true });
}

async function addAttempt(request, env) {
  const b = await readBody(request);
  if (!b || !MISSIONS.has(b.mission)) return json({ error: 'bad_request' }, 400);
  const rules = Array.isArray(b.rules)
    ? b.rules.slice(0, 20).map(r => ({ id: str(r && r.id, 20), ok: !!(r && r.ok) }))
    : [];
  await env.DB.prepare(
    'INSERT INTO attempts (at, version, tester, mission, points, max_points, passed, licence_fail, rules, txs, changes, secs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    new Date().toISOString(), str(b.v, 20), str(b.tester, 10).toUpperCase(), b.mission,
    int(b.points, 0, 100), int(b.max, 0, 100), b.passed ? 1 : 0, b.licence ? 1 : 0,
    JSON.stringify(rules), int(b.txs, 0, 1000), int(b.changes, 0, 10000), int(b.secs, 0, 86400)
  ).run();
  return json({ ok: true });
}

async function adminData(request, env, url) {
  const auth = request.headers.get('authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.ADMIN_KEY || !(await sameSecret(given, env.ADMIN_KEY))) {
    await new Promise(r => setTimeout(r, 400)); // slow down guessing
    return json({ error: 'unauthorised' }, 401);
  }
  const limit = int(url.searchParams.get('limit') || 500, 1, 2000);
  const fb = await env.DB.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').bind(limit).all();
  const at = await env.DB.prepare('SELECT * FROM attempts ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ feedback: fb.results, attempts: at.results });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function withSecurityHeaders(res, pathname) {
  const h = new Headers(res.headers);
  h.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; media-src 'self' blob: data:; img-src 'self' data:; frame-ancestors 'none'");
  if (pathname.startsWith('/admin')) h.set('X-Robots-Tag', 'noindex');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
