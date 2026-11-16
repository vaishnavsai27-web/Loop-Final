// Recommendation orchestration. SCORING happens in MySQL
// (sp_generate_recommendations). This service:
//   1. turns the request (moods, text, context, seed, language...) into a
//      target sound profile and weighted moods,
//   2. stores that as a recommendation_batches row + its moods,
//   3. runs the engine in the SAME transaction (batch + items + reasons are
//      atomic: either the whole list exists or none of it does),
//   4. shapes the stored scores and reasons for the API.
const { query, one, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { toSong, withUserFlags } = require('./songMapper');
const moodParser = require('./moodParser');
const { weightedMoods, recommendationEvidence, relevantItems } = require('../utils/recommendationLogic');

const SIGNALS = [
  ['mood', 'mood_score', 'w_mood', 'Mood match'],
  ['audio', 'audio_score', 'w_audio', 'Sound match'],
  ['preference', 'preference_score', 'w_preference', 'Your taste'],
  ['recency', 'recency_score', 'w_recency', 'Recent listening'],
  ['trend', 'trend_score', 'w_trend', 'Trending'],
  ['context', 'context_score', 'w_context', 'Context fit'],
  ['regional', 'regional_score', 'w_regional', 'Language & region'],
  ['exploration', 'exploration_score', 'w_exploration', 'Novelty'],
];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
const profileOf = (r) => ({
  energy: r.target_energy, valence: r.target_valence, danceability: r.target_danceability, acousticness: r.target_acousticness,
  instrumentalness: r.target_instrumentalness, tempoMin: r.tempo_min, tempoMax: r.tempo_max, maxSpeechiness: r.max_speechiness ?? 1,
});

async function moodRows(ids) {
  return ids.length ? query('SELECT * FROM moods WHERE mood_id IN (?)', [ids]) : [];
}

function blend(rows, weightOf) {
  const total = rows.reduce((s, r) => s + weightOf(r), 0) || 1;
  const avg = (k) => rows.reduce((s, r) => s + Number(r[k]) * weightOf(r), 0) / total;
  return {
    energy: avg('target_energy'), valence: avg('target_valence'), danceability: avg('target_danceability'),
    acousticness: avg('target_acousticness'), instrumentalness: avg('target_instrumentalness'),
    tempoMin: avg('tempo_min'), tempoMax: avg('tempo_max'), maxSpeechiness: 1,
  };
}

/** Feelings and activity share energy/valence; the activity decides texture. */
function withContext(moodProfile, ctx) {
  const c = profileOf(ctx);
  if (!moodProfile) return c;
  return { ...c, energy: (moodProfile.energy + c.energy) / 2, valence: (moodProfile.valence + c.valence) / 2 };
}

function normalise(t) {
  const o = {
    energy: r3(clamp01(t.energy)), valence: r3(clamp01(t.valence)), danceability: r3(clamp01(t.danceability)),
    acousticness: r3(clamp01(t.acousticness)), instrumentalness: r3(clamp01(t.instrumentalness)),
    tempoMin: Math.round(Math.max(40, t.tempoMin)), tempoMax: Math.round(Math.min(220, t.tempoMax)),
    maxSpeechiness: r3(clamp01(t.maxSpeechiness ?? 1)),
  };
  if (o.tempoMax <= o.tempoMin) o.tempoMax = Math.min(220, o.tempoMin + 10);
  return o;
}

const level = (x) => (x < 0.35 ? 'Low' : x < 0.65 ? 'Medium' : 'High');
function describe(t) {
  const mid = (t.tempoMin + t.tempoMax) / 2;
  return [
    { label: 'Energy', value: level(t.energy), score: t.energy },
    { label: 'Positivity', value: t.valence < 0.35 ? 'Dark' : t.valence < 0.6 ? 'Neutral' : 'Positive', score: t.valence },
    { label: 'Tempo', value: `${mid < 90 ? 'Slow' : mid < 120 ? 'Medium' : 'Fast'} · ${t.tempoMin}–${t.tempoMax} BPM`, score: null },
    { label: 'Instrumental', value: level(t.instrumentalness), score: t.instrumentalness },
    { label: 'Acoustic', value: level(t.acousticness), score: t.acousticness },
    { label: 'Danceable', value: level(t.danceability), score: t.danceability },
  ];
}

/** The user's own average sound from completed plays (used by the personal mix). */
async function tasteProfile(userId) {
  const r = await one(
    `SELECT COUNT(*) AS n, AVG(af.energy) AS energy, AVG(af.valence) AS valence, AVG(af.danceability) AS danceability,
            AVG(af.acousticness) AS acousticness, AVG(af.instrumentalness) AS instrumentalness, AVG(af.tempo_bpm) AS tempo,
            STDDEV_POP(af.tempo_bpm) AS tempo_sd
       FROM listening_history lh JOIN audio_features af ON af.song_id = lh.song_id AND af.is_current = 1
      WHERE lh.user_id = ? AND lh.completed = 1 AND lh.started_at >= NOW() - INTERVAL 30 DAY`, [userId]);
  if (!r || r.n < 3) return null;
  const spread = Math.max(15, Math.min(30, Number(r.tempo_sd) || 20));
  return normalise({ ...r, tempoMin: r.tempo - spread, tempoMax: r.tempo + spread, maxSpeechiness: 1 });
}

async function topMoodPrefs(userId, n = 3) {
  const rows = await query(
    `SELECT ump.mood_id AS moodId, m.name, ump.blended_score AS weight FROM user_mood_preferences ump
       JOIN moods m ON m.mood_id = ump.mood_id WHERE ump.user_id = ? AND ump.blended_score > 0
      ORDER BY ump.blended_score DESC LIMIT ?`, [userId, n]);
  const top = rows[0]?.weight || 1;
  return rows.map((r) => ({ ...r, weight: Math.max(0.1, r.weight / top) }));
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
/** Insert the batch + its moods and run the engine on the given transaction. */
async function runInTx(tx, user, { strategy, label, inputText = null, contextId = null, seedSongId = null, languageId = null,
  targets, moods, discoveryOnly = false, limit = 20 }) {
  const res = await tx.query(
    `INSERT INTO recommendation_batches
      (user_id, model_id, strategy, label, input_text, context_id, seed_song_id, language_id,
       target_energy, target_valence, target_danceability, target_acousticness, target_instrumentalness,
       tempo_min, tempo_max, max_speechiness, discovery_only)
     VALUES (?, fn_active_model('RECOMMENDER'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, strategy, label, inputText, contextId, seedSongId, languageId,
      targets.energy, targets.valence, targets.danceability, targets.acousticness, targets.instrumentalness,
      targets.tempoMin, targets.tempoMax, targets.maxSpeechiness, discoveryOnly ? 1 : 0]);
  const batchId = res.insertId;
  for (const m of moods) {
    await tx.query('INSERT INTO recommendation_batch_moods (batch_id, mood_id, weight) VALUES (?, ?, ?)',
      [batchId, m.moodId, Math.max(0.01, Math.min(1, Math.round(m.weight * 100) / 100))]);
  }
  const sets = await tx.call('sp_generate_recommendations', [batchId, limit]);
  return { batchId, rows: sets[sets.length - 1] || [] };
}

/**
 * Batch + items + reasons are atomic: either the whole list exists or none of it does.
 * READ COMMITTED: the scoring INSERT … SELECT then reads listening history,
 * preferences and catalogue as a consistent snapshot WITHOUT shared row locks
 * (under REPEATABLE READ it locked ~2,700 source rows and two lists generated
 * at once for the same listener deadlocked — see docs/CONCURRENCY.md, case 4).
 * Each list writes only its own new batch rows, so nothing is lost by this.
 */
async function createAndRun(user, opts) {
  return withTransaction((tx) => runInTx(tx, user, opts), { isolation: 'READ COMMITTED', retries: 2 });
}

async function modelWeights(batchId) {
  const rows = await query(
    `SELECT mp.param_code, mp.param_value, im.name, im.version FROM recommendation_batches b
       JOIN model_parameters mp ON mp.model_id = b.model_id JOIN intelligence_models im ON im.model_id = b.model_id
      WHERE b.batch_id = ?`, [batchId]);
  const w = Object.fromEntries(rows.map((r) => [r.param_code, Number(r.param_value)]));
  return { weights: w, model: rows[0] ? `${rows[0].name} ${rows[0].version}` : null };
}

function breakdown(row, weights, strategy) {
  const applicable = SIGNALS.filter(([, col]) => row[col] !== null && row[col] !== undefined);
  const w = (k) => (k === 'w_exploration' && strategy === 'DISCOVERY' ? weights[k] * 2 : weights[k]) || 0;
  const total = applicable.reduce((s, [, , k]) => s + w(k), 0) || 1;
  return {
    signals: SIGNALS.map(([key, col, wk, label]) => ({
      key, label, score: row[col] === null || row[col] === undefined ? null : Number(row[col]),
      weight: w(wk), contribution: row[col] === null || row[col] === undefined ? null : r3((w(wk) * Number(row[col])) / total),
    })),
    repetitionPenalty: Number(row.repetition_penalty),
  };
}

async function shape(user, batchId, rows, meta) {
  const { weights, model } = await modelWeights(batchId);
  let songs = rows.map((r) => ({
    ...toSong(r),
    rank: r.rank_position,
    score: Number(r.final_score),
    confidence: recommendationEvidence(r),
    breakdown: breakdown(r, weights, meta.strategy),
    reasons: (typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons || [])
      .sort((a, b) => b.strength - a.strength).map((x) => ({ code: x.code, text: x.text })),
  }));
  // The engine writes reasons only above strong thresholds; a song that passed the
  // relevance gate on a weaker signal still says, from its real scores, why it is here.
  const asked = new Set(meta.moods.map((m) => m.name));
  songs = songs.map((song, i) => {
    if (song.reasons.length) return song;
    const row = rows[i];
    const shared = song.moods.find((m) => asked.has(m));
    if (row.mood_score !== null && Number(row.mood_score) > 0 && shared) {
      return { ...song, reasons: [{ code: 'MOOD_MATCH', text: `Has the ${shared.toLowerCase()} feel you asked for` }] };
    }
    if (Number(row.audio_score) >= 0.6) {
      return { ...song, reasons: [{ code: 'AUDIO_FIT', text: 'Its energy and positivity sit close to what you asked for' }] };
    }
    if (row.mood_score !== null && Number(row.mood_score) > 0) {
      return { ...song, reasons: [{ code: 'MOOD_MATCH', text: 'Carries some of the mood you asked for' }] };
    }
    return song;
  });
  songs = await withUserFlags(user.id, songs);
  const moodIds = meta.moods.map((m) => m.moodId);
  const details = moodIds.length ? await query('SELECT mood_id, name, emoji, color_hex FROM moods WHERE mood_id IN (?)', [moodIds]) : [];
  return {
    batchId, model, strategy: meta.strategy, title: meta.title, subtitle: meta.subtitle || null,
    context: meta.context || null,
    interpretation: {
      moods: meta.moods.map((m) => {
        const d = details.find((x) => x.mood_id === m.moodId);
        return d ? { id: d.mood_id, name: d.name, emoji: d.emoji, color: d.color_hex, weight: r3(m.weight) } : null;
      }).filter(Boolean),
      targets: meta.targets, summary: describe(meta.targets), parse: meta.parse || null,
    },
    songs,
    playableCount: songs.filter((song) => song.playback && song.playback.playable).length,
    generatedAt: new Date().toISOString(),
  };
}

async function contextByCode(code) {
  const c = await one('SELECT * FROM contexts WHERE code = ?', [code]);
  if (!c) throw new ApiError(400, 'INVALID_CONTEXT', `Unknown context "${code}".`);
  return c;
}
async function contextMoods(contextId) {
  return query(`SELECT cm.mood_id AS moodId, m.name, cm.weight FROM context_moods cm JOIN moods m ON m.mood_id = cm.mood_id
                 WHERE cm.context_id = ? ORDER BY cm.weight DESC`, [contextId]);
}

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

/** Mood picker and/or free text (optionally with a context). */
async function forMood(user, { moodIds = [], moodWeights = undefined, text = null, contextCode = null, limit = 20 }) {
  let moods = [];
  let parse = null;
  let ctx = contextCode ? await contextByCode(contextCode) : null;

  let requestedWeights;
  try { requestedWeights = weightedMoods(moodIds, moodWeights); }
  catch (err) { throw ApiError.badRequest(err.message); }
  if (requestedWeights.length) {
    const rows = await moodRows(requestedWeights.map((m) => m.moodId));
    if (rows.length !== requestedWeights.length) throw new ApiError(400, 'INVALID_MOOD', 'One or more of the selected moods do not exist.');
    moods = rows.map((r) => ({ moodId: r.mood_id, name: r.name, weight: requestedWeights.find((m) => m.moodId === r.mood_id).weight }));
  }
  if (text) {
    parse = await moodParser.parse(text);
    if (!parse.moods.length && !parse.context && !moods.length) {
      throw new ApiError(422, 'MOOD_NOT_UNDERSTOOD',
        'LOOP could not find a mood in that. Try words like “calm”, “stressed”, “need motivation” or “late-night study”.',
        { suggestions: ['I need something calm for studying', "I've had a rough day", 'Something energetic for the gym', 'Feeling nostalgic tonight'] });
    }
    if (moodWeights === undefined) parse.moods.forEach((pm) => { if (!moods.find((m) => m.moodId === pm.moodId)) moods.push(pm); });
    if (parse.context && !ctx) ctx = await contextByCode(parse.context.code);
  }
  if (!moods.length && ctx) moods = await contextMoods(ctx.context_id);
  if (!moods.length) throw ApiError.badRequest('Pick at least one mood or describe how you feel.');
  moods = moods.slice(0, 4);
  if (moodWeights === undefined && moods.length) {
    const totalWeight = moods.reduce((sum, mood) => sum + Math.max(0, Number(mood.weight) || 0), 0) || moods.length;
    moods = moods.map((mood) => ({ ...mood, weight: (Math.max(0, Number(mood.weight) || 1) / totalWeight) }));
  }

  const rows = await moodRows(moods.map((m) => m.moodId));
  const base = blend(rows, (r) => moods.find((m) => m.moodId === r.mood_id).weight);
  const targets = normalise(ctx ? withContext(base, ctx) : base);
  const names = moods.slice(0, 2).map((m) => m.name).join(' + ');
  const strategy = text ? 'TEXT' : 'MOOD';
  const { batchId, rows: ranked } = await createAndRun(user, {
    strategy, label: ctx ? `${names} · ${ctx.name}` : names, inputText: text || names, contextId: ctx ? ctx.context_id : null,
    targets, moods, limit,
  });
  const matching = relevantItems(ranked);
  const out = await shape(user, batchId, matching, {
    strategy, title: ctx ? `${names} for ${ctx.name.toLowerCase()}` : names, subtitle: 'Your mood feels like',
    moods, targets, parse, context: ctx ? { code: ctx.code, name: ctx.name, emoji: ctx.emoji } : null,
  });
  out.coverage = coverage(limit, matching.length, ranked.length);
  return out;
}

/** Tell the listener plainly when LOOP's catalogue has fewer close matches than requested. */
function coverage(requested, matched, ranked) {
  if (matched === 0) {
    return { requested, matched, complete: false,
      message: 'LOOP’s catalogue has no songs that fit this mood closely yet. Try a broader feeling or fewer moods.' };
  }
  if (matched < requested) {
    return { requested, matched, complete: false,
      message: `Only ${matched} song${matched === 1 ? '' : 's'} in LOOP’s catalogue fit this mood closely${ranked > matched ? '; weaker matches were left out' : ''}.` };
  }
  return { requested, matched, complete: true, message: null };
}

/** Daily Mix: the user's own average sound + their strongest learned moods. */
async function daily(user, { limit = 20 } = {}) {
  let targets = await tasteProfile(user.id);
  let moods = await topMoodPrefs(user.id);
  let subtitle = `Tuned to your last 30 days — mostly ${moods.map((m) => m.name).join(', ')}`;
  if (!targets || !moods.length) {
    const ctx = await contextByCode('MORNING');
    targets = normalise(profileOf(ctx));
    moods = moods.length ? moods : await contextMoods(ctx.context_id);
    subtitle = 'Play a few songs and this mix will start to follow your taste';
  }
  const { batchId, rows } = await createAndRun(user, { strategy: 'DAILY', label: 'Daily Mix', targets, moods, limit });
  return shape(user, batchId, rows, { strategy: 'DAILY', title: 'Daily Mix', subtitle, moods, targets });
}

/** "Because you liked X": the seed song's sound and moods. */
async function similar(user, { seedSongId = null, limit = 12 } = {}) {
  let seed;
  if (seedSongId) {
    seed = await one('SELECT * FROM v_song_catalog WHERE song_id = ? AND status = \'ACTIVE\'', [seedSongId]);
    if (!seed) throw ApiError.notFound('Song');
  } else {
    seed = await one(
      `SELECT sc.* FROM v_song_catalog sc
         LEFT JOIN ratings r ON r.song_id = sc.song_id AND r.user_id = ?
         LEFT JOIN user_likes ul ON ul.song_id = sc.song_id AND ul.user_id = ?
        WHERE sc.status = 'ACTIVE' AND sc.energy IS NOT NULL AND (r.rating >= 4 OR ul.user_id IS NOT NULL)
        ORDER BY GREATEST(COALESCE(r.updated_at, '1970-01-01'), COALESCE(ul.liked_at, '1970-01-01')) DESC, sc.song_id
        LIMIT 1`, [user.id, user.id]);
    if (!seed) return null;
  }
  const moods = await query(
    `SELECT mood_id AS moodId, mood_name AS name, confidence AS weight FROM v_current_song_moods
      WHERE song_id = ? AND mood_rank <= 3`, [seed.song_id]);
  const targets = normalise({
    energy: seed.energy, valence: seed.valence, danceability: seed.danceability, acousticness: seed.acousticness,
    instrumentalness: seed.instrumentalness, tempoMin: seed.tempo_bpm - 15, tempoMax: seed.tempo_bpm + 15,
    maxSpeechiness: Math.min(1, seed.speechiness + 0.15),
  });
  const { batchId, rows } = await createAndRun(user, { strategy: 'SIMILAR', label: `Because you liked ${seed.title}`,
    inputText: seed.title, seedSongId: seed.song_id, targets, moods, limit });
  const out = await shape(user, batchId, rows, { strategy: 'SIMILAR', title: `Because you liked ${seed.title}`,
    subtitle: 'Similar sound and mood', moods, targets });
  out.seed = toSong(seed);
  return out;
}

/** Re-open a stored batch (scores and reasons come from the tables, not recomputed). */
async function getBatch(user, batchId) {
  const b = await one('SELECT * FROM recommendation_batches WHERE batch_id = ?', [batchId]);
  if (!b || (b.user_id !== user.id && !user.permissions.has('users.manage'))) throw ApiError.notFound('Recommendation list');
  const rows = await query(
    `SELECT ri.*, sc.*,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('code', e.reason_code, 'text', e.reason_text, 'strength', e.strength))
               FROM v_recommendation_explanations e WHERE e.batch_id = ri.batch_id AND e.song_id = ri.song_id AND e.reason_rank <= 3) AS reasons
       FROM recommendation_items ri JOIN v_song_catalog sc ON sc.song_id = ri.song_id
      WHERE ri.batch_id = ? ORDER BY ri.rank_position`, [batchId]);
  const moods = await query(`SELECT bm.mood_id AS moodId, m.name, bm.weight FROM recommendation_batch_moods bm
                              JOIN moods m ON m.mood_id = bm.mood_id WHERE bm.batch_id = ? ORDER BY bm.weight DESC`, [batchId]);
  const shown = ['MOOD', 'TEXT'].includes(b.strategy) ? relevantItems(rows) : rows;
  return shape(user, batchId, shown, { strategy: b.strategy, title: b.label || b.strategy, moods, targets: {
    energy: b.target_energy, valence: b.target_valence, danceability: b.target_danceability, acousticness: b.target_acousticness,
    instrumentalness: b.target_instrumentalness, tempoMin: b.tempo_min, tempoMax: b.tempo_max, maxSpeechiness: b.max_speechiness } });
}

/** The listener's recent mood requests, newest first (Library → Recent moods). */
async function history(user, limit = 12) {
  const rows = await query(
    `SELECT b.batch_id AS id, b.strategy, b.label, b.input_text AS inputText, b.created_at AS createdAt,
            (SELECT COUNT(*) FROM recommendation_items ri WHERE ri.batch_id = b.batch_id) AS songCount,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', m.mood_id, 'name', m.name, 'color', m.color_hex))
               FROM recommendation_batch_moods bm JOIN moods m ON m.mood_id = bm.mood_id WHERE bm.batch_id = b.batch_id) AS moods
       FROM recommendation_batches b
      WHERE b.user_id = ? AND b.strategy IN ('MOOD', 'TEXT')
      ORDER BY b.batch_id DESC LIMIT ?`, [user.id, limit]);
  return rows.map((r) => ({ ...r, moods: typeof r.moods === 'string' ? JSON.parse(r.moods) : r.moods || [] }));
}

module.exports = {
  forMood, daily, similar, getBatch, history,
  createAndRun, shape, normalise, describe, contextByCode,
};
