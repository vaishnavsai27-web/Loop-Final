# How mood becomes recommendations

1. **Input.** Up to four moods (`moodIds`), optional free text (≤ 280 characters) and an optional listening
   context (Study, Workout, Night…).
2. **Interpretation** (`services/moodParser.js`). The text is normalised and matched against LOOP's lexicon in the
   database (`mood_keywords`, `context_keywords`). Longest phrases win; negations ("not happy") are flipped or
   ignored; intensifiers ("really") boost. The result is weighted moods plus an optional context, shown live in
   the interface ("LOOP hears …"). Text with no known mood returns `422 MOOD_NOT_UNDERSTOOD` with suggestions.
3. **Target sound.** Each mood has a target profile (energy, valence, danceability, acousticness,
   instrumentalness, tempo range). Selected moods are blended by weight; a context shares energy/valence and
   sets texture.
4. **Scoring** (`sp_generate_recommendations`, in MySQL, inside one transaction with the batch rows). For every
   active, analysed song: mood overlap, audio closeness to the target, learned taste (genres, artists, moods,
   ratings — onboarding answers fade as real listening accumulates), similarity to what was just finished,
   7-day trend momentum, context fit, language/region fit and novelty, minus a repetition penalty. Weights come
   from the active recommender model in `model_parameters`. Artist and genre caps keep the list varied. Songs
   rated 1★ or marked "Not interested" never appear.
5. **Explanations.** Reasons are written only from signals that are really present (`recommendation_reasons`,
   rendered through `reason_types`), e.g. "Carries the calm feel you asked for".
6. **Honesty gate** (`utils/recommendationLogic.js`). A song is shown only if it shares the requested moods
   (`mood_score ≥ 0.05`) or closely matches the sound (`audio_score ≥ 0.6`), and its overall score is at least
   0.2. When fewer songs pass than were requested, the response carries `coverage.message`
   ("Only 6 songs in LOOP's catalogue fit this mood closely"). Nothing is padded.
7. **Playability.** Each song reports `playback.playable`. Only songs with authorised LOOP-owned audio
   (`v_song_playback`) can be played; others are shown as unavailable.

Feedback loops back: likes, ratings, completed plays, skips and dismissals update preference tables through
`sp_refresh_user_preferences_core`, so the next list reflects them. "Explore similar" seeds the same engine with
one song's sound and moods. Every list is stored, so Library → Recent moods reopens it with the same ranking.
