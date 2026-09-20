# Protocol tracker

One Cloudflare Worker serves the API (`/api/*`, `src/worker.js`) and the static UI (`public/`), backed by a D1 database.

## Deploy

Live: `https://protocol-tracker.dshodge2020.workers.dev`.

The D1 database `protocol-tracker` (id `58401803-3b9c-4cad-964b-13674ed80312`) already exists with the schema applied, and its id is in `wrangler.jsonc`. Use the same Cloudflare account when you log in.

This repo uses `pnpm` (see `package.json`) and stores the API token in `pass` at `protocol-tracker/API_TOKEN` (never in the repo; `.dev.vars` is gitignored).

```sh
pnpm add -D wrangler
pnpm approve-builds esbuild workerd -y   # one-time: lets workerd/esbuild postinstall run
./node_modules/.bin/wrangler login
./node_modules/.bin/wrangler whoami   # confirm account before deploying
./node_modules/.bin/wrangler deploy
pass generate --no-symbols -f protocol-tracker/API_TOKEN 48
pass show protocol-tracker/API_TOKEN | ./node_modules/.bin/wrangler secret put API_TOKEN
```

If `wrangler login` fails with `No CSRF value available in the session cookie`, allow third-party cookies for `dash.cloudflare.com` and retry, or authenticate with a Cloudflare API token (`Edit Cloudflare Workers` template + D1 Write) instead.

Open the `*.workers.dev` URL, paste the token in Settings once (`pass show protocol-tracker/API_TOKEN`). Until the secret is set, every API call returns 401.

Verify a deploy (read-only):

```sh
API_TOKEN=$(pass show protocol-tracker/API_TOKEN)
BASE=https://protocol-tracker.dshodge2020.workers.dev
curl -s "$BASE/api/day?day=2026-09-20"                                  # expect 401 unauthorized
curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE/api/day?day=2026-09-20"      # expect 200 day JSON
curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE/api/range?days=7"            # expect 200 range JSON
curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE/api/settings"                # expect 200 settings JSON
```

To run locally: put `API_TOKEN=devtoken` in `.dev.vars`, run `./node_modules/.bin/wrangler d1 execute protocol-tracker --local --file=schema.sql`, then `./node_modules/.bin/wrangler dev`. Local dev needs `workerd`, which requires macOS 13.5+ (fails on 12.x).

## Theme

`public/theme.css` implements your Minimalist Japandi brand guide: the five palette colors, the ink tints and hairlines, Inter for structure and UI, Newsreader for headings and habit names (italic 400 section headers, 500 display), a 6px radius, and the plaster-to-stone page wash. `style.css` reads only those variables.

- Fonts are self-hosted from `public/fonts/` (Latin subset, variable, licenses included), so the page makes no third-party requests.
- The mark is used at 44px tall (the guide's minimum is 24px), in Sumi Ink on plaster, with the guide's single entrance animation (disabled under reduced motion).
- Light only. The guide defines no dark system, so I didn't invent one.
- Derived values, not from the guide: the translucent sticky bar (`--plaster-glass`) and the sage chart band (`--sage-wash`).
- `public/brand/` holds the mark in ink, wood and plaster, plus favicon, apple-touch and manifest icons. On Android, Chrome's "Install app" / "Add to Home screen" gives you a standalone icon.

## Scoring

Seven habits. A stored row (manual tap or phone automation) always wins; otherwise the state is derived:

| Habit | Derived from |
|---|---|
| Eating window | first/last meal buttons, else the times on the two meal cards; must be within `window_hours` |
| Protein | both meals at or above `protein_per_meal` |
| Carbs | day total at or under `carb_cap` (needs both meals logged to finish as done) |
| Walks | count of walk events, at least `walks_needed` |
| Training | a training event; only counts on scheduled days |
| Sleep, Screens | only from a row (phone automation or manual tap) |

Habits you switch off in Settings are hidden and excluded from the score, which is how you ramp in.

## Phone automation (Android)

Every call needs `Authorization: Bearer <API_TOKEN>` and `Content-Type: application/json`. Tasker, MacroDroid or the HTTP Shortcuts app can all send these.

| Purpose | Request |
|---|---|
| Walk finished | `POST /api/event` `{"kind":"walk","source":"tasker"}` |
| Meal window opened / closed | `POST /api/event` `{"kind":"first_meal"}` or `{"kind":"last_meal"}` |
| Trained | `POST /api/event` `{"kind":"training","source":"health-connect"}` |
| Sleep hours | `PUT /api/habit` `{"habit":"sleep","value":7.4,"source":"health-connect"}` |
| Screens off | `PUT /api/habit` `{"habit":"screens","done":true,"source":"bedtime-mode"}` |
| Glucose batch | `POST /api/glucose` `{"source":"health-connect","readings":[{"ts":1789920600,"mgdl":92}]}` (max 2000 per request; `ts` is unix seconds, or send `"local":"2026-09-20T12:30:00"` to use your time zone) |

Other endpoints: `GET /api/day?day=YYYY-MM-DD`, `GET /api/range?days=14`, `GET /api/export.csv?days=28`, `POST /api/meal`, `POST /api/weight`, `GET|PUT /api/settings`.

## Glucose import

Settings, then "Import a Dexcom Clarity CSV". The parser finds the Timestamp, Glucose Value and (if present) Event Type columns by header name, keeps only `EGV` rows, converts mmol/L to mg/dL if needed, and maps "Low"/"High" to 40/400. Re-importing overlapping files is safe: existing timestamps are skipped.

## Limits worth knowing

- Glucose imports are capped at 2000 rows per request (40 statements of 50 rows) to stay inside the D1 Free-plan limit of 50 queries per Worker invocation. The UI chunks big files automatically.
- Range views and CSV export cover at most 31 days. For longer history, query D1 directly.
- Meal glucose analysis uses the time you enter for each meal, so accuracy depends on that entry.
