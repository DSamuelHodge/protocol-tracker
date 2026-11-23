import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MANUAL_WEIGHT_UPSERT, SLEEP_HABIT_UPSERT } from '../src/lib/sql.js';

const V1 = `
CREATE TABLE habit_log (
  day TEXT NOT NULL, habit TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, value REAL,
  source TEXT NOT NULL DEFAULT 'manual', updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, habit)
);
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, slot INTEGER NOT NULL, ts INTEGER NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0, carbs_g REAL NOT NULL DEFAULT 0, note TEXT,
  UNIQUE (day, slot)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', meta TEXT
);
CREATE TABLE glucose (ts INTEGER PRIMARY KEY, mgdl REAL NOT NULL, source TEXT NOT NULL DEFAULT 'import');
CREATE TABLE weights (day TEXT PRIMARY KEY, weight REAL NOT NULL, waist REAL, body_fat_pct REAL, source TEXT NOT NULL DEFAULT 'manual');
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE withings_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL, userid TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE withings_oauth_state (state TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE withings_sync (id INTEGER PRIMARY KEY CHECK (id = 1), lastupdate INTEGER NOT NULL DEFAULT 0);
CREATE TABLE vitals (
  day TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'withings', updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);
`;

const plain = (row) => (row ? { ...row } : row);
const migration = fs.readFileSync(new URL('../migrations/0001_lit_program.sql', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

function apply(db, sql) {
  db.exec(sql);
}

test('migration upgrades a v1 database without touching history', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, V1);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('sleep_hours', '7');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('training_days', '[1,4,5]');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('active_habits', '["window","protein","carbs","walks","training","sleep","screens"]');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('carb_cap', '50');
  db.prepare('INSERT INTO weights (day, weight, waist, body_fat_pct, source) VALUES (?, ?, ?, ?, ?)').run('2026-11-04', 236.2, 40, 30.4, 'withings');
  db.prepare('INSERT INTO habit_log (day, habit, done, value, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('2026-11-22', 'sleep', 1, 8, 'manual', 1);
  db.prepare('INSERT INTO events (day, ts, kind, source) VALUES (?, ?, ?, ?)').run('2026-10-02', 100, 'training', 'manual');
  db.prepare('INSERT INTO events (day, ts, kind, source) VALUES (?, ?, ?, ?)').run('2026-10-02', 200, 'walk', 'manual');
  db.prepare('INSERT INTO meals (day, slot, ts, protein_g, carbs_g) VALUES (?, ?, ?, ?, ?)').run('2026-10-02', 1, 100, 40, 10);

  apply(db, migration);

  const cols = db.prepare('PRAGMA table_info(meals)').all().map((c) => c.name);
  assert.ok(cols.includes('kcal') && cols.includes('fat_g'));
  const meal = plain(db.prepare('SELECT protein_g, carbs_g, kcal FROM meals').get());
  assert.equal(meal.protein_g, 40);
  assert.equal(meal.kcal, null);

  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sleep_hours'").get().value, '7.5');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'training_days'").get().value, '[1,3,5]');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'carb_cap'").get().value, '50');
  assert.match(db.prepare("SELECT value FROM settings WHERE key = 'active_habits'").get().value, /protein_day/);
  assert.equal(db.prepare("SELECT value FROM settings_history WHERE key = 'sleep_hours' AND note = 'pre-lit-reorg'").get().value, '7');
  assert.equal(db.prepare("SELECT value FROM settings_history WHERE key = 'training_days'").get().value, '[1,4,5]');

  const weight = plain(db.prepare('SELECT weight, waist, body_fat_pct, source FROM weights').get());
  assert.deepEqual(weight, { weight: 236.2, waist: 40, body_fat_pct: 30.4, source: 'withings' });

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM program_schedule").get().n, 13);
  assert.equal(db.prepare("SELECT session_type FROM program_schedule WHERE effective_from = '2026-11-24' AND weekday = 4").get().session_type, 'strength_b');
  assert.equal(db.prepare("SELECT session_type FROM program_schedule WHERE effective_from = '2026-11-30' AND weekday = 1").get().session_type, 'strength_a');
  assert.equal(db.prepare("SELECT session_type FROM program_schedule WHERE effective_to = '2026-11-29' AND weekday = 7").get().session_type, 'long_cardio');

  const sessions = db.prepare('SELECT day, session_type, status, notes FROM workout_sessions').all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session_type, 'legacy_training');
  assert.match(sessions[0].notes, /No exercises were invented/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'walk'").get().n, 1);
});

test('manual weigh-in sets source and keeps a scale body-fat when fat is omitted', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, V1);
  db.prepare('INSERT INTO weights (day, weight, waist, body_fat_pct, source) VALUES (?, ?, ?, ?, ?)').run('2026-11-24', 236, 40, 30.1, 'withings');
  db.prepare(MANUAL_WEIGHT_UPSERT).run('2026-11-24', 235.4, 39.5, null);
  let row = plain(db.prepare('SELECT weight, waist, body_fat_pct, source FROM weights').get());
  assert.deepEqual(row, { weight: 235.4, waist: 39.5, body_fat_pct: 30.1, source: 'manual' });
  db.prepare(MANUAL_WEIGHT_UPSERT).run('2026-11-24', 235, 39.5, 29.4);
  row = plain(db.prepare('SELECT weight, body_fat_pct, source FROM weights').get());
  assert.deepEqual(row, { weight: 235, body_fat_pct: 29.4, source: 'manual' });
});

test('withings sleep sync does not overwrite a manual sleep row', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, V1);
  db.prepare('INSERT INTO habit_log (day, habit, done, value, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('2026-11-22', 'sleep', 1, 8.1, 'manual', 10);
  db.prepare(SLEEP_HABIT_UPSERT).run('2026-11-22', 0, 6.5, 99);
  const manual = plain(db.prepare('SELECT done, value, source, updated_at FROM habit_log').get());
  assert.deepEqual(manual, { done: 1, value: 8.1, source: 'manual', updated_at: 10 });

  db.prepare(SLEEP_HABIT_UPSERT).run('2026-11-21', 1, 7.8, 50);
  db.prepare(SLEEP_HABIT_UPSERT).run('2026-11-21', 0, 7.1, 60);
  const watch = plain(db.prepare("SELECT done, value, source, updated_at FROM habit_log WHERE day = '2026-11-21'").get());
  assert.deepEqual(watch, { done: 0, value: 7.1, source: 'withings', updated_at: 60 });
});

test('schema.sql builds a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, schema);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workout_templates").get().n, 7);
  assert.ok(db.prepare('PRAGMA table_info(meals)').all().some((c) => c.name === 'kcal'));
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'program_start'").get().value, '"2026-11-24"');
});
