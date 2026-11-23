import { parseLocal } from './dates.js';
import { mean, round1 } from './units.js';

export const RANGE_LO = 70;
export const RANGE_HI = 140;
export const MAX_GLUCOSE_PER_REQUEST = 2000;

export function prepareGlucoseRows(readings, tz, nowS = Date.now() / 1000) {
  const rows = [];
  for (const r of readings || []) {
    let ts = r.ts != null ? Math.round(+r.ts) : parseLocal(r.local, tz);
    if (ts > 1e11) ts = Math.round(ts / 1000);
    const mg = +r.mgdl;
    if (!Number.isFinite(ts) || !Number.isFinite(mg) || mg < 20 || mg > 600 || ts < 1.4e9 || ts > nowS + 86400) continue;
    rows.push([ts, mg]);
  }
  return rows;
}

export function glucoseStats(readings, meals, start) {
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
