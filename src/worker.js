// Cadet HF-1 test site.
// Serves the radio from /public and keeps three small tables in D1:
//   feedback  - what testers tell us
//   attempts  - one row per scored mission, with the cadet's GreenVoice callsign (or GUEST)
//   missions  - missions written in the builder by GreenVoice super admins
// Linked to GreenVoice (README, "GreenVoice link"):
//   - Cadets log in on GreenVoice's /hf1/ page and come back with a ticket signed with
//     HF1_KEY, a secret both Workers share. This Worker checks the ticket and passes each
//     result on to GreenVoice (service binding GREENVOICE, POST /hf1-api/result), so it
//     reaches the cadet's instructor on the GreenVoice admin page.
//   - Super admins open the builder from the GreenVoice admin page with a builder token,
//     also signed with HF1_KEY. The ADMIN_KEY secret still works as a fallback.
// Testers can add feedback and attempts and read active missions.

const BUILTIN_MISSIONS = new Set(); // every mission now comes from the builder
const DEFAULT_GV = 'https://greenvoice.ccistt.net';
const ROLES = new Set(['cadet', 'instructor', 'other']);
const MAX_BODY = 12 * 1024;
const MAX_MISSION = 420 * 1024; // room for a recorded voice message
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

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
  if (m === 'POST' && pathname === '/api/attempt/forward') return forwardOnly(request, env);
  if (m === 'GET' && pathname === '/api/missions') return listMissions(env);
  if (m === 'GET' && pathname === '/api/config') return json({ greenvoice: gvUrl(env), linked: !!(await hmacKey(env)) });
  if (pathname.startsWith('/api/admin/')) {
    const who = await isAdmin(request, env);
    if (!who) {
      await new Promise(r => setTimeout(r, 400)); // slow down guessing
      return json({ error: 'unauthorised' }, 401);
    }
    if (m === 'GET' && pathname === '/api/admin/data') return adminData(env, url);
    if (m === 'GET' && pathname === '/api/admin/check') return json({ ok: true, who: who.email || null });
    if (m === 'POST' && pathname === '/api/admin/missions') return saveMission(request, env, who);
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

async function missionRow(env, id) {
  if (!ID_RE.test(id)) return null;
  return await env.DB.prepare('SELECT id, title FROM missions WHERE id = ?').bind(id).first();
}

// ---- GreenVoice link -------------------------------------------------------
// Tickets and builder tokens are made by GreenVoice (src/hf1-api.js there) and
// checked here with the same shared secret. "hf1:" = cadet ticket, "hf1b:" = builder.
const gvUrl = env => { const u = String(env.GREENVOICE_URL || DEFAULT_GV).replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+$/i.test(u) ? u : DEFAULT_GV; };
const unb64u = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
let keyCache = { secret: null, key: null };
async function hmacKey(env) {
  const secret = env.HF1_KEY;
  if (!secret || String(secret).length < 16) return null;
  if (keyCache.secret !== secret) keyCache = { secret, key: crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']) };
  return keyCache.key;
}
async function verifyToken(env, prefix, token) {
  try {
    const k = await hmacKey(env);
    if (!k || typeof token !== 'string' || token.length > 1024) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const ok = await crypto.subtle.verify('HMAC', k, unb64u(token.slice(dot + 1)), new TextEncoder().encode(prefix + body));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return t && t.v === 1 && t.exp > Date.now() ? t : null;
  } catch { return null; }
}
async function toGreenVoice(env, path, body) {
  const init = { method: 'POST', headers: { 'content-type': 'application/json', 'x-hf1-key': String(env.HF1_KEY || '') }, body: JSON.stringify(body) };
  try {
    const r = env.GREENVOICE ? await env.GREENVOICE.fetch(new Request('https://greenvoice' + path, init)) : await fetch(gvUrl(env) + path, init);
    const d = await r.json().catch(() => ({}));
    return { status: r.status, d };
  } catch (err) { console.error('greenvoice call failed', err); return { status: 0, d: {} }; }
}
// What the page needs to know: sent, or why not and whether to try again later.
function sendResult(x) {
  if (x.status === 200 && x.d.ok) return { sent: true, to: x.d.to || null };
  const retry = x.status === 0 || x.status === 429 || x.status >= 500;
  const reason = x.d.reason === 'callsign' ? 'callsign' : x.d.reason === 'ticket' ? 'login' : retry ? 'later' : 'refused';
  return { sent: false, retry, reason };
}
function resultFor(b, t, row) {
  return {
    ticket: b.ticket, attemptId: str(b.attemptId, 64), mission: row.id, title: row.title,
    points: int(b.points, 0, 200), max: int(b.max, 0, 200), passed: !!b.passed, licence: !!b.licence, secs: int(b.secs, 0, 86400),
  };
}

async function addAttempt(request, env) {
  const b = await readBody(request);
  if (!b || typeof b.mission !== 'string') return json({ error: 'bad_request' }, 400);
  const row = await missionRow(env, b.mission);
  if (!row) return json({ error: 'unknown_mission' }, 400);
  const t = b.ticket ? await verifyToken(env, 'hf1:', b.ticket) : null;
  const call = t ? normCall(t.cs) : 'GUEST';
  const rules = Array.isArray(b.rules)
    ? b.rules.slice(0, 30).map(r => ({ id: str(r && r.id, 24), ok: !!(r && r.ok) }))
    : [];
  await env.DB.prepare(
    'INSERT INTO attempts (at, version, tester, mission, points, max_points, passed, licence_fail, rules, txs, changes, secs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    new Date().toISOString(), str(b.v, 20), call, row.id,
    int(b.points, 0, 200), int(b.max, 0, 200), b.passed ? 1 : 0, b.licence ? 1 : 0,
    JSON.stringify(rules), int(b.txs, 0, 1000), int(b.changes, 0, 10000), int(b.secs, 0, 86400)
  ).run();
  if (!t) return json({ ok: true, sent: false, reason: b.ticket ? 'login' : 'guest' });
  if (!/^[a-z0-9-]{8,64}$/i.test(str(b.attemptId, 64))) return json({ ok: true, sent: false, reason: 'refused' });
  return json(Object.assign({ ok: true }, sendResult(await toGreenVoice(env, '/hf1-api/result', resultFor(b, t, row)))));
}

// A result the phone kept because GreenVoice couldn't be reached: send it on, don't count it again here.
async function forwardOnly(request, env) {
  const b = await readBody(request);
  if (!b || typeof b.mission !== 'string') return json({ error: 'bad_request' }, 400);
  const row = await missionRow(env, b.mission);
  if (!row) return json({ ok: true, sent: false, retry: false, reason: 'refused' });
  const t = await verifyToken(env, 'hf1:', b.ticket);
  if (!t) return json({ ok: true, sent: false, retry: false, reason: 'login' });
  if (!/^[a-z0-9-]{8,64}$/i.test(str(b.attemptId, 64))) return json({ ok: true, sent: false, retry: false, reason: 'refused' });
  return json(Object.assign({ ok: true }, sendResult(await toGreenVoice(env, '/hf1-api/result', resultFor(b, t, row)))));
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
const CHECKS = new Set(['txMax', 'txInside', 'setting', 'max', 'min', 'range', 'inRanges', 'changed', 'unchanged', 'rxOffset', 'answer']);
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
function cleanMsg(m) {
  if (!m || typeof m !== 'object') return undefined;
  const f = int(m.f, 0, 30000000);
  if (f < 1800000) return null;
  const mode = ['LSB', 'USB', 'CW'].includes(m.mode) ? m.mode : null;
  if (!mode) return null;
  const out = { f, mode, dbm: int(m.dbm, -120, -40), gap: int(m.gap, 0, 60), wpm: int(m.wpm, 5, 40) };
  if (mode === 'CW') {
    out.text = str(m.text, 200).toUpperCase().replace(/[^A-Z0-9 /?=.,]/g, '');
    if (!out.text) return null;
  } else {
    const a = m.audio || {};
    if (a.rate !== 6000 || typeof a.iq !== 'string' || a.iq.length > 320000 || !B64.test(a.iq) || typeof a.env !== 'string' || a.env.length > 4000 || !B64.test(a.env)) return null;
    out.audio = { rate: 6000, pk: Number(a.pk) || 1, iq: a.iq, env: a.env, dur: Math.min(20, Number(a.dur) || 0) };
  }
  return out;
}
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
    if (Array.isArray(r.ranges)) c.ranges = r.ranges.slice(0, 24).map(g => [Number(g[0]), Number(g[1])]);
    if (r.station !== undefined) c.station = str(r.station, 12);
    rules.push(c);
  }
  const start = {};
  for (const [k, v] of Object.entries(b.start).slice(0, 40)) {
    if (/^[a-zA-Z]{1,12}$/.test(k) && ['number', 'string', 'boolean'].includes(typeof v)) start[k] = typeof v === 'string' ? v.slice(0, 12) : v;
  }
  const msg = cleanMsg(b.msg);
  if (msg === null) return { error: 'bad_message_station' };
  const data = {
    brief, start, rules, msg,
    pass: int(b.pass, 0, 200),
    time: str(b.time, 12) || '5 min',
    question: str(b.question, 200) || undefined,
    answerHash: /^[0-9a-f]{64}$/.test(b.answerHash || '') ? b.answerHash : undefined,
    path: b.path ? int(b.path, 100, 170) : undefined,
    by: str(b.by, 120) || undefined,
    builder: b.builder && typeof b.builder === 'object' ? b.builder : undefined,
  };
  const text = JSON.stringify(data);
  if (text.length > MAX_MISSION) return { error: 'too_big' };
  return { id, title, text };
}

async function saveMission(request, env, who) {
  const b = await readBody(request, MAX_MISSION + 4096);
  if (!b) return json({ error: 'bad_request' }, 400);
  if (who && who.email) b.by = who.email;
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

// A GreenVoice super admin's builder token ("Bearer bt:<token>"), or the ADMIN_KEY secret.
async function isAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!given) return null;
  if (given.startsWith('bt:')) {
    const t = await verifyToken(env, 'hf1b:', given.slice(3));
    return t ? { email: String(t.em || '') } : null;
  }
  return env.ADMIN_KEY && (await sameSecret(given, env.ADMIN_KEY)) ? { email: null } : null;
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
