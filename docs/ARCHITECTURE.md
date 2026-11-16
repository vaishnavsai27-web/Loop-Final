# Architecture

```
Browser (React 18, Vite build)
  └─ fetch /api/* (same origin, httpOnly session cookie + CSRF header)
Express API (backend/src/app.js)
  helmet CSP → CORS allow-list → origin check → JSON body → routes
  routes/index.js: authentication → permission → validation → controller
  controllers/index.js → services/*.js → MySQL (mysql2 pool, least-privilege account)
MySQL 8.4
  tables, views, stored procedures (recommendation scoring, preference learning), triggers (audit, counters)
```

## Request rules

* Every protected route passes `requireAuth`, which resolves the session token, then re-reads the user, role and
  permissions from the database. Admin routes also pass `requirePermission(...)`; Artist tools pass
  `artist.studio` / `artist.upload`. The frontend's route guards are a convenience; the API is the authority.
* Inputs are validated next to each route (`utils/validate.js`); unknown fields are dropped.
* Errors always have the shape `{ "error": { "code", "message", "details?" } }`. MySQL errors are translated, never
  leaked.

## API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/session`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all` |
| Reference | `GET /moods`, `/contexts`, `/genres`, `/languages` |
| Catalogue | `GET /songs`, `/songs/:id`, `/artists/:id`, `/albums/:id`, `/search`, `/search/suggest` |
| Recommendations | `POST /recommendations/mood`, `POST /recommendations/parse`, `GET /recommendations/for-you`, `/similar`, `/history`, `/batches/:id`, `GET /users/:id/recommendations` |
| Feedback | `PUT/DELETE /songs/:id/rating`, `PUT /songs/:id/like`, `GET /likes`, `PUT/DELETE /songs/:id/dismiss`, `GET /me/dismissals` |
| Library | `GET/POST /playlists`, `POST /playlists/from-batch`, `GET/PATCH/DELETE /playlists/:id`, `POST /playlists/:id/songs`, `DELETE /playlists/:id/songs/:songId` |
| Playback | `POST /playback/start`, `POST /playback/:playId/finish`, `GET /history`, `GET /media/:id` |
| Account | `GET/DELETE /me/sessions…`, `POST /me/password`, `DELETE /me`, `GET/PUT /me/preferences`, `PATCH /me/settings` |
| Artist | `GET /artist/me`, `POST /artist/applications`, `PATCH /artist/profiles/:id`, `POST /artist/uploads`, `PUT /artist/uploads/:id/content`, `POST /artist/uploads/:id/withdraw`, `POST /artist/uploads/:id/reports` |
| Admin | `/admin/overview`, `/users`, `/permissions`, `/health`, `/audit`, `/references`, `/songs…`, `/artists…`, `/albums`, `/media…`, `/artist-applications…`, `/artist-uploads…`, `/artist-rights-reports…` |
| Ops | `GET /health` (liveness), `GET /ready` (database, schema version, media storage) |

`npm run ui:audit` fails if the frontend calls a path that is not in this router.

## Frontend

* `lib/router.jsx` — small history-API router (no dependency). `lib/api.js` — every API call.
  `lib/auth.jsx` — session state; the role always comes from `/auth/session`.
* Three shells (`components/Shell.jsx`): listener (Discover, Search, Library, Settings), Artist studio and Admin
  console. Wrong-role routes render an access-denied page.
* `pages/Discover.jsx` is the core journey: composer → interpretation → ranked, explained results → feedback.
* Design system in `styles/loop.css` (tokens at the top). One bold element — the mood composer and its aura drawn
  from the moods' own colours; everything else is quiet lists, ink type and one action colour.
