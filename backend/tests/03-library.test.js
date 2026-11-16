// Likes, ratings, saved mixes, playlists, playback of LOOP-owned audio and history.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);

test('like and unlike a song; the liked list is per user', async () => {
  const u = await h.newUser();
  const other = await h.newUser();
  const s = await h.activeSong();
  assert.equal((await h.api('PUT', `/songs/${s.song_id}/like`, { token: u.token, body: { liked: true } })).status, 200);
  assert.ok((await h.api('GET', '/likes', { token: u.token })).body.some((x) => x.id === s.song_id));
  assert.ok(!(await h.api('GET', '/likes', { token: other.token })).body.some((x) => x.id === s.song_id), 'not visible to others');
  assert.equal((await h.api('PUT', `/songs/${s.song_id}/like`, { token: u.token, body: { liked: false } })).status, 200);
  assert.ok(!(await h.api('GET', '/likes', { token: u.token })).body.some((x) => x.id === s.song_id));
  assert.equal((await h.api('PUT', '/songs/99999999/like', { token: u.token, body: { liked: true } })).status, 404);
});

test('ratings are validated, stored and removable', async () => {
  const u = await h.newUser();
  const s = await h.activeSong();
  assert.equal((await h.api('PUT', `/songs/${s.song_id}/rating`, { token: u.token, body: { rating: 6 } })).status, 400);
  assert.equal((await h.api('PUT', `/songs/${s.song_id}/rating`, { token: u.token, body: { rating: 4 } })).status, 200);
  assert.equal((await h.one('SELECT rating FROM ratings WHERE user_id = ? AND song_id = ?', [u.id, s.song_id])).rating, 4);
  assert.equal((await h.api('DELETE', `/songs/${s.song_id}/rating`, { token: u.token })).status, 200);
  assert.equal(await h.one('SELECT rating FROM ratings WHERE user_id = ? AND song_id = ?', [u.id, s.song_id]), null);
});

test('a recommendation list saves as a playlist with exactly the songs that were shown', async () => {
  const u = await h.newUser();
  const calm = (await h.one("SELECT mood_id FROM moods WHERE name = 'Calm'")).mood_id;
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: [calm], limit: 12 } });
  const dismissed = r.body.songs[1];
  await h.api('PUT', `/songs/${dismissed.id}/dismiss`, { token: u.token, body: {} });
  const p = await h.api('POST', '/playlists/from-batch', { token: u.token, body: { batchId: r.body.batchId, name: `Calm ${h.uid()}` } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.kind, 'SAVED_MIX');
  const expected = r.body.songs.filter((s) => s.id !== dismissed.id).map((s) => s.id);
  assert.deepEqual(p.body.songs.map((s) => s.id), expected);
  const other = await h.newUser();
  assert.equal((await h.api('POST', '/playlists/from-batch', { token: other.token, body: { batchId: r.body.batchId, name: 'Stolen' } })).status, 404);
});

test('playlists: create, add, duplicate add, rename, remove song, delete; owner only', async () => {
  const u = await h.newUser();
  const other = await h.newUser();
  const s = await h.activeSong();
  const p = await h.api('POST', '/playlists', { token: u.token, body: { name: `Mine ${h.uid()}` } });
  assert.equal(p.status, 201);
  const id = p.body.id;
  assert.equal((await h.api('POST', `/playlists/${id}/songs`, { token: u.token, body: { songId: s.song_id } })).status, 201);
  const dup = await h.api('POST', `/playlists/${id}/songs`, { token: u.token, body: { songId: s.song_id } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DUPLICATE_PLAYLIST_SONG');
  assert.equal((await h.api('GET', `/playlists/${id}`, { token: other.token })).status, 404, 'private to its owner');
  assert.equal((await h.api('POST', `/playlists/${id}/songs`, { token: other.token, body: { songId: s.song_id } })).status, 404);
  const renamed = await h.api('PATCH', `/playlists/${id}`, { token: u.token, body: { name: 'Renamed' } });
  assert.equal(renamed.body.name, 'Renamed');
  assert.equal(renamed.body.songCount, 1, 'song count maintained by the database');
  assert.equal((await h.api('DELETE', `/playlists/${id}/songs/${s.song_id}`, { token: u.token })).status, 200);
  assert.equal((await h.api('DELETE', `/playlists/${id}`, { token: u.token })).status, 200);
  assert.equal((await h.api('GET', `/playlists/${id}`, { token: u.token })).status, 404);
});

test('a song without LOOP audio cannot be played; a registered recording can, and goes into history', async () => {
  const u = await h.newUser();
  const meta = await h.metadataOnlySong();
  const refused = await h.api('POST', '/playback/start', { token: u.token, body: { songId: meta.song_id } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'NO_PLAYBACK_SOURCE');

  const s = await h.playableSong();
  const start = await h.api('POST', '/playback/start', { token: u.token, body: { songId: s.song_id, origin: 'MOOD' } });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  assert.match(start.body.media.uri, /^\/api\/media\/\d+$/, 'streams from LOOP’s own API only');
  const fin = await h.api('POST', `/playback/${start.body.playId}/finish`, { token: u.token, body: { listenedSec: s.duration_sec } });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.completed, true);
  const hist = await h.api('GET', '/history?limit=1', { token: u.token });
  assert.equal(hist.body[0].id, s.song_id);
  const other = await h.newUser();
  assert.equal((await h.api('POST', `/playback/${start.body.playId}/finish`, { token: other.token, body: { listenedSec: 5 } })).status, 404, 'cannot touch another user’s play');
});

test('audio streams only to signed-in users', async () => {
  const s = await h.playableSong();
  const media = await h.one('SELECT media_id FROM v_song_playback WHERE song_id = ?', [s.song_id]);
  assert.equal((await h.api('GET', `/media/${media.media_id}`)).status, 401);
  const u = await h.newUser();
  const res = await h.api('GET', `/media/${media.media_id}`, { token: u.token });
  assert.equal(res.status, 200);
});

test('search finds catalogue songs, artists and moods; injection is plain text', async () => {
  const u = await h.newUser();
  const r = await h.api('GET', '/search?q=calm', { token: u.token });
  assert.equal(r.status, 200);
  assert.ok(r.body.moods.some((m) => m.name === 'Calm'));
  const weird = await h.api('GET', `/search?q=${encodeURIComponent("' OR 1=1 --")}`, { token: u.token });
  assert.equal(weird.status, 200);
  const none = await h.api('GET', '/search?q=xyzzyplugh', { token: u.token });
  assert.equal(none.body.total, 0);
});
