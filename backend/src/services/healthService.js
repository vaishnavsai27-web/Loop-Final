// Database health and query-performance panels for admins.
// Read-only. Never exposes credentials, hostnames or connection strings.
const { query, one } = require('../config/db');
const { db } = require('../config/env');

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Exact row counts for every base table (names come from information_schema, then re-validated). */
async function tableCounts() {
  const tables = await query(
    `SELECT TABLE_NAME AS name, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024) AS kb, ROUND(INDEX_LENGTH / 1024) AS index_kb
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [db.database]);
  const safe = tables.filter((t) => IDENT.test(t.name));
  const counts = await query(safe.map((t) => `SELECT '${t.name}' AS name, COUNT(*) AS n FROM \`${t.name}\``).join(' UNION ALL '));
  const m = new Map(counts.map((c) => [c.name, c.n]));
  return safe.map((t) => ({ name: t.name, rows: m.get(t.name), sizeKb: Number(t.kb), indexKb: Number(t.index_kb) }));
}

/** Rules a foreign key or CHECK cannot express. Each should return 0 rows. */
const CHECKS = [
  ['Active songs without a current audio analysis',
    `SELECT COUNT(*) AS n FROM songs s WHERE s.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM audio_features af WHERE af.song_id = s.song_id AND af.is_current = 1)`],
  ['Active songs without exactly one primary genre',
    `SELECT COUNT(*) AS n FROM songs s WHERE s.status = 'ACTIVE'
       AND (SELECT COUNT(*) FROM song_genres sg WHERE sg.song_id = s.song_id AND sg.is_primary = 1) <> 1`],
  ['Active songs without a mood from the active mood model',
    `SELECT COUNT(*) AS n FROM songs s WHERE s.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM v_current_song_moods cm WHERE cm.song_id = s.song_id)`],
  ['Playlists whose stored song count or length drifted from playlist_songs',
    `SELECT COUNT(*) AS n FROM playlists p
      WHERE p.song_count <> (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.playlist_id)
         OR p.total_duration_sec <> (SELECT COALESCE(SUM(s.duration_sec), 0) FROM playlist_songs ps JOIN songs s ON s.song_id = ps.song_id
                                      WHERE ps.playlist_id = p.playlist_id)`],
  ['Finished plays whose completion % disagrees with listened time',
    `SELECT COUNT(*) AS n FROM listening_history lh JOIN songs s ON s.song_id = lh.song_id
      WHERE lh.ended_at IS NOT NULL AND ABS(lh.completion_pct - fn_completion_pct(lh.listened_sec, s.duration_sec)) > 0.01`],
  ['Closed sessions whose summary disagrees with their plays',
    `SELECT COUNT(*) AS n FROM listening_sessions ls
      WHERE ls.status = 'CLOSED' AND ls.plays <> (SELECT COUNT(*) FROM listening_history lh WHERE lh.session_id = ls.session_id)`],
  ['Merged songs that still have listening history',
    `SELECT COUNT(*) AS n FROM songs s JOIN listening_history lh ON lh.song_id = s.song_id WHERE s.status = 'MERGED'`],
  ['Completed provenance records not linked to any entity',
    `SELECT COUNT(*) AS n FROM source_records WHERE status = 'COMPLETED'
       AND song_id IS NULL AND artist_id IS NULL AND album_id IS NULL AND film_id IS NULL`],
  ['Preference rows computed by an inactive preference model',
    `SELECT COUNT(*) AS n FROM user_genre_preferences ugp JOIN intelligence_models im ON im.model_id = ugp.model_id WHERE im.is_active = 0`],
];

async function integrity() {
  const out = [];
  for (const [label, sql] of CHECKS) {
    const r = await one(sql);
    out.push({ label, violations: Number(r.n), ok: Number(r.n) === 0, severity: 'error' });
  }
  return out;
}

/** Essential operational health for Admin → System. No secrets, hostnames or connection strings. */
async function health() {
  const [tables, checks, failed, audit, sessions, version, media] = await Promise.all([
    tableCounts(),
    integrity(),
    query(`SELECT job_id AS id, job_type AS type, retry_count AS retries, last_error AS error, completed_at AS at
             FROM pipeline_jobs WHERE status = 'FAILED' ORDER BY job_id DESC LIMIT 10`),
    query(`SELECT a.audit_id AS id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.created_at AS createdAt,
                  up.display_name AS actor FROM audit_logs a LEFT JOIN user_profiles up ON up.user_id = a.actor_user_id
            ORDER BY a.audit_id DESC LIMIT 12`),
    one(`SELECT (SELECT COUNT(*) FROM listening_sessions WHERE status = 'OPEN') AS openListeningSessions,
                (SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > NOW()) AS activeSignIns`),
    one('SELECT VERSION() AS version'),
    one(`SELECT (SELECT COUNT(*) FROM songs WHERE status = 'ACTIVE') AS activeSongs,
                (SELECT COUNT(*) FROM v_song_playback p JOIN songs s ON s.song_id = p.song_id AND s.status = 'ACTIVE') AS playableSongs`),
  ]);
  const sizeKb = tables.reduce((s, t) => s + t.sizeKb, 0);
  return {
    server: { version: version.version, sizeKb, tables: tables.length, checkedAt: new Date().toISOString() },
    integrity: checks, failedJobs: failed, recentAudit: audit, sessions, catalogue: media,
  };
}

module.exports = { health, integrity, tableCounts };
