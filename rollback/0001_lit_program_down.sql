-- Manual rollback for migration 0001. Wrangler will NOT run this file.
-- Prefer restoring the D1 export or Time Travel bookmark from before the migration.
-- That puts settings, tokens, and every row back. Redeploy the backup ref after the restore.
--
-- This script is the narrower alternative: it puts the snapshotted settings back and
-- drops tables the previous Worker never reads. It cannot remove meals.kcal / meals.fat_g
-- (SQLite has no DROP COLUMN here). The previous Worker ignores those columns.
-- Running the DROP section deletes workout logs, check-ins, and blood-pressure rows.

BEGIN;

UPDATE settings
SET value = (
  SELECT h.value FROM settings_history h
  WHERE h.key = settings.key AND h.note = 'pre-lit-reorg'
  ORDER BY h.id DESC LIMIT 1
)
WHERE key IN (SELECT key FROM settings_history WHERE note = 'pre-lit-reorg');

DELETE FROM settings
WHERE key NOT IN (SELECT key FROM settings_history WHERE note = 'pre-lit-reorg')
  AND key IN (
    'sleep_hours_high', 'kcal_low', 'kcal_high', 'protein_day_low', 'protein_day_high',
    'fat_low', 'fat_high', 'water_oz_low', 'water_oz_high', 'steps_goal',
    'program_start', 'standard_start', 'offset_from', 'offset_to', 'strength_ramp_weeks',
    'phase_weeks', 'horizon_days', 'goal_weight_low', 'goal_weight_high', 'goal_bf_low',
    'goal_bf_high', 'weekly_loss_low', 'weekly_loss_high', 'zone2_hr_low', 'zone2_hr_high',
    'zone2_min_low', 'zone2_min_high', 'long_session_min', 'recovery_walk_min',
    'typical_bedtime', 'show_glucose', 'start_weight'
  );

-- Optional and destructive. Uncomment only if you do not want the new rows kept.
-- DROP TABLE IF EXISTS workout_sets;
-- DROP TABLE IF EXISTS workout_sessions;
-- DROP TABLE IF EXISTS template_exercises;
-- DROP TABLE IF EXISTS workout_templates;
-- DROP TABLE IF EXISTS program_schedule;
-- DROP TABLE IF EXISTS daily_checkins;
-- DROP TABLE IF EXISTS bp_readings;
-- DROP TABLE IF EXISTS auth_grants;
-- DROP TABLE IF EXISTS settings_history;

COMMIT;
