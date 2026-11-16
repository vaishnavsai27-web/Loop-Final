// Admin console operations against the real database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let admin;
before(async () => { await h.start(); admin = await h.adminLogin(); });
after(h.stop);

test('overview reports the queues an Admin acts on', async () => {
  const r = await h.api('GET', '/admin/overview', { token: admin });
  assert.equal(r.status, 200);
  for (const k of ['active_songs', 'playable_songs', 'users', 'pending_artist_applications', 'uploads_in_review', 'open_rights_reports', 'mood_requests_7d']) {
    assert.ok(k in r.body, k);
  }
});

test('a song added with audio features is analysed, tagged with moods and recommendable', async () => {
  const refs = await h.api('GET', '/admin/references', { token: admin });
  const artist = refs.body.artists[0];
  const genre = refs.body.genres[0];
  const title = `Test Calm ${h.uid()}`;
  const r = await h.api('POST', '/admin/songs', { token: admin, body: {
    title, artistId: artist.id, genreId: genre.id, durationSec: 210, releaseYear: 2026,
    features: { energy: 0.22, valence: 0.55, danceability: 0.3, acousticness: 0.75, instrumentalness: 0.5, speechiness: 0.04, tempo_bpm: 80 },
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'ACTIVE');
  assert.ok(r.body.moodsDetailed.length > 0, 'the active mood model tagged it');
  assert.ok(await h.one('SELECT 1 AS ok FROM v_recommendation_candidates WHERE song_id = ?', [r.body.id]));
  const noFeatures = await h.api('POST', '/admin/songs', { token: admin, body: { title: `${title} B`, artistId: artist.id, genreId: genre.id, durationSec: 200, releaseYear: 2026 } });
  assert.equal(noFeatures.body.status, 'PENDING_ANALYSIS', 'without features a song waits and is never recommended');
  assert.equal(await h.one('SELECT 1 AS ok FROM v_recommendation_candidates WHERE song_id = ?', [noFeatures.body.id]), null);
});

test('hiding a song removes it from search and recommendations; activating brings it back', async () => {
  const s = await h.activeSong();
  const u = await h.newUser();
  assert.equal((await h.api('PATCH', `/admin/songs/${s.song_id}`, { token: admin, body: { status: 'HIDDEN' } })).status, 200);
  try {
    assert.equal((await h.api('GET', `/songs/${s.song_id}`, { token: u.token })).status, 404);
    assert.equal(await h.one('SELECT 1 AS ok FROM v_recommendation_candidates WHERE song_id = ?', [s.song_id]), null);
  } finally {
    await h.api('PATCH', `/admin/songs/${s.song_id}`, { token: admin, body: { status: 'ACTIVE' } });
  }
  assert.equal((await h.api('GET', `/songs/${s.song_id}`, { token: u.token })).status, 200);
});

test('mood curation is stored, audited and re-applied by the mood model', async () => {
  const s = await h.activeSong();
  const mood = await h.one("SELECT mood_id FROM moods WHERE name = 'Romantic'");
  const r = await h.api('PUT', `/admin/songs/${s.song_id}/moods/${mood.mood_id}`, { token: admin, body: { action: 'ADD', confidence: 0.9 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.curations.some((c) => c.id === mood.mood_id));
  assert.ok(await h.one("SELECT 1 AS ok FROM audit_logs WHERE action = 'MOOD_CURATED' AND entity_id = ?", [String(s.song_id)]));
  assert.equal((await h.api('DELETE', `/admin/songs/${s.song_id}/moods/${mood.mood_id}`, { token: admin })).status, 200);
});

test('registering LOOP audio needs a real file in the media folder', async () => {
  const s = await h.metadataOnlySong();
  const bad = await h.api('POST', `/admin/songs/${s.song_id}/media`, { token: admin, body: { fileName: 'not-there.mp3' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'LOCAL_FILE_NOT_FOUND');
  const traversal = await h.api('POST', `/admin/songs/${s.song_id}/media`, { token: admin, body: { fileName: '../etc/passwd' } });
  assert.equal(traversal.status, 400);
  await h.makePlayable(s.song_id);
  const media = await h.api('GET', '/admin/media', { token: admin });
  assert.equal(media.body.storage.state, 'ready');
});

test('deactivating a user signs them out everywhere and reactivation restores access', async () => {
  const u = await h.newUser({ onboard: false });
  assert.equal((await h.api('PATCH', `/admin/users/${u.id}`, { token: admin, body: { isActive: false } })).status, 200);
  assert.equal((await h.api('GET', '/auth/me', { token: u.token })).status, 401);
  assert.equal((await h.api('PATCH', `/admin/users/${u.id}`, { token: admin, body: { isActive: true } })).status, 200);
  assert.equal((await h.api('POST', '/auth/login', { body: { login: u.username, password: 'Testpass1' } })).status, 200);
});

test('system health reports integrity checks without secrets', async () => {
  const r = await h.api('GET', '/admin/health', { token: admin });
  assert.equal(r.status, 200);
  assert.ok(r.body.integrity.length > 0);
  assert.ok(r.body.mediaStorage.state);
  const text = JSON.stringify(r.body);
  for (const k of ['DB_APP_PASSWORD', 'SESSION_SECRET', 'DB_OWNER_PASSWORD']) if (process.env[k]) assert.ok(!text.includes(process.env[k]), `${k} leaked`);
});
