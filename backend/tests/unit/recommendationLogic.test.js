const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weightedMoods, recommendationEvidence, relevantItems, isRelevant } = require('../../src/utils/recommendationLogic');

test('explicit mood blend weights are normalized from exactly 100 percent', () => {
  const result = weightedMoods([], [{ moodId: 1, weight: 62.5 }, { moodId: 2, weight: 37.5 }]);
  assert.deepEqual(result, [{ moodId: 1, weight: 0.625 }, { moodId: 2, weight: 0.375 }]);
  assert.equal(result.reduce((sum, row) => sum + row.weight, 0), 1);
});

test('mood blend rejects duplicate, zero, excessive and non-100 percent allocations', () => {
  assert.throws(() => weightedMoods([], [{ moodId: 1, weight: 50 }, { moodId: 1, weight: 50 }]), /once/);
  assert.throws(() => weightedMoods([], [{ moodId: 1, weight: 0 }, { moodId: 2, weight: 100 }]), /greater than 0/);
  assert.throws(() => weightedMoods([], [{ moodId: 1, weight: 50 }, { moodId: 2, weight: 49 }]), /exactly 100/);
  assert.throws(() => weightedMoods([], [{ moodId: 1, weight: 50 }, { moodId: 2, weight: 25 }, { moodId: 3, weight: 15 }, { moodId: 4, weight: 10 }, { moodId: 5, weight: 1 }]), /one and four/);
});

test('legacy mood selections are evenly weighted and duplicate ids are removed', () => {
  assert.deepEqual(weightedMoods([4, 7, 4]), [
    { moodId: 4, weight: 0.5 }, { moodId: 7, weight: 0.5 },
  ]);
});

test('recommendation confidence is labelled from available evidence rather than score-as-probability', () => {
  assert.equal(recommendationEvidence({ mood_score: 0.9, audio_score: 0.8 }).level, 'NEW_USER_FALLBACK');
  assert.equal(recommendationEvidence({ mood_score: 0.9, audio_score: 0.8, preference_score: 0.7 }).level, 'PARTIAL_MATCH');
  assert.equal(recommendationEvidence({ mood_score: 0.9, audio_score: 0.8, preference_score: 0.7,
    recency_score: 0.6, trend_score: 0.4, context_score: 0.8 }).level, 'STRONG_MATCH');
});

test('relevance gate keeps songs that share a requested mood or closely match the sound', () => {
  assert.equal(isRelevant({ mood_score: 0.4, audio_score: 0.3, final_score: 0.5 }), true, 'mood match');
  assert.equal(isRelevant({ mood_score: 0, audio_score: 0.82, final_score: 0.45 }), true, 'sound match');
  assert.equal(isRelevant({ mood_score: 0.01, audio_score: 0.4, final_score: 0.3 }), false, 'neither: not a match');
  assert.equal(isRelevant({ mood_score: 0.5, audio_score: 0.9, final_score: 0.1 }), false, 'too low overall');
  assert.equal(isRelevant({ mood_score: null, audio_score: 0.7, final_score: 0.4 }), true, 'no mood requested: sound decides');
});

test('relevantItems keeps rank order and drops weak matches', () => {
  const rows = [
    { song_id: 1, mood_score: 0.6, audio_score: 0.7, final_score: 0.8 },
    { song_id: 2, mood_score: 0, audio_score: 0.2, final_score: 0.3 },
    { song_id: 3, mood_score: 0.2, audio_score: 0.5, final_score: 0.5 },
  ];
  assert.deepEqual(relevantItems(rows).map((r) => r.song_id), [1, 3]);
  assert.deepEqual(relevantItems(null), []);
});

