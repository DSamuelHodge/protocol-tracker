// JSON writes. Historical tables stay; new logs go to workout_sessions, daily_checkins, and bp_readings.

import { dayOfTs, hoursBeforeBed, timeToTs, todayIn } from './lib/dates.js';
import { prepareGlucoseRows, MAX_GLUCOSE_PER_REQUEST } from './lib/glucose.js';
import { ALL_HABITS } from './lib/habits.js';
import { SESSION_TYPES } from './lib/schedule.js';
import { cleanSource, glucoseBinds, glucoseInsertSql, MANUAL_WEIGHT_UPSERT } from './lib/sql.js';
import { bad, validDay } from './http.js';

const EVENT_KINDS = ['first_meal', 'last_meal', 'walk', 'training'];
const SESSION_STATUS = ['planned', 'completed', 'skipped', 'partial'];

function optNum(v, lo, hi, label) {
  if (v == null || v === '') return null;
  const n = +v;
  if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${label} out of range`);
  return n;
}
function reqNum(v, lo, hi, label) {
  const n = optNum(v, lo, hi, label);
  if (n == null) throw bad(`${label} is required`);
  return n;
}
function optFlag(v) {
  if (v == null || v === '') return null;
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

export async function postMeal(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const slot = +b.slot;
  if (!(slot >= 1 && slot <= 6)) throw bad('slot must be 1 to 6');
  const protein = +b.protein_g, carbs = +b.carbs_g;
  if (!(protein >= 0 && protein < 400) || !(carbs >= 0 && carbs < 500)) throw bad('protein_g / carbs_g out of range');
  const kcal = optNum(b.kcal, 0, 5000, 'kcal');
  const fat = optNum(b.fat_g, 0, 500, 'fat_g');
  const ts = b.time ? timeToTs(day, b.time, S.tz) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts)) throw bad('time must be HH:MM');
  await env.DB.prepare(
    `INSERT INTO meals (day, slot, ts, protein_g, carbs_g, kcal, fat_g, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, slot) DO UPDATE SET ts = excluded.ts, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
       kcal = excluded.kcal, fat_g = excluded.fat_g, note = excluded.note`
  ).bind(day, slot, ts, protein, carbs, kcal, fat, b.note ? String(b.note).slice(0, 200) : null).run();
  return { ok: true };
}

export async function postEvent(env, S, b) {
  if (!EVENT_KINDS.includes(b.kind)) throw bad(`kind must be one of ${EVENT_KINDS.join(', ')}`);
  const ts = b.ts ? Math.floor(+b.ts) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts)) throw bad('bad ts');
  const day = b.day ? validDay(b.day) : dayOfTs(ts, S.tz);
  const stmts = [];
  if (b.kind === 'first_meal' || b.kind === 'last_meal') stmts.push(env.DB.prepare('DELETE FROM events WHERE day = ? AND kind = ?').bind(day, b.kind));
  stmts.push(env.DB.prepare('INSERT INTO events (day, ts, kind, source, meta) VALUES (?, ?, ?, ?, ?)').bind(day, ts, b.kind, String(b.source || 'manual').slice(0, 30), b.meta ? String(b.meta).slice(0, 200) : null));
  await env.DB.batch(stmts);
  return { ok: true, day };
}

export async function putHabit(env, S, b) {
  if (!ALL_HABITS.includes(b.habit)) throw bad('unknown habit');
  const day = validDay(b.day || todayIn(S.tz));
  const value = b.value == null || b.value === '' ? null : +b.value;
  let done = b.done;
  if (done == null && value != null && b.habit === 'sleep') done = value >= S.sleep_hours;
  if (done == null) throw bad('done (or a sleep value) is required');
  await env.DB.prepare(
    `INSERT INTO habit_log (day, habit, done, value, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, habit) DO UPDATE SET done = excluded.done, value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`
  ).bind(day, b.habit, done ? 1 : 0, Number.isFinite(value) ? value : null, String(b.source || 'manual').slice(0, 30), Math.floor(Date.now() / 1000)).run();
  return { ok: true };
}

export async function postWeight(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const w = reqNum(b.weight, 20, 700, 'weight');
  const waist = optNum(b.waist, 10, 80, 'waist');
  // Null body fat keeps the stored value (a Withings fat % should survive a waist-only edit).
  const fat = optNum(b.body_fat_pct, 1, 70, 'body_fat_pct');
  await env.DB.prepare(MANUAL_WEIGHT_UPSERT).bind(day, w, waist, fat).run();
  return { ok: true };
}

export async function postGlucose(env, S, b) {
  if (!Array.isArray(b.readings)) throw bad('readings must be an array');
  if (b.readings.length > MAX_GLUCOSE_PER_REQUEST) throw bad(`max ${MAX_GLUCOSE_PER_REQUEST} readings per request`);
  const source = cleanSource(b.source || 'import');
  const rows = prepareGlucoseRows(b.readings, S.tz);
  const stmts = [];
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    stmts.push(env.DB.prepare(glucoseInsertSql(chunk.length)).bind(...glucoseBinds(chunk, source)));
  }
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  return { received: b.readings.length, valid: rows.length, inserted: res.reduce((s, r) => s + (r.meta?.changes || 0), 0) };
}

export async function putCheckin(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const kcal = optNum(b.kcal, 0, 10000, 'kcal');
  const protein = optNum(b.protein_g, 0, 500, 'protein_g');
  const fat = optNum(b.fat_g, 0, 500, 'fat_g');
  const carbs = optNum(b.carbs_g, 0, 1000, 'carbs_g');
  const water = optNum(b.water_oz, 0, 400, 'water_oz');
  const sugary = optFlag(b.sugary_drinks);
  const sun = optFlag(b.morning_sun);
  const last = b.last_meal_time ? String(b.last_meal_time).slice(0, 5) : null;
  const bed = b.bed_time ? String(b.bed_time).slice(0, 5) : null;
  if (last && !/^\d{1,2}:\d{2}$/.test(last)) throw bad('last_meal_time must be HH:MM');
  if (bed && !/^\d{1,2}:\d{2}$/.test(bed)) throw bad('bed_time must be HH:MM');
  const gap = last ? hoursBeforeBed(last, bed || S.typical_bedtime) : null;
  const notes = b.notes ? String(b.notes).slice(0, 500) : null;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO daily_checkins (day, kcal, protein_g, fat_g, carbs_g, water_oz, sugary_drinks, morning_sun, last_meal_time, bed_time, last_meal_to_bed_hours, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET kcal = excluded.kcal, protein_g = excluded.protein_g, fat_g = excluded.fat_g, carbs_g = excluded.carbs_g,
       water_oz = excluded.water_oz, sugary_drinks = excluded.sugary_drinks, morning_sun = excluded.morning_sun,
       last_meal_time = excluded.last_meal_time, bed_time = excluded.bed_time, last_meal_to_bed_hours = excluded.last_meal_to_bed_hours,
       notes = excluded.notes, updated_at = excluded.updated_at`
  ).bind(day, kcal, protein, fat, carbs, water, sugary, sun, last, bed, gap, notes, now).run();
  return { ok: true, day };
}

export async function postBp(env, S, b) {
  const day = validDay(b.day || todayIn(S.tz));
  const systolic = reqNum(b.systolic, 70, 250, 'systolic');
  const diastolic = reqNum(b.diastolic, 40, 150, 'diastolic');
  const pulse = optNum(b.pulse, 30, 220, 'pulse');
  const ts = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    'INSERT INTO bp_readings (ts, day, systolic, diastolic, pulse, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(ts, day, Math.round(systolic), Math.round(diastolic), pulse == null ? null : Math.round(pulse), 'manual').run();
  return { ok: true, id: res.meta?.last_row_id ?? null };
}

function cleanSets(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw bad('sets must be an array');
  if (raw.length > 80) throw bad('too many sets');
  return raw.map((s, i) => ({
    exercise_name: String(s.exercise_name || s.name || 'Exercise').slice(0, 80),
    seq: Number.isFinite(+s.seq) ? +s.seq : i + 1,
    set_no: Number.isFinite(+s.set_no) ? +s.set_no : 1,
    reps: optNum(s.reps, 0, 200, 'reps'),
    seconds: optNum(s.seconds, 0, 3600, 'seconds'),
    band_level: s.band_level ? String(s.band_level).slice(0, 40) : null,
    tul_seconds: optNum(s.tul_seconds, 0, 3600, 'tul_seconds'),
    tempo_ok: s.tempo_ok === false || s.tempo_ok === 0 ? 0 : (s.tempo_ok == null ? null : 1),
    skipped: s.skipped ? 1 : 0,
    notes: s.notes ? String(s.notes).slice(0, 200) : null,
  }));
}

export async function upsertSession(env, S, b, scheduled) {
  const day = validDay(b.day || todayIn(S.tz));
  const session_type = b.session_type || scheduled?.session_type;
  if (!session_type || (!SESSION_TYPES[session_type] && session_type !== 'legacy_training')) throw bad('unknown session_type');
  const status = b.status || 'completed';
  if (!SESSION_STATUS.includes(status)) throw bad('unknown status');
  const template_id = b.template_id || scheduled?.template_id || SESSION_TYPES[session_type]?.template_id || null;
  const now = Math.floor(Date.now() / 1000);
  const duration = optNum(b.duration_min, 0, 300, 'duration_min');
  const hrAvg = optNum(b.hr_avg, 30, 230, 'hr_avg');
  const hrMin = optNum(b.hr_min, 30, 230, 'hr_min');
  const hrMax = optNum(b.hr_max, 30, 230, 'hr_max');
  const effort = optNum(b.perceived_effort, 1, 10, 'perceived_effort');
  const rounds = optNum(b.rounds_completed, 0, 20, 'rounds_completed');
  const modality = b.modality ? String(b.modality).slice(0, 40) : null;
  const notes = b.notes ? String(b.notes).slice(0, 500) : null;
  const zoneLow = scheduled?.hr_zone?.[0] ?? null;
  const zoneHigh = scheduled?.hr_zone?.[1] ?? null;
  const ended = status === 'completed' || status === 'partial' || status === 'skipped' ? now : null;

  await env.DB.prepare(
    `INSERT INTO workout_sessions (day, template_id, session_type, status, started_at, ended_at, rounds_completed, modality, duration_min, hr_avg, hr_min, hr_max, hr_zone_low, hr_zone_high, perceived_effort, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
     ON CONFLICT(day, session_type) DO UPDATE SET template_id = excluded.template_id, status = excluded.status, ended_at = excluded.ended_at,
       rounds_completed = excluded.rounds_completed, modality = excluded.modality, duration_min = excluded.duration_min,
       hr_avg = excluded.hr_avg, hr_min = excluded.hr_min, hr_max = excluded.hr_max, hr_zone_low = excluded.hr_zone_low,
       hr_zone_high = excluded.hr_zone_high, perceived_effort = excluded.perceived_effort, notes = excluded.notes`
  ).bind(day, template_id, session_type, status, now, ended, rounds, modality, duration, hrAvg, hrMin, hrMax, zoneLow, zoneHigh, effort, notes, now).run();

  const saved = await env.DB.prepare('SELECT id FROM workout_sessions WHERE day = ? AND session_type = ?').bind(day, session_type).first();
  const sets = cleanSets(b.sets);
  if (saved && (b.sets || sets.length)) {
    await replaceSets(env, saved.id, sets);
  }
  return { ok: true, id: saved?.id ?? null, day, session_type, status };
}

export async function postSessionSets(env, sessionId, body) {
  const raw = Array.isArray(body) ? body : body?.sets;
  return replaceSets(env, sessionId, cleanSets(raw));
}

export async function replaceSets(env, sessionId, sets) {
  const id = +sessionId;
  if (!id) throw bad('session id required');
  const existing = await env.DB.prepare('SELECT id FROM workout_sessions WHERE id = ?').bind(id).first();
  if (!existing) throw bad('session not found');
  const stmts = [env.DB.prepare('DELETE FROM workout_sets WHERE session_id = ?').bind(id)];
  for (const s of sets) {
    stmts.push(env.DB.prepare(
      `INSERT INTO workout_sets (session_id, exercise_name, seq, set_no, reps, seconds, band_level, tul_seconds, tempo_ok, skipped, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, s.exercise_name, s.seq, s.set_no, s.reps, s.seconds, s.band_level, s.tul_seconds, s.tempo_ok, s.skipped, s.notes));
  }
  await env.DB.batch(stmts);
  return { ok: true, id, sets: sets.length };
}
