#!/usr/bin/env node
// SQL contract check (npm run test:sql). Read-only.
// Confirms that the database the API points at matches what the code needs:
//   * schema version equals the newest migration file
//   * every table, view and routine the application calls exists
//   * retired objects (migration 0017) are gone
//   * every view can be read, and the recommendation candidate view covers the
//     whole active, analysed catalogue (not just songs that already have audio)
const mysql = require('mysql2/promise');
const { db } = require('../src/config/env');
const { files } = require('./migrate');

const TABLES = [
  'users', 'roles', 'permissions', 'role_permissions', 'user_profiles', 'auth_sessions', 'audit_logs',
  'languages', 'regions', 'genres', 'moods', 'mood_categories', 'mood_keywords', 'contexts', 'context_keywords', 'context_moods',
  'artists', 'artist_aliases', 'albums', 'album_artists', 'films', 'songs', 'song_artists', 'song_genres',
  'audio_features', 'song_moods', 'song_mood_curations', 'intelligence_models', 'model_parameters',
  'recommendation_batches', 'recommendation_batch_moods', 'recommendation_items', 'recommendation_reasons', 'reason_types',
  'user_genre_preferences', 'user_artist_preferences', 'user_mood_preferences', 'user_context_preferences', 'user_languages',
  'ratings', 'user_likes', 'song_dismissals', 'playlists', 'playlist_songs',
  'listening_sessions', 'listening_history', 'playback_events', 'search_history', 'trend_snapshots', 'pipeline_jobs', 'pipeline_job_logs',
  'music_sources', 'song_media', 'source_records',
  'artist_applications', 'artist_accounts', 'artist_uploads', 'artist_upload_events', 'artist_rights_reports',
  'retired_feature_archive', 'schema_migrations',
];
const VIEWS = ['v_song_catalog', 'v_song_playback', 'v_recommendation_candidates', 'v_current_song_moods', 'v_current_audio_features',
  'v_recommendation_explanations', 'v_song_stats', 'v_song_primary_mood', 'v_genre_statistics', 'v_artist_popularity', 'v_user_music_profile'];
const ROUTINES = ['sp_generate_recommendations', 'sp_refresh_user_preferences_core', 'sp_refresh_user_preferences', 'sp_close_listening_session',
  'sp_generate_trend_snapshot', 'sp_analyze_song_moods', 'sp_set_current_audio_features', 'fn_active_model', 'fn_model_param',
  'fn_unit_similarity', 'fn_tempo_fit', 'fn_feature_similarity', 'fn_completion_pct'];
const RETIRED = ['weekly_worlds', 'world_archetypes', 'archetype_moods', 'world_feedback', 'mood_diary_entries', 'song_lyrics', 'lyric_lines',
  'lyric_annotations', 'user_song_notes', 'song_mood_ratings', 'song_apple_music', 'v_muse_world_summary', 'v_weekly_mood_summary',
  'v_daily_listening_summary', 'v_trending_songs', 'v_song_lyric_annotation_summary', 'v_song_mood_rating_stats',
  'sp_rollback_world', 'sp_cleanup_expired_incognito', 'sp_user_listening_summary', 'sp_merge_songs', 'sp_record_apple_match'];

async function main() {
  const conn = await mysql.createConnection({
    host: db.host, port: db.port, database: db.database, charset: 'utf8mb4',
    user: db.ownerUser || db.appUser, password: db.ownerUser ? db.ownerPassword : db.appPassword,
  });
  const failures = [];
  let passed = 0;
  const check = (ok, label) => { if (ok) passed += 1; else failures.push(label); console.log(`${ok ? '  ✓' : '  ✗'} ${label}`); };
  try {
    const all = files();
    const expected = all.length ? all[all.length - 1].version : null;
    const [[ver]] = await conn.query('SELECT MAX(version) AS v FROM schema_migrations');
    check(ver.v === expected, `schema at migration ${expected} (database reports ${ver.v})`);

    const [tables] = await conn.query("SELECT TABLE_NAME AS n, TABLE_TYPE AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
    const [routines] = await conn.query('SELECT ROUTINE_NAME AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()');
    const base = new Set(tables.filter((x) => x.t === 'BASE TABLE').map((x) => x.n));
    const views = new Set(tables.filter((x) => x.t === 'VIEW').map((x) => x.n));
    const procs = new Set(routines.map((x) => x.n));
    TABLES.forEach((t) => check(base.has(t), `table ${t}`));
    VIEWS.forEach((v) => check(views.has(v), `view ${v}`));
    ROUTINES.forEach((r) => check(procs.has(r), `routine ${r}`));
    RETIRED.forEach((o) => check(!base.has(o) && !views.has(o) && !procs.has(o), `retired ${o} is absent`));

    for (const v of [...views].sort()) {
      try { await conn.query(`SELECT * FROM \`${v}\` LIMIT 1`); check(true, `view ${v} is readable`); }
      catch (err) { check(false, `view ${v} is readable (${err.sqlMessage || err.message})`); }
    }
    const [[cand]] = await conn.query('SELECT COUNT(*) AS n FROM v_recommendation_candidates');
    const [[active]] = await conn.query(`SELECT COUNT(*) AS n FROM songs s
       WHERE s.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM audio_features af WHERE af.song_id = s.song_id AND af.is_current = 1)
         AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.song_id AND sg.is_primary = 1)`);
    check(Number(cand.n) === Number(active.n), `recommendation candidates cover the analysed catalogue (${cand.n}/${active.n})`);
    const [[roles]] = await conn.query("SELECT GROUP_CONCAT(code ORDER BY code) AS codes FROM roles");
    check(roles.codes === 'ADMIN,ARTIST,LISTENER', `exactly three roles (${roles.codes})`);
  } finally {
    await conn.end();
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err.sqlMessage || err.message); process.exitCode = 1; });
