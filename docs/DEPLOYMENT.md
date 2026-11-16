# Deployment

## Vercel (GitHub-connected project)

`vercel.json` is the deployment contract (checked by `npm run deploy:check`):

| Setting | Value |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` (Vite → `frontend/dist`) |
| Output | `frontend/dist` |
| API | `/api/*` is rewritten to the single function `api/index.js`, which runs the Express app |
| Other paths | `/index.html` (single-page app) |
| Node.js | 26.x (`engines`) |
| Region | `bom1` |

Project settings: leave the root directory at the repository root and let `vercel.json` drive the build.

Environment variables (Production and Preview): `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD`,
`DB_SSL=true` (and `DB_SSL_CA` if your provider needs it), `DB_TIMEZONE`, `SESSION_SECRET` (32+ characters),
`COOKIE_SECURE=true`, `CORS_ORIGIN=https://<your-domain>`, `TRUST_PROXY=1`. Do not set owner credentials on Vercel.
Without database variables the site loads and every data endpoint answers `503 DATABASE_NOT_CONFIGURED`.

The MySQL database must be reachable from Vercel (a managed MySQL 8 provider). Run migrations from a trusted machine
(`npm run db:migrate` with owner credentials), never from the build.

### What stays off on Vercel

Vercel Functions have no persistent disk. LOOP therefore disables local media on serverless hosts
(`providers/runtimeCapabilities.js`): no audio streaming, no Artist uploads, no media registration, and the interface
says so. Mood discovery, recommendations, search, likes, playlists, roles and moderation of existing records all work.
Enabling audio needs a persistent host for the API (any Node 26 server with a mounted media folder, ClamAV and
ffprobe) or a durable private object store plus a scanning worker — not an external music service.

Background jobs (closing idle listening sessions, hourly trend snapshots) run only in a persistent `npm start`
process; on Vercel they do not run, and trend signals simply stay at their last snapshot.

### Verify a deployment

```bash
LOOP_PRODUCTION_URL=https://<deployment> npm run deploy:smoke   # homepage, /api/health, /api/ready
BASE_URL=https://<deployment> E2E_ADMIN_LOGIN=… E2E_ADMIN_PASSWORD=… npm run test:e2e
```

A successful push is not a successful deployment: check the Vercel build log and `/api/ready`.

## Persistent host

```bash
npm ci && npm run build
npm run db:migrate
NODE_ENV=production npm start      # serves frontend/dist and /api on PORT
```
