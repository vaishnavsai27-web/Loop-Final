// The core journey: mood input → recommendations → explanations → feedback.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { isRelevant } = require('../src/utils/recommendationLogic');

before(h.start);
after(h.stop);

const moodId = async (name) => (await h.one('SELECT mood_id FROM moods WHERE name = ?', [name])).mood_id;

test('selected moods produce a ranked, explained list from LOOP’s own catalogue', async () => {
  const u = await h.newUser();
  const calm = await moodId('Calm');
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: [calm], limit: 15 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.batchId > 0);
  assert.ok(r.body.songs.length > 0, 'the seeded catalogue has calm songs');
  assert.ok(r.body.songs.length <= 15);
  r.body.songs.forEach((s, i) => {
    assert.ok(Number.isInteger(s.rank) && s.rank >= i + 1, 'rank is present');
    assert.ok(s.reasons.length > 0, `“${s.title}” explains why it fits`);
    assert.ok(typeof s.playback.playable === 'boolean');
  });
  const ranks = r.body.songs.map((s) => s.rank);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, 'returned in rank order');
  assert.equal(r.body.interpretation.moods[0].name, 'Calm');
  assert.ok(r.body.interpretation.summary.find((x) => x.label === 'Energy'));
  // every song is a real catalogue row
  const ids = r.body.songs.map((s) => s.id);
  const found = await h.query("SELECT COUNT(*) AS n FROM songs WHERE song_id IN (?) AND status = 'ACTIVE'", [ids]);
  assert.equal(Number(found[0].n), ids.length);
});

test('free text is interpreted with LOOP’s lexicon, and the list honours it', async () => {
  const u = await h.newUser();
  const parse = await h.api('POST', '/recommendations/parse', { token: u.token, body: { text: 'I feel calm and want something to study to' } });
  assert.equal(parse.status, 200);
  assert.ok(parse.body.moods.some((m) => m.name === 'Calm'));
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { text: 'I feel calm and want something to study to' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.strategy, 'TEXT');
  assert.ok(r.body.interpretation.parse.moods.length > 0);
});

test('text with no recognisable mood is a clear 422 with suggestions, not a made-up list', async () => {
  const u = await h.newUser();
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { text: 'qwzx plorb' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'MOOD_NOT_UNDERSTOOD');
  assert.ok(Array.isArray(r.body.error.details.suggestions));
  const empty = await h.api('POST', '/recommendations/mood', { token: u.token, body: {} });
  assert.equal(empty.status, 400);
});

test('only relevant songs are returned; coverage says when fewer fit than were asked for', async () => {
  const u = await h.newUser();
  const ids = await Promise.all(['Calm', 'Energetic', 'Romantic', 'Nostalgic'].map(moodId));
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: ids, limit: 50 } });
  assert.equal(r.status, 200);
  const items = await h.query('SELECT song_id, mood_score, audio_score, final_score FROM recommendation_items WHERE batch_id = ?', [r.body.batchId]);
  const shown = new Set(r.body.songs.map((s) => s.id));
  for (const it of items) assert.equal(shown.has(it.song_id), isRelevant(it), `song ${it.song_id} shown only if relevant`);
  assert.equal(r.body.coverage.matched, r.body.songs.length);
  if (r.body.songs.length < 50) {
    assert.equal(r.body.coverage.complete, false);
    assert.match(r.body.coverage.message, /LOOP’s catalogue/);
  }
});

test('a listening context steers the list; unknown contexts are rejected', async () => {
  const u = await h.newUser();
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: [await moodId('Calm')], contextCode: 'STUDY' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.context.code, 'STUDY');
  const bad = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: [await moodId('Calm')], contextCode: 'NOPE' } });
  assert.equal(bad.status, 400);
});

test('“Not interested” removes a song from future lists until undone', async () => {
  const u = await h.newUser();
  const body = { moodIds: [await moodId('Happy')], limit: 20 };
  const first = await h.api('POST', '/recommendations/mood', { token: u.token, body });
  const target = first.body.songs[0];
  assert.equal((await h.api('PUT', `/songs/${target.id}/dismiss`, { token: u.token, body: { batchId: first.body.batchId } })).status, 200);
  const second = await h.api('POST', '/recommendations/mood', { token: u.token, body });
  assert.ok(!second.body.songs.some((s) => s.id === target.id), 'dismissed song never comes back');
  const list = await h.api('GET', '/me/dismissals', { token: u.token });
  assert.ok(list.body.some((s) => s.id === target.id));
  assert.equal((await h.api('DELETE', `/songs/${target.id}/dismiss`, { token: u.token })).status, 200);
});

test('mood requests are kept: history lists them and a list can be reopened only by its owner', async () => {
  const u = await h.newUser();
  const other = await h.newUser();
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { text: 'feeling nostalgic tonight' } });
  assert.equal(r.status, 200);
  const hist = await h.api('GET', '/recommendations/history', { token: u.token });
  assert.equal(hist.body[0].id, r.body.batchId);
  assert.equal(hist.body[0].inputText, 'feeling nostalgic tonight');
  const again = await h.api('GET', `/recommendations/batches/${r.body.batchId}`, { token: u.token });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.songs.map((s) => s.id), r.body.songs.map((s) => s.id), 'stored scores, same list');
  assert.equal((await h.api('GET', `/recommendations/batches/${r.body.batchId}`, { token: other.token })).status, 404);
});

test('explore similar starts from a seed song and never returns the seed', async () => {
  const u = await h.newUser();
  const seed = await h.activeSong();
  const r = await h.api('GET', `/recommendations/similar?seed=${seed.song_id}&limit=10`, { token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.seed.id, seed.song_id);
  assert.ok(!r.body.songs.some((s) => s.id === seed.song_id));
  assert.equal((await h.api('GET', '/recommendations/similar?seed=99999999', { token: u.token })).status, 404);
});

test('the personal mix works for a new user and for their own id only', async () => {
  const u = await h.newUser();
  const other = await h.newUser();
  const mine = await h.api('GET', '/recommendations/for-you?limit=10', { token: u.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.songs.length > 0);
  assert.equal((await h.api('GET', `/users/${u.id}/recommendations`, { token: u.token })).status, 200);
  assert.equal((await h.api('GET', `/users/${other.id}/recommendations`, { token: u.token })).status, 403);
});

test('songs without LOOP audio are recommended as unavailable, never as playable', async () => {
  const u = await h.newUser();
  const r = await h.api('POST', '/recommendations/mood', { token: u.token, body: { moodIds: [await moodId('Calm')], limit: 30 } });
  for (const s of r.body.songs) {
    const media = await h.one('SELECT 1 AS ok FROM v_song_playback WHERE song_id = ?', [s.id]);
    assert.equal(s.playback.playable, !!media, `“${s.title}” playable only with registered audio`);
  }
  assert.equal(r.body.playableCount, r.body.songs.filter((s) => s.playback.playable).length);
});

test('recommendation endpoints need a session', async () => {
  assert.equal((await h.api('POST', '/recommendations/mood', { body: { moodIds: [1] } })).status, 401);
  assert.equal((await h.api('GET', '/recommendations/history')).status, 401);
});
