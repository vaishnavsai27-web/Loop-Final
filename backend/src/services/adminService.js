// Admin operations. Every write runs in a transaction with the
// acting user exposed to audit triggers as @muse_actor_id; writes that no
// trigger covers insert their own audit row in the same transaction.
const { query, one, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { toSong } = require('./songMapper');
const sessions = require('./sessionService');

/** Stable JSON (sorted keys) so equal payloads hash equally in source_records. */
function canonicalJson(value) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value));
}

const audit = (tx, actor, action, type, id, oldV, newV) => tx.query(
  'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?)',
  [actor, action, type, String(id), oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null]);

// ---------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------
async function overview() {
  const c = await one(`SELECT
      (SELECT COUNT(*) FROM songs WHERE status = 'ACTIVE') AS active_songs,
      (SELECT COUNT(*) FROM songs WHERE status = 'PENDING_ANALYSIS') AS pending_songs,
      (SELECT COUNT(*) FROM songs WHERE status = 'HIDDEN') AS hidden_songs,
      (SELECT COUNT(*) FROM artists) AS artists, (SELECT COUNT(*) FROM albums) AS albums,
      (SELECT COUNT(*) FROM users WHERE is_active = 1) AS users,
      (SELECT COUNT(*) FROM listening_history WHERE started_at >= NOW() - INTERVAL 7 DAY) AS plays_7d,
      (SELECT COUNT(DISTINCT user_id) FROM listening_history WHERE started_at >= NOW() - INTERVAL 7 DAY) AS listeners_7d,
      (SELECT COUNT(*) FROM v_song_playback p JOIN songs s ON s.song_id = p.song_id AND s.status = 'ACTIVE') AS playable_songs,
      (SELECT COUNT(*) FROM users u JOIN roles r USING (role_id) WHERE r.code = 'ARTIST' AND u.is_active = 1) AS artists_active,
      (SELECT COUNT(*) FROM artist_applications WHERE status = 'PENDING') AS pending_artist_applications,
      (SELECT COUNT(*) FROM artist_uploads WHERE status IN ('QUARANTINED','PROCESSING','PENDING_REVIEW','APPROVED')) AS uploads_in_review,
      (SELECT COUNT(*) FROM artist_rights_reports WHERE status IN ('OPEN','UNDER_REVIEW')) AS open_rights_reports,
      (SELECT COUNT(*) FROM recommendation_batches WHERE created_at >= NOW() - INTERVAL 7 DAY) AS mood_requests_7d`);
  return c;
}

/** Read-only matrix of permissions assigned to each database role. */
async function permissionMatrix() {
  const [roles, permissions, assignments] = await Promise.all([
    query('SELECT role_id AS id, code, name FROM roles ORDER BY role_id'),
    query('SELECT permission_code AS code, description FROM permissions ORDER BY permission_code'),
    query('SELECT role_id AS roleId, permission_code AS permission FROM role_permissions ORDER BY role_id, permission_code'),
  ]);
  const byRole = new Map(roles.map((role) => [role.id, []]));
  for (const row of assignments) byRole.get(row.roleId)?.push(row.permission);
  return {
    permissions,
    roles: roles.map((role) => ({ ...role, permissions: byRole.get(role.id) || [] })),
  };
}

// ---------------------------------------------------------------------------
// catalogue: songs
// ---------------------------------------------------------------------------
async function listSongs({ q = '', status = null, page = 1, pageSize = 25 }) {
  const where = ['1 = 1']; const params = [];
  if (status) { where.push('sc.status = ?'); params.push(status); }
  if (q) { where.push('(sc.title LIKE ? OR sc.artist_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM v_song_catalog sc WHERE ${where.join(' AND ')}`, params);
  const rows = await query(`SELECT sc.*, st.plays FROM v_song_catalog sc LEFT JOIN v_song_stats st ON st.song_id = sc.song_id
                             WHERE ${where.join(' AND ')} ORDER BY sc.song_id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { total, page, pageSize, songs: rows.map((r) => ({ ...toSong(r), plays: r.plays })) };
}

async function references() {
  const [artists, albums, genres, languages, moods, contexts, regions] = await Promise.all([
    query('SELECT artist_id AS id, name, disambiguation FROM artists ORDER BY name'),
    query(`SELECT al.album_id AS id, al.title, al.album_type AS type, a.name AS artist FROM albums al
             LEFT JOIN album_artists aa ON aa.album_id = al.album_id AND aa.credit_order = 1 LEFT JOIN artists a ON a.artist_id = aa.artist_id
            ORDER BY al.title`),
    query('SELECT genre_id AS id, name FROM genres ORDER BY name'),
    query('SELECT language_id AS id, name FROM languages ORDER BY name'),
    query('SELECT mood_id AS id, name, emoji, color_hex AS color FROM moods ORDER BY name'),
    query('SELECT code, name FROM contexts ORDER BY sort_order'),
    query("SELECT region_code AS code, name FROM regions ORDER BY country_code = 'XX', name"),
  ]);
  return { artists, albums, genres, languages, moods, contexts, regions };
}

/**
 * Manual catalogue entry: a provenance row under the MANUAL_ENTRY source. When
 * audio features are supplied they are stored as the current analysis, the active
 * mood model tags the song, and it becomes ACTIVE in the same transaction.
 * Without features the song waits in PENDING_ANALYSIS (not recommendable).
 */
async function createSong(actor, s) {
  const { songId } = await withTransaction(async (tx) => {
    const src = await tx.one("SELECT source_id FROM music_sources WHERE code = 'MANUAL_ENTRY'");
    const artist = await tx.one('SELECT artist_id, name FROM artists WHERE artist_id = ?', [s.artistId]);
    if (!artist) throw ApiError.notFound('Artist');
    const contentRating = s.explicit && s.contentRating === 'ALL' ? 'TEEN' : s.contentRating;
    const r = await tx.query(
      `INSERT INTO songs (title, version_label, primary_artist_id, album_id, track_number, duration_sec, release_year, language_id,
                          isrc, explicit, content_rating, popularity, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_ANALYSIS')`,
      [s.title, s.versionLabel || '', s.artistId, s.albumId || null, s.trackNumber || null, s.durationSec, s.releaseYear,
        s.languageId || null, s.isrc || null, s.explicit ? 1 : 0, contentRating, s.popularity]);
    await tx.query('INSERT INTO song_genres (song_id, genre_id, is_primary) VALUES (?, ?, 1)', [r.insertId, s.genreId]);
    const payload = { title: s.title, artist: artist.name, duration_sec: s.durationSec, release_year: s.releaseYear, isrc: s.isrc || null,
      analysis: s.features ? { ...s.features, segments: [] } : undefined };
    const json = canonicalJson(payload);
    await tx.query(
      `INSERT INTO source_records (source_id, entity_type, external_id, isrc, song_id, rights_status, payload, payload_hash, status,
                                   match_method, match_confidence, quality_score, processing_version)
       VALUES (?, 'SONG', ?, ?, ?, 'PERMITTED', ?, SHA2(?, 256), 'COMPLETED', 'MANUAL', 1, 1, '2.0')`,
      [src.source_id, `manual:${r.insertId}`, s.isrc || null, r.insertId, json, json]);
    if (s.features) await analyse(tx, r.insertId, s.features);
    await audit(tx, actor, 'SONG_CREATED', 'song', r.insertId, null, { title: s.title, artist_id: s.artistId, analysed: !!s.features });
    return { songId: r.insertId };
  }, { actorId: actor });
  return songDetailAdmin(songId);
}

/** Store supplied audio features as current, run the active mood model, activate the song. */
async function analyse(tx, songId, f) {
  const featureModel = await activeModel(tx, 'AUDIO_FEATURES');
  const af = await tx.query(
    `INSERT INTO audio_features (song_id, model_id, energy, valence, danceability, acousticness, instrumentalness, speechiness,
                                 loudness_db, tempo_bpm, musical_key, mode, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [songId, featureModel, f.energy, f.valence, f.danceability, f.acousticness, f.instrumentalness, f.speechiness,
      f.loudness_db ?? -8, f.tempo_bpm, f.key ?? 0, f.mode ?? 1]);
  await tx.call('sp_set_current_audio_features', [af.insertId]);
  await tx.call('sp_analyze_song_moods', [await activeModel(tx, 'MOOD'), null, songId]);
  await tx.query("UPDATE songs SET status = 'ACTIVE' WHERE song_id = ? AND status = 'PENDING_ANALYSIS'", [songId]);
}

async function songDetailAdmin(songId) {
  const row = await one('SELECT * FROM v_song_catalog WHERE song_id = ?', [songId]);
  if (!row) throw ApiError.notFound('Song');
  const [moods, curations] = await Promise.all([
    query('SELECT mood_id AS id, mood_name AS name, emoji, confidence FROM v_current_song_moods WHERE song_id = ? ORDER BY mood_rank', [songId]),
    query(`SELECT c.mood_id AS id, m.name, c.action, c.confidence, c.note, c.curated_at AS curatedAt, up.display_name AS curatedBy
             FROM song_mood_curations c JOIN moods m ON m.mood_id = c.mood_id LEFT JOIN user_profiles up ON up.user_id = c.curated_by
            WHERE c.song_id = ?`, [songId]),
  ]);
  return { ...toSong(row), albumId: row.album_id, genreId: row.genre_id, moodsDetailed: moods, curations };
}

const SONG_FIELDS = { title: 'title', versionLabel: 'version_label', albumId: 'album_id', durationSec: 'duration_sec',
  releaseYear: 'release_year', languageId: 'language_id', isrc: 'isrc', explicit: 'explicit', contentRating: 'content_rating',
  popularity: 'popularity', status: 'status' };

async function updateSong(actor, songId, patch) {
  await withTransaction(async (tx) => {
    const s = await tx.one('SELECT song_id, status FROM songs WHERE song_id = ? FOR UPDATE', [songId]);
    if (!s) throw ApiError.notFound('Song');
    if (s.status === 'MERGED') throw new ApiError(409, 'SONG_MERGED', 'A merged song cannot be edited; edit its canonical song.');
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(SONG_FIELDS)) {
      if (patch[k] === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(k === 'explicit' ? (patch[k] ? 1 : 0) : (patch[k] === '' ? null : patch[k]));
    }
    if (patch.explicit === true && patch.contentRating === undefined) sets.push("content_rating = IF(content_rating = 'ALL', 'TEEN', content_rating)");
    if (sets.length) await tx.query(`UPDATE songs SET ${sets.join(', ')} WHERE song_id = ?`, [...params, songId]);   // audited by trg_songs_au_audit
    if (patch.genreId) {
      await tx.query('DELETE FROM song_genres WHERE song_id = ? AND is_primary = 1', [songId]);
      await tx.query(`INSERT INTO song_genres (song_id, genre_id, is_primary) VALUES (?, ?, 1)
                      ON DUPLICATE KEY UPDATE is_primary = 1`, [songId, patch.genreId]);
    }
    // New audio analysis (e.g. for a published artist upload) makes the song recommendable.
    if (patch.features) await analyse(tx, songId, patch.features);
  }, { actorId: actor });
  return songDetailAdmin(songId);
}

/**
 * Songs with provenance or listening history are HIDDEN (kept for history and
 * audit); a song with neither is deleted outright.
 */
async function deleteSong(actor, songId) {
  return withTransaction(async (tx) => {
    const s = await tx.one(
      `SELECT s.song_id, s.title, s.status,
              (SELECT COUNT(*) FROM source_records sr WHERE sr.song_id = s.song_id) AS provenance,
              (SELECT COUNT(*) FROM listening_history lh WHERE lh.song_id = s.song_id) AS plays
         FROM songs s WHERE s.song_id = ? FOR UPDATE`, [songId]);
    if (!s) throw ApiError.notFound('Song');
    if (s.provenance > 0 || s.plays > 0) {
      await tx.query("UPDATE songs SET status = 'HIDDEN' WHERE song_id = ?", [songId]);
      return { songId, result: 'HIDDEN',
        message: `“${s.title}” has ${s.plays} plays and ${s.provenance} provenance records, so it was hidden instead of deleted. Its history stays intact.` };
    }
    await tx.query('DELETE FROM songs WHERE song_id = ?', [songId]);   // audited by trg_songs_ad_audit
    return { songId, result: 'DELETED', message: `“${s.title}” was deleted.` };
  }, { actorId: actor });
}

/** Admin mood decision: stored, then the active mood model is re-run for the song so it takes effect. */
async function curateMood(actor, songId, moodId, { action, confidence = null, note = null }) {
  if (action === 'ADD' && !confidence) throw ApiError.badRequest('confidence is required when adding a mood');
  await withTransaction(async (tx) => {
    const s = await tx.one('SELECT song_id, status FROM songs WHERE song_id = ?', [songId]);
    if (!s) throw ApiError.notFound('Song');
    const m = await tx.one('SELECT mood_id, name FROM moods WHERE mood_id = ?', [moodId]);
    if (!m) throw new ApiError(400, 'INVALID_MOOD', 'Unknown mood.');
    const before = await tx.one('SELECT action, confidence FROM song_mood_curations WHERE song_id = ? AND mood_id = ?', [songId, moodId]);
    await tx.query(
      `INSERT INTO song_mood_curations (song_id, mood_id, action, confidence, note, curated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE action = VALUES(action), confidence = VALUES(confidence), note = VALUES(note), curated_by = VALUES(curated_by)`,
      [songId, moodId, action, action === 'ADD' ? confidence : null, note, actor]);
    await audit(tx, actor, 'MOOD_CURATED', 'song', songId, before, { mood: m.name, action, confidence });
    const hasFeatures = await tx.one('SELECT 1 AS ok FROM audio_features WHERE song_id = ? AND is_current = 1', [songId]);
    if (hasFeatures) await tx.call('sp_analyze_song_moods', [await activeModel(tx, 'MOOD'), null, songId]);
  }, { actorId: actor });
  return songDetailAdmin(songId);
}

async function clearCuration(actor, songId, moodId) {
  await withTransaction(async (tx) => {
    const r = await tx.query('DELETE FROM song_mood_curations WHERE song_id = ? AND mood_id = ?', [songId, moodId]);
    if (!r.affectedRows) throw ApiError.notFound('Curation');
    await audit(tx, actor, 'MOOD_CURATION_CLEARED', 'song', songId, { mood_id: moodId }, null);
    const hasFeatures = await tx.one('SELECT 1 AS ok FROM audio_features WHERE song_id = ? AND is_current = 1', [songId]);
    if (hasFeatures) await tx.call('sp_analyze_song_moods', [await activeModel(tx, 'MOOD'), null, songId]);
  }, { actorId: actor });
  return songDetailAdmin(songId);
}

async function activeModel(tx, kind) {
  const m = await tx.one('SELECT model_id FROM intelligence_models WHERE kind = ? AND is_active = 1', [kind]);
  if (!m) throw new ApiError(409, 'NO_ACTIVE_MODEL', `No active ${kind} model.`);
  return m.model_id;
}

// ---------------------------------------------------------------------------
// artists, albums, moods, keywords
// ---------------------------------------------------------------------------
async function listArtists({ q = '' }) {
  return query(
    `SELECT a.artist_id AS id, a.name, a.disambiguation, a.artist_type AS type, a.country_code AS country, a.region_code AS region,
            l.name AS language, a.formed_year AS formedYear,
            (SELECT COUNT(*) FROM songs s WHERE s.primary_artist_id = a.artist_id) AS songs,
            (SELECT GROUP_CONCAT(alias SEPARATOR ', ') FROM artist_aliases al WHERE al.artist_id = a.artist_id) AS aliases
       FROM artists a LEFT JOIN languages l ON l.language_id = a.primary_language_id
      WHERE a.name LIKE ? ORDER BY a.name`, [`%${q}%`]);
}

async function createArtist(actor, a) {
  return withTransaction(async (tx) => {
    const r = await tx.query(
      `INSERT INTO artists (name, disambiguation, artist_type, country_code, region_code, primary_language_id, formed_year, bio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.name, a.disambiguation || '', a.type, a.countryCode, a.regionCode || null, a.languageId || null, a.formedYear || null, a.bio || null]);
    for (const alias of a.aliases || []) {
      await tx.query("INSERT INTO artist_aliases (artist_id, alias, alias_type) VALUES (?, ?, 'SPELLING')", [r.insertId, alias]);
    }
    await audit(tx, actor, 'ARTIST_CREATED', 'artist', r.insertId, null, { name: a.name });
    return { id: r.insertId, name: a.name };
  }, { actorId: actor });
}

async function updateArtist(actor, artistId, a) {
  return withTransaction(async (tx) => {
    const before = await tx.one('SELECT name, bio, region_code, formed_year FROM artists WHERE artist_id = ? FOR UPDATE', [artistId]);
    if (!before) throw ApiError.notFound('Artist');
    const map = { name: 'name', disambiguation: 'disambiguation', type: 'artist_type', regionCode: 'region_code',
      languageId: 'primary_language_id', formedYear: 'formed_year', bio: 'bio' };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) if (a[k] !== undefined) { sets.push(`${col} = ?`); params.push(a[k] === '' ? null : a[k]); }
    if (sets.length) await tx.query(`UPDATE artists SET ${sets.join(', ')} WHERE artist_id = ?`, [...params, artistId]);
    await audit(tx, actor, 'ARTIST_UPDATED', 'artist', artistId, before, a);
    return { id: artistId };
  }, { actorId: actor });
}

async function createAlbum(actor, a) {
  return withTransaction(async (tx) => {
    const r = await tx.query(
      `INSERT INTO albums (title, album_type, film_id, release_year, language_id, cover_color_1, cover_color_2)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [a.title, a.albumType, a.filmId || null, a.releaseYear, a.languageId || null, a.coverColor1, a.coverColor2]);
    for (const [i, artistId] of a.artistIds.entries()) {
      await tx.query('INSERT INTO album_artists (album_id, artist_id, credit_order) VALUES (?, ?, ?)', [r.insertId, artistId, i + 1]);
    }
    await audit(tx, actor, 'ALBUM_CREATED', 'album', r.insertId, null, { title: a.title, artists: a.artistIds });
    return { id: r.insertId, title: a.title };
  }, { actorId: actor });
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
async function listUsers({ q = '' }) {
  return query(
    `SELECT u.user_id AS id, u.username, u.email, r.code AS role, u.is_active AS isActive, u.created_at AS createdAt,
            u.last_login_at AS lastLoginAt, p.display_name AS displayName, p.region_code AS region,
            vp.total_plays AS plays, vp.minutes_listened AS minutes, vp.favorite_genre AS favoriteGenre, vp.dominant_mood AS dominantMood,
            (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS locked
       FROM users u JOIN roles r ON r.role_id = u.role_id JOIN user_profiles p ON p.user_id = u.user_id
       LEFT JOIN v_user_music_profile vp ON vp.user_id = u.user_id
      WHERE u.username LIKE ? OR p.display_name LIKE ? OR u.email LIKE ?
      ORDER BY u.user_id`, [`%${q}%`, `%${q}%`, `%${q}%`]);
}

async function updateUser(actor, userId, { role, isActive }) {
  return withTransaction(async (tx) => {
    // lock only the users row (OF u): roles is read-only reference data for the app account
    const u = await tx.one('SELECT u.user_id, r.code AS role FROM users u JOIN roles r USING (role_id) WHERE u.user_id = ? FOR UPDATE OF u', [userId]);
    if (!u) throw ApiError.notFound('User');
    // Admin access is never granted from the console; it is provisioned with
    // `npm run admin:provision` by someone with database owner credentials.
    if (role === 'ADMIN' && u.role !== 'ADMIN') {
      throw new ApiError(403, 'ADMIN_PROVISIONING_ONLY', 'Admin access can only be granted with the server-side provisioning command.');
    }
    if (userId === actor && (role && role !== 'ADMIN' || isActive === false)) {
      throw new ApiError(409, 'SELF_LOCKOUT', 'You cannot remove your own admin access.');
    }
    if (u.role === 'ADMIN' && (role && role !== 'ADMIN' || isActive === false)) {
      // lock all admins so two concurrent demotions cannot leave zero admins
      const admins = await tx.query(`SELECT u.user_id FROM users u JOIN roles r USING (role_id)
                                      WHERE r.code = 'ADMIN' AND u.is_active = 1 FOR UPDATE OF u`);
      if (admins.length <= 1) throw new ApiError(409, 'LAST_ADMIN', 'At least one active admin must remain.');
    }
    if (role === 'ARTIST') {
      const artist = await tx.one(
        "SELECT 1 AS ok FROM artist_accounts WHERE user_id = ? AND account_status = 'ACTIVE' LIMIT 1", [userId]);
      if (!artist) throw new ApiError(409, 'ARTIST_PROFILE_REQUIRED', 'Approve an artist application before assigning the Artist role.');
    }
    if (role) {
      const r = await tx.one('SELECT role_id FROM roles WHERE code = ?', [role]);
      if (!r) throw new ApiError(400, 'INVALID_ROLE', 'Unknown role.');
      await tx.query('UPDATE users SET role_id = ? WHERE user_id = ?', [r.role_id, userId]);
    }
    if (isActive !== undefined) await tx.query('UPDATE users SET is_active = ? WHERE user_id = ?', [isActive ? 1 : 0, userId]);
    if (isActive === false) await sessions.revokeAll(userId, 'ADMIN_DEACTIVATED', { tx });   // signed out everywhere, at once
    return { id: userId, role: role || u.role, isActive };
  }, { actorId: actor });
}

async function auditLog({ entityType = null, limit = 50 }) {
  return query(
    `SELECT a.audit_id AS id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.old_values AS oldValues,
            a.new_values AS newValues, a.created_at AS createdAt, up.display_name AS actor
       FROM audit_logs a LEFT JOIN user_profiles up ON up.user_id = a.actor_user_id
      WHERE (? IS NULL OR a.entity_type = ?) ORDER BY a.audit_id DESC LIMIT ?`, [entityType, entityType, limit]);
}

module.exports = {
  overview, permissionMatrix, listSongs, references, createSong, songDetailAdmin, updateSong, deleteSong, curateMood, clearCuration,
  listArtists, createArtist, updateArtist, createAlbum, listUsers, updateUser, auditLog,
};
