// Guarantees that live in the database itself (constraints, triggers, procedures),
// tested directly through the least-privilege application account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);

const code = (errno) => (e) => e.errno === errno;

test('CHECK constraints reject impossible values', async () => {
  const s = await h.activeSong();
  await assert.rejects(h.query('UPDATE audio_features SET energy = 1.5 WHERE song_id = ? AND is_current = 1', [s.song_id]), code(3819));
  await assert.rejects(h.query('UPDATE audio_features SET tempo_bpm = 400 WHERE song_id = ? AND is_current = 1', [s.song_id]), code(3819));
  await assert.rejects(h.query("UPDATE songs SET explicit = 1, content_rating = 'ALL' WHERE song_id = ?", [s.song_id]), code(3819));
  await assert.rejects(h.query("UPDATE users SET email = 'not-an-email' WHERE username = 'varsha'"), code(3819));
});

test('foreign keys protect referenced rows', async () => {
  const s = await h.activeSong();
  await assert.rejects(h.query('DELETE FROM artists WHERE artist_id = ?', [s.primary_artist_id]), code(1451));
  await assert.rejects(h.query('INSERT INTO song_genres (song_id, genre_id, is_primary) VALUES (?, 65000, 0)', [s.song_id]), code(1452));
});

test('audio analysis is versioned: exactly one current version per song, switchable atomically', async () => {
  const s = await h.one('SELECT song_id FROM audio_features GROUP BY song_id HAVING COUNT(*) >= 2 LIMIT 1');
  const versions = await h.query('SELECT feature_id, is_current FROM audio_features WHERE song_id = ? ORDER BY feature_id', [s.song_id]);
  const cur = versions.find((v) => v.is_current);
  const old = versions.find((v) => !v.is_current);
  await assert.rejects(h.query('UPDATE audio_features SET is_current = 1 WHERE feature_id = ?', [old.feature_id]), code(1062));
  try {
    await h.query('CALL sp_set_current_audio_features(?)', [old.feature_id]);
    const now = await h.query('SELECT feature_id FROM audio_features WHERE song_id = ? AND is_current = 1', [s.song_id]);
    assert.deepEqual(now.map((r) => r.feature_id), [old.feature_id]);
  } finally {
    await h.query('CALL sp_set_current_audio_features(?)', [cur.feature_id]);
  }
  assert.equal((await h.one('SELECT COUNT(*) AS n FROM audio_features WHERE song_id = ?', [s.song_id])).n, versions.length, 'old versions kept');
});

test('mood segments must stay inside the song and may not overlap', async () => {
  const seg = await h.one('SELECT song_id, model_id, start_sec, end_sec, mood_id FROM mood_segments ORDER BY segment_id LIMIT 1');
  const dur = (await h.one('SELECT duration_sec FROM songs WHERE song_id = ?', [seg.song_id])).duration_sec;
  await assert.rejects(h.query(
    `INSERT INTO mood_segments (song_id, model_id, segment_index, start_sec, end_sec, mood_id, confidence, energy, valence)
     VALUES (?, ?, 99, ?, ?, ?, 0.5, 0.5, 0.5)`, [seg.song_id, seg.model_id, seg.start_sec, seg.end_sec, seg.mood_id]), /may not overlap/);
  await assert.rejects(h.query(
    `INSERT INTO mood_segments (song_id, model_id, segment_index, start_sec, end_sec, mood_id, confidence, energy, valence)
     VALUES (?, ?, 98, ?, ?, ?, 0.5, 0.5, 0.5)`, [seg.song_id, seg.model_id, dur - 1, dur + 30, seg.mood_id]), /after the song ends/);
});

test('preferences decay with age: old plays fade from short-term faster than from long-term', async () => {
  const u = await h.newUser({ onboard: false });
  const [a, b] = await h.query(`SELECT s.song_id, s.duration_sec, sg.genre_id FROM songs s JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
                                 WHERE s.status = 'ACTIVE' AND sg.genre_id <> (SELECT genre_id FROM song_genres WHERE song_id = 1 AND is_primary = 1)
                                 ORDER BY s.song_id LIMIT 1`).then(async (x) => [x[0],
    await h.one(`SELECT s.song_id, s.duration_sec, sg.genre_id FROM songs s JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
                  WHERE s.song_id = 1`)]);
  // a play 30 days ago (inserted with its real timestamp), and a play now through the API
  const sess = await h.query(`INSERT INTO listening_sessions (user_id, started_at, last_activity_at, ended_at, status, plays, listen_sec)
                               VALUES (?, NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 30 DAY, 'CLOSED', 1, ?)`, [u.id, a.duration_sec]);
  await h.query(`INSERT INTO listening_history (session_id, user_id, song_id, started_at, ended_at, listened_sec, origin)
                 VALUES (?, ?, ?, NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 30 DAY, ?, 'HOME')`, [sess.insertId, u.id, a.song_id, a.duration_sec]);
  await h.makePlayable(b.song_id);
  await h.play(u.token, b.song_id, b.duration_sec);
  const rows = await h.query('SELECT genre_id, short_term_score AS st, long_term_score AS lt FROM user_genre_preferences WHERE user_id = ? AND genre_id IN (?, ?)',
    [u.id, a.genre_id, b.genre_id]);
  const old = rows.find((r) => r.genre_id === a.genre_id);
  const recent = rows.find((r) => r.genre_id === b.genre_id);
  assert.ok(Number(old.st) < Number(recent.st) * 0.2, `short-term: 30-day-old play mostly faded (${old.st} vs ${recent.st})`);
  assert.ok(Number(old.lt) > Number(recent.lt) * 0.6, `long-term: still remembered (${old.lt} vs ${recent.lt})`);
});

test('trend snapshots are idempotent by hour key and cover 24H / 7D / 30D', async () => {
  const maintenance = require('../src/services/maintenanceService');
  const key = `trend:test:${h.uid()}`;
  const first = await maintenance.runTrendSnapshot({ key });
  assert.equal(first.status, 'COMPLETED');
  const again = await maintenance.runTrendSnapshot({ key });
  assert.equal(again.reused, true, 'the same key never produces a second snapshot');
  const windows = await h.query('SELECT DISTINCT window_code FROM trend_snapshots WHERE job_id = ? ORDER BY window_code', [first.jobId]);
  assert.deepEqual(windows.map((w) => w.window_code).sort(), ['24H', '30D', '7D']);
});

test('migration 0017 retired feature objects and kept user-authored rows in the archive', async () => {
  const gone = await h.query(`SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME IN ('weekly_worlds','world_archetypes','mood_diary_entries','song_lyrics','song_mood_ratings','song_apple_music','v_muse_world_summary')`);
  assert.deepEqual(gone, []);
  assert.ok(await h.one("SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'retired_feature_archive'"));
  const cand = await h.one('SELECT COUNT(*) AS n FROM v_recommendation_candidates');
  const analysed = await h.one(`SELECT COUNT(*) AS n FROM songs s WHERE s.status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM audio_features af WHERE af.song_id = s.song_id AND af.is_current = 1)
    AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.song_id AND sg.is_primary = 1)`);
  assert.equal(Number(cand.n), Number(analysed.n), 'candidates are the whole analysed catalogue, not only songs with audio');
});

test('stored functions behave as documented', async () => {
  const f = await h.one(`SELECT fn_completion_pct(90, 180) AS half, fn_completion_pct(500, 180) AS capped,
                                fn_decay(7, 7) AS one_half_life, fn_week_start('2026-10-10') AS wk,
                                fn_normalize_text('  Vennela   Kurise! ') AS norm`);
  assert.equal(Number(f.half), 50);
  assert.equal(Number(f.capped), 100);
  assert.ok(Math.abs(f.one_half_life - 0.5) < 1e-9);
  assert.equal(f.wk instanceof Date ? f.wk.toISOString().slice(0, 10) : String(f.wk).slice(0, 10), '2026-10-05');
  assert.equal(f.norm, 'vennela kurise');
});
