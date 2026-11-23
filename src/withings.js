// Withings OAuth and the 3-hour sync. Behavior that cron depends on stays:
// kg → lb, stamp lastupdate with this run's time, and a rolling 14-day activity window.

import { publicWithingsStatus } from './lib/auth.js';
import { activityWindow, dayBounds, dayOfTs } from './lib/dates.js';
import { applyRemFallback, normalizeSleepNight, secondsToMin } from './lib/sleep.js';
import { SLEEP_HABIT_UPSERT, WITHINGS_WEIGHT_UPSERT } from './lib/sql.js';
import { round1, kgToLb } from './lib/units.js';
import { HttpError, json } from './http.js';

const WITHINGS_AUTH_URL = 'https://account.withings.com/oauth2_user/authorize2';
const WITHINGS_TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';
const WITHINGS_API_URL = 'https://wbsapi.withings.net';
const WITHINGS_SCOPE = 'user.info,user.metrics,user.activity,user.sleepevents';
const WITHINGS_STATE_TTL = 600;

const SLEEP_FIELDS = 'sleep_score,sleep_efficiency,total_sleep_time,deepsleepduration,lightsleepduration,remsleepduration,wakeupduration';

function redirectUriFor(env, url) {
  return env.WITHINGS_REDIRECT_URI || `${url.origin}/api/withings/callback`;
}

async function withingsTokenRequest(env, params) {
  const form = new URLSearchParams({ action: 'requesttoken', client_id: env.WITHINGS_CLIENT_ID, client_secret: env.WITHINGS_CLIENT_SECRET, ...params });
  const res = await fetch(WITHINGS_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const data = await res.json();
  if (data.status !== 0) throw new HttpError(502, `Withings token error (status ${data.status})`);
  return data.body;
}

async function saveWithingsTokens(env, body) {
  const expires_at = Math.floor(Date.now() / 1000) + (body.expires_in || 10800) - 60;
  await env.DB.prepare(
    `INSERT INTO withings_tokens (id, access_token, refresh_token, expires_at, userid, updated_at) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, userid = excluded.userid, updated_at = excluded.updated_at`
  ).bind(body.access_token, body.refresh_token, expires_at, body.userid ? String(body.userid) : null, Math.floor(Date.now() / 1000)).run();
}

/** Authenticated. Mints a one-time code the browser can open without putting API_TOKEN in the URL. */
export async function withingsConnect(env, url) {
  if (!env.WITHINGS_CLIENT_ID) throw new HttpError(500, 'WITHINGS_CLIENT_ID not configured');
  const code = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_grants WHERE created_at < ?').bind(now - WITHINGS_STATE_TTL),
    env.DB.prepare('INSERT INTO auth_grants (code, created_at, purpose) VALUES (?, ?, ?)').bind(code, now, 'withings'),
  ]);
  return { url: `${url.origin}/api/withings/auth?code=${encodeURIComponent(code)}` };
}

// GET /api/withings/auth?code=<one-time>. The long-lived API token is not accepted here.
export async function withingsAuthStart(env, url) {
  if (url.searchParams.has('token')) {
    return json({ error: 'Token query parameters are not accepted. Use Connect Withings in Settings.' }, 400);
  }
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'missing connect code' }, 400);
  if (!env.WITHINGS_CLIENT_ID) throw new HttpError(500, 'WITHINGS_CLIENT_ID not configured');
  const now = Math.floor(Date.now() / 1000);
  const grant = await env.DB.prepare(
    'SELECT code FROM auth_grants WHERE code = ? AND purpose = ? AND created_at > ?'
  ).bind(code, 'withings', now - WITHINGS_STATE_TTL).first();
  if (!grant) return json({ error: 'invalid or expired connect code' }, 401);
  await env.DB.prepare('DELETE FROM auth_grants WHERE code = ?').bind(code).run();

  const state = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM withings_oauth_state WHERE created_at < ?').bind(now - WITHINGS_STATE_TTL),
    env.DB.prepare('INSERT INTO withings_oauth_state (state, created_at) VALUES (?, ?)').bind(state, now),
  ]);
  const authUrl = new URL(WITHINGS_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', env.WITHINGS_CLIENT_ID);
  authUrl.searchParams.set('scope', WITHINGS_SCOPE);
  authUrl.searchParams.set('redirect_uri', redirectUriFor(env, url));
  authUrl.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      location: authUrl.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

// Withings verifies the registered URL with a bare HEAD that must return 2xx.
export async function withingsCallback(env, url, method) {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) {
    if (method === 'HEAD') return new Response(null, { status: 200 });
    return new Response('Withings callback endpoint. Connect from Settings in the app.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT state FROM withings_oauth_state WHERE state = ? AND created_at > ?').bind(state, now - WITHINGS_STATE_TTL).first();
  if (!row) return json({ error: 'invalid or expired state — connect again from Settings' }, 400);
  await env.DB.prepare('DELETE FROM withings_oauth_state WHERE state = ?').bind(state).run();
  const body = await withingsTokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUriFor(env, url) });
  await saveWithingsTokens(env, body);
  return new Response('Withings connected. You can close this tab.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function getWithingsAccessToken(env) {
  const row = await env.DB.prepare('SELECT access_token, refresh_token, expires_at FROM withings_tokens WHERE id = 1').first();
  if (!row) throw new HttpError(409, 'Withings is not connected. Use Connect Withings in Settings.');
  if (row.expires_at > Math.floor(Date.now() / 1000)) return row.access_token;
  const body = await withingsTokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await saveWithingsTokens(env, body);
  return body.access_token;
}

async function withingsApi(env, path, params) {
  const token = await getWithingsAccessToken(env);
  const res = await fetch(`${WITHINGS_API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (data.status !== 0) throw new HttpError(502, `Withings API error ${data.status} on ${path}`);
  return data.body;
}

async function withingsSeries(env, path, params) {
  const series = [];
  let offset;
  for (let page = 0; page < 6; page++) {
    const body = await withingsApi(env, path, offset != null ? { ...params, offset: String(offset) } : params);
    for (const row of body?.series || []) series.push(row);
    if (!body?.more) break;
    if (body.offset == null || body.offset === offset) break;
    offset = body.offset;
  }
  return series;
}

export async function withingsSync(env, S) {
  const now = Math.floor(Date.now() / 1000);
  const syncRow = await env.DB.prepare('SELECT lastupdate FROM withings_sync WHERE id = 1').first();
  const since = syncRow?.lastupdate || now - 30 * 86400;
  const toDay = dayOfTs(now, S.tz);
  const { fromDay } = activityWindow(toDay);

  const meas = await withingsApi(env, '/measure', { action: 'getmeas', meastypes: '1,6', category: 1, lastupdate: since });
  const weightStmts = [];
  for (const grp of meas.measuregrps || []) {
    const byType = Object.fromEntries((grp.measures || []).map((x) => [x.type, x.value * 10 ** x.unit]));
    if (byType[1] == null) continue;
    const day = dayOfTs(grp.date, S.tz);
    weightStmts.push(env.DB.prepare(WITHINGS_WEIGHT_UPSERT).bind(day, kgToLb(byType[1]), byType[6] != null ? round1(byType[6]) : null));
  }
  if (weightStmts.length) await env.DB.batch(weightStmts);

  const activity = await withingsApi(env, '/v2/measure', {
    action: 'getactivity', startdateymd: fromDay, enddateymd: toDay,
    data_fields: 'steps,hr_average,hr_min,hr_max',
  });

  const vitalsStmts = [];
  const upsertVital = (day, metric, value) => {
    if (value == null || !day) return;
    vitalsStmts.push(env.DB.prepare(
      `INSERT INTO vitals (day, metric, value, source, updated_at) VALUES (?, ?, ?, 'withings', ?)
       ON CONFLICT(day, metric) DO UPDATE SET value = excluded.value, source = 'withings', updated_at = excluded.updated_at`
    ).bind(day, metric, value, now));
  };
  for (const a of activity.activities || []) {
    upsertVital(a.date, 'steps', a.steps);
    upsertVital(a.date, 'hr_avg', a.hr_average);
    upsertVital(a.date, 'hr_min', a.hr_min);
    upsertVital(a.date, 'hr_max', a.hr_max);
  }

  let sleepNights = 0;
  try {
    let nights = (await withingsSeries(env, '/v2/sleep', {
      action: 'getsummary', startdateymd: fromDay, enddateymd: toDay, data_fields: SLEEP_FIELDS,
    })).map(normalizeSleepNight);

    if (nights.some((n) => n.remSeconds == null && (n.deepSeconds != null || n.lightSeconds != null))) {
      try {
        const [start] = dayBounds(fromDay, S.tz);
        const [, end] = dayBounds(toDay, S.tz);
        const stages = await withingsSeries(env, '/v2/sleep', { action: 'get', startdate: String(start), enddate: String(end) });
        nights = applyRemFallback(nights, stages);
      } catch (e) {
        console.error('withings REM stage fallback failed (continuing)', e);
      }
    }

    for (const n of nights) {
      const day = n.day;
      upsertVital(day, 'sleep_score', n.score);
      upsertVital(day, 'sleep_efficiency_pct', n.efficiency);
      const deep = secondsToMin(n.deepSeconds);
      const light = secondsToMin(n.lightSeconds);
      const rem = secondsToMin(n.remSeconds);
      const awake = secondsToMin(n.awakeSeconds);
      if (deep != null) upsertVital(day, 'sleep_deep_min', deep);
      if (light != null) upsertVital(day, 'sleep_light_min', light);
      if (rem != null) upsertVital(day, 'sleep_rem_min', rem);
      if (awake != null) upsertVital(day, 'sleep_awake_min', awake);
      if (n.totalSeconds != null) {
        const hours = round1(n.totalSeconds / 3600);
        upsertVital(day, 'sleep_hours', hours);
        // Fill the sleep habit only when nobody has overridden it. See SLEEP_HABIT_UPSERT.
        vitalsStmts.push(env.DB.prepare(SLEEP_HABIT_UPSERT).bind(day, hours >= S.sleep_hours ? 1 : 0, hours, now));
      }
      sleepNights++;
    }
  } catch (e) {
    console.error('withings sleep sync failed (continuing)', e);
  }

  for (let i = 0; i < vitalsStmts.length; i += 50) await env.DB.batch(vitalsStmts.slice(i, i + 50));
  await env.DB.prepare('INSERT INTO withings_sync (id, lastupdate) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET lastupdate = excluded.lastupdate').bind(now).run();

  return { ok: true, weight_days: weightStmts.length, activity_days: (activity.activities || []).length, sleep_nights: sleepNights };
}

export async function withingsStatus(env) {
  const [tok, sync] = await env.DB.batch([
    env.DB.prepare('SELECT updated_at FROM withings_tokens WHERE id = 1'),
    env.DB.prepare('SELECT lastupdate FROM withings_sync WHERE id = 1'),
  ]);
  return publicWithingsStatus(tok.results[0], sync.results[0]?.lastupdate ?? null);
}
