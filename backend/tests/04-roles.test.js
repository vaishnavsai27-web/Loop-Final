// User / Artist / Admin boundaries, checked through the API (never the UI).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let admin;
before(async () => { await h.start(); admin = await h.adminLogin(); });
after(h.stop);

const ADMIN_READS = ['/admin/overview', '/admin/users', '/admin/songs', '/admin/permissions', '/admin/health',
  '/admin/artist-applications', '/admin/artist-uploads', '/admin/artist-rights-reports', '/admin/media', '/admin/audit'];

/** Register a user, apply for Artist access and have the Admin approve it. */
async function newArtist() {
  const u = await h.newUser({ onboard: false });
  const app = await h.api('POST', '/artist/applications', { token: u.token, body: { stageName: `Act ${h.uid()}`, bio: 'Original songs.' } });
  assert.equal(app.status, 201, JSON.stringify(app.body));
  const d = await h.api('POST', `/admin/artist-applications/${app.body.id}/decision`, { token: admin, body: { action: 'APPROVE' } });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  return { ...u, artistId: d.body.artistId };
}

test('a User cannot reach any Admin endpoint or Artist tools', async () => {
  const u = await h.newUser({ onboard: false });
  for (const p of ADMIN_READS) assert.equal((await h.api('GET', p, { token: u.token })).status, 403, p);
  assert.equal((await h.api('PATCH', `/admin/users/${u.id}`, { token: u.token, body: { role: 'ADMIN' } })).status, 403, 'cannot promote themself');
  assert.equal((await h.api('PATCH', '/artist/profiles/1', { token: u.token, body: { bio: 'x' } })).status, 403);
  assert.equal((await h.api('POST', '/artist/uploads/' + 'a'.repeat(32) + '/withdraw', { token: u.token })).status, 403);
});

test('anonymous requests to protected endpoints are 401', async () => {
  for (const p of ['/auth/me', '/likes', '/playlists', '/artist/me', ...ADMIN_READS]) assert.equal((await h.api('GET', p)).status, 401, p);
});

test('Artist access follows application → Admin approval; one pending application at a time', async () => {
  const u = await h.newUser({ onboard: false });
  const a1 = await h.api('POST', '/artist/applications', { token: u.token, body: { stageName: `Act ${h.uid()}` } });
  assert.equal(a1.status, 201);
  const a2 = await h.api('POST', '/artist/applications', { token: u.token, body: { stageName: 'Again' } });
  assert.equal(a2.status, 409);
  assert.equal((await h.api('GET', '/auth/me', { token: u.token })).body.role, 'LISTENER', 'still a User while pending');
  await h.api('POST', `/admin/artist-applications/${a1.body.id}/decision`, { token: admin, body: { action: 'APPROVE' } });
  const me = await h.api('GET', '/auth/me', { token: u.token });
  assert.equal(me.body.role, 'ARTIST', 'role read from the database on the next request');
  assert.ok(me.body.permissions.includes('artist.upload'));
  const again = await h.api('POST', `/admin/artist-applications/${a1.body.id}/decision`, { token: admin, body: { action: 'REJECT' } });
  assert.equal(again.status, 409, 'a decided application cannot be decided again');
});

test('an Artist manages only their own profile and cannot use Admin tools', async () => {
  const a = await newArtist();
  const ok = await h.api('PATCH', `/artist/profiles/${a.artistId}`, { token: a.token, body: { bio: 'New bio' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await h.one('SELECT bio FROM artists WHERE artist_id = ?', [a.artistId])).bio, 'New bio');
  const someoneElse = await h.one('SELECT artist_id FROM artists WHERE artist_id <> ? ORDER BY artist_id LIMIT 1', [a.artistId]);
  assert.equal((await h.api('PATCH', `/artist/profiles/${someoneElse.artist_id}`, { token: a.token, body: { bio: 'hijack' } })).status, 403);
  for (const p of ADMIN_READS) assert.equal((await h.api('GET', p, { token: a.token })).status, 403, p);
  const upload = 'b'.repeat(32);
  assert.equal((await h.api('POST', `/admin/artist-uploads/${upload}/decision`, { token: a.token, body: { action: 'APPROVE' } })).status, 403, 'cannot approve uploads');
  assert.equal((await h.api('POST', `/admin/artist-uploads/${upload}/publish`, { token: a.token })).status, 403, 'cannot publish uploads');
  const studio = await h.api('GET', '/artist/me', { token: a.token });
  assert.equal(studio.status, 200);
  assert.equal(studio.body.artists[0].id, a.artistId);
  assert.equal(typeof studio.body.uploadsEnabled, 'boolean');
});

test('upload intents are validated on the server', async () => {
  const a = await newArtist();
  const genre = await h.one('SELECT genre_id FROM genres ORDER BY genre_id LIMIT 1');
  const base = { artistId: a.artistId, title: 'First Song', genreId: genre.genre_id, durationSec: 200, releaseYear: 2026,
    fileSize: 1000, mimeType: 'audio/mpeg', compositionRights: 'OWNED', recordingRights: 'OWNED', rightsAccepted: true };
  assert.equal((await h.api('POST', '/artist/uploads', { token: a.token, body: { ...base, durationSec: 5 } })).status, 400, 'too short');
  assert.equal((await h.api('POST', '/artist/uploads', { token: a.token, body: { ...base, fileSize: 999999999 } })).status, 400, 'too large');
  const other = await h.one('SELECT artist_id FROM artists WHERE artist_id <> ? ORDER BY artist_id LIMIT 1', [a.artistId]);
  const foreign = await h.api('POST', '/artist/uploads', { token: a.token, body: { ...base, artistId: other.artist_id } });
  assert.ok([403, 404].includes(foreign.status), 'cannot upload as another artist');
  const unaccepted = await h.api('POST', '/artist/uploads', { token: a.token, body: { ...base, rightsAccepted: false } });
  assert.ok(unaccepted.status >= 400, 'rights declaration is required');
});

test('Admin cannot be granted from the console, and the last Admin cannot lock themself out', async () => {
  const u = await h.newUser({ onboard: false });
  const r = await h.api('PATCH', `/admin/users/${u.id}`, { token: admin, body: { role: 'ADMIN' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'ADMIN_PROVISIONING_ONLY');
  const noArtist = await h.api('PATCH', `/admin/users/${u.id}`, { token: admin, body: { role: 'ARTIST' } });
  assert.equal(noArtist.status, 409, 'Artist needs an approved application');
  const adminId = (await h.one("SELECT user_id FROM users WHERE username = 'admin'")).user_id;
  const self = await h.api('PATCH', `/admin/users/${adminId}`, { token: admin, body: { role: 'LISTENER' } });
  assert.equal(self.status, 409);
});

test('an Admin can demote an Artist back to User; their Artist tools stop working at once', async () => {
  const a = await newArtist();
  assert.equal((await h.api('PATCH', `/admin/users/${a.id}`, { token: admin, body: { role: 'LISTENER' } })).status, 200);
  assert.equal((await h.api('PATCH', `/artist/profiles/${a.artistId}`, { token: a.token, body: { bio: 'x' } })).status, 403);
});

test('the permission matrix has exactly three roles and Admin alone reviews artists', async () => {
  const m = await h.api('GET', '/admin/permissions', { token: admin });
  assert.deepEqual(m.body.roles.map((r) => r.code).sort(), ['ADMIN', 'ARTIST', 'LISTENER']);
  const by = Object.fromEntries(m.body.roles.map((r) => [r.code, r.permissions]));
  assert.ok(by.ADMIN.includes('artist.review'));
  assert.ok(!by.ARTIST.includes('artist.review'));
  assert.ok(!by.LISTENER.includes('artist.upload'));
});
