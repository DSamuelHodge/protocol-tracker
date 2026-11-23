// SQL the Worker executes for the bugs called out in the audit.
// Kept as constants so tests can run the same strings against SQLite.

/** Manual weigh-in. Sets source to manual, writes body fat when provided, and keeps a stored fat % when the form omits it. */
export const MANUAL_WEIGHT_UPSERT = `INSERT INTO weights (day, weight, waist, body_fat_pct, source)
VALUES (?, ?, ?, ?, 'manual')
ON CONFLICT(day) DO UPDATE SET
  weight = excluded.weight,
  waist = excluded.waist,
  body_fat_pct = COALESCE(excluded.body_fat_pct, weights.body_fat_pct),
  source = 'manual'`;

/** Withings scale sync. Overwrites weight, preserves waist, fills fat only when the scale sent it. */
export const WITHINGS_WEIGHT_UPSERT = `INSERT INTO weights (day, weight, body_fat_pct, source) VALUES (?, ?, ?, 'withings')
ON CONFLICT(day) DO UPDATE SET weight = excluded.weight,
  body_fat_pct = COALESCE(excluded.body_fat_pct, weights.body_fat_pct), source = 'withings'`;

/**
 * Sleep habit written by the cron. The WHERE clause keeps a manual (or Tasker) row:
 * SQLite skips the UPDATE when the existing source is not 'withings', and the INSERT
 * is discarded because of the conflict. A missing row is still inserted.
 */
export const SLEEP_HABIT_UPSERT = `INSERT INTO habit_log (day, habit, done, value, source, updated_at) VALUES (?, 'sleep', ?, ?, 'withings', ?)
ON CONFLICT(day, habit) DO UPDATE SET done = excluded.done, value = excluded.value, source = excluded.source, updated_at = excluded.updated_at
WHERE habit_log.source = 'withings'`;

export function glucoseInsertSql(n) {
  const tuples = Array.from({ length: n }, () => '(?, ?, ?)').join(',');
  return `INSERT OR IGNORE INTO glucose (ts, mgdl, source) VALUES ${tuples}`;
}

/** Strip anything that is not a word character or hyphen. Never interpolated into SQL. */
export function cleanSource(source) {
  const s = String(source ?? 'import').replace(/[^\w-]/g, '').slice(0, 20);
  return s || 'import';
}

export function glucoseBinds(rows, source) {
  const src = cleanSource(source);
  return rows.flatMap(([ts, mg]) => [ts, mg, src]);
}
