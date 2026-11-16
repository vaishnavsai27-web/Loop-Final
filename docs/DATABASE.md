# Database

MySQL 8.4 LTS (8.0.19+). Built from `database/01_schema.sql … 06_security.sql` (baseline), the generated seed
`07_seed.sql`, then every forward-only migration in `database/migrations/`. An existing database only ever runs
`npm run db:migrate`.

## What the product uses

| Area | Objects |
|---|---|
| Accounts and access | `users`, `user_profiles`, `roles`, `permissions`, `role_permissions`, `auth_sessions`, `audit_logs` |
| Catalogue | `artists`, `artist_aliases`, `albums`, `album_artists`, `films`, `songs`, `song_artists`, `song_genres`, `genres`, `languages`, `regions` |
| Moods and sound | `moods`, `mood_categories`, `mood_keywords`, `contexts`, `context_keywords`, `context_moods`, `audio_features`, `song_moods`, `song_mood_curations`, `mood_segments`, `intelligence_models`, `model_parameters` |
| Recommendations | `recommendation_batches`, `recommendation_batch_moods`, `recommendation_items`, `recommendation_reasons`, `reason_types`, `sp_generate_recommendations`, `v_recommendation_candidates`, `v_recommendation_explanations` |
| Taste | `user_languages`, `user_genre_preferences`, `user_artist_preferences`, `user_mood_preferences`, `user_context_preferences`, `sp_refresh_user_preferences(_core)` |
| Feedback and library | `ratings`, `user_likes`, `song_dismissals`, `playlists`, `playlist_songs`, `search_history` |
| Listening | `listening_sessions`, `listening_history`, `playback_events`, `sp_close_listening_session`, `trend_snapshots`, `sp_generate_trend_snapshot`, `pipeline_jobs`, `pipeline_job_logs` |
| Media and artists | `music_sources`, `song_media`, `source_records`, `v_song_playback`, `artist_applications`, `artist_accounts`, `artist_uploads`, `artist_upload_events`, `artist_rights_reports` |

`npm run test:sql` checks that all of these exist, that retired objects are gone and that every view is readable.

## Migration 0017 — mood-first simplification

* **Fix:** 0016 limited `v_recommendation_candidates` to songs that already had LOOP audio. With no recordings
  registered, every mood request returned nothing. Candidates are again the whole active, analysed catalogue;
  `v_song_catalog.playable` still says, per song, whether it can be played.
* **Removed** (features retired from the product): weekly worlds (`weekly_worlds`, `world_archetypes`,
  `archetype_moods`, `world_feedback`, `v_muse_world_summary`, `sp_rollback_world`), the private-session cleanup
  routine, listening-insight routines and views, lyrics and private notes, the mood diary, per-mood percentage
  ratings, the song-merge routine, and the retired third-party preview table with its routine and triggers.
* **Kept safe:** rows people wrote in retired features (diary entries, per-mood ratings, song notes, lyric
  annotations) are copied into `retired_feature_archive` (JSON per row) before their tables are dropped. Account
  deletion removes a person's archived rows too.
* **Kept on purpose:** `incognito_sessions`, `incognito_events` and `v_incognito_memory` are still referenced by
  `sp_generate_recommendations`; they stay, empty, until that procedure is replaced.
* Visible text: the trending explanation and the seed source name say LOOP.

Earlier migrations are untouched (their checksums are verified by `db:migrate`).

## Upgrade runbook (existing database)

1. `npm run db:backup` — writes and verifies a dump.
2. Optional rehearsal: `npm run db:restore:drill` restores it into a throw-away database.
3. `npm run db:migrate` — applies 0017 only.
4. `npm run test:sql` — must report 0 failed.

`npm run db:verify` (CI) proves that baseline + migrations produce exactly the same structure as a fresh install,
that re-running migrations is a no-op, and that an empty catalogue behaves.
