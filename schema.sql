-- Already applied to D1 database "protocol-tracker" (58401803-3b9c-4cad-964b-13674ed80312).
-- Kept here so the project is reproducible:  npx wrangler d1 execute protocol-tracker --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS habit_log (
  day TEXT NOT NULL, habit TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, value REAL,
  source TEXT NOT NULL DEFAULT 'manual', updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, habit)
);
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, slot INTEGER NOT NULL, ts INTEGER NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0, carbs_g REAL NOT NULL DEFAULT 0, note TEXT,
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
CREATE TABLE IF NOT EXISTS weights (day TEXT PRIMARY KEY, weight REAL NOT NULL, waist REAL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
