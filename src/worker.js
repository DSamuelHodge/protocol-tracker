// Protocol tracker API. One Worker serves /api/* (this file) and static files from ./public.
// Single-user by design: every /api call needs "Authorization: Bearer <API_TOKEN>".

const HABITS = ['window', 'protein', 'carbs', 'walks', 'training', 'sleep', 'screens'];
const KINDS = ['first_meal', 'last_meal', 'walk', 'training'];
const DEFAULTS = {
  tz: 'America/New_York',
  carb_cap: 50,          // g/day
  protein_per_meal: 40,  // g
  window_hours: 8,       // first meal -> last meal
  sleep_hours: 7,
  walks_needed: 2,
  training_days: [1, 3, 5], // Mon=1 ... Sun=7
  active_habits: HABITS,
};
const RANGE_LO = 70, RANGE_HI = 140; // mg/dL band used for "within range"
const MAX_GLUCOSE_PER_REQUEST = 2000; // 40 statements x 50 rows, inside the Free-plan 50-query limit

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => { if (!DAY_RE.test(d || '')) throw bad('day must be YYYY-MM-DD'); return d; };

async function authed(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!env.API_TOKEN || !token) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(env.API_TOKEN)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function readBody(request) {
  try { return await request.json(); } catch { throw bad('invalid JSON body'); }
}

// ---------- time zone math (no libraries) ----------
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
function zonedToEpoch(y, mo, d, h, mi, s, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz); // second pass settles DST edges
  return Math.floor(t / 1000);
}
const dayOfTs = (ts, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts * 1000));
const todayIn = (tz) => dayOfTs(Date.now() / 1000, tz);
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayBounds(day, tz) {
  const at = (s) => { const [y, m, d] = s.split('-').map(Number); return zonedToEpoch(y, m, d, 0, 0, 0, tz); };
  return [at(day), at(addDays(day, 1))];
}
function isoWeekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7; // Sun -> 7
}
function parseLocal(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str || '');
  return m ? zonedToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz) : NaN;
}
function timeToTs(day, hhmm, tz) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) throw bad('time must be HH:MM');
  const [y, mo, d] = day.split('-').map(Number);
  return zonedToEpoch(y, mo, d, +m[1], +m[2], 0, tz);
}

// ---------- settings ----------
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const S = { ...DEFAULTS, tz: env.DEFAULT_TZ || DEFAULTS.tz };
  for (const r of results) { try { if (r.key in DEFAULTS) S[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  return S;
}
async function putSettings(env, body) {
  const stmts = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in DEFAULTS)) continue;
    if (k === 'tz') { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); } catch { throw bad('unknown time zone'); } }
    else if (k === 'training_days') { if (!Array.isArray(v) || v.some((n) => !(n >= 1 && n <= 7))) throw bad('training_days: numbers 1-7'); }
    else if (k === 'active_habits') { if (!Array.isArray(v) || v.some((h) => !HABITS.includes(h))) throw bad('active_habits: unknown habit'); }
    else if (!(typeof v === 'number' && v >= 0 && v < 1000)) throw bad(`${k} must be a number`);
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getSettings(env);
}

// ---------- habit resolution ----------
// A stored habit_log row (manual tap, or pushed by an Android automation) always wins.
// Otherwise the state is derived from meals/events. States: done | missed | pending | na
function buildDay(S, day, meals, events, rows) {
  const row = Object.fromEntries(rows.map((r) => [r.habit, r]));
  const ev = (k) => events.filter((e) => e.kind === k);
  const hm = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: S.tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ts * 1000));
  const H = {};

  // window
  // Button events win; otherwise fall back to the times entered on the meal cards.
  const fEv = ev('first_meal')[0], lEv = ev('last_meal').at(-1);
  const firstTs = fEv?.ts ?? meals[0]?.ts;
  const lastTs = lEv?.ts ?? (meals.length >= 2 ? meals.at(-1).ts : undefined);
  if (firstTs && lastTs) {
    const hrs = (lastTs - firstTs) / 3600;
    H.window = { state: hrs <= S.window_hours ? 'done' : 'missed', source: 'auto', detail: `${round1(hrs)} h (${hm(firstTs)}-${hm(lastTs)}), limit ${S.window_hours} h` };
  } else if (firstTs) H.window = { state: 'pending', source: 'auto', detail: `open since ${hm(firstTs)}` };
  else H.window = { state: 'pending', source: 'auto', detail: 'tap First meal, then Meal closed' };

  // protein (per meal)
  const p = meals.map((m) => m.protein_g);
  if (meals.length >= 2) {
    const ok = meals.slice(0, 2).every((m) => m.protein_g >= S.protein_per_meal);
    H.protein = { state: ok ? 'done' : 'missed', source: 'auto', detail: `${p.map((x) => x + ' g').join(' / ')}, target ${S.protein_per_meal} g each` };
  } else H.protein = { state: 'pending', source: 'auto', detail: meals.length ? `${p[0]} g logged, one meal to go` : `log both meals, ${S.protein_per_meal} g each` };

  // carbs (daily cap)
  const carbs = meals.reduce((s, m) => s + m.carbs_g, 0);
  if (carbs > S.carb_cap) H.carbs = { state: 'missed', source: 'auto', detail: `${round1(carbs)} g of ${S.carb_cap} g cap` };
  else if (meals.length >= 2) H.carbs = { state: 'done', source: 'auto', detail: `${round1(carbs)} g of ${S.carb_cap} g cap` };
  else H.carbs = { state: 'pending', source: 'auto', detail: meals.length ? `${round1(carbs)} g so far, cap ${S.carb_cap} g` : `cap ${S.carb_cap} g` };

  // walks
  const walks = ev('walk').length;
  H.walks = { state: walks >= S.walks_needed ? 'done' : 'pending', source: 'auto', detail: `${walks} of ${S.walks_needed}` };

  // training (only scheduled days count)
  const trained = ev('training').length > 0;
  const scheduled = S.training_days.includes(isoWeekday(day));
  if (trained) H.training = { state: 'done', source: 'auto', detail: 'logged' };
  else if (!scheduled) H.training = { state: 'na', source: 'auto', detail: 'rest day' };
  else H.training = { state: 'pending', source: 'auto', detail: 'scheduled today' };

  // sleep, screens: only from a row (phone automation or manual)
  H.sleep = { state: 'pending', source: 'auto', detail: `${S.sleep_hours} h or more` };
  H.screens = { state: 'pending', source: 'auto', detail: 'off 90 min before bed' };

  // overrides
  for (const h of HABITS) {
    const r = row[h];
    if (!r) continue;
    const extra = h === 'sleep' && r.value != null ? `${round1(r.value)} h` : null;
    H[h] = { ...H[h], state: r.done ? 'done' : 'missed', source: r.source, overridden: true, detail: extra || H[h].detail };
  }

  const counted = HABITS.filter((h) => S.active_habits.includes(h) && H[h].state !== 'na');
  const done = counted.filter((h) => H[h].state === 'done').length;
  return { day, habits: H, score: { done, total: counted.length }, meals, events, protein_total: round1(meals.reduce((s, m) => s + m.protein_g, 0)), carbs_total: round1(carbs) };
}

// ---------- glucose analysis ----------
function glucoseStats(readings, meals, start) {
  if (!readings.length) return null;
  const vals = readings.map((r) => r.mgdl);
  const firstMealTs = meals.length ? Math.min(...meals.map((m) => m.ts)) : start + 12 * 3600;
  const fasting = readings.filter((r) => r.ts >= start + 6 * 3600 && r.ts < firstMealTs).map((r) => r.mgdl);
  const perMeal = meals.map((m) => {
    let base = readings.filter((r) => r.ts >= m.ts - 900 && r.ts <= m.ts).map((r) => r.mgdl);
    if (!base.length) { const prev = readings.filter((r) => r.ts < m.ts && r.ts >= m.ts - 1800).at(-1); base = prev ? [prev.mgdl] : []; }
    const after = readings.filter((r) => r.ts > m.ts && r.ts <= m.ts + 7200);
    if (!base.length || !after.length) return { slot: m.slot, ts: m.ts, baseline: null, peak: null, rise: null, minutes_to_peak: null };
    const peak = after.reduce((a, r) => (r.mgdl > a.mgdl ? r : a));
    const b = mean(base);
    return { slot: m.slot, ts: m.ts, baseline: round1(b), peak: peak.mgdl, rise: round1(peak.mgdl - b), minutes_to_peak: Math.round((peak.ts - m.ts) / 60) };
  });
  return {
    n: vals.length, avg: round1(mean(vals)), min: Math.min(...vals), max: Math.max(...vals),
    fasting_avg: round1(mean(fasting)),
    in_range_pct: Math.round((100 * vals.filter((v) => v >= RANGE_LO && v <= RANGE_HI).length) / vals.length),
    per_meal: perMeal,
  };
}

// ---------- views ----------
async function dayView(env, S, day) {
  validDay(day);
  const [start, end] = dayBounds(day, S.tz);
  const [meals, events, rows, gl, last] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM meals WHERE day = ? ORDER BY slot').bind(day),
    env.DB.prepare('SELECT * FROM events WHERE day = ? ORDER BY ts').bind(day),
    env.DB.prepare('SELECT habit, done, value, source FROM habit_log WHERE day = ?').bind(day),
    env.DB.prepare('SELECT ts, mgdl FROM glucose WHERE ts >= ? AND ts < ? ORDER BY ts').bind(start, end),
    env.DB.prepare('SELECT MAX(ts) AS ts FROM glucose'),
  ]);
  const d = buildDay(S, day, meals.results, events.results, rows.results);
  const weight = await env.DB.prepare('SELECT weight, waist FROM weights WHERE day = ?').bind(day).first();
  return {
    ...d, start, end, settings: S, weight: weight || null,
    glucose: { series: gl.results.map((r) => [r.ts, r.mgdl]), stats: glucoseStats(gl.results, meals.results, start), last_ts: last.results[0]?.ts ?? null, band: [RANGE_LO, RANGE_HI] },
  };
}

async function rangeView(env, S, days, to) {
  to = to ? validDay(to) : todayIn(S.tz);
  const from = addDays(to, -(days - 1));
  const [start] = dayBounds(from, S.tz), [, end] = dayBounds(to, S.tz);
  const [meals, events, rows, weights, gl] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM meals WHERE day BETWEEN ? AND ? ORDER BY day, slot').bind(from, to),
    env.DB.prepare('SELECT * FROM events WHERE day BETWEEN ? AND ? ORDER BY ts').bind(from, to),
    env.DB.prepare('SELECT day, habit, done, value, source FROM habit_log WHERE day BETWEEN ? AND ?').bind(from, to),
    env.DB.prepare('SELECT day, weight, waist FROM weights WHERE day BETWEEN ? AND ? ORDER BY day').bind(from, to),
    env.DB.prepare('SELECT ts, mgdl FROM glucose WHERE ts >= ? AND ts < ? ORDER BY ts').bind(start, end),
  ]);
  const group = (arr) => arr.reduce((m, x) => ((m[x.day] ||= []).push(x), m), {});
  const gm = group(meals.results), ge = group(events.results), gr = group(rows.results);
  const wmap = Object.fromEntries(weights.results.map((w) => [w.day, w]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const [s, e] = dayBounds(day, S.tz);
    const d = buildDay(S, day, gm[day] || [], ge[day] || [], gr[day] || []);
    const g = glucoseStats(gl.results.filter((r) => r.ts >= s && r.ts < e), gm[day] || [], s);
    out.push({
      day, score: d.score, habits: Object.fromEntries(HABITS.map((h) => [h, d.habits[h].state])),
      protein_total: d.protein_total, carbs_total: d.carbs_total,
      weight: wmap[day]?.weight ?? null, waist: wmap[day]?.waist ?? null,
      glucose_avg: g?.avg ?? null, glucose_fasting_avg: g?.fasting_avg ?? null, glucose_in_range_pct: g?.in_range_pct ?? null,
      meal1_rise: g?.per_meal.find((m) => m.slot === 1)?.rise ?? null, meal2_rise: g?.per_meal.find((m) => m.slot === 2)?.rise ?? null,
    });
  }
  return { from, to, days: out, settings: S };
}

function toCsv(range) {
  const cols = ['day', 'score_done', 'score_total', ...HABITS, 'protein_g', 'carbs_g', 'weight', 'waist', 'glucose_avg', 'glucose_fasting_avg', 'glucose_in_range_pct', 'meal1_rise', 'meal2_rise'];
  const lines = [cols.join(',')];
  for (const d of range.days) {
    lines.push([d.day, d.score.done, d.score.total, ...HABITS.map((h) => d.habits[h]), d.protein_total, d.carbs_total, d.weight, d.waist, d.glucose_avg, d.glucose_fasting_avg, d.glucose_in_range_pct, d.meal1_rise, d.meal2_rise].map((v) => (v == null ? '' : v)).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------- writes ----------
async function postMeal(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const slot = +b.slot;
  if (![1, 2].includes(slot)) throw bad('slot must be 1 or 2');
  const protein = +b.protein_g, carbs = +b.carbs_g;
  if (!(protein >= 0 && protein < 400) || !(carbs >= 0 && carbs < 500)) throw bad('protein_g / carbs_g out of range');
  const ts = b.time ? timeToTs(day, b.time, S.tz) : Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO meals (day, slot, ts, protein_g, carbs_g, note) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, slot) DO UPDATE SET ts = excluded.ts, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, note = excluded.note`
  ).bind(day, slot, ts, protein, carbs, b.note ? String(b.note).slice(0, 200) : null).run();
  return { ok: true };
}

async function postEvent(env, S, b) {
  if (!KINDS.includes(b.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
  const ts = b.ts ? Math.floor(+b.ts) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts)) throw bad('bad ts');
  const day = b.day ? validDay(b.day) : dayOfTs(ts, S.tz);
  const stmts = [];
  if (b.kind === 'first_meal' || b.kind === 'last_meal') stmts.push(env.DB.prepare('DELETE FROM events WHERE day = ? AND kind = ?').bind(day, b.kind));
  stmts.push(env.DB.prepare('INSERT INTO events (day, ts, kind, source, meta) VALUES (?, ?, ?, ?, ?)').bind(day, ts, b.kind, String(b.source || 'manual').slice(0, 30), b.meta ? String(b.meta).slice(0, 200) : null));
  await env.DB.batch(stmts);
  return { ok: true, day };
}

async function putHabit(env, S, b) {
  if (!HABITS.includes(b.habit)) throw bad('unknown habit');
  const day = validDay(b.day || todayIn(S.tz));
  const value = b.value == null ? null : +b.value;
  let done = b.done;
  if (done == null && value != null && b.habit === 'sleep') done = value >= S.sleep_hours;
  if (done == null) throw bad('done (or a sleep value) is required');
  await env.DB.prepare(
    `INSERT INTO habit_log (day, habit, done, value, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, habit) DO UPDATE SET done = excluded.done, value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`
  ).bind(day, b.habit, done ? 1 : 0, value, String(b.source || 'manual').slice(0, 30), Math.floor(Date.now() / 1000)).run();
  return { ok: true };
}

async function postWeight(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const w = +b.weight, waist = b.waist == null || b.waist === '' ? null : +b.waist;
  if (!(w > 20 && w < 700)) throw bad('weight out of range');
  await env.DB.prepare('INSERT INTO weights (day, weight, waist) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET weight = excluded.weight, waist = excluded.waist').bind(day, w, waist).run();
  return { ok: true };
}

async function postGlucose(env, S, b) {
  if (!Array.isArray(b.readings)) throw bad('readings must be an array');
  if (b.readings.length > MAX_GLUCOSE_PER_REQUEST) throw bad(`max ${MAX_GLUCOSE_PER_REQUEST} readings per request`);
  const source = String(b.source || 'import').slice(0, 20);
  const nowS = Date.now() / 1000;
  const rows = [];
  for (const r of b.readings) {
    let ts = r.ts != null ? Math.round(+r.ts) : parseLocal(r.local, S.tz);
    if (ts > 1e11) ts = Math.round(ts / 1000); // tolerate milliseconds
    const mg = +r.mgdl;
    if (!Number.isFinite(ts) || !Number.isFinite(mg) || mg < 20 || mg > 600 || ts < 1.4e9 || ts > nowS + 86400) continue;
    rows.push([ts, mg]);
  }
  const stmts = [];
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO glucose (ts, mgdl, source) VALUES ${chunk.map(() => `(?, ?, '${source.replace(/[^\w-]/g, '')}')`).join(',')}`).bind(...chunk.flat()));
  }
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  return { received: b.readings.length, valid: rows.length, inserted: res.reduce((s, r) => s + (r.meta?.changes || 0), 0) };
}

// ---------- router ----------
async function route(request, env, url) {
  const p = url.pathname, m = request.method, q = url.searchParams;
  const S = await getSettings(env);

  if (p === '/api/settings') {
    if (m === 'GET') return json(S);
    if (m === 'PUT') return json(await putSettings(env, await readBody(request)));
  }
  if (p === '/api/day' && m === 'GET') return json(await dayView(env, S, q.get('day') || todayIn(S.tz)));
  if (p === '/api/range' && m === 'GET') return json(await rangeView(env, S, Math.min(Math.max(+q.get('days') || 14, 1), 31), q.get('to')));
  if (p === '/api/export.csv' && m === 'GET') {
    const csv = toCsv(await rangeView(env, S, Math.min(Math.max(+q.get('days') || 28, 1), 31), q.get('to')));
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="protocol-export.csv"', 'cache-control': 'no-store' } });
  }
  if (p === '/api/meal') {
    if (m === 'POST') return json(await postMeal(env, S, await readBody(request)));
    if (m === 'DELETE') { await env.DB.prepare('DELETE FROM meals WHERE day = ? AND slot = ?').bind(validDay(q.get('day')), +q.get('slot')).run(); return json({ ok: true }); }
  }
  if (p === '/api/event') {
    if (m === 'POST') return json(await postEvent(env, S, await readBody(request)));
    if (m === 'DELETE') { await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(+q.get('id')).run(); return json({ ok: true }); }
  }
  if (p === '/api/habit') {
    if (m === 'PUT') return json(await putHabit(env, S, await readBody(request)));
    if (m === 'DELETE') { await env.DB.prepare('DELETE FROM habit_log WHERE day = ? AND habit = ?').bind(validDay(q.get('day')), q.get('habit')).run(); return json({ ok: true }); }
  }
  if (p === '/api/weight' && m === 'POST') return json(await postWeight(env, S, await readBody(request)));
  if (p === '/api/glucose' && m === 'POST') return json(await postGlucose(env, S, await readBody(request)));
  throw new HttpError(404, 'not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!(await authed(request, env))) return json({ error: 'unauthorized' }, 401);
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};
