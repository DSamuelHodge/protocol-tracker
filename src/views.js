// Read models for the day page, the 14-day charts, the CSV, and the 16-week / 6-month panel.

import { addDays, dayBounds, formatDay, todayIn } from './lib/dates.js';
import { glucoseStats, RANGE_HI, RANGE_LO } from './lib/glucose.js';
import { buildDay } from './lib/scoring.js';
import {
  chooseWeightAnchor, describeProgram, progressionHint, programMeta, resolveScheduledSession, scheduleSeedRows, weightGuide,
} from './lib/schedule.js';
import { validDay } from './http.js';

const CSV_LEGACY = ['window', 'protein', 'carbs', 'walks', 'training', 'sleep', 'screens'];
const CSV_NEW = ['session', 'protein_day', 'calories', 'water', 'sun', 'sugar', 'last_meal'];

async function tryAll(stmt) {
  try {
    const res = await stmt.all();
    return res.results || [];
  } catch (e) {
    if (/no such table/i.test(String(e?.message))) return [];
    throw e;
  }
}
async function tryFirst(stmt) {
  try { return await stmt.first(); }
  catch (e) {
    if (/no such table/i.test(String(e?.message))) return null;
    throw e;
  }
}

export async function loadScheduleRows(env) {
  const rows = await tryAll(env.DB.prepare(
    'SELECT effective_from, effective_to, weekday, session_type, template_id FROM program_schedule'
  ));
  if (!rows.length) return scheduleSeedRows();
  return rows.map((r) => ({ ...r, weekday: +r.weekday, effective_to: r.effective_to || null }));
}

function vitalsMap(rows) {
  return Object.fromEntries((rows || []).map((r) => [r.metric, r.value]));
}

async function progressionFor(env, session, day) {
  if (!session?.template_id || !session.exercises?.length) return {};
  const prev = await tryFirst(env.DB.prepare(
    `SELECT id, day FROM workout_sessions
     WHERE template_id = ? AND day < ? AND status IN ('completed', 'partial')
     ORDER BY day DESC LIMIT 1`
  ).bind(session.template_id, day));
  if (!prev) return {};
  const sets = await tryAll(env.DB.prepare(
    'SELECT exercise_name, set_no, reps, seconds, band_level, tul_seconds FROM workout_sets WHERE session_id = ? AND skipped = 0 ORDER BY seq, set_no'
  ).bind(prev.id));
  const out = {};
  for (const ex of session.exercises) {
    const mine = sets.filter((s) => s.exercise_name === ex.name);
    const last = mine.at(-1);
    if (!last) continue;
    const prevSet = { ...last, day: prev.day };
    out[ex.name] = { ...prevSet, hint: progressionHint(prevSet) };
  }
  return out;
}

function presentSession(session, meta, S, { previewDay = null, log = null, progression = {} } = {}) {
  if (!session) return null;
  return {
    ...session,
    preview: !!previewDay,
    preview_day: previewDay,
    line: previewDay ? `Program starts ${formatDay(previewDay).long}` : describeProgram(meta, session, S),
    log: log ? { ...log, sets: log.sets || [] } : null,
    progression,
  };
}

export async function dayView(env, S, day) {
  day = validDay(day);
  const today = todayIn(S.tz);
  const titles = formatDay(day);
  const [start, end] = dayBounds(day, S.tz);
  const rows = await loadScheduleRows(env);
  const meta = programMeta(day, S);
  let planned = meta.active ? resolveScheduledSession(day, S, rows).session : null;
  let previewDay = null;
  if (!planned && S.program_start && day < S.program_start) {
    planned = resolveScheduledSession(S.program_start, S, rows).session;
    previewDay = S.program_start;
  }

  const [meals, events, habitRows, vitalRows, weight, checkin, sessionRows, bp, gl, lastGl] = await Promise.all([
    env.DB.prepare('SELECT * FROM meals WHERE day = ? ORDER BY slot').bind(day).all().then((r) => r.results || []),
    env.DB.prepare('SELECT * FROM events WHERE day = ? ORDER BY ts').bind(day).all().then((r) => r.results || []),
    env.DB.prepare('SELECT habit, done, value, source FROM habit_log WHERE day = ?').bind(day).all().then((r) => r.results || []),
    env.DB.prepare('SELECT metric, value FROM vitals WHERE day = ?').bind(day).all().then((r) => r.results || []),
    env.DB.prepare('SELECT weight, waist, body_fat_pct, source FROM weights WHERE day = ?').bind(day).first(),
    tryFirst(env.DB.prepare('SELECT * FROM daily_checkins WHERE day = ?').bind(day)),
    tryAll(env.DB.prepare('SELECT * FROM workout_sessions WHERE day = ?').bind(day)),
    tryAll(env.DB.prepare('SELECT id, ts, systolic, diastolic, pulse, source FROM bp_readings WHERE day = ? ORDER BY ts DESC').bind(day)),
    S.show_glucose
      ? env.DB.prepare('SELECT ts, mgdl FROM glucose WHERE ts >= ? AND ts < ? ORDER BY ts').bind(start, end).all().then((r) => r.results || [])
      : Promise.resolve([]),
    S.show_glucose
      ? env.DB.prepare('SELECT MAX(ts) AS ts FROM glucose').first()
      : Promise.resolve(null),
  ]);

  const vitals = vitalsMap(vitalRows);
  const logRow = planned ? sessionRows.find((s) => s.session_type === planned.session_type) || null : null;
  let sets = [];
  if (logRow && !previewDay) {
    sets = await tryAll(env.DB.prepare(
      'SELECT exercise_name, seq, set_no, reps, seconds, band_level, tul_seconds, tempo_ok, skipped, notes FROM workout_sets WHERE session_id = ? ORDER BY seq, set_no'
    ).bind(logRow.id));
  }
  const progression = previewDay ? {} : await progressionFor(env, planned, day);
  const built = buildDay(S, day, {
    meals, events, rows: habitRows, vitals, checkin, scheduled: previewDay ? null : planned, logged: logRow, today,
  });

  return {
    ...built,
    start, end,
    nav: {
      prev: addDays(day, -1),
      next: day < today ? addDays(day, 1) : null,
      today,
      is_today: day === today,
      title: day === today ? 'Today' : titles.short,
      title_long: titles.long,
    },
    program: {
      ...meta,
      line: previewDay ? `Program starts ${formatDay(previewDay).long}` : describeProgram(meta, planned, S),
      start: S.program_start,
      standard_start: S.standard_start,
      six_month_label: meta.six_month ? formatDay(meta.six_month).long : null,
    },
    session: presentSession(planned, meta, S, {
      previewDay,
      log: logRow && !previewDay ? { ...logRow, sets } : null,
      progression,
    }),
    settings: S,
    weight: weight || null,
    checkin: checkin || null,
    bp,
    vitals,
    glucose: S.show_glucose ? {
      hidden: false,
      series: gl.map((r) => [r.ts, r.mgdl]),
      stats: glucoseStats(gl, meals, start),
      last_ts: lastGl?.ts ?? null,
      band: [RANGE_LO, RANGE_HI],
    } : { hidden: true, series: [], stats: null, last_ts: null, band: [RANGE_LO, RANGE_HI] },
  };
}

function group(arr) {
  return arr.reduce((m, x) => ((m[x.day] ||= []).push(x), m), {});
}

export async function rangeView(env, S, days, to, { includeGlucose = false, max = 31 } = {}) {
  const n = Math.min(Math.max(+days || 14, 1), max);
  to = to ? validDay(to) : todayIn(S.tz);
  const today = todayIn(S.tz);
  const from = addDays(to, -(n - 1));
  const [start] = dayBounds(from, S.tz);
  const [, end] = dayBounds(to, S.tz);
  const schedule = await loadScheduleRows(env);
  const [meals, events, habitRows, weights, vitalRows, checkins, sessions, bps, gl] = await Promise.all([
    env.DB.prepare('SELECT * FROM meals WHERE day BETWEEN ? AND ? ORDER BY day, slot').bind(from, to).all().then((r) => r.results || []),
    env.DB.prepare('SELECT * FROM events WHERE day BETWEEN ? AND ? ORDER BY ts').bind(from, to).all().then((r) => r.results || []),
    env.DB.prepare('SELECT day, habit, done, value, source FROM habit_log WHERE day BETWEEN ? AND ?').bind(from, to).all().then((r) => r.results || []),
    env.DB.prepare('SELECT day, weight, waist, body_fat_pct, source FROM weights WHERE day BETWEEN ? AND ? ORDER BY day').bind(from, to).all().then((r) => r.results || []),
    env.DB.prepare('SELECT day, metric, value FROM vitals WHERE day BETWEEN ? AND ?').bind(from, to).all().then((r) => r.results || []),
    tryAll(env.DB.prepare('SELECT * FROM daily_checkins WHERE day BETWEEN ? AND ?').bind(from, to)),
    tryAll(env.DB.prepare('SELECT * FROM workout_sessions WHERE day BETWEEN ? AND ?').bind(from, to)),
    tryAll(env.DB.prepare('SELECT day, ts, systolic, diastolic, pulse FROM bp_readings WHERE day BETWEEN ? AND ? ORDER BY ts').bind(from, to)),
    includeGlucose
      ? env.DB.prepare('SELECT ts, mgdl FROM glucose WHERE ts >= ? AND ts < ? ORDER BY ts').bind(start, end).all().then((r) => r.results || [])
      : Promise.resolve([]),
  ]);
  const gm = group(meals), ge = group(events), gr = group(habitRows);
  const gc = Object.fromEntries(checkins.map((c) => [c.day, c]));
  const gs = group(sessions);
  const wmap = Object.fromEntries(weights.map((w) => [w.day, w]));
  const vmap = {};
  for (const r of vitalRows) (vmap[r.day] ||= {})[r.metric] = r.value;
  const bpMap = {};
  for (const r of bps) bpMap[r.day] = r;

  const out = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    const planned = programMeta(day, S).active ? resolveScheduledSession(day, S, schedule).session : null;
    const logs = gs[day] || [];
    const logged = planned ? logs.find((s) => s.session_type === planned.session_type) || null : null;
    const d = buildDay(S, day, {
      meals: gm[day] || [], events: ge[day] || [], rows: gr[day] || [],
      vitals: vmap[day] || {}, checkin: gc[day] || null, scheduled: planned, logged, today,
    });
    const [s, e] = dayBounds(day, S.tz);
    const g = includeGlucose ? glucoseStats(gl.filter((r) => r.ts >= s && r.ts < e), gm[day] || [], s) : null;
    const v = vmap[day] || {};
    const bp = bpMap[day] || null;
    out.push({
      day,
      score: d.score,
      habits: Object.fromEntries([...CSV_LEGACY, ...CSV_NEW].map((h) => [h, d.habits[h]?.state || 'na'])),
      protein_total: d.protein_total, carbs_total: d.carbs_total, kcal_total: d.kcal_total, fat_total: d.fat_total, water_oz: d.water_oz,
      weight: wmap[day]?.weight ?? null, waist: wmap[day]?.waist ?? null, body_fat_pct: wmap[day]?.body_fat_pct ?? null,
      vitals: v,
      steps: v.steps ?? null, sleep_hours: v.sleep_hours ?? null, sleep_score: v.sleep_score ?? null,
      session_status: logged?.status ?? (planned ? 'planned' : null),
      bp_systolic: bp?.systolic ?? null, bp_diastolic: bp?.diastolic ?? null,
      glucose_avg: g?.avg ?? null, glucose_fasting_avg: g?.fasting_avg ?? null, glucose_in_range_pct: g?.in_range_pct ?? null,
      meal1_rise: g?.per_meal.find((m) => m.slot === 1)?.rise ?? null,
      meal2_rise: g?.per_meal.find((m) => m.slot === 2)?.rise ?? null,
    });
  }
  return { from, to, days: out, settings: S };
}

export function toCsv(range) {
  const cols = [
    'day', 'score_done', 'score_total', ...CSV_LEGACY,
    'protein_g', 'carbs_g', 'weight', 'waist', 'body_fat_pct', 'steps', 'sleep_hours', 'sleep_score',
    'glucose_avg', 'glucose_fasting_avg', 'glucose_in_range_pct', 'meal1_rise', 'meal2_rise',
    ...CSV_NEW, 'kcal', 'fat_g', 'water_oz', 'session_status', 'bp_systolic', 'bp_diastolic',
  ];
  const lines = [cols.join(',')];
  for (const d of range.days) {
    const cells = [
      d.day, d.score.done, d.score.total, ...CSV_LEGACY.map((h) => d.habits[h]),
      d.protein_total, d.carbs_total, d.weight, d.waist, d.body_fat_pct, d.steps, d.sleep_hours, d.sleep_score,
      d.glucose_avg, d.glucose_fasting_avg, d.glucose_in_range_pct, d.meal1_rise, d.meal2_rise,
      ...CSV_NEW.map((h) => d.habits[h]), d.kcal_total, d.fat_total, d.water_oz, d.session_status, d.bp_systolic, d.bp_diastolic,
    ];
    lines.push(cells.map((v) => (v == null ? '' : v)).join(','));
  }
  return lines.join('\n') + '\n';
}

function avg(nums) {
  const xs = nums.filter((n) => n != null && !Number.isNaN(+n)).map(Number);
  if (!xs.length) return null;
  return Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10;
}

export async function progressView(env, S, days, to) {
  const n = Math.min(Math.max(+days || S.horizon_days || 180, 1), 200);
  to = to ? validDay(to) : todayIn(S.tz);
  const today = todayIn(S.tz);
  const from = addDays(to, -(n - 1));
  const schedule = await loadScheduleRows(env);
  const [weights, vitalRows, sessions, bps] = await Promise.all([
    env.DB.prepare('SELECT day, weight, waist, body_fat_pct FROM weights WHERE day <= ? ORDER BY day').bind(to).all().then((r) => r.results || []),
    env.DB.prepare("SELECT day, metric, value FROM vitals WHERE day BETWEEN ? AND ? AND metric IN ('steps', 'sleep_hours')").bind(from, to).all().then((r) => r.results || []),
    tryAll(env.DB.prepare("SELECT day, session_type, status FROM workout_sessions WHERE day BETWEEN ? AND ?").bind(S.program_start || from, to)),
    tryAll(env.DB.prepare('SELECT day, ts, systolic, diastolic FROM bp_readings WHERE day BETWEEN ? AND ? ORDER BY ts').bind(from, to)),
  ]);

  const anchor = chooseWeightAnchor(weights, S);

  const inWindow = weights.filter((w) => w.day >= from && w.day <= to);
  const guide = [];
  if (anchor && S.program_start) {
    const end = to < S.program_start ? S.program_start : to;
    for (let day = S.program_start, guard = 0; day <= end && guard < 80; day = addDays(day, 7), guard++) {
      guide.push({ day, ...weightGuide(anchor.weight, anchor.day, day, S.weekly_loss_low, S.weekly_loss_high) });
    }
    if (!guide.length || guide[guide.length - 1].day !== end) {
      guide.push({ day: end, ...weightGuide(anchor.weight, anchor.day, end, S.weekly_loss_low, S.weekly_loss_high) });
    }
  }

  const steps = [], sleep = [];
  for (const r of vitalRows) {
    if (r.metric === 'steps') steps.push(r.value);
    if (r.metric === 'sleep_hours') sleep.push(r.value);
  }

  let scheduled = 0, adhered = 0;
  const endDay = to < today ? to : today;
  if (S.program_start && endDay >= S.program_start) {
    let guard = 0;
    for (let day = S.program_start; day <= endDay && guard < 400; day = addDays(day, 1), guard++) {
      const planned = resolveScheduledSession(day, S, schedule).session;
      if (!planned) continue;
      scheduled++;
      const hit = sessions.find((s) => s.day === day && s.session_type === planned.session_type && (s.status === 'completed' || s.status === 'partial'));
      if (hit) adhered++;
    }
  }

  const latestWeight = [...weights].reverse().find((w) => w.weight != null) || null;
  const waists = weights.filter((w) => w.waist != null);
  const fats = weights.filter((w) => w.body_fat_pct != null);
  const latestBp = bps.at(-1) || null;
  const guideToday = anchor ? weightGuide(anchor.weight, anchor.day, today < (S.program_start || today) ? S.program_start : (to < today ? to : today), S.weekly_loss_low, S.weekly_loss_high) : null;

  return {
    from, to,
    phase: {
      start: S.program_start,
      week: programMeta(to < (S.program_start || to) ? S.program_start : to, S).week,
      phase_weeks: S.phase_weeks,
      six_month: programMeta(S.program_start || to, S).six_month,
      six_month_label: S.program_start ? formatDay(addDays(S.program_start, S.horizon_days || 182)).long : null,
      goal_weight: [S.goal_weight_low, S.goal_weight_high],
      goal_bf: [S.goal_bf_low, S.goal_bf_high],
      weekly_loss: [S.weekly_loss_low, S.weekly_loss_high],
    },
    anchor: anchor ? { day: anchor.day, weight: anchor.weight } : null,
    guide_today: guideToday,
    guide,
    weights: inWindow,
    summary: {
      weight: latestWeight?.weight ?? null,
      weight_day: latestWeight?.day ?? null,
      waist: waists.at(-1)?.waist ?? null,
      waist_first: waists[0]?.waist ?? null,
      waist_day: waists.at(-1)?.day ?? null,
      body_fat_pct: fats.at(-1)?.body_fat_pct ?? null,
      body_fat_day: fats.at(-1)?.day ?? null,
      steps_avg: avg(steps),
      sleep_avg: avg(sleep),
      adherence: { done: adhered, scheduled },
      bp: latestBp ? { day: latestBp.day, systolic: latestBp.systolic, diastolic: latestBp.diastolic } : null,
    },
  };
}
