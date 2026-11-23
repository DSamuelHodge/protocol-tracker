-- End-state schema for a brand-new database.
-- An existing protocol-tracker database must NOT run this file: CREATE TABLE IF NOT EXISTS
-- will not add columns, and re-applying the inserts is not how upgrades work.
-- Upgrade the live database with migrations/0001_lit_program.sql after a backup.
-- See the README for the export, Time Travel bookmark, apply, and rollback steps.

CREATE TABLE IF NOT EXISTS habit_log (
  day TEXT NOT NULL, habit TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, value REAL,
  source TEXT NOT NULL DEFAULT 'manual', updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, habit)
);
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, slot INTEGER NOT NULL, ts INTEGER NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0, carbs_g REAL NOT NULL DEFAULT 0,
  kcal REAL, fat_g REAL, note TEXT,
  UNIQUE (day, slot)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events (day, kind);
CREATE TABLE IF NOT EXISTS glucose (
  ts INTEGER PRIMARY KEY, mgdl REAL NOT NULL, source TEXT NOT NULL DEFAULT 'import'
);
CREATE TABLE IF NOT EXISTS weights (
  day TEXT PRIMARY KEY, weight REAL NOT NULL, waist REAL, body_fat_pct REAL, source TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS withings_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL, userid TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS withings_oauth_state (state TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS withings_sync (id INTEGER PRIMARY KEY CHECK (id = 1), lastupdate INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS vitals (
  day TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'withings', updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);

-- Meal totals can carry calories and fat. Daily targets also live on daily_checkins.
CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  recorded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_grants (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  purpose TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  weekday INTEGER NOT NULL,
  session_type TEXT NOT NULL,
  template_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_schedule_slot
  ON program_schedule (effective_from, weekday, session_type);

CREATE TABLE IF NOT EXISTS workout_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  warmup_min INTEGER,
  finisher TEXT,
  default_rounds INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS template_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  planned_sets INTEGER,
  planned_reps INTEGER,
  planned_seconds INTEGER,
  each_side INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER,
  tempo TEXT DEFAULT '3-0-3-0'
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  template_id TEXT,
  session_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  rounds_completed INTEGER,
  modality TEXT,
  duration_min REAL,
  hr_avg REAL,
  hr_min REAL,
  hr_max REAL,
  hr_zone_low INTEGER,
  hr_zone_high INTEGER,
  perceived_effort INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  UNIQUE (day, session_type)
);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_day ON workout_sessions (day);

CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  exercise_name TEXT NOT NULL,
  seq INTEGER NOT NULL,
  set_no INTEGER NOT NULL,
  reps INTEGER,
  seconds INTEGER,
  band_level TEXT,
  tul_seconds REAL,
  tempo_ok INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_workout_sets_session ON workout_sets (session_id);

CREATE TABLE IF NOT EXISTS daily_checkins (
  day TEXT PRIMARY KEY,
  kcal REAL,
  protein_g REAL,
  fat_g REAL,
  carbs_g REAL,
  water_oz REAL,
  sugary_drinks INTEGER,
  morning_sun INTEGER,
  last_meal_time TEXT,
  bed_time TEXT,
  last_meal_to_bed_hours REAL,
  notes TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bp_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  systolic INTEGER NOT NULL,
  diastolic INTEGER NOT NULL,
  pulse INTEGER,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_bp_day ON bp_readings (day);

-- Snapshot whatever settings are stored today so a rollback can put them back.
INSERT INTO settings_history (key, value, note, recorded_at)
SELECT key, value, 'pre-lit-reorg', strftime('%s','now') FROM settings;

-- Protocol targets. Previous values are in settings_history (note = pre-lit-reorg).
INSERT INTO settings (key, value) VALUES
  ('sleep_hours', '7.5'),
  ('training_days', '[1,3,5]'),
  ('active_habits', '["session","steps","sleep","protein_day","calories","water","sun","sugar","last_meal"]')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('tz', '"America/New_York"'),
  ('carb_cap', '50'),
  ('protein_per_meal', '40'),
  ('window_hours', '8'),
  ('sleep_hours_high', '8'),
  ('walks_needed', '2'),
  ('kcal_low', '2100'),
  ('kcal_high', '2400'),
  ('protein_day_low', '180'),
  ('protein_day_high', '210'),
  ('fat_low', '60'),
  ('fat_high', '80'),
  ('water_oz_low', '100'),
  ('water_oz_high', '120'),
  ('steps_goal', '10000'),
  ('program_start', '"2026-11-24"'),
  ('standard_start', '"2026-11-30"'),
  ('offset_from', '"2026-11-24"'),
  ('offset_to', '"2026-11-29"'),
  ('strength_ramp_weeks', '2'),
  ('phase_weeks', '16'),
  ('horizon_days', '182'),
  ('goal_weight_low', '200'),
  ('goal_weight_high', '210'),
  ('goal_bf_low', '20'),
  ('goal_bf_high', '24'),
  ('weekly_loss_low', '1'),
  ('weekly_loss_high', '2'),
  ('zone2_hr_low', '110'),
  ('zone2_hr_high', '130'),
  ('zone2_min_low', '45'),
  ('zone2_min_high', '60'),
  ('long_session_min', '75'),
  ('recovery_walk_min', '30'),
  ('typical_bedtime', '"22:30"'),
  ('show_glucose', 'false'),
  ('start_weight', 'null');

INSERT OR IGNORE INTO workout_templates (id, name, kind, warmup_min, finisher, default_rounds, notes) VALUES
  ('strength_a_v1', 'Full Body Strength A', 'strength', 10, 'walk_15', 3, 'Weeks 1-2 use 2 sets. Tempo 3s down / 3s up. Finish with a 15 min walk.'),
  ('strength_b_v1', 'Full Body Strength B', 'strength', 10, 'walk_15', 3, 'Weeks 1-2 use 2 sets. Tempo 3s down / 3s up. Finish with a 15 min walk.'),
  ('circuit_v1', 'Full Body Circuit', 'circuit', 10, NULL, 3, 'Always 3 rounds, including weeks 1-2. Rest 60-90s between rounds.'),
  ('zone2_v1', 'Zone 2 cardio', 'cardio', NULL, NULL, NULL, '45-60 min at 110-130 bpm.'),
  ('long_cardio_v1', 'Long fat-burn', 'cardio', NULL, NULL, NULL, '75 min walk, hike, or bike.'),
  ('recovery_v1', 'Recovery', 'recovery', NULL, NULL, NULL, '30 min walk, mobility, and stretching.'),
  ('mobility_v1', 'Mobility and recovery', 'mobility', NULL, NULL, NULL, 'Easy movement, mobility, and stretching.');

INSERT OR IGNORE INTO template_exercises (template_id, seq, name, planned_sets, planned_reps, planned_seconds, each_side, tempo) VALUES
  ('strength_a_v1', 1, 'Sit-to-stand squats', 3, 12, NULL, 0, '3-0-3-0'),
  ('strength_a_v1', 2, 'Incline push-ups', 3, 10, NULL, 0, '3-0-3-0'),
  ('strength_a_v1', 3, 'Band rows', 3, 15, NULL, 0, '3-0-3-0'),
  ('strength_a_v1', 4, 'Assisted reverse lunges', 3, 10, NULL, 1, '3-0-3-0'),
  ('strength_a_v1', 5, 'Band suitcase hold', 3, NULL, 40, 0, '3-0-3-0'),
  ('strength_a_v1', 6, 'Plank', 3, NULL, 30, 0, '3-0-3-0'),
  ('strength_b_v1', 1, 'Band squat', 3, 10, NULL, 0, '3-0-3-0'),
  ('strength_b_v1', 2, 'Band chest press', 3, 15, NULL, 0, '3-0-3-0'),
  ('strength_b_v1', 3, 'Band Romanian deadlift', 3, 12, NULL, 0, '3-0-3-0'),
  ('strength_b_v1', 4, 'Seated band shoulder press', 3, 12, NULL, 0, '3-0-3-0'),
  ('strength_b_v1', 5, 'Band pull-aparts', 3, 20, NULL, 0, '3-0-3-0'),
  ('strength_b_v1', 6, 'Dead bugs', 3, 12, NULL, 1, '3-0-3-0'),
  ('circuit_v1', 1, 'Squats', 3, 15, NULL, 0, '3-0-3-0'),
  ('circuit_v1', 2, 'Elevated push-ups', 3, 12, NULL, 0, '3-0-3-0'),
  ('circuit_v1', 3, 'Band rows', 3, 15, NULL, 0, '3-0-3-0'),
  ('circuit_v1', 4, 'Step-ups', 3, 12, NULL, 1, '3-0-3-0'),
  ('circuit_v1', 5, 'Band hold / march', 3, NULL, 60, 0, '3-0-3-0'),
  ('circuit_v1', 6, 'Plank', 3, NULL, 45, 0, '3-0-3-0');

-- Offset week (Tue 2026-11-24 plays Monday's Strength A ... Sun 2026-11-29 plays the long session).
-- Thu 2026-11-26 (Thanksgiving) is weekday 4 in this window, so it is Strength B.
-- Standard week starts Monday Nov 30. Keep this list in sync with scheduleSeedRows().
INSERT OR IGNORE INTO program_schedule (effective_from, effective_to, weekday, session_type, template_id) VALUES
  ('2026-11-24', '2026-11-29', 2, 'strength_a', 'strength_a_v1'),
  ('2026-11-24', '2026-11-29', 3, 'zone2', 'zone2_v1'),
  ('2026-11-24', '2026-11-29', 4, 'strength_b', 'strength_b_v1'),
  ('2026-11-24', '2026-11-29', 5, 'recovery', 'recovery_v1'),
  ('2026-11-24', '2026-11-29', 6, 'circuit', 'circuit_v1'),
  ('2026-11-24', '2026-11-29', 7, 'long_cardio', 'long_cardio_v1'),
  ('2026-11-30', NULL, 1, 'strength_a', 'strength_a_v1'),
  ('2026-11-30', NULL, 2, 'zone2', 'zone2_v1'),
  ('2026-11-30', NULL, 3, 'strength_b', 'strength_b_v1'),
  ('2026-11-30', NULL, 4, 'recovery', 'recovery_v1'),
  ('2026-11-30', NULL, 5, 'circuit', 'circuit_v1'),
  ('2026-11-30', NULL, 6, 'long_cardio', 'long_cardio_v1'),
  ('2026-11-30', NULL, 7, 'mobility', 'mobility_v1');

-- Three historical training taps become sessions. Walk taps stay events so they are not double-counted against steps.
INSERT OR IGNORE INTO workout_sessions (day, template_id, session_type, status, source, created_at, notes)
SELECT day, NULL, 'legacy_training', 'completed', 'migration', COALESCE(MIN(ts), strftime('%s','now')),
  'Backfilled from a historical training tap. No exercises were invented.'
FROM events
WHERE kind = 'training'
GROUP BY day;
