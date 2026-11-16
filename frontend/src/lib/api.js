// Thin fetch wrapper. Every call goes to LOOP's Express API (/api/...), which
// reads and writes LOOP's MySQL database. Nothing is faked in the browser.
//
// Authentication: the session lives in an httpOnly cookie that page scripts
// cannot read. State-changing requests also send the CSRF token from the
// readable `muse_csrf` cookie (double-submit, verified server-side).

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(name, source) {
  const all = source !== undefined ? source : (typeof document !== 'undefined' ? document.cookie : '');
  for (const part of String(all || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function buildHeaders(method, hasBody, cookieSource) {
  const headers = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (!SAFE.has(method)) {
    const csrf = readCookie('muse_csrf', cookieSource);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

export const qs = (o = {}) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
const QUIET_401 = new Set(['/auth/session', '/auth/login', '/auth/register']);

export async function request(method, path, body, { timeoutMs = 15000, raw = null, headers: extra = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let text;
  try {
    const hasBody = body !== undefined && raw === null;
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...buildHeaders(method, hasBody), ...extra },
      body: raw !== null ? raw : hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (err && err.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'LOOP took too long to answer. Try again in a moment.');
    throw new ApiError(0, 'NETWORK', 'LOOP’s server can’t be reached. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const fallback = res.status >= 500 ? 'LOOP’s server had a problem. Try again in a moment.' : 'That request could not be completed.';
    const e = data && data.error ? data.error : { code: `HTTP_${res.status}`, message: fallback };
    if (res.status === 401 && !QUIET_401.has(path)) onUnauthorized(e);
    throw new ApiError(res.status, e.code, e.message || fallback, e.details);
  }
  return data;
}

const get = (p, q) => request('GET', p + qs(q));
const post = (p, b = {}) => request('POST', p, b);
const put = (p, b = {}) => request('PUT', p, b);
const patch = (p, b = {}) => request('PATCH', p, b);
const del = (p, b) => request('DELETE', p, b);

export const api = {
  // auth
  session: () => get('/auth/session'),
  login: (login, password) => post('/auth/login', { login, password }),
  register: (body) => post('/auth/register', body),
  logout: () => post('/auth/logout'),
  logoutAll: () => post('/auth/logout-all'),

  // reference data
  moods: () => get('/moods'),
  contexts: () => get('/contexts'),
  languages: () => get('/languages'),
  genres: () => get('/genres'),

  // discovery
  recommend: (body) => post('/recommendations/mood', body),
  parseMood: (text) => post('/recommendations/parse', { text }),
  forYou: (limit = 12) => get('/recommendations/for-you', { limit }),
  similar: (seed, limit = 12) => get('/recommendations/similar', { seed, limit }),
  batch: (id) => get(`/recommendations/batches/${id}`),
  moodHistory: (limit = 12) => get('/recommendations/history', { limit }),

  // catalogue
  search: (q) => get('/search', { q }),
  song: (id) => get(`/songs/${id}`),
  artist: (id) => get(`/artists/${id}`),
  album: (id) => get(`/albums/${id}`),

  // feedback
  like: (id, liked) => put(`/songs/${id}/like`, { liked }),
  rate: (id, rating) => put(`/songs/${id}/rating`, { rating }),
  unrate: (id) => del(`/songs/${id}/rating`),
  dismiss: (id, batchId) => put(`/songs/${id}/dismiss`, batchId ? { batchId } : {}),
  undismiss: (id) => del(`/songs/${id}/dismiss`),
  likes: () => get('/likes'),
  dismissals: () => get('/me/dismissals'),

  // library
  playlists: () => get('/playlists'),
  playlist: (id) => get(`/playlists/${id}`),
  createPlaylist: (body) => post('/playlists', body),
  saveMix: (batchId, name) => post('/playlists/from-batch', { batchId, name }),
  renamePlaylist: (id, body) => patch(`/playlists/${id}`, body),
  deletePlaylist: (id) => del(`/playlists/${id}`),
  addToPlaylist: (id, songId) => post(`/playlists/${id}/songs`, { songId }),
  removeFromPlaylist: (id, songId) => del(`/playlists/${id}/songs/${songId}`),

  // playback
  startPlay: (songId, origin, batchId) => post('/playback/start', { songId, origin, ...(batchId ? { batchId } : {}) }),
  finishPlay: (playId, listenedSec) => post(`/playback/${playId}/finish`, { listenedSec }),
  history: (limit = 20) => get('/history', { limit }),

  // account
  me: () => get('/auth/me'),
  preferences: () => get('/me/preferences'),
  savePreferences: (body) => put('/me/preferences', body),
  updateSettings: (body) => patch('/me/settings', body),
  sessions: () => get('/me/sessions'),
  revokeSession: (id) => del(`/me/sessions/${id}`),
  changePassword: (currentPassword, newPassword) => post('/me/password', { currentPassword, newPassword }),
  deleteAccount: (password) => del('/me', { password, confirm: 'DELETE' }),

  // artist
  artistMe: () => get('/artist/me'),
  applyArtist: (body) => post('/artist/applications', body),
  updateArtistProfile: (id, body) => patch(`/artist/profiles/${id}`, body),
  createUpload: (body) => post('/artist/uploads', body),
  uploadContent: (id, file) => request('PUT', `/artist/uploads/${id}/content`, undefined,
    { raw: file, timeoutMs: 120000, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
  withdrawUpload: (id) => post(`/artist/uploads/${id}/withdraw`),

  // admin
  admin: {
    overview: () => get('/admin/overview'),
    health: () => get('/admin/health'),
    permissions: () => get('/admin/permissions'),
    audit: (q) => get('/admin/audit', q),
    references: () => get('/admin/references'),
    songs: (q) => get('/admin/songs', q),
    song: (id) => get(`/admin/songs/${id}`),
    createSong: (body) => post('/admin/songs', body),
    updateSong: (id, body) => patch(`/admin/songs/${id}`, body),
    deleteSong: (id) => del(`/admin/songs/${id}`),
    curateMood: (id, moodId, body) => put(`/admin/songs/${id}/moods/${moodId}`, body),
    artists: (q) => get('/admin/artists', { q }),
    createArtist: (body) => post('/admin/artists', body),
    users: (q) => get('/admin/users', { q }),
    updateUser: (id, body) => patch(`/admin/users/${id}`, body),
    applications: (status) => get('/admin/artist-applications', { status }),
    decideApplication: (id, action, note) => post(`/admin/artist-applications/${id}/decision`, { action, ...(note ? { note } : {}) }),
    uploads: (status) => get('/admin/artist-uploads', { status }),
    scanUpload: (id) => post(`/admin/artist-uploads/${id}/scan`),
    decideUpload: (id, action, note) => post(`/admin/artist-uploads/${id}/decision`, { action, ...(note ? { note } : {}) }),
    publishUpload: (id) => post(`/admin/artist-uploads/${id}/publish`),
    reports: (status) => get('/admin/artist-rights-reports', { status }),
    resolveReport: (id, status, note) => post(`/admin/artist-rights-reports/${id}/decision`, { status, ...(note ? { note } : {}) }),
    media: () => get('/admin/media'),
    checkMedia: () => post('/admin/media/check'),
    registerMedia: (songId, body) => post(`/admin/songs/${songId}/media`, body),
  },
};
