# LOOP

LOOP is a mood-first music discovery platform. You tell it how you feel — in your own words, with a few moods,
or both — and it recommends songs from its own catalogue, explaining why each one fits. Like, save, hide or
explore from any recommendation. Playback is secondary and only exists for recordings LOOP is authorised to stream.

React (Vite) → Express API → MySQL. No third-party music catalogue, search, preview, embed or playback service is
used anywhere.

## Roles

| Shown as | Internal code | Can |
|---|---|---|
| User | `LISTENER` | Discover by mood, search, like, save, hide songs, manage playlists, preferences and account, apply for Artist access |
| Artist | `ARTIST` | Everything a User can, plus the Artist studio: profile, upload recordings, track and withdraw submissions |
| Admin | `ADMIN` | The Admin console: users and roles, Artist applications, upload moderation, catalogue, LOOP media, permissions, health |

Registration always creates a User. Artist access comes from an application an Admin approves. Admin access is
granted only from the server with `npm run admin:provision` (database owner credentials), never from the web.
The API reads the role and permissions from the database on every request; the interface only follows them.

## Quick start

Requirements: Node.js 26 (`.nvmrc`), MySQL 8.4 LTS (8.0.19+ works), Python 3 for the browser tests.

```bash
cp .env.example .env            # set the database accounts and SESSION_SECRET
npm ci
npm run db:seed:generate
npm run db:setup -- --allow-destructive   # NEW, EMPTY database only: drops and recreates DB_NAME
npm run dev                     # API on :4000, Vite on :5173
```

Seeded development accounts (`admin`, `varsha`, …) have well-known passwords. Never seed a public database; see
[docs/SECURITY.md](docs/SECURITY.md).

### Existing database

```bash
npm run db:backup     # verified dump first
npm run db:migrate    # applies only pending forward-only migrations (0017 for databases at 0016)
npm run test:sql      # confirms the schema matches what the code needs
```

Never run `db:setup` against a database you want to keep. See [docs/DATABASE.md](docs/DATABASE.md).

## Checks

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint over backend, frontend and scripts |
| `npm run test:unit` | Backend unit tests (no database) |
| `npm run test:web` | Frontend unit tests (Vitest) |
| `npm test` | Backend unit + API integration tests against MySQL (`db:setup` first) |
| `npm run test:sql` | Read-only SQL contract check of the configured database |
| `npm run test:e2e` | Playwright browser tests against a running LOOP (`BASE_URL`) |
| `npm run build` | Production frontend build |
| `npm run ui:audit` | Static interface audit: API contract, no third-party services, guarded role areas, accessibility basics |
| `npm run deploy:check` | Static deployment contract: runtime, lockfile, Vercel config, server safety, CI |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of these, with MySQL 8.4 and 8.0, and the
browser suite against a production build.

## Layout

```
api/index.js            Vercel Function wrapping the Express app
backend/src             Express app: routes → controllers → services → MySQL
backend/scripts         setup, migrate, verify, seed generation, admin provisioning, upload scanning
backend/tests           API integration tests (tests/unit: no database)
database/               baseline schema 01–06, generated seed 07, forward-only migrations
frontend/src            React app: pages (listener, artist/, admin/), components, lib (router, API, auth)
e2e/                    Playwright browser tests and the coverage matrix
scripts/                backup/restore drill, deployment and UI audits, smoke test
docs/                   architecture, database, recommendations, security, deployment, testing
```

## Deployment

Vercel serves the built frontend and runs the API as one function (`vercel.json`). It needs an external MySQL
database and environment variables. Vercel has no persistent disk, so audio playback and Artist uploads stay
switched off there, with an explanation in the interface. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
