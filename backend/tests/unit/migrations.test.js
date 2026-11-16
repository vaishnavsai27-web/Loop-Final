// Verifies the forward-only policy migration contains the required self-hosted changes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/0016_loop_owned_media_three_roles.sql'), 'utf8');

test('migration creates the three application roles and demotes legacy Curator accounts', () => {
  assert.match(migration, /code = 'CURATOR'[\s\S]*?SET u\.role_id = user_role\.role_id/);
  assert.match(migration, /DELETE FROM roles WHERE code = 'CURATOR'/);
  assert.match(migration, /UPDATE roles SET name = 'User' WHERE code = 'LISTENER'/);
  assert.match(migration, /UPDATE roles SET name = 'Artist' WHERE code = 'ARTIST'/);
  assert.match(migration, /UPDATE roles SET name = 'Admin' WHERE code = 'ADMIN'/);
});

test('migration grants Artist User permissions plus private studio/upload capabilities', () => {
  assert.match(migration, /artist\.studio/);
  assert.match(migration, /artist\.upload/);
  assert.match(migration, /artist\.review/);
  assert.match(migration, /Admin remains the only reviewer/);
});

test('playback view can only choose approved LOOP-owned local media', () => {
  assert.match(migration, /ms\.code IN \('LOCAL_MEDIA','ARTIST_UPLOAD'\)/);
  assert.match(migration, /sm\.media_type = 'USER_LOCAL'/);
  assert.match(migration, /sm\.rights_status IN \('PERMITTED','ATTRIBUTION_REQUIRED'\)/);
  assert.match(migration, /sm\.availability = 'AVAILABLE'/);
  assert.match(migration, /CREATE OR REPLACE VIEW v_song_playback/);
});

test('historical external media is marked unavailable instead of deleted', () => {
  assert.match(migration, /SET sm\.rights_status = 'RESTRICTED', sm\.availability = 'UNAVAILABLE'/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+song_media/i);
});

const m17 = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/0017_mood_first_simplification.sql'), 'utf8');

test('0017 restores the whole analysed catalogue as recommendation candidates', () => {
  const view = m17.slice(m17.indexOf('CREATE OR REPLACE VIEW v_recommendation_candidates'), m17.indexOf('-- ----', m17.indexOf('CREATE OR REPLACE VIEW v_recommendation_candidates')));
  assert.match(view, /WHERE s\.status = 'ACTIVE';/);
  assert.doesNotMatch(view, /v_song_playback/, 'playability no longer gates candidates');
});

test('0017 archives user-authored rows before dropping their tables', () => {
  for (const [feature, table] of [['MOOD_DIARY', 'mood_diary_entries'], ['SONG_MOOD_RATING', 'song_mood_ratings'], ['SONG_NOTE', 'user_song_notes'], ['LYRIC_ANNOTATION', 'lyric_annotations']]) {
    const archive = m17.indexOf(`'${feature}'`);
    const drop = m17.indexOf(`DROP TABLE IF EXISTS ${table};`);
    assert.ok(archive > -1 && drop > -1 && archive < drop, `${table} archived before it is dropped`);
  }
});

test('0017 never drops tables the product still uses', () => {
  const dropped = [...m17.matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)].map((x) => x[1]);
  for (const kept of ['users', 'songs', 'moods', 'song_moods', 'audio_features', 'recommendation_batches', 'playlists', 'user_likes', 'ratings',
    'listening_history', 'artist_uploads', 'artist_applications', 'song_media', 'incognito_sessions', 'incognito_events']) {
    assert.ok(!dropped.includes(kept), `${kept} is kept`);
  }
});
