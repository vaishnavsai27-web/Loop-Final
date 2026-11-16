'use strict';

const MOOD_FIELDS = ['target_energy', 'target_valence', 'target_danceability', 'target_acousticness', 'target_instrumentalness', 'tempo_min', 'tempo_max'];

/** Convert a 0–100 user allocation into weights whose total is exactly 1. */
function weightedMoods(moodIds = [], moodWeights = undefined) {
  if (moodWeights !== undefined) {
    if (!Array.isArray(moodWeights) || moodWeights.length < 1 || moodWeights.length > 4) {
      throw new TypeError('Choose between one and four weighted moods.');
    }
    const seen = new Set();
    const rows = moodWeights.map((item) => {
      const moodId = Number(item?.moodId);
      const weight = Number(item?.weight);
      if (!Number.isInteger(moodId) || moodId < 1 || seen.has(moodId)) throw new TypeError('Each mood must be selected once.');
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new TypeError('Each mood weight must be greater than 0 and no more than 100.');
      seen.add(moodId);
      return { moodId, weight };
    });
    const total = Math.round(rows.reduce((sum, row) => sum + row.weight, 0) * 100) / 100;
    if (Math.abs(total - 100) > 0.01) throw new TypeError('Mood weights must add up to exactly 100%.');
    return rows.map((row) => ({ ...row, weight: row.weight / total }));
  }
  const unique = [...new Set((moodIds || []).map(Number))];
  if (unique.length > 4) throw new TypeError('Choose no more than four moods.');
  if (!unique.every((id) => Number.isInteger(id) && id > 0)) throw new TypeError('Mood IDs must be positive whole numbers.');
  return unique.map((moodId) => ({ moodId, weight: unique.length ? 1 / unique.length : 0 }));
}


const SIGNAL_LABELS = {
  mood_score: 'Mood fit', audio_score: 'Audio features', preference_score: 'Your taste', recency_score: 'Recent listening',
  trend_score: 'Current trends', context_score: 'Listening context', regional_score: 'Language and region', exploration_score: 'Discovery variety',
};
function recommendationEvidence(row) {
  const present = Object.entries(SIGNAL_LABELS).filter(([field]) => row[field] !== null && row[field] !== undefined);
  const keys = present.map(([field]) => field);
  const behaviorBacked = keys.includes('preference_score') || keys.includes('recency_score');
  let level;
  if (!behaviorBacked) level = 'NEW_USER_FALLBACK';
  else if (keys.length >= 5) level = 'STRONG_MATCH';
  else if (keys.length >= 3) level = 'PARTIAL_MATCH';
  else level = 'LIMITED_DATA';
  const labels = { STRONG_MATCH: 'Strong match', PARTIAL_MATCH: 'Partial match', LIMITED_DATA: 'Limited data', NEW_USER_FALLBACK: 'New-user fallback' };
  return { level, label: labels[level], supportingSignals: present.map(([, label]) => label), signalCount: keys.length };
}

/**
 * Honest catalogue coverage. The SQL engine ranks every eligible catalogue song,
 * so a long list can contain songs that share neither the requested mood tags nor
 * the requested sound. Those are dropped instead of being presented as matches.
 *  - moodScore: weighted share of the requested moods tagged on the song (0–1, null when no mood was requested)
 *  - audioScore: closeness of the song's audio features to the target profile (0–1)
 */
const MIN_MOOD_SCORE = 0.05;
const MIN_AUDIO_SCORE = 0.6;
const MIN_FINAL_SCORE = 0.2;
function isRelevant(row) {
  const mood = row.mood_score === null || row.mood_score === undefined ? null : Number(row.mood_score);
  const audio = Number(row.audio_score) || 0;
  const final = Number(row.final_score) || 0;
  if (final < MIN_FINAL_SCORE) return false;
  if (mood === null) return audio >= MIN_AUDIO_SCORE;
  return mood >= MIN_MOOD_SCORE || audio >= MIN_AUDIO_SCORE;
}
function relevantItems(rows) {
  return (rows || []).filter(isRelevant);
}

module.exports = { weightedMoods, recommendationEvidence, relevantItems, isRelevant, MOOD_FIELDS, MIN_MOOD_SCORE, MIN_AUDIO_SCORE, MIN_FINAL_SCORE };
