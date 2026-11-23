// Calendar and time-zone helpers shared by the Worker and the tests.
// The browser does not reimplement these; day navigation comes back on the API payload.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

export function zonedToEpoch(y, mo, d, h, mi, s, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz); // second pass settles DST edges
  return Math.floor(t / 1000);
}

export const dayOfTs = (ts, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts * 1000));
export const todayIn = (tz, nowMs = Date.now()) => dayOfTs(nowMs / 1000, tz);

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function dayBounds(day, tz) {
  const at = (s) => { const [y, m, d] = s.split('-').map(Number); return zonedToEpoch(y, m, d, 0, 0, 0, tz); };
  return [at(day), at(addDays(day, 1))];
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

export function parseLocal(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str || '');
  return m ? zonedToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz) : NaN;
}

export function timeToTs(day, hhmm, tz) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return NaN;
  const [y, mo, d] = day.split('-').map(Number);
  return zonedToEpoch(y, mo, d, +m[1], +m[2], 0, tz);
}

export function hhmmIn(ts, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ts * 1000));
}

/** Format a calendar date (not an instant) so the weekday cannot drift across zones. */
export function formatDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(dt);
  return {
    short: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
    long: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    weekday: fmt({ weekday: 'long' }),
  };
}

/**
 * Withings activity/sleep sync uses a rolling 14-day window ending today.
 * `addDays(toDay, -13)` is load-bearing: upserts are idempotent and this keeps
 * backfilling recent nights when nobody has weighed in.
 */
export function activityWindow(toDay) {
  return { fromDay: addDays(toDay, -13), toDay };
}

/** Hours from a same-evening last meal to bed. A bed clock at or before the meal is treated as after midnight. */
export function hoursBeforeBed(lastHHMM, bedHHMM) {
  const last = clockMinutes(lastHHMM);
  let bed = clockMinutes(bedHHMM);
  if (last == null || bed == null) return null;
  if (bed <= last) bed += 24 * 60;
  return (bed - last) / 60;
}

function clockMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
