// Every route: authentication → authorisation → input validation → controller.
// Validation schemas are declared next to the route so the contract is visible.
// Roles never come from the request: req.user (role + permissions) is re-read
// from the database for every request by middleware/auth.js.
const express = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers');
const h = require('../utils/asyncHandler');
const { requireAuth, optionalAuth, requirePermission, requireSelfOr } = require('../middleware/auth');
const { rules: r, optional: opt, validate: v, idParam } = require('../utils/validate');
const { nodeEnv, rateLimits } = require('../config/env');

const router = express.Router();
const id = idParam('id');
const limitQ = { limit: opt(r.int(1, 50)) };
const can = requirePermission;

// Failed sign-in / registration attempts per client IP per 15 minutes (successful ones
// are not counted). Per-account lockout (5 wrong passwords) is separate, in authService.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: nodeEnv === 'test' ? 1000 : rateLimits.authFailuresPer15Min, skipSuccessfulRequests: true,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts from this network. Wait a few minutes.' } },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, limit: nodeEnv === 'test' ? 5000 : rateLimits.writesPerMinute, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Slow down a little and try again.' } },
});

// ---------------------------------------------------------------- auth (public)
// Ordinary registration always creates a User (LISTENER). Artist access comes from
// an approved application; Admin access only from `npm run admin:provision`.
const PASSWORD = r.str(8, 72, /^(?=.*[A-Za-z])(?=.*\d).+$/, 'needs at least one letter and one number');
router.post('/auth/register', loginLimiter, v({
  username: r.str(3, 30, /^[a-z0-9_]+$/, 'may use lowercase letters, digits and _ only'),
  email: r.email(),
  password: PASSWORD,
  displayName: r.str(1, 60),
}), h(c.auth.register));
router.post('/auth/login', loginLimiter, v({ login: r.str(3, 120), password: r.str(1, 72) }), h(c.auth.login));
router.get('/auth/session', optionalAuth, h(c.auth.session));

// ---------------------------------------------------------------- catalogue & reference data
const listQ = {
  genreId: opt(r.int(1, 65535)), moodId: opt(r.int(1, 65535)), languageId: opt(r.int(0, 65535)),
  page: opt(r.int(1, 1000), 1), pageSize: opt(r.int(1, 60), 24), sort: opt(r.oneOf(['popular', 'newest', 'title']), 'popular'),
};
router.get('/moods', optionalAuth, h(c.catalog.moods));
router.get('/contexts', optionalAuth, h(c.catalog.contexts));
router.get('/genres', optionalAuth, h(c.catalog.genres));
router.get('/languages', optionalAuth, h(c.catalog.languages));
router.get('/songs', optionalAuth, v(listQ, 'query'), h(c.catalog.songs));
router.get('/songs/:id', optionalAuth, id, h(c.catalog.song));
router.get('/artists/:id', optionalAuth, id, h(c.catalog.artist));
router.get('/albums/:id', optionalAuth, id, h(c.catalog.album));
router.get('/search/suggest', optionalAuth, v({ q: r.str(2, 80) }, 'query'), h(c.catalog.searchSuggest));
router.get('/search', optionalAuth, v({ q: r.str(1, 80) }, 'query'), h(c.catalog.search));

// ---------------------------------------------------------------- everything below needs a session
router.use(requireAuth);
router.use((req, res, next) => (req.method === 'GET' ? next() : writeLimiter(req, res, next)));

router.get('/auth/me', h(c.auth.me));
router.post('/auth/logout', h(c.auth.logout));
router.post('/auth/logout-all', h(c.auth.logoutAll));

// ---------------------------------------------------------------- account & preferences
const idList = (max) => r.arrayOf(r.int(1, 2 ** 31), max);
router.get('/me/sessions', h(c.me.sessions));
router.delete('/me/sessions/:sessionId', v({ sessionId: r.str(16, 16, /^[0-9a-f]{16}$/) }, 'params'), h(c.me.revokeSession));
router.post('/me/password', v({ currentPassword: r.str(1, 72), newPassword: PASSWORD }), h(c.me.changePassword));
router.delete('/me', v({ password: r.str(1, 72), confirm: r.oneOf(['DELETE']) }), h(c.me.deleteAccount));
router.get('/me/preferences', h(c.me.preferenceOptions));
router.put('/me/preferences', v({
  languageIds: r.arrayOf(r.int(1, 65535), 5, 1),
  regionCode: opt(r.str(2, 6, /^[A-Z]{2}(-[A-Z]{2,3})?$/)),
  genreIds: opt(idList(6), []),
  artistIds: opt(idList(8), []),
  moodIds: opt(idList(5), []),
  contextCodes: opt(r.arrayOf(r.str(2, 20, /^[A-Z_]+$/), 4), []),
  listeningHabit: opt(r.oneOf(['BACKGROUND', 'ACTIVE', 'MIXED'])),
  contentFilter: opt(r.oneOf(['OFF', 'NO_EXPLICIT', 'FAMILY'])),
}), h(c.me.savePreferences));
router.patch('/me/settings', v({
  displayName: opt(r.str(1, 60)),
  contentFilter: opt(r.oneOf(['OFF', 'NO_EXPLICIT', 'FAMILY'])),
}), h(c.me.updateSettings));

// ---------------------------------------------------------------- mood recommendations (the core journey)
router.post('/recommendations/mood', v({
  moodIds: opt(r.arrayOf(r.int(1, 65535), 4), []),
  moodWeights: opt(r.arrayOf(r.object({ moodId: r.int(1, 65535), weight: r.decimal(0.01, 100, 2) }), 4, 1)),
  text: opt(r.str(2, 280)),
  contextCode: opt(r.str(2, 20, /^[A-Z_]+$/)),
  limit: opt(r.int(1, 50), 20),
}), h(c.rec.mood));
router.post('/recommendations/parse', v({ text: r.str(1, 280) }), h(c.rec.parse));
router.get('/recommendations/for-you', v(limitQ, 'query'), h(c.rec.forYou));
router.get('/recommendations/similar', v({ seed: opt(r.int(1, 2 ** 31)), ...limitQ }, 'query'), h(c.rec.similar));
router.get('/recommendations/batches/:id', id, h(c.rec.batch));
router.get('/recommendations/history', v(limitQ, 'query'), h(c.rec.history));

// ---------------------------------------------------------------- feedback
router.put('/songs/:id/rating', id, v({ rating: r.int(1, 5) }), h(c.feedback.rate));
router.delete('/songs/:id/rating', id, h(c.feedback.unrate));
router.put('/songs/:id/like', id, v({ liked: r.bool() }), h(c.feedback.like));
router.get('/likes', h(c.feedback.liked));
router.put('/songs/:id/dismiss', id, v({ batchId: opt(r.int(1, 2 ** 53)) }), h(c.feedback.dismiss));
router.delete('/songs/:id/dismiss', id, h(c.feedback.undismiss));
router.get('/me/dismissals', h(c.feedback.dismissed));

// ---------------------------------------------------------------- library: saved mixes and playlists
router.get('/playlists', h(c.playlists.list));
router.post('/playlists', v({ name: r.str(1, 80), description: opt(r.str(0, 255)), songIds: opt(r.arrayOf(r.int(1, 2 ** 31), 200), []) }), h(c.playlists.create));
router.post('/playlists/from-batch', v({ batchId: r.int(1, 2 ** 53), name: r.str(1, 80), description: opt(r.str(0, 255)) }), h(c.playlists.saveBatch));
router.get('/playlists/:id', id, h(c.playlists.detail));
router.patch('/playlists/:id', id, v({ name: opt(r.str(1, 80)), description: opt(r.str(0, 255)) }), h(c.playlists.update));
router.delete('/playlists/:id', id, h(c.playlists.remove));
router.post('/playlists/:id/songs', id, v({ songId: r.int(1, 2 ** 31) }), h(c.playlists.addSong));
router.delete('/playlists/:id/songs/:songId', v({ id: r.int(1, 2 ** 31), songId: r.int(1, 2 ** 31) }, 'params'), h(c.playlists.removeSong));

// ---------------------------------------------------------------- playback (LOOP-owned audio only) & history
const ORIGIN = r.oneOf(['HOME', 'MOOD', 'SEARCH', 'PLAYLIST', 'LIBRARY']);
router.post('/playback/start', v({ songId: r.int(1, 2 ** 31), origin: opt(ORIGIN, 'MOOD'), batchId: opt(r.int(1, 2 ** 53)) }), h(c.playback.start));
router.post('/playback/:playId/finish', v({ playId: r.int(1, 2 ** 53) }, 'params'), v({
  listenedSec: r.int(0, 1800), positionSec: opt(r.int(0, 1800)),
}), h(c.playback.finish));
router.get('/history', v(limitQ, 'query'), h(c.playback.recent));
router.get('/media/:id', id, h(c.media.stream));

// ---------------------------------------------------------------- artist access & studio
const uploadId = v({ id: r.str(32, 32, /^[a-f0-9]{32}$/) }, 'params');
router.get('/artist/me', h(c.artist.me));
router.post('/artist/applications', v({
  stageName: r.str(1, 100), artistType: opt(r.oneOf(['SOLO', 'GROUP', 'COMPOSER', 'ORCHESTRA']), 'SOLO'),
  countryCode: opt(r.str(2, 2, /^[A-Z]{2}$/), 'IN'), bio: opt(r.str(0, 400)),
  websiteUrl: opt(r.str(9, 255, /^https:\/\//i)), proofUrl: opt(r.str(9, 500, /^https:\/\//i)),
}), h(c.artist.apply));
router.patch('/artist/profiles/:id', can('artist.studio'), id, v({
  name: opt(r.str(1, 100)), artistType: opt(r.oneOf(['SOLO', 'GROUP', 'COMPOSER', 'ORCHESTRA'])),
  bio: opt(r.str(0, 400)), formedYear: opt(r.int(1900, 2100)),
}), h(c.artist.updateProfile));
router.post('/artist/uploads', can('artist.upload'), v({
  artistId: r.int(1, 2 ** 31), title: r.str(1, 150), versionLabel: opt(r.str(0, 40), ''),
  genreId: r.int(1, 65535), languageId: opt(r.int(1, 65535)), durationSec: r.int(30, 1800),
  releaseYear: r.int(1900, 2100), explicit: opt(r.bool(), false), fileSize: r.int(1, 52428800),
  mimeType: r.str(1, 100), compositionRights: r.oneOf(['OWNED', 'LICENSED', 'PUBLIC_DOMAIN']),
  recordingRights: r.oneOf(['OWNED', 'LICENSED', 'PUBLIC_DOMAIN']),
  rightsEvidenceRef: opt(r.str(9, 500, /^https:\/\//i)),
  territories: opt(r.arrayOf(r.str(2, 10, /^(WORLDWIDE|[A-Z]{2})$/), 50, 1), ['WORLDWIDE']),
  licenceStart: opt(r.date()), licenceEnd: opt(r.date()), royaltySharePct: opt(r.decimal(0, 100, 2), 0),
  royaltyCurrency: opt(r.str(3, 3, /^[A-Z]{3}$/), 'INR'), rightsAccepted: r.bool(),
}), h(c.artist.createUpload));
router.put('/artist/uploads/:id/content', can('artist.upload'), uploadId, h(c.artist.uploadContent));
router.post('/artist/uploads/:id/withdraw', can('artist.upload'), uploadId, h(c.artist.withdraw));
router.post('/artist/uploads/:id/reports', uploadId, v({
  reportType: r.oneOf(['COPYRIGHT', 'IMPERSONATION', 'EXPLICIT_CONTENT', 'MISLABELLED', 'SAFETY', 'OTHER']),
  details: r.str(10, 2000), evidenceRef: opt(r.str(9, 500, /^https:\/\//i)),
}), h(c.artist.report));

// ---------------------------------------------------------------- admin console
const A = express.Router();
const HEX = r.hex();
const UNIT = r.num(0, 1);
const FEATURES = r.object({
  energy: UNIT, valence: UNIT, danceability: UNIT, acousticness: UNIT, instrumentalness: UNIT, speechiness: UNIT,
  tempo_bpm: r.num(40, 220), loudness_db: opt(r.num(-60, 0), -8), key: opt(r.int(0, 11), 0), mode: opt(r.int(0, 1), 1),
});
const ISRC = r.str(12, 12, /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/, 'must be a 12-character ISRC like INABC2600001');
A.get('/overview', can('health.view'), h(c.admin.overview));
A.get('/permissions', can('health.view'), h(c.admin.permissionMatrix));
A.get('/health', can('health.view'), h(c.admin.health));
A.get('/audit', can('audit.view'), v({ entityType: opt(r.str(1, 30, /^[a-z_]+$/), null), limit: opt(r.int(1, 200), 50) }, 'query'), h(c.admin.audit));
A.get('/references', can('catalog.write'), h(c.admin.references));
A.get('/songs', can('catalog.write'), v({ q: opt(r.str(0, 80), ''), status: opt(r.oneOf(['ACTIVE', 'PENDING_ANALYSIS', 'HIDDEN', 'MERGED'])),
  page: opt(r.int(1, 1000), 1), pageSize: opt(r.int(1, 100), 25) }, 'query'), h(c.admin.songs));
A.get('/songs/:id', can('catalog.write'), id, h(c.admin.song));
A.post('/songs', can('catalog.write'), v({
  title: r.str(1, 150), versionLabel: opt(r.str(0, 40), ''), artistId: r.int(1, 2 ** 31), albumId: opt(r.int(1, 2 ** 31)),
  trackNumber: opt(r.int(1, 99)), genreId: r.int(1, 65535), durationSec: r.int(30, 1800), releaseYear: r.int(1900, 2100),
  languageId: opt(r.int(1, 65535)), isrc: opt(ISRC),
  explicit: opt(r.bool(), false), contentRating: opt(r.oneOf(['ALL', 'TEEN', 'MATURE']), 'ALL'), popularity: opt(r.int(0, 100), 50),
  features: opt(FEATURES),
}), h(c.admin.createSong));
A.patch('/songs/:id', can('catalog.write'), id, v({
  title: opt(r.str(1, 150)), versionLabel: opt(r.str(0, 40)), albumId: opt(r.int(1, 2 ** 31)), durationSec: opt(r.int(30, 1800)),
  releaseYear: opt(r.int(1900, 2100)), languageId: opt(r.int(1, 65535)), isrc: opt(ISRC),
  explicit: opt(r.bool()), contentRating: opt(r.oneOf(['ALL', 'TEEN', 'MATURE'])), popularity: opt(r.int(0, 100)),
  status: opt(r.oneOf(['ACTIVE', 'HIDDEN'])), genreId: opt(r.int(1, 65535)), features: opt(FEATURES),
}), h(c.admin.updateSong));
A.delete('/songs/:id', can('catalog.write'), id, h(c.admin.deleteSong));
A.put('/songs/:id/moods/:moodId', can('catalog.write'), v({ id: r.int(1, 2 ** 31), moodId: r.int(1, 65535) }, 'params'),
  v({ action: r.oneOf(['ADD', 'REMOVE']), confidence: opt(r.num(0.05, 1)), note: opt(r.str(0, 200)) }), h(c.admin.curateMood));
A.delete('/songs/:id/moods/:moodId', can('catalog.write'), v({ id: r.int(1, 2 ** 31), moodId: r.int(1, 65535) }, 'params'), h(c.admin.clearCuration));
A.get('/artists', can('catalog.write'), v({ q: opt(r.str(0, 80), '') }, 'query'), h(c.admin.artists));
A.post('/artists', can('catalog.write'), v({
  name: r.str(1, 100), disambiguation: opt(r.str(0, 80), ''), type: opt(r.oneOf(['SOLO', 'GROUP', 'COMPOSER', 'ORCHESTRA']), 'SOLO'),
  countryCode: opt(r.str(2, 2, /^[A-Z]{2}$/), 'IN'), regionCode: opt(r.str(2, 6, /^[A-Z]{2}(-[A-Z]{2,3})?$/)),
  languageId: opt(r.int(1, 65535)), formedYear: opt(r.int(1900, 2100)), bio: opt(r.str(0, 400)), aliases: opt(r.arrayOf(r.str(1, 100), 10), []),
}), h(c.admin.createArtist));
A.patch('/artists/:id', can('catalog.write'), id, v({
  name: opt(r.str(1, 100)), disambiguation: opt(r.str(0, 80)), type: opt(r.oneOf(['SOLO', 'GROUP', 'COMPOSER', 'ORCHESTRA'])),
  regionCode: opt(r.str(2, 6, /^[A-Z]{2}(-[A-Z]{2,3})?$/)), languageId: opt(r.int(1, 65535)), formedYear: opt(r.int(1900, 2100)), bio: opt(r.str(0, 400)),
}), h(c.admin.updateArtist));
A.post('/albums', can('catalog.write'), v({
  title: r.str(1, 150), albumType: opt(r.oneOf(['ALBUM', 'EP', 'SINGLE', 'SOUNDTRACK', 'COMPILATION']), 'ALBUM'),
  releaseYear: r.int(1900, 2100), languageId: opt(r.int(1, 65535)),
  coverColor1: HEX, coverColor2: HEX, artistIds: r.arrayOf(r.int(1, 2 ** 31), 6, 1),
}), h(c.admin.createAlbum));
A.get('/users', can('users.manage'), v({ q: opt(r.str(0, 80), '') }, 'query'), h(c.admin.users));
// ADMIN is accepted only so an existing admin row validates; granting it is refused in adminService.
A.patch('/users/:id', can('users.manage'), id, v({ role: opt(r.oneOf(['LISTENER', 'ARTIST', 'ADMIN'])), isActive: opt(r.bool()) }), h(c.admin.updateUser));
// LOOP-owned media management; no external providers or catalogue links.
A.get('/media', can('catalog.write'), h(c.admin.media));
A.post('/media/check', can('catalog.write'), h(c.admin.checkMedia));
A.post('/songs/:id/media', can('catalog.write'), id, v({
  fileName: r.str(1, 121, /^[A-Za-z0-9][A-Za-z0-9._-]*$/), rights: opt(r.oneOf(['PERMITTED', 'ATTRIBUTION_REQUIRED']), 'PERMITTED'),
  attribution: opt(r.str(0, 200), null),
}), h(c.admin.registerMedia));
// Artist onboarding and rights review is separate from catalogue curation.
A.get('/artist-applications', can('artist.review'), v({ status: opt(r.oneOf(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'ALL']), 'PENDING'), limit: opt(r.int(1, 200), 100) }, 'query'), h(c.admin.artistApplications));
A.post('/artist-applications/:id/decision', can('artist.review'), id, v({ action: r.oneOf(['APPROVE', 'REJECT']), note: opt(r.str(0, 500)) }), h(c.admin.decideArtistApplication));
A.get('/artist-uploads', can('artist.review'), v({ status: opt(r.oneOf(['UPLOADING', 'QUARANTINED', 'PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'TAKEN_DOWN', 'PROCESSING_FAILED', 'ALL']), 'PENDING_REVIEW'), limit: opt(r.int(1, 200), 100) }, 'query'), h(c.admin.artistUploads));
A.post('/artist-uploads/:id/scan', can('artist.review'), uploadId, h(c.admin.scanArtistUpload));
A.post('/artist-uploads/:id/decision', can('artist.review'), uploadId, v({ action: r.oneOf(['APPROVE', 'REJECT']), note: opt(r.str(0, 500)) }), h(c.admin.decideArtistUpload));
A.post('/artist-uploads/:id/publish', can('artist.review'), uploadId, h(c.admin.publishArtistUpload));
A.get('/artist-rights-reports', can('artist.review'), v({ status: opt(r.oneOf(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ALL']), 'OPEN'), limit: opt(r.int(1, 200), 100) }, 'query'), h(c.admin.artistRightsReports));
A.post('/artist-rights-reports/:id/decision', can('artist.review'), id, v({ status: r.oneOf(['UNDER_REVIEW', 'RESOLVED', 'DISMISSED']), note: opt(r.str(0, 500)) }), h(c.admin.resolveArtistRightsReport));

router.use('/admin', A);

// Kept for API clients: another user's personal mix needs users.manage.
router.get('/users/:id/recommendations', id, requireSelfOr('users.manage'), v(limitQ, 'query'), h(c.rec.forUser));

module.exports = router;
