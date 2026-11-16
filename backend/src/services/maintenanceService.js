// Background housekeeping used by the scheduler and by Admin → System health.
//   * close idle listening sessions so preferences are folded in
//   * hourly trend snapshot (feeds the "trending" signal of the recommender)
// Each trend run is a pipeline_jobs row keyed by the hour, so several API
// instances or restarts never produce duplicate snapshots.
const { query, one, call } = require('../config/db');
const runner = require('./jobRunner');

async function runTrendSnapshot({ requestedBy = null, key = null } = {}) {
  const hourKey = (await one("SELECT DATE_FORMAT(NOW(), '%Y-%m-%dT%H') AS h")).h;
  const { job } = await runner.createJob({ type: 'TREND_SNAPSHOT', key: key || `trend:${hourKey}`, requestedBy });
  if (job.status !== 'DISCOVERED') return { jobId: job.job_id, status: job.status, reused: true };
  const { job: done } = await runner.run(job.job_id, async (j) => {
    await runner.setStatus(j.job_id, 'PROCESSING');
    const sets = await call('sp_generate_trend_snapshot', [j.job_id]);
    const rows = sets[0] || [];
    await runner.log(j.job_id, 'INFO', 'TREND_ANALYSIS', `Snapshot written: ${rows.map((r) => `${r.window_code}/${r.entity_type}=${r.entities}`).join(', ')}`);
    return { entities: rows.reduce((s, r) => s + Number(r.entities), 0) };
  });
  return { jobId: done.job_id, status: done.status };
}

async function closeIdleSessions(idleMinutes) {
  const idle = await query("SELECT session_id FROM listening_sessions WHERE status = 'OPEN' AND last_activity_at < NOW() - INTERVAL ? MINUTE", [idleMinutes]);
  for (const s of idle) await call('sp_close_listening_session', [s.session_id]);
  return idle.length;
}

module.exports = { runTrendSnapshot, closeIdleSessions };
