# Protocol tracker

A single-user Cloudflare Worker and D1 app for the L.I.T. protocol: the day's session (bands, reps, time under load), fuel, steps, sleep, waist, and a 16-week / 6-month progress view. Withings still fills weight, steps, heart rate, and sleep.

The Worker (`src/worker.js`) serves `/api/*`. Static files live in `public/`. Shared rules (the calendar, habit scoring, dates) live in `src/lib/` and are what the tests import. The browser does not keep its own copy of the habit list or the date shifter; the day payload includes `nav`, `habit_order`, and the session.

## The week

Normal weeks start Monday 2026-11-30.

| Day | Session |
|---|---|
| Mon | Full Body Strength A. 10 min warm-up, then the six moves, 15 min walk |
| Tue | Zone 2, 45–60 min, heart rate 110–130 |
| Wed | Full Body Strength B, then a 15 min walk |
| Thu | Recovery: 30 min walk, mobility, stretching |
| Fri | Circuit, 3 rounds, rest 60–90s |
| Sat | Long easy walk, hike, or bike, 75 min |
| Sun | Mobility and recovery |

The week of 2026-11-24 through 2026-11-29 is shifted one day: Tuesday is Strength A, Wednesday is Zone 2, Thursday 2026-11-26 (Thanksgiving) is Strength B, and Sunday is the long session. There is no Monday session in that window. From Monday 2026-11-30 the table above is the calendar.

Strength A and Strength B use 2 sets in weeks 1 and 2, then 3. The circuit stays at 3 rounds. Reps are a slow 3 seconds down and 3 seconds up. Log the band and the seconds under load. Move up a band or add 2 reps when the last two reps feel easy.

Daily targets, also the code defaults: 2,100–2,400 kcal, 180–210 g protein, 60–80 g fat, 100–120 oz water, 10,000 steps, 7.5–8 h sleep, no sugary drinks, stop eating at least 2 hours before bed, 10–15 min of morning sun. Water at or above 100 oz scores done, including days over 120. Calories and protein use the closed range.

The 16-week phase starts 2026-11-24. The 6-month marker is about 182 days later, aimed at roughly 200–210 lb and 20–24% body fat, losing about 1–2 lb a week. The guide line uses the first weigh-in on or after the start date, or the optional anchor weight in Settings.

Older habits (eating window, protein at both meals, carb cap, post-meal walks, the old training flag, screens) stay in the database and can be turned back on under Settings. They are off by default. Glucose import stays in Settings and the section stays hidden until "Show glucose" is on. Nothing is deleted.

## Local development

```sh
pnpm install
printf 'API_TOKEN=devtoken\n' > .dev.vars
pnpm exec wrangler d1 migrations apply protocol-tracker --local
pnpm dev
```

Open the local URL, paste `devtoken` in Settings once. It is stored in an httpOnly cookie, not in `localStorage`. `.dev.vars` is gitignored.

`pnpm test` runs the suite with Node's built-in test runner. No Cloudflare credentials are required. The migration test applies `migrations/0001_lit_program.sql` to an in-memory copy of the old schema and checks that meals, manual sleep, and the scale row survive.

## Deploy

This repo does not deploy itself. From a checkout of the branch you intend to ship, after the backup and the migration below:

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler deploy
```

Secrets (already set on the live Worker; do not put them in the repo): `API_TOKEN`, `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`. Optional var `WITHINGS_REDIRECT_URI` if the callback host is not the request host.

Deploy the Worker only after the migration has been applied. The new pages still render the plan if the new tables are missing, and saving a session returns a clear error until they exist. Workers Logs (`observability.enabled` in `wrangler.jsonc`) turn on at the next deploy. They are not on the current live script.

Connect Withings from Settings. That mints a one-time code; the API token is not placed in the URL. The old `?token=` link is rejected.

## Back up D1, then migrate

Do this yourself, against the remote database, before the first `migrations apply --remote`. These commands were not run as part of the change. `wrangler d1 migrations apply` also captures a backup of its own; take the export and the Time Travel bookmark first anyway.

```sh
mkdir -p backups
pnpm exec wrangler d1 export protocol-tracker --remote --output=backups/protocol-tracker-pre-lit.sql
pnpm exec wrangler d1 time-travel info protocol-tracker
```

Write down the bookmark (and the UTC time) from `time-travel info`. Keep the SQL file somewhere that is not the git repo. It contains Withings tokens.

Confirm the pending migration, then apply it:

```sh
pnpm exec wrangler d1 migrations list protocol-tracker --remote
pnpm exec wrangler d1 migrations apply protocol-tracker --remote
```

`migrations/0001_lit_program.sql` is additive. It creates the program, session, check-in, blood-pressure, settings-history, and connect-code tables; adds `meals.kcal` and `meals.fat_g`; copies current settings into `settings_history` with note `pre-lit-reorg`; then writes the new targets. Historical training taps become `legacy_training` sessions with no invented exercises. Walk taps stay in `events` so they are not counted twice against steps.

Do not execute `schema.sql` on the live database. That file is the end state for a brand-new database. `CREATE TABLE IF NOT EXISTS` will not add columns to tables that already exist.

A fresh empty database can use either:

```sh
pnpm exec wrangler d1 migrations apply protocol-tracker --local
```

or, for a one-shot empty file only, `wrangler d1 execute protocol-tracker --local --file=schema.sql`. Do not run both against the same database: the migration's `ALTER TABLE` will fail if `schema.sql` already added the columns.

## Roll back

Code and data roll back separately. The previous Worker ignores the new tables and the extra meal columns, but it will look empty if `active_habits` is still the new list. Restoring the database puts the old settings back, which is the reliable path.

1. Restore D1 to the bookmark you saved:

```sh
pnpm exec wrangler d1 time-travel restore protocol-tracker --bookmark=BOOKMARK_FROM_THE_BACKUP
```

Time Travel on the Workers Free plan keeps about 7 days, and about 30 days on Paid. Restoring replaces the database in place. If the bookmark window has expired, import the SQL export into a database you are willing to point the Worker at, or use the export as the source of the old rows. Prefer the bookmark when it is still valid.

2. Redeploy the pre-change code. The tag `pre-lit-reorg` and the branch `backup/pre-lit-reorg` both point at main `7609485bb806d164b9d8c51980bd8b50d8fd244e`.

```sh
git fetch origin tag pre-lit-reorg
git checkout pre-lit-reorg
pnpm exec wrangler deploy
```

Check that checkout out in a separate work tree if you still want this branch. Do not reset or delete `main`, and do not delete `backup/pre-lit-reorg`.

`rollback/0001_lit_program_down.sql` is not applied by Wrangler. It restores settings from `settings_history` and deletes keys this migration introduced. The `DROP TABLE` statements are commented out on purpose: dropping them deletes workout logs and check-ins. Use it only if you are keeping the new tables and only need the old settings back. It cannot remove `meals.kcal` or `meals.fat_g`. The previous Worker tolerates those columns.

After a data restore, the migrations table may again list `0001` as unapplied, because Time Travel rewinds that table too. Read `wrangler d1 migrations list` before applying anything else.

## API

Browser calls send the cookie. Tasker and other automations keep `Authorization: Bearer <API_TOKEN>`.

| Purpose | Request |
|---|---|
| Day, including today's session | `GET /api/day?day=YYYY-MM-DD` |
| Log or update a session | `POST /api/session` |
| Replace sets on a session | `POST /api/session/:id/sets` |
| Daily fuel | `PUT /api/checkin` |
| Blood pressure | `POST /api/bp` |
| Weigh-in (weight, waist, optional body fat) | `POST /api/weight` |
| 14-day charts (31 days max) | `GET /api/range?days=14` |
| 16-week / 6-month panel (200 days max) | `GET /api/progress?days=180` |
| CSV, up to 180 days | `GET /api/export.csv?days=180` |
| Settings | `GET` or `PUT /api/settings` |
| Withings connect | `POST /api/withings/connect`, then open the returned URL |
| Manual sync | `POST /api/withings/sync` |

`POST /api/event`, `POST /api/meal`, `PUT /api/habit`, and `POST /api/glucose` still work. Meal slots are 1 through 6 and can carry calories and fat. The fuel form is the daily total the score uses; per-meal rows are optional.

A manual sleep row is left alone by the cron. Withings updates the sleep habit only when the existing source is `withings` or the row is missing. A manual weigh-in sets `source` to `manual` and keeps a stored body-fat percent when the form leaves that field blank. The next scale sync still overwrites that day's weight and sets the source back to `withings`, and it still keeps the waist.

## Theme

`public/theme.css` is the light Japandi palette (no dark theme). Fonts are self-hosted. `public/brand/` still has the unused wood and plaster marks.

## Not done here

- No remote migration, no `wrangler deploy`, and no writes to the live D1 database.
- No custom domain. The app stays on whatever host you deploy.
- Withings access and refresh tokens are still plaintext in D1. An export contains them.
- REM is requested as `remsleepduration`. When a night has deep or light sleep and no REM field, the sync sums Withings stage `state = 3` for that night. That runs inside the existing 14-day window, so older nights are not rewritten.
- No Body by Science email import, no band-progression coach beyond "last time / add 2 reps", and no live zone-2 stream. Session heart rate is typed in.
