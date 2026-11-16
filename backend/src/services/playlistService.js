// Playlists: manual lists and saved mood mixes (a recommendation list kept as a playlist).
// song_count / total_duration_sec / positions are maintained by triggers.
const { query, one, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { toSong, withUserFlags } = require('./songMapper');

const { isRelevant } = require('../utils/recommendationLogic');

const KINDS = { MANUAL: 'MANUAL', SAVED_MIX: 'SAVED_MIX' };

async function owned(user, playlistId, { forUpdate = false, tx = null } = {}) {
  const run = tx ? tx.one : one;
  const p = await run(`SELECT * FROM playlists WHERE playlist_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [playlistId]);
  if (!p || p.user_id !== user.id) throw ApiError.notFound('Playlist');
  return p;
}

async function list(user) {
  return query(
    `SELECT p.playlist_id AS id, p.name, p.description, p.kind, p.song_count AS songCount,
            p.total_duration_sec AS totalDurationSec, p.created_at AS createdAt, p.updated_at AS updatedAt,
            (SELECT JSON_ARRAYAGG(JSON_ARRAY(c1, c2)) FROM (
               SELECT sc.cover_color_1 AS c1, sc.cover_color_2 AS c2 FROM playlist_songs ps
                 JOIN v_song_catalog sc ON sc.song_id = ps.song_id
                WHERE ps.playlist_id = p.playlist_id ORDER BY ps.position LIMIT 4) x) AS covers
       FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.playlist_id DESC`, [user.id]);
}

async function detail(user, playlistId) {
  const p = await owned(user, playlistId);
  const rows = await query(
    `SELECT sc.*, ps.position, ps.added_at FROM playlist_songs ps JOIN v_song_catalog sc ON sc.song_id = ps.song_id
      WHERE ps.playlist_id = ? ORDER BY ps.position`, [playlistId]);
  const songs = await withUserFlags(user.id, rows.map((r) => ({ ...toSong(r), position: r.position, addedAt: r.added_at })));
  return {
    id: p.playlist_id, name: p.name, description: p.description, kind: p.kind,
    sourceBatchId: p.source_batch_id, songCount: p.song_count, totalDurationSec: p.total_duration_sec,
    createdAt: p.created_at, updatedAt: p.updated_at, songs,
  };
}

/** Create a playlist and add its first songs in ONE transaction (all or nothing). */
async function create(user, { name, description = null, songIds = [], kind = KINDS.MANUAL, sourceBatchId = null }) {
  const unique = [...new Set(songIds)];
  if (unique.length !== songIds.length) throw new ApiError(409, 'DUPLICATE_PLAYLIST_SONG', 'The same song appears twice in the list.');
  return withTransaction(async (tx) => {
    if (sourceBatchId) {
      const b = await tx.one('SELECT user_id FROM recommendation_batches WHERE batch_id = ?', [sourceBatchId]);
      if (!b || b.user_id !== user.id) throw ApiError.notFound('Recommendation list');
    }
    const r = await tx.query(
      'INSERT INTO playlists (user_id, name, description, kind, source_batch_id) VALUES (?, ?, ?, ?, ?)',
      [user.id, name, description, kind, sourceBatchId]);
    for (const songId of unique) {
      const s = await tx.one("SELECT song_id FROM songs WHERE song_id = ? AND status = 'ACTIVE'", [songId]);
      if (!s) throw new ApiError(404, 'NOT_FOUND', `Song ${songId} not found.`);   // rolls back the playlist too
      await tx.query('INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)', [r.insertId, songId]);
    }
    return { id: r.insertId };
  }).then(({ id }) => detail(user, id));
}

/**
 * Save a recommendation list as a playlist, keeping its rank order. Only the songs
 * the listener was shown are saved: weak matches dropped by the relevance gate and
 * songs they marked "Not interested" are left out.
 */
async function saveBatch(user, { batchId, name, description = null }) {
  const b = await one('SELECT user_id, strategy, label FROM recommendation_batches WHERE batch_id = ?', [batchId]);
  if (!b || b.user_id !== user.id) throw ApiError.notFound('Recommendation list');
  const items = (await query(
    `SELECT ri.song_id, ri.mood_score, ri.audio_score, ri.final_score FROM recommendation_items ri
      WHERE ri.batch_id = ? AND NOT EXISTS (SELECT 1 FROM song_dismissals sd WHERE sd.user_id = ? AND sd.song_id = ri.song_id)
      ORDER BY ri.rank_position`, [batchId, user.id])).filter(isRelevant);
  if (!items.length) throw new ApiError(400, 'EMPTY_LIST', 'That list has no songs to save.');
  return create(user, { name, description: description || `Saved from “${b.label || 'a mood mix'}”`,
    songIds: items.map((i) => i.song_id), kind: KINDS.SAVED_MIX, sourceBatchId: batchId });
}

async function update(user, playlistId, { name, description }) {
  await owned(user, playlistId);
  const sets = []; const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description || null); }
  if (sets.length) await query(`UPDATE playlists SET ${sets.join(', ')}, updated_at = NOW() WHERE playlist_id = ?`, [...params, playlistId]);
  return detail(user, playlistId);
}

async function remove(user, playlistId) {
  await owned(user, playlistId);
  await query('DELETE FROM playlists WHERE playlist_id = ?', [playlistId]);
  return { deleted: true };
}

async function addSong(user, playlistId, songId) {
  return withTransaction(async (tx) => {
    await owned(user, playlistId, { forUpdate: true, tx });     // serialises concurrent adds (positions stay unique)
    const s = await tx.one("SELECT song_id FROM songs WHERE song_id = ? AND status = 'ACTIVE'", [songId]);
    if (!s) throw ApiError.notFound('Song');
    await tx.query('INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)', [playlistId, songId]);   // PK rejects duplicates
    const p = await tx.one('SELECT song_count, total_duration_sec FROM playlists WHERE playlist_id = ?', [playlistId]);
    return { playlistId, songId, songCount: p.song_count, totalDurationSec: p.total_duration_sec };
  });
}

async function removeSong(user, playlistId, songId) {
  await owned(user, playlistId);
  const r = await query('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?', [playlistId, songId]);
  if (!r.affectedRows) throw ApiError.notFound('Song in this playlist');
  return { removed: true };
}

module.exports = { list, detail, create, saveBatch, update, remove, addSong, removeSong };
