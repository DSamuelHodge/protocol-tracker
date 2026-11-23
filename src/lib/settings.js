import { DAY_RE } from './dates.js';
import { ALL_HABITS, DEFAULT_ACTIVE } from './habits.js';

export const DEFAULTS = {
  tz: 'America/New_York',
  carb_cap: 50,
  protein_per_meal: 40,
  window_hours: 8,
  sleep_hours: 7.5,
  sleep_hours_high: 8,
  walks_needed: 2,
  training_days: [1, 3, 5], // legacy habit only; the L.I.T. calendar is the schedule
  active_habits: DEFAULT_ACTIVE,
  kcal_low: 2100,
  kcal_high: 2400,
  protein_day_low: 180,
  protein_day_high: 210,
  fat_low: 60,
  fat_high: 80,
  water_oz_low: 100,
  water_oz_high: 120,
  steps_goal: 10000,
  program_start: '2026-11-24',
  standard_start: '2026-11-30',
  offset_from: '2026-11-24',
  offset_to: '2026-11-29',
  strength_ramp_weeks: 2,
  phase_weeks: 16,
  horizon_days: 182,
  goal_weight_low: 200,
  goal_weight_high: 210,
  goal_bf_low: 20,
  goal_bf_high: 24,
  weekly_loss_low: 1,
  weekly_loss_high: 2,
  zone2_hr_low: 110,
  zone2_hr_high: 130,
  zone2_min_low: 45,
  zone2_min_high: 60,
  long_session_min: 75,
  recovery_walk_min: 30,
  typical_bedtime: '22:30',
  show_glucose: false,
  // Optional anchor for the 1–2 lb/week guide. Null uses the first logged weight on/after program_start.
  start_weight: null,
};

const RANGES = {
  carb_cap: [0, 500],
  protein_per_meal: [0, 400],
  window_hours: [1, 24],
  sleep_hours: [1, 14],
  sleep_hours_high: [1, 14],
  walks_needed: [0, 10],
  kcal_low: [0, 10000],
  kcal_high: [0, 10000],
  protein_day_low: [0, 500],
  protein_day_high: [0, 500],
  fat_low: [0, 500],
  fat_high: [0, 500],
  water_oz_low: [0, 400],
  water_oz_high: [0, 400],
  steps_goal: [0, 100000],
  strength_ramp_weeks: [0, 52],
  phase_weeks: [1, 104],
  horizon_days: [28, 400],
  goal_weight_low: [50, 700],
  goal_weight_high: [50, 700],
  goal_bf_low: [1, 70],
  goal_bf_high: [1, 70],
  weekly_loss_low: [0, 10],
  weekly_loss_high: [0, 10],
  zone2_hr_low: [40, 220],
  zone2_hr_high: [40, 220],
  zone2_min_low: [1, 300],
  zone2_min_high: [1, 300],
  long_session_min: [1, 300],
  recovery_walk_min: [1, 300],
  start_weight: [50, 700],
};

const DATE_KEYS = ['program_start', 'standard_start', 'offset_from', 'offset_to'];
const BOOL_KEYS = ['show_glucose'];

export function mergeSettings(rows, envTz) {
  const S = {
    ...DEFAULTS,
    tz: envTz || DEFAULTS.tz,
    active_habits: [...DEFAULTS.active_habits],
    training_days: [...DEFAULTS.training_days],
  };
  for (const r of rows || []) {
    if (!(r.key in DEFAULTS)) continue;
    try { S[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  return S;
}

/** Validate a PUT /api/settings body. Unknown keys are ignored. Returns { values, error }. */
export function validateSettings(body) {
  const values = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in DEFAULTS) || k === 'active_habits' || k === 'training_days' || k === 'tz') continue;
    if (DATE_KEYS.includes(k)) {
      if (typeof v !== 'string' || !DAY_RE.test(v)) return { error: `${k} must be YYYY-MM-DD` };
      values[k] = v;
    } else if (k === 'typical_bedtime') {
      if (typeof v !== 'string' || !/^\d{1,2}:\d{2}$/.test(v)) return { error: 'typical_bedtime must be HH:MM' };
      values[k] = v;
    } else if (BOOL_KEYS.includes(k)) {
      if (typeof v !== 'boolean') return { error: `${k} must be true or false` };
      values[k] = v;
    } else if (k === 'start_weight' && (v === null || v === '')) {
      values[k] = null;
    } else if (k in RANGES) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? +v : NaN);
      const [lo, hi] = RANGES[k];
      if (!(n >= lo && n <= hi)) return { error: `${k} must be a number from ${lo} to ${hi}` };
      values[k] = n;
    }
  }
  if ('tz' in (body || {})) {
    const tz = body.tz;
    if (typeof tz !== 'string') return { error: 'unknown time zone' };
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return { error: 'unknown time zone' }; }
    values.tz = tz;
  }
  if ('training_days' in (body || {})) {
    const v = body.training_days;
    if (!Array.isArray(v) || v.some((n) => !(n >= 1 && n <= 7))) return { error: 'training_days: numbers 1-7' };
    values.training_days = v.map(Number);
  }
  if ('active_habits' in (body || {})) {
    const v = body.active_habits;
    if (!Array.isArray(v) || v.some((h) => !ALL_HABITS.includes(h))) return { error: 'active_habits: unknown habit' };
    values.active_habits = v;
  }
  return { values };
}
