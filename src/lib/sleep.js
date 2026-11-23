// Withings sleep summary field is still `remsleepduration` (seconds) on
// POST /v2/sleep action=getsummary. Deep and light use deepsleepduration and
// lightsleepduration. Some nights come back with those two filled and REM
// omitted; the high-frequency action=get series uses state 3 for REM and can
// fill the gap. See https://developer.withings.com/api-reference (sleepv2-getsummary).

export const SLEEP_STATE = { awake: 0, light: 1, deep: 2, rem: 3 };

const REM_KEYS = ['remsleepduration', 'rem_sleep_duration', 'remsleep_duration'];
const DEEP_KEYS = ['deepsleepduration', 'deep_sleep_duration'];
const LIGHT_KEYS = ['lightsleepduration', 'light_sleep_duration'];
const AWAKE_KEYS = ['wakeupduration', 'wake_up_duration'];

function num(v) {
  if (v == null || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') {
      const n = num(obj[k]);
      if (n != null) return n;
    }
  }
  return null;
}

/** Flatten one getsummary series item. Durations are seconds; null means the field was absent. */
export function normalizeSleepNight(seriesItem) {
  const item = seriesItem || {};
  const data = item.data && typeof item.data === 'object' ? item.data : {};
  const flat = { ...item, ...data };
  return {
    day: item.date || data.date || null,
    startdate: num(item.startdate ?? data.startdate),
    enddate: num(item.enddate ?? data.enddate),
    score: num(flat.sleep_score),
    efficiency: num(flat.sleep_efficiency),
    totalSeconds: num(flat.total_sleep_time),
    deepSeconds: pick(flat, DEEP_KEYS),
    lightSeconds: pick(flat, LIGHT_KEYS),
    remSeconds: pick(flat, REM_KEYS),
    awakeSeconds: pick(flat, AWAKE_KEYS),
  };
}

/** Sum REM seconds (state === 3) overlapping a night window. */
export function remSecondsFromStages(stages, nightStart, nightEnd) {
  if (nightStart == null || nightEnd == null || !(nightEnd > nightStart)) return 0;
  let sec = 0;
  for (const seg of stages || []) {
    if (+seg.state !== SLEEP_STATE.rem) continue;
    const a = Math.max(+seg.startdate, nightStart);
    const b = Math.min(+seg.enddate, nightEnd);
    if (b > a) sec += b - a;
  }
  return sec;
}

/** Fill REM from stage segments only when the summary omitted it. A real 0 from the summary is kept. */
export function applyRemFallback(nights, stages) {
  if (!stages?.length) return nights;
  return nights.map((n) => {
    if (n.remSeconds != null) return n;
    const rem = remSecondsFromStages(stages, n.startdate, n.enddate);
    return rem > 0 ? { ...n, remSeconds: rem, remSource: 'stages' } : n;
  });
}

export function secondsToMin(sec) {
  if (sec == null) return null;
  return Math.round(sec / 60);
}
