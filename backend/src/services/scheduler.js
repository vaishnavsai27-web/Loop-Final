// In-process scheduler. Every task is idempotent, so restarts or several API
// instances are safe (trend jobs are keyed by the hour in pipeline_jobs).
//   every minute  close idle listening sessions
//   every hour    trend snapshot; delete sign-in sessions that ended more than
//                 30 days ago; re-check registered local media files
const { jobs } = require('../config/env');
const maintenance = require('./maintenanceService');
const sessions = require('./sessionService');
const media = require('./mediaService');
const { localMedia } = require('../providers');

const timers = [];
let busy = false;

async function guarded(name, fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (err) { console.error(`[scheduler] ${name}:`, err.sqlMessage || err.message); } finally { busy = false; }
}

async function minutely() {
  const closed = await maintenance.closeIdleSessions(jobs.sessionIdleMinutes);
  if (closed) console.log(`[scheduler] closed ${closed} idle listening sessions`);
}

async function hourly() {
  const purged = await sessions.purgeEnded(30);
  if (purged) console.log(`[scheduler] purged ${purged} ended sign-in sessions`);
  if (localMedia.check().state !== 'disabled') {
    const m = await media.checkLocal();
    if (m.unavailable) console.log(`[scheduler] ${m.unavailable} registered local media file(s) missing`);
  }
  await maintenance.runTrendSnapshot({});
}

function start() {
  timers.push(setInterval(() => guarded('minutely', minutely), 60 * 1000));
  timers.push(setInterval(() => guarded('hourly', hourly), 60 * 60 * 1000));
  setTimeout(() => guarded('startup', async () => { await minutely(); await hourly(); }), 3000).unref();
  timers.forEach((t) => t.unref());
  console.log('Background scheduler started (listening sessions, sign-in session purge, media check, trends)');
}

function stop() { timers.splice(0).forEach(clearInterval); }

module.exports = { start, stop, minutely, hourly };
