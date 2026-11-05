// Cadet HF-1 test site.
// Serves the radio from /public and keeps three small tables in D1:
//   feedback  - what testers tell us
//   attempts  - one row per scored mission, with the cadet's callsign
//   missions  - missions written in the builder (built-in ones live in the page)
// Testers can add feedback and attempts and read active missions.
// Everything else needs the ADMIN_KEY secret.

const BUILTIN_MISSIONS = new Set(['foundation40', 'rit', 'beacon', 'data']);
const ROLES = new Set(['cadet', 'instructor', 'other']);
const MAX_BODY = 12 * 1024;
const MAX_MISSION = 48 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CALL_RE = /^[A-Z0-9/]{2,10}$/;

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
  const m = request.method;
  if (m === 'POST' && pathname === '/api/feedback') return addFeedback(request, env);
  if (m === 'POST' && pathname === '/api/attempt') return addAttempt(request, env);
  if (m === 'GET' && pathname === '/api/missions') return listMissions(env);
  if (pathname.startsWith('/api/admin/')) {
    if (!(await isAdmin(request, env))) {
      await new Promise(r => setTimeout(r, 400)); // slow down guessing
      return json({ error: 'unauthorised' }, 401);
    }
    if (m === 'GET' && pathname === '/api/admin/data') return adminData(env, url);
    if (m === 'GET' && pathname === '/api/admin/check') return json({ ok: true });
    if (m === 'POST' && pathname === '/api/admin/missions') return saveMission(request, env);
    if (m === 'POST' && pathname === '/api/admin/missions/active') return setActive(request, env);
    if (m === 'DELETE' && pathname === '/api/admin/missions') return deleteMission(env, url);
  }
  return json({ error: 'not_found' }, 404);
}

async function readBody(request, max = MAX_BODY) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
// Cadets write zero as Ø. Store a plain 0 so the same callsign always matches.
const normCall = v => str(v, 12).toUpperCase().replace(/[ØΦ∅]/g, '0').replace(/[^A-Z0-9/]/g, '');

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

async function missionExists(env, id) {
  if (BUILTIN_MISSIONS.has(id)) return true;
  if (!ID_RE.test(id)) return false;
  const row = await env.DB.prepare('SELECT id FROM missions WHERE id = ?').bind(id).first();
  return !!row;
}

async function addAttempt(request, env) {
  const b = await readBody(request);
  if (!b || typeof b.mission !== 'string') return json({ error: 'bad_request' }, 400);
  const call = normCall(b.callsign || b.tester);
  if (!CALL_RE.test(call)) return json({ error: 'bad_callsign' }, 400);
  if (!(await missionExists(env, b.mission))) return json({ error: 'unknown_mission' }, 400);
  const rules = Array.isArray(b.rules)
    ? b.rules.slice(0, 30).map(r => ({ id: str(r && r.id, 24), ok: !!(r && r.ok) }))
    : [];
  await env.DB.prepare(
    'INSERT INTO attempts (at, version, tester, mission, points, max_points, passed, licence_fail, rules, txs, changes, secs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    new Date().toISOString(), str(b.v, 20), call, b.mission,
    int(b.points, 0, 200), int(b.max, 0, 200), b.passed ? 1 : 0, b.licence ? 1 : 0,
    JSON.stringify(rules), int(b.txs, 0, 1000), int(b.changes, 0, 10000), int(b.secs, 0, 86400)
  ).run();
  return json({ ok: true });
}

async function listMissions(env) {
  const r = await env.DB.prepare('SELECT id, title, data FROM missions WHERE active = 1 ORDER BY updated DESC').all();
  const out = [];
  for (const row of r.results || []) {
    try {
      const d = JSON.parse(row.data);
      delete d.builder; // builder working notes stay admin-only
      out.push(Object.assign(d, { id: row.id, title: row.title, custom: true }));
    } catch { /* skip a broken row */ }
  }
  return new Response(JSON.stringify({ missions: out }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// A mission is stored as JSON. Check its shape so a bad save cannot break the radio for everyone.
const CHECKS = new Set(['txMax', 'txInside', 'setting', 'max', 'min', 'range', 'changed', 'unchanged', 'rxOffset', 'answer']);
const KINDS = new Set(['licence', 'practice', 'efficiency']);
function cleanMission(b) {
  const id = str(b.id, 40).toLowerCase();
  if (!ID_RE.test(id) || BUILTIN_MISSIONS.has(id)) return { error: 'bad_id' };
  const title = str(b.title, 60), brief = str(b.brief, 800);
  if (!title || !brief) return { error: 'missing_title_or_brief' };
  if (!b.start || typeof b.start !== 'object') return { error: 'missing_start' };
  if (!Array.isArray(b.rules) || !b.rules.length || b.rules.length > 30) return { error: 'bad_rules' };
  const rules = [];
  for (const r of b.rules) {
    if (!r || !CHECKS.has(r.check) || !KINDS.has(r.kind)) return { error: 'bad_rule' };
    const c = { id: str(r.id, 24), kind: r.kind, check: r.check, ok: str(r.ok, 200), no: str(r.no, 200) };
    if (r.kind !== 'licence') c.points = int(r.points, 0, 20);
    if (r.field !== undefined) c.field = str(r.field, 20);
    for (const k of ['max', 'min', 'tol']) if (r[k] !== undefined) c[k] = Number(r[k]);
    if (Array.isArray(r.anyOf)) c.anyOf = r.anyOf.slice(0, 12);
    if (Array.isArray(r.ranges)) c.ranges = r.ranges.slice(0, 12).map(g => [Number(g[0]), Number(g[1])]);
    if (r.station !== undefined) c.station = str(r.station, 12);
    rules.push(c);
  }
  const start = {};
  for (const [k, v] of Object.entries(b.start).slice(0, 40)) {
    if (/^[a-zA-Z]{1,12}$/.test(k) && ['number', 'string', 'boolean'].includes(typeof v)) start[k] = typeof v === 'string' ? v.slice(0, 12) : v;
  }
  const data = {
    brief, start, rules,
    pass: int(b.pass, 0, 200),
    time: str(b.time, 12) || '5 min',
    question: str(b.question, 200) || undefined,
    answerHash: /^[0-9a-f]{64}$/.test(b.answerHash || '') ? b.answerHash : undefined,
    path: b.path ? int(b.path, 100, 170) : undefined,
    builder: b.builder && typeof b.builder === 'object' ? b.builder : undefined,
  };
  const text = JSON.stringify(data);
  if (text.length > MAX_MISSION) return { error: 'too_big' };
  return { id, title, text };
}

async function saveMission(request, env) {
  const b = await readBody(request, MAX_MISSION + 4096);
  if (!b) return json({ error: 'bad_request' }, 400);
  const m = cleanMission(b);
  if (m.error) return json({ error: m.error }, 400);
  await env.DB.prepare(
    'INSERT INTO missions (id, title, data, active, updated) VALUES (?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, updated = excluded.updated'
  ).bind(m.id, m.title, m.text, new Date().toISOString()).run();
  return json({ ok: true, id: m.id });
}

async function setActive(request, env) {
  const b = await readBody(request);
  if (!b || !ID_RE.test(str(b.id, 40))) return json({ error: 'bad_request' }, 400);
  await env.DB.prepare('UPDATE missions SET active = ?, updated = ? WHERE id = ?').bind(b.active ? 1 : 0, new Date().toISOString(), b.id).run();
  return json({ ok: true });
}

async function deleteMission(env, url) {
  const id = str(url.searchParams.get('id'), 40);
  if (!ID_RE.test(id)) return json({ error: 'bad_request' }, 400);
  await env.DB.prepare('DELETE FROM missions WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function adminData(env, url) {
  const limit = int(url.searchParams.get('limit') || 1000, 1, 5000);
  const fb = await env.DB.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').bind(limit).all();
  const at = await env.DB.prepare('SELECT * FROM attempts ORDER BY id DESC LIMIT ?').bind(limit).all();
  const ms = await env.DB.prepare('SELECT id, title, active, updated, data FROM missions ORDER BY updated DESC').all();
  return json({ feedback: fb.results, attempts: at.results, missions: ms.results });
}

async function isAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!env.ADMIN_KEY && !!given && (await sameSecret(given, env.ADMIN_KEY));
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
