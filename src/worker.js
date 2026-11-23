// Protocol tracker API. Static files come from ./public; this module serves /api/* .
// Single-user: browser calls use an httpOnly cookie, phone automations keep the bearer token.

import { clearSessionCookie, readCookie, sessionCookie, tokensEqual } from './lib/auth.js';
import { todayIn } from './lib/dates.js';
import { HABIT_CATALOG } from './lib/habits.js';
import { applySecurityHeaders } from './lib/headers.js';
import { resolveScheduledSession } from './lib/schedule.js';
import { mergeSettings, validateSettings } from './lib/settings.js';
import { HttpError, bad, json, validDay } from './http.js';
import { dayView, loadScheduleRows, progressView, rangeView, toCsv } from './views.js';
import {
  postBp, postEvent, postGlucose, postMeal, postSessionSets, postWeight, putCheckin, putHabit, upsertSession,
} from './writes.js';
import { withingsAuthStart, withingsCallback, withingsConnect, withingsStatus, withingsSync } from './withings.js';

async function readBody(request) {
  try { return await request.json(); } catch { throw bad('invalid JSON body'); }
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  return mergeSettings(results, env.DEFAULT_TZ);
}

async function putSettings(env, body) {
  const { values, error } = validateSettings(body);
  if (error) throw bad(error);
  const stmts = Object.entries(values).map(([k, v]) => env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(k, JSON.stringify(v)));
  if (stmts.length) await env.DB.batch(stmts);
  return getSettings(env);
}

async function authed(request, env) {
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const cookie = readCookie(request.headers.get('cookie'), 'pt_session');
  return tokensEqual(bearer || cookie, env.API_TOKEN);
}

function secureRequest(request) {
  return new URL(request.url).protocol === 'https:';
}

async function login(request, env) {
  const body = await readBody(request);
  const presented = String(body.token || '');
  if (!(await tokensEqual(presented, env.API_TOKEN))) return json({ error: 'unauthorized' }, 401);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(presented, secureRequest(request)) });
}

function logout(request) {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(secureRequest(request)) });
}

async function route(request, env, url) {
  const p = url.pathname, m = request.method, q = url.searchParams;
  const S = await getSettings(env);

  if (p === '/api/settings') {
    if (m === 'GET') return json({ ...S, habit_catalog: HABIT_CATALOG });
    if (m === 'PUT') return json({ ...(await putSettings(env, await readBody(request))), habit_catalog: HABIT_CATALOG });
  }
  if (p === '/api/day' && m === 'GET') return json(await dayView(env, S, q.get('day') || todayIn(S.tz)));
  if (p === '/api/range' && m === 'GET') {
    return json(await rangeView(env, S, +q.get('days') || 14, q.get('to'), { includeGlucose: !!S.show_glucose, max: 31 }));
  }
  if (p === '/api/progress' && m === 'GET') return json(await progressView(env, S, +q.get('days') || 180, q.get('to')));
  if (p === '/api/export.csv' && m === 'GET') {
    const csv = toCsv(await rangeView(env, S, +q.get('days') || 28, q.get('to'), { includeGlucose: true, max: 180 }));
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="protocol-export.csv"',
        'cache-control': 'no-store',
      },
    });
  }
  if (p === '/api/meal') {
    if (m === 'POST') return json(await postMeal(env, S, await readBody(request)));
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM meals WHERE day = ? AND slot = ?').bind(validDay(q.get('day')), +q.get('slot')).run();
      return json({ ok: true });
    }
  }
  if (p === '/api/event') {
    if (m === 'POST') return json(await postEvent(env, S, await readBody(request)));
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(+q.get('id')).run();
      return json({ ok: true });
    }
  }
  if (p === '/api/habit') {
    if (m === 'PUT') return json(await putHabit(env, S, await readBody(request)));
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM habit_log WHERE day = ? AND habit = ?').bind(validDay(q.get('day')), q.get('habit')).run();
      return json({ ok: true });
    }
  }
  if (p === '/api/weight' && m === 'POST') return json(await postWeight(env, S, await readBody(request)));
  if (p === '/api/checkin' && m === 'PUT') return json(await putCheckin(env, S, await readBody(request)));
  if (p === '/api/bp') {
    if (m === 'POST') return json(await postBp(env, S, await readBody(request)));
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM bp_readings WHERE id = ?').bind(+q.get('id')).run();
      return json({ ok: true });
    }
  }
  if (p === '/api/glucose' && m === 'POST') return json(await postGlucose(env, S, await readBody(request)));
  if (p === '/api/session' && m === 'GET') {
    const view = await dayView(env, S, q.get('day') || todayIn(S.tz));
    return json({ day: view.day, program: view.program, session: view.session });
  }
  if (p === '/api/session' && m === 'POST') {
    const body = await readBody(request);
    const day = validDay(body.day || todayIn(S.tz));
    const planned = resolveScheduledSession(day, S, await loadScheduleRows(env)).session;
    return json(await upsertSession(env, S, body, planned));
  }
  const setsPath = /^\/api\/session\/(\d+)\/sets$/.exec(p);
  if (setsPath && m === 'POST') return json(await postSessionSets(env, setsPath[1], await readBody(request)));
  if (p === '/api/withings/connect' && m === 'POST') return json(await withingsConnect(env, url));
  if (p === '/api/withings/sync' && m === 'POST') return json(await withingsSync(env, S));
  if (p === '/api/withings/status' && m === 'GET') return json(await withingsStatus(env));
  throw new HttpError(404, 'not found');
}

async function dispatch(request, env, url) {
  const p = url.pathname, m = request.method;
  if (p === '/api/auth/login' && m === 'POST') return login(request, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(request);
  if (p === '/api/withings/auth' && m === 'GET') return withingsAuthStart(env, url);
  if (p === '/api/withings/callback' && (m === 'GET' || m === 'HEAD')) return withingsCallback(env, url, m);
  if (!(await authed(request, env))) return json({ error: 'unauthorized' }, 401);
  return route(request, env, url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) return applySecurityHeaders(await env.ASSETS.fetch(request));
      return applySecurityHeaders(await dispatch(request, env, url));
    } catch (e) {
      const missing = /no such table/i.test(String(e?.message));
      const err = missing ? new HttpError(503, 'Apply the D1 migrations before logging. See the README.') : e;
      if (err instanceof HttpError) return applySecurityHeaders(json({ error: err.message }, err.status));
      console.error(err);
      return applySecurityHeaders(json({ error: 'server error' }, 500));
    }
  },

  async scheduled(event, env, ctx) {
    const S = await getSettings(env);
    ctx.waitUntil(withingsSync(env, S).catch((e) => console.error('withings cron sync failed', e)));
  },
};
