# Implementation status — mood-first LOOP release

Branch: `feature/loop-mood-first-release` (from `main` at `e36ba0e`, the initial README commit).

## Done

| Area | Result |
|---|---|
| Import | Baseline from `LOOP-SELF-HOSTED-ROLES-2026-11-16.zip` (without generated ERD/report/Workbench artefacts) |
| Product scope | Mood discovery is the home of the app; removed guest mode, private sessions, worlds, lyrics, diary, per-mood ratings, insights, data export, ingestion pipeline, model tuning, smart playlists, extra recommendation strategies, database explorer, in-browser demo mode |
| Backend | 99 routes, every Admin route permission-gated; relevance gate + coverage; saved mixes contain only shown songs; Artist profile editing; self-review/publish blocked; Admin grant blocked in console; `admin:provision` CLI; media availability never marked missing from serverless |
| Database | Migration 0017 (forward-only): candidates fixed (mood discovery was empty since 0016), retired objects dropped after archiving user-authored rows, visible text says LOOP |
| Frontend | Rebuilt: design system, composer with live interpretation, explained results with like/save/not interested/similar, Library, Search, Settings (profile, preferences, security, Artist access, delete), Artist studio, Admin console; separate shells; responsive with mobile tab bar; react-router-dom and lucide-react removed |
| Tests | Backend unit (37), API integration suites rewritten for the new API, empty-catalogue suite, frontend unit (17), Playwright suite (36 tests) with coverage matrix, SQL contract check, UI and deployment audits |
| CI | `.github/workflows/ci.yml`: lint, unit, build, audits; MySQL 8.4 and 8.0 integration; browser tests against a production build |
| Docs | README, docs/ARCHITECTURE, DATABASE, RECOMMENDATIONS, SECURITY, DEPLOYMENT, TESTING; e2e/COVERAGE |

## Verified in the build workspace

The workspace had Node 22, no MySQL and no package-registry access, so Express, mysql2, Vite, Vitest and ESLint could
not be installed. What was run:

| Check | Result |
|---|---|
| Backend unit tests (`node --test tests/unit`) | 37 passed, 0 failed |
| Frontend unit tests (Vitest specs run through a node:test shim) | 17 passed, 0 failed |
| `npm run ui:audit` | 12/12 |
| `npm run deploy:check` | 16/16 |
| Backend module graph loads, every route resolves to a controller (stubbed npm modules) | 99 routes, 0 missing |
| Static SQL reference scan of backend code against schema + migrations | no references to retired objects |
| Frontend bundle (esbuild in place of Vite, React 19 in place of 18) | builds |
| Playwright suite against the built frontend + an in-memory stand-in for the API | 35 passed, 1 skipped (axe-core not installed) |

## Not yet verified (needs CI or a machine with MySQL and npm access)

* `npm ci`, ESLint, Vite build and Vitest with the real dependencies on Node 26.
* API integration tests, `db:setup`, migration 0017 and `db:verify` against MySQL 8.4 / 8.0.
* Playwright suite against the real API and database, including axe-core.
* Vercel deployment.

## Remaining limitations

* Audio playback and Artist uploads need a persistent host or durable private object storage plus a scanning worker;
  they are off on Vercel by design.
* The development seed has accounts with published passwords; deactivate them on any public database.
* `incognito_*` tables remain only because `sp_generate_recommendations` still references them.
