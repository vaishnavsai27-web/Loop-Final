// Controllers: translate HTTP (req.valid, req.user) into service calls and
// shape the response. No SQL lives here except small read-only list queries;
// writes are in services/ and the database.
const auth = require('../services/authService');
const preferences = require('../services/preferenceService');
const catalog = require('../services/catalogService');
const rec = require('../services/recommendationService');
const moodParser = require('../services/moodParser');
const playback = require('../services/playbackService');
const feedback = require('../services/feedbackService');
const playlists = require('../services/playlistService');
const admin = require('../services/adminService');
const healthSvc = require('../services/healthService');
const { query, one } = require('../config/db');
const { toSong } = require('../services/songMapper');
const ApiError = require('../utils/ApiError');
const sessions = require('../services/sessionService');
const media = require('../services/mediaService');
const artistSvc = require('../services/artistService');
const { localMedia } = require('../providers');
const { setSessionCookies, clearSessionCookies } = require('../middleware/auth');

const b = (req) => (req.valid && req.valid.body) || {};
const q = (req) => (req.valid && req.valid.query) || {};
const p = (req) => (req.valid && req.valid.params) || {};
const actor = (req) => req.user.id;

// ---------------------------------------------------------------------------
const client = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });
/**
 * Browser: the session token goes only into the httpOnly cookie. API clients that
 * send `X-Auth-Mode: bearer` get the token in the body instead (no cookie).
 */
function sendSession(req, res, status, { session: s, user }) {
  const bearer = req.get('x-auth-mode') === 'bearer';
  if (!bearer) setSessionCookies(res, s);
  res.status(status).json({ user, csrfToken: bearer ? undefined : s.csrfToken, expiresAt: s.expiresAt, ...(bearer ? { token: s.token } : {}) });
}

async function meBody(req) {
  return { ...(await auth.profile(req.user.id)),
    session: { id: req.session.id, expiresAt: req.session.expiresAt, csrfToken: req.session.via === 'cookie' ? sessions.csrfFor(req.session.id) : undefined } };
}

exports.auth = {
  register: async (req, res) => sendSession(req, res, 201, await auth.register(b(req), client(req))),
  login: async (req, res) => sendSession(req, res, 200, await auth.login(b(req), client(req))),
  me: async (req, res) => res.json(await meBody(req)),
  session: async (req, res) => {
    if (req.user) return res.json({ authenticated: true, ...(await meBody(req)) });
    return res.json({ authenticated: false });
  },
  logout: async (req, res) => {
    const closed = await playback.closeOpenSessions(req.user.id);   // fold open listening into preferences
    await sessions.revoke(req.session.id, 'LOGOUT');
    clearSessionCookies(res);
    res.json({ ok: true, sessionsClosed: closed });
  },
  logoutAll: async (req, res) => {
    const revoked = await sessions.revokeAll(req.user.id, 'LOGOUT_ALL');
    clearSessionCookies(res);
    res.json({ ok: true, sessionsRevoked: revoked });
  },
};

exports.me = {
  sessions: async (req, res) => res.json(await sessions.list(req.user.id, req.session.id)),
  revokeSession: async (req, res) => {
    const id = p(req).sessionId;
    const own = await one('SELECT user_id FROM auth_sessions WHERE session_id = ?', [id]);
    if (!own || own.user_id !== req.user.id) throw ApiError.notFound('Session');
    await sessions.revoke(id, 'REVOKED_BY_USER');
    if (id === req.session.id) clearSessionCookies(res);
    res.json({ ok: true });
  },
  changePassword: async (req, res) => res.json(await auth.changePassword(req.user.id, req.session.id, b(req))),
  deleteAccount: async (req, res) => {
    await auth.deleteAccount(req.user.id, b(req));
    clearSessionCookies(res);
    res.json({ deleted: true });
  },
  preferenceOptions: async (req, res) => res.json(await preferences.options(req.user.id)),
  savePreferences: async (req, res) => {
    await preferences.save(req.user.id, b(req));
    res.json(await auth.profile(req.user.id));
  },
  updateSettings: async (req, res) => {
    await preferences.updateSettings(req.user.id, b(req));
    res.json(await auth.profile(req.user.id));
  },
};

// ---------------------------------------------------------------------------
exports.catalog = {
  songs: async (req, res) => res.json(await catalog.listSongs(req.user, q(req))),
  song: async (req, res) => res.json(await catalog.songDetail(req.user, p(req).id)),
  artist: async (req, res) => res.json(await catalog.artistDetail(req.user, p(req).id)),
  album: async (req, res) => res.json(await catalog.albumDetail(req.user, p(req).id)),
  genres: async (req, res) => res.json(await catalog.genreTree()),
  moods: async (req, res) => res.json(await catalog.moods()),
  contexts: async (req, res) => res.json(await catalog.contexts()),
  languages: async (req, res) => res.json(await catalog.languages()),
  search: async (req, res) => res.json(await catalog.search(req.user, q(req).q)),
  searchSuggest: async (req, res) => {
    const result = await catalog.search(req.user, q(req).q, { recordHistory: false });
    res.json({ songs: result.songs.slice(0, 5), artists: result.artists.slice(0, 3), moods: result.moods.slice(0, 3) });
  },
};

// ---------------------------------------------------------------------------
exports.rec = {
  mood: async (req, res) => res.json(await rec.forMood(req.user, b(req))),
  parse: async (req, res) => res.json(await moodParser.parse(b(req).text)),
  forYou: async (req, res) => res.json(await rec.daily(req.user, q(req))),
  similar: async (req, res) => {
    const r = await rec.similar(req.user, { seedSongId: q(req).seed, limit: q(req).limit });
    res.json(r || { strategy: 'SIMILAR', title: null, songs: [], empty: true,
      message: 'Like a song or rate it 4★ or more, and LOOP will find songs that sound like it.' });
  },
  batch: async (req, res) => res.json(await rec.getBatch(req.user, p(req).id)),
  history: async (req, res) => res.json(await rec.history(req.user, q(req).limit || 12)),
  /** GET /api/users/:id/recommendations — a user's personal mix (self, or users.manage). */
  forUser: async (req, res) => {
    const target = p(req).id;
    const u = target === req.user.id ? req.user : await targetUser(target);
    res.json(await rec.daily(u, q(req)));
  },
};

async function targetUser(userId) {
  const u = await one(
    `SELECT u.user_id AS id, up.region_code AS regionCode, up.content_filter AS contentFilter
       FROM users u JOIN user_profiles up USING (user_id) WHERE u.user_id = ? AND u.is_active = 1`, [userId]);
  if (!u) throw ApiError.notFound('User');
  return { ...u, permissions: new Set() };
}

// ---------------------------------------------------------------------------
exports.artist = {
  me: async (req, res) => res.json(await artistSvc.myProfile(req.user.id)),
  apply: async (req, res) => res.status(201).json(await artistSvc.apply(req.user.id, b(req))),
  updateProfile: async (req, res) => res.json(await artistSvc.updateProfile(req.user.id, p(req).id, b(req))),
  createUpload: async (req, res) => res.status(201).json(await artistSvc.createUploadIntent(req.user.id, req.ip, b(req))),
  uploadContent: async (req, res) => res.status(201).json(await artistSvc.storeUpload(req.user.id, p(req).id, req)),
  withdraw: async (req, res) => res.json(await artistSvc.withdrawUpload(req.user.id, p(req).id)),
  report: async (req, res) => res.status(201).json(await artistSvc.reportUpload(req.user.id, p(req).id, b(req))),
};

// ---------------------------------------------------------------------------
exports.playback = {
  start: async (req, res) => res.status(201).json(await playback.start(req.user, b(req))),
  finish: async (req, res) => res.json(await playback.finish(req.user, p(req).playId, b(req))),
  recent: async (req, res) => {
    const rows = await playback.recent(req.user, q(req).limit || 20);
    res.json(rows.map((r) => ({ ...toSong(r), playId: r.play_id, playedAt: r.started_at, listenedSec: r.listened_sec,
      completionPct: Number(r.completion_pct), completed: !!r.completed, skipped: !!r.skipped, origin: r.origin })));
  },
};

exports.feedback = {
  rate: async (req, res) => res.json(await feedback.rate(req.user, p(req).id, b(req).rating, 'upsert')),
  unrate: async (req, res) => res.json(await feedback.unrate(req.user, p(req).id)),
  like: async (req, res) => res.json(await feedback.like(req.user, p(req).id, b(req).liked)),
  dismiss: async (req, res) => res.json(await feedback.dismiss(req.user, p(req).id, b(req).batchId || null)),
  undismiss: async (req, res) => res.json(await feedback.undismiss(req.user, p(req).id)),
  dismissed: async (req, res) => {
    const rows = await feedback.dismissed(req.user);
    res.json(rows.map((r) => ({ ...toSong(r), dismissedAt: r.dismissed_at })));
  },
  liked: async (req, res) => {
    const rows = await query(
      `SELECT sc.*, ul.liked_at FROM user_likes ul JOIN v_song_catalog sc ON sc.song_id = ul.song_id
        WHERE ul.user_id = ? AND sc.status = 'ACTIVE' ORDER BY ul.liked_at DESC`, [req.user.id]);
    res.json(rows.map((r) => ({ ...toSong(r), liked: true, likedAt: r.liked_at })));
  },
};

// ---------------------------------------------------------------------------
exports.playlists = {
  list: async (req, res) => res.json(await playlists.list(req.user)),
  detail: async (req, res) => res.json(await playlists.detail(req.user, p(req).id)),
  create: async (req, res) => res.status(201).json(await playlists.create(req.user, b(req))),
  saveBatch: async (req, res) => res.status(201).json(await playlists.saveBatch(req.user, b(req))),
  update: async (req, res) => res.json(await playlists.update(req.user, p(req).id, b(req))),
  remove: async (req, res) => res.json(await playlists.remove(req.user, p(req).id)),
  addSong: async (req, res) => res.status(201).json(await playlists.addSong(req.user, p(req).id, b(req).songId)),
  removeSong: async (req, res) => res.json(await playlists.removeSong(req.user, p(req).id, p(req).songId)),
};

/**
 * GET /api/media/:id — streams a registered LOOP-owned audio file to a signed-in
 * user (HTTP range requests supported by sendFile). The content filter applies.
 */
exports.media = {
  stream: async (req, res) => {
    const f = await media.localFile(p(req).id, req.user);
    if (!playback.contentAllowed(req.user, f.song)) throw new ApiError(403, 'CONTENT_FILTERED', 'Your content filter hides this song.');
    // Uploads can be withdrawn or taken down for rights reasons; do not let caches outlive that.
    res.set('Cache-Control', f.song.source === 'ARTIST_UPLOAD' ? 'private, no-store' : 'private, max-age=300');
    res.type(f.type);
    await new Promise((resolve, reject) => res.sendFile(f.full, { acceptRanges: true, dotfiles: 'deny' }, (err) => (err && !res.headersSent ? reject(err) : resolve())));
  },
};

// ---------------------------------------------------------------------------
exports.admin = {
  overview: async (req, res) => res.json(await admin.overview()),
  permissionMatrix: async (req, res) => res.json(await admin.permissionMatrix()),
  health: async (req, res) => res.json({ ...(await healthSvc.health()), mediaStorage: localMedia.check() }),
  audit: async (req, res) => res.json(await admin.auditLog(q(req))),
  references: async (req, res) => res.json(await admin.references()),
  songs: async (req, res) => res.json(await admin.listSongs(q(req))),
  song: async (req, res) => res.json(await admin.songDetailAdmin(p(req).id)),
  createSong: async (req, res) => res.status(201).json(await admin.createSong(actor(req), b(req))),
  updateSong: async (req, res) => res.json(await admin.updateSong(actor(req), p(req).id, b(req))),
  deleteSong: async (req, res) => res.json(await admin.deleteSong(actor(req), p(req).id)),
  curateMood: async (req, res) => res.json(await admin.curateMood(actor(req), p(req).id, p(req).moodId, b(req))),
  clearCuration: async (req, res) => res.json(await admin.clearCuration(actor(req), p(req).id, p(req).moodId)),
  artists: async (req, res) => res.json(await admin.listArtists(q(req))),
  createArtist: async (req, res) => res.status(201).json(await admin.createArtist(actor(req), b(req))),
  updateArtist: async (req, res) => res.json(await admin.updateArtist(actor(req), p(req).id, b(req))),
  createAlbum: async (req, res) => res.status(201).json(await admin.createAlbum(actor(req), b(req))),
  users: async (req, res) => res.json(await admin.listUsers(q(req))),
  updateUser: async (req, res) => res.json(await admin.updateUser(actor(req), p(req).id, b(req))),
  media: async (req, res) => res.json({ summary: await media.summary(), storage: localMedia.check(), localFiles: localMedia.list() }),
  checkMedia: async (req, res) => res.json(await media.checkLocal()),
  registerMedia: async (req, res) => res.status(201).json(await media.registerLocal(p(req).id, b(req).fileName, b(req))),
  artistApplications: async (req, res) => res.json(await artistSvc.listApplications(q(req))),
  decideArtistApplication: async (req, res) => res.json(await artistSvc.decideApplication(actor(req), p(req).id, b(req).action, b(req).note)),
  artistUploads: async (req, res) => res.json(await artistSvc.listUploads(q(req))),
  decideArtistUpload: async (req, res) => res.json(await artistSvc.decideUpload(actor(req), p(req).id, b(req).action, b(req).note)),
  publishArtistUpload: async (req, res) => res.json(await artistSvc.publishUpload(actor(req), p(req).id)),
  scanArtistUpload: async (req, res) => res.json(await artistSvc.scanUpload(p(req).id, actor(req))),
  artistRightsReports: async (req, res) => res.json(await artistSvc.listRightsReports(q(req))),
  resolveArtistRightsReport: async (req, res) => res.json(await artistSvc.resolveRightsReport(actor(req), p(req).id, b(req).status, b(req).note)),
};
