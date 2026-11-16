// LOOP-owned full-track media. Every playable file must exist in the local
// media directory and be registered in song_media with an approved rights state.
const { query, one } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { localMedia } = require('../providers');

const LOCAL_SOURCES = ['LOCAL_MEDIA', 'ARTIST_UPLOAD'];
const LABELS = { LOCAL: 'LOOP Library · full track' };

// A process without local media storage (e.g. a serverless function) cannot see
// the files, so it must never record them as missing in the shared database.
async function mark(mediaId, availability) {
  if (localMedia.check().state === 'disabled') return;
  await query('UPDATE song_media SET availability = ?, last_checked_at = NOW() WHERE media_id = ?', [availability, mediaId]);
}

async function resolve(song) {
  const row = await one(
    `SELECT media_id, source_code, source_name, uri, attribution
       FROM v_song_playback WHERE song_id = ?`, [song.song_id]);
  if (!row || !LOCAL_SOURCES.includes(row.source_code) || !localMedia.available(row.uri)) {
    if (row) await mark(row.media_id, 'UNAVAILABLE');
    return null;
  }
  return {
    mediaId: row.media_id, type: 'LOCAL', source: row.source_code,
    sourceName: row.source_name, label: LABELS.LOCAL, attribution: row.attribution || null,
    uri: `/api/media/${row.media_id}`, durationSec: song.duration_sec, demo: false,
  };
}

async function localFile(mediaId) {
  const id = Number(mediaId);
  if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('Media');
  const row = await one(
    `SELECT sm.media_id, sm.song_id, sm.uri, sm.rights_status, sm.availability,
            ms.code AS source_code, s.title, s.duration_sec, s.explicit, s.content_rating, s.status
       FROM song_media sm
       JOIN music_sources ms ON ms.source_id = sm.source_id
       JOIN songs s ON s.song_id = sm.song_id
      WHERE sm.media_id = ? AND sm.media_type = 'USER_LOCAL'
        AND ms.code IN ('LOCAL_MEDIA','ARTIST_UPLOAD') AND ms.is_enabled = 1
        AND sm.rights_status IN ('PERMITTED','ATTRIBUTION_REQUIRED')
        AND sm.availability = 'AVAILABLE' AND s.status = 'ACTIVE'`, [id]);
  if (!row) throw ApiError.notFound('Media');
  const file = localMedia.resolveFile(row.uri);
  if (!file || !localMedia.available(row.uri)) {
    await mark(id, 'UNAVAILABLE');
    throw new ApiError(404, 'MEDIA_MISSING', 'This LOOP audio file is currently unavailable.');
  }
  return {
    ...file,
    song: {
      song_id: row.song_id, title: row.title, duration_sec: row.duration_sec,
      explicit: !!row.explicit, content_rating: row.content_rating, status: row.status,
      source: row.source_code,
    },
  };
}

async function registerLocal(songId, fileName, { attribution = null, rights = 'PERMITTED' } = {}) {
  const file = localMedia.resolveFile(fileName);
  if (!file || !localMedia.available(fileName)) {
    throw new ApiError(400, 'LOCAL_FILE_NOT_FOUND', 'Choose an audio file that exists in the LOOP media folder.');
  }
  if (!['PERMITTED', 'ATTRIBUTION_REQUIRED'].includes(rights)) throw ApiError.badRequest('Invalid media rights state.');
  if (rights === 'ATTRIBUTION_REQUIRED' && !String(attribution || '').trim()) {
    throw ApiError.badRequest('Attribution is required for this audio file.');
  }
  const [source, song] = await Promise.all([
    one("SELECT source_id FROM music_sources WHERE code = 'LOCAL_MEDIA' AND is_enabled = 1"),
    one("SELECT song_id FROM songs WHERE song_id = ? AND status = 'ACTIVE'", [songId]),
  ]);
  if (!source) throw new ApiError(503, 'LOCAL_MEDIA_DISABLED', 'LOOP local media storage is not enabled.');
  if (!song) throw ApiError.notFound('Active song');
  await query(
    `INSERT INTO song_media
       (song_id, source_id, media_type, uri, rights_status, availability, last_checked_at, attribution, priority)
     VALUES (?, ?, 'USER_LOCAL', ?, ?, 'AVAILABLE', NOW(), ?, 5)
     ON DUPLICATE KEY UPDATE uri = VALUES(uri), rights_status = VALUES(rights_status),
       availability = 'AVAILABLE', last_checked_at = NOW(), attribution = VALUES(attribution), priority = 5`,
    [songId, source.source_id, fileName, rights, attribution || null]);
  return { songId: Number(songId), fileName, rights, availability: 'AVAILABLE', source: 'LOCAL_MEDIA' };
}

async function checkLocal() {
  if (localMedia.check().state === 'disabled') {
    throw new ApiError(503, 'LOCAL_MEDIA_DISABLED', 'This deployment has no LOOP media storage, so files cannot be checked here.');
  }
  const rows = await query(
    `SELECT sm.media_id, sm.uri FROM song_media sm JOIN music_sources ms ON ms.source_id = sm.source_id
      WHERE sm.media_type = 'USER_LOCAL' AND ms.code IN ('LOCAL_MEDIA','ARTIST_UPLOAD')`);
  let available = 0;
  let unavailable = 0;
  for (const row of rows) {
    const ok = localMedia.available(row.uri);
    ok ? available++ : unavailable++;
    await mark(row.media_id, ok ? 'AVAILABLE' : 'UNAVAILABLE');
  }
  return { checked: rows.length, available, unavailable };
}

async function summary() {
  return query(
    `SELECT sm.media_type AS type, ms.code AS source, sm.availability, COUNT(*) AS n
       FROM song_media sm JOIN music_sources ms ON ms.source_id = sm.source_id
      WHERE ms.code IN ('LOCAL_MEDIA','ARTIST_UPLOAD')
      GROUP BY sm.media_type, ms.code, sm.availability ORDER BY ms.code, sm.availability`);
}

module.exports = { resolve, localFile, registerLocal, checkLocal, summary, LABELS };
