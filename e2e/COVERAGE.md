# Coverage matrix

`B` = browser test (e2e/), `A` = API integration test (backend/tests/), `U` = unit test.

## Routes

| Route | Signed out | User | Artist | Admin | Tests |
|---|---|---|---|---|---|
| `/` landing | page | → `/discover` | → `/discover` | → `/admin` | B test_ui, test_auth |
| `/login`, `/register` | page | → home | → home | → home | B test_auth |
| `/discover` (+ `?mood`, `?similar`, `?batch`) | → login | page | page | listener view | B test_user, test_ui |
| `/search` | → login | page | page | page | B test_user, test_ui |
| `/library` (4 tabs), `/playlist/:id` | → login | page | page | page | B test_user, test_ui |
| `/song/:id`, `/artist/:id`, `/album/:id` | → login | page | page | page | B test_user |
| `/settings/*` (5 sections) | → login | page | page | page (no Artist access tab) | B test_user, test_ui |
| `/studio/*` (5 sections) | → login | access denied | page | access denied | B test_roles |
| `/admin/*` (8 sections) | → login | access denied | access denied | page | B test_roles, test_ui |
| unknown path | landing | not-found page | not-found page | not-found page | B test_ui |

## Workflows

| Workflow | Tests |
|---|---|
| Register, duplicate registration, invalid input | B test_auth · A 01-auth |
| Sign in (valid / invalid), role home, reload persistence, sign out | B test_auth · A 01-auth, 08-sessions |
| Session expiry / revocation, sign out everywhere, CSRF, origin check | B test_auth · A 08-sessions |
| Mood chips → explained recommendations | B test_user · A 02-recommendations |
| Free text → live interpretation → recommendations; unrecognised text | B test_user · A 02-recommendations |
| Listening context | A 02-recommendations |
| Relevance gate and coverage message | A 02-recommendations · U recommendationLogic |
| Like, save to playlist, save whole mix, not interested, explore similar | B test_user · A 02, 03 |
| Recent moods reopen a stored list | B test_user · A 02-recommendations |
| Search (moods, songs, no results, injection) | B test_user · A 03-library |
| Playlists create / rename / remove song / delete | B test_user · A 03-library |
| Playback refused without LOOP audio; registered audio plays and enters history | A 03-library |
| Preferences and profile | B test_user · A 01-auth |
| Artist application → Admin approval → Artist studio | B test_roles · A 04-roles |
| Artist profile management | B test_roles · A 04-roles |
| Upload validation (client and server) / uploads-off explanation | B test_roles · A 04-roles · U frontend validation |
| Admin: users, roles, deactivate/reactivate, reject application | B test_roles · A 04-roles, 05-admin |
| Admin: catalogue add with features, hide/activate, mood curation | B test_roles · A 05-admin |
| Admin: LOOP media registration (missing file, traversal) | A 05-admin |
| Loading, empty, backend-failure and network-failure states | B test_ui |
| Keyboard-only mood request, dialog Escape, skip link | B test_ui |
| axe-core (serious/critical) on public, listener and results screens | B test_ui |
| No third-party music service names in the interface | B test_ui |

## Permission boundaries

| Attempt | Expected | Tests |
|---|---|---|
| Anonymous → any protected API | 401 | B test_auth · A 04-roles |
| User → `/admin/*` API and pages | 403 / access denied | B test_roles · A 04-roles |
| User → Artist profile / uploads | 403 | A 04-roles |
| Artist → `/admin/*`, approve or publish uploads | 403 | B test_roles · A 04-roles |
| Artist → another artist's profile or upload as another artist | 403 | A 04-roles |
| Admin → grant Admin from the console | 403 `ADMIN_PROVISIONING_ONLY` | B test_roles · A 04-roles |
| Admin → demote self / last Admin | 409 | A 04-roles, 08-sessions |
| Role field sent at registration | ignored, User created | A 01-auth |
| User → another user's mood list, playlist or personal mix | 404 / 403 | B test_user · A 02, 03 |
| Admin demotes an Artist | Artist tools 403 on next request | A 04-roles |
