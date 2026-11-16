// Runs against an EMPTY catalogue (no songs, artists, plays or users; reference
// data only). Started by `npm run db:verify`, which builds that database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers');

let base;
let user;
before(async () => {
  base = await h.start();
  const n = await h.one('SELECT COUNT(*) AS n FROM songs');
  if (n.n !== 0) throw new Error('tests/empty must run against an empty catalogue (npm run db:verify)');
});
after(h.stop);

test('readiness on an empty catalogue: ready, zero songs', async () => {
  const r = await fetch(`${base}/ready`);
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.deepEqual(body.catalogue, { activeSongs: 0, playableSongs: 0 });
});

test('the first account can register and save preferences with no music in the catalogue', async () => {
  user = await h.newUser({ onboard: false });
  const opts = await h.api('GET', '/me/preferences', { token: user.token });
  assert.equal(opts.status, 200);
  assert.ok(opts.body.languages.length > 0);
  assert.ok(opts.body.moods.length > 0);
  assert.deepEqual(opts.body.artists, []);
  const langs = opts.body.languages.slice(0, 2).map((l) => l.id);
  const o = await h.api('PUT', '/me/preferences', { token: user.token, body: { languageIds: langs } });
  assert.equal(o.status, 200, JSON.stringify(o.body));
});

test('search and every recommendation return honest empty results, not errors', async () => {
  const list = await h.api('GET', '/songs', { token: user.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 0);
  const s = await h.api('GET', '/search?q=calm', { token: user.token });
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.songs, []);
  const mood = await h.api('POST', '/recommendations/mood', { token: user.token, body: { text: 'something calm for studying' } });
  assert.equal(mood.status, 200, JSON.stringify(mood.body));
  assert.deepEqual(mood.body.songs, []);
  assert.equal(mood.body.coverage.complete, false);
  assert.match(mood.body.coverage.message, /no songs that fit/);
  const forYou = await h.api('GET', '/recommendations/for-you', { token: user.token });
  assert.equal(forYou.status, 200, JSON.stringify(forYou.body));
  assert.deepEqual(forYou.body.songs, []);
  const sim = await h.api('GET', '/recommendations/similar', { token: user.token });
  assert.equal(sim.status, 200);
  assert.equal(sim.body.empty, true);
});

test('library pages cope with no music', async () => {
  for (const p of ['/playlists', '/likes', '/history', '/me/dismissals', '/recommendations/history']) {
    const r = await h.api('GET', p, { token: user.token });
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`);
  }
});
