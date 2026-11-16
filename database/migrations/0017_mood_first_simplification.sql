-- =====================================================================
--  0017 — Mood-first product simplification
--
--  Forward-only. Back up first (npm run db:backup). Earlier migrations are
--  not modified.
--
--  1. Recommendations use the whole active LOOP catalogue again. Migration
--     0016 limited candidates to songs that already have LOOP-owned audio,
--     which left mood discovery empty on any catalogue without registered
--     recordings. Playability is still reported per song (v_song_catalog.
--     playable); a song without authorised audio is shown as unavailable,
--     never as playable.
--  2. Retired product features are removed from the schema:
--       weekly "worlds", private-session cleanup routine, listening-insight
--       routines/views, lyrics and annotations, mood diary, per-mood
--       percentage ratings, the song-merge routine (it wrote to retired
--       tables) and the retired third-party preview table and its routines.
--     User-authored rows from the retired personal features (mood diary,
--     per-mood ratings, private song notes, lyric annotations) are copied
--     into retired_feature_archive first, so nothing a person wrote is lost.
--     Account deletion also removes that person's archived rows.
--  3. Kept on purpose: incognito_sessions / incognito_events and
--     v_incognito_memory are still referenced by sp_generate_recommendations;
--     they stay (empty) until that procedure is replaced in a later migration.
-- =====================================================================

-- ---------------------------------------------------------------- 1. candidates
CREATE OR REPLACE VIEW v_recommendation_candidates AS
SELECT s.song_id, s.primary_artist_id AS artist_id, sg.genre_id, s.language_id, s.explicit, s.content_rating,
       s.popularity, s.duration_sec, a.region_code AS artist_region,
       af.energy, af.valence, af.danceability, af.acousticness, af.instrumentalness, af.speechiness, af.tempo_bpm
  FROM songs s
  JOIN artists a ON a.artist_id = s.primary_artist_id
  JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
  JOIN audio_features af ON af.song_id = s.song_id AND af.is_current = 1
 WHERE s.status = 'ACTIVE';

-- ---------------------------------------------------------------- 2a. archive personal rows
CREATE TABLE IF NOT EXISTS retired_feature_archive (
  archive_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  feature      VARCHAR(40) NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  payload      JSON NOT NULL,
  archived_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (archive_id),
  KEY idx_rfa_user (user_id),
  KEY idx_rfa_feature (feature)
) ENGINE=InnoDB;

GRANT SELECT, DELETE ON __DB__.retired_feature_archive TO '__APP_USER__'@'__APP_HOST__';

-- The INSERT … SELECT statements below only run while the source table exists.
-- information_schema checks keep the migration safe on databases where an
-- earlier optional table was never created.
DROP PROCEDURE IF EXISTS mig_0017_archive;
DELIMITER $$
CREATE PROCEDURE mig_0017_archive()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mood_diary_entries') THEN
    INSERT INTO retired_feature_archive (feature, user_id, payload)
    SELECT 'MOOD_DIARY', user_id,
           JSON_OBJECT('checkin_date', checkin_date, 'mood_id', mood_id, 'note', note, 'created_at', created_at, 'updated_at', updated_at)
      FROM mood_diary_entries;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'song_mood_ratings') THEN
    INSERT INTO retired_feature_archive (feature, user_id, payload)
    SELECT 'SONG_MOOD_RATING', user_id,
           JSON_OBJECT('song_id', song_id, 'mood_id', mood_id, 'match_percentage', match_percentage,
                       'review_text', review_text, 'created_at', created_at, 'updated_at', updated_at)
      FROM song_mood_ratings;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_song_notes') THEN
    INSERT INTO retired_feature_archive (feature, user_id, payload)
    SELECT 'SONG_NOTE', user_id,
           JSON_OBJECT('song_id', song_id, 'note_text', note_text, 'created_at', created_at, 'updated_at', updated_at)
      FROM user_song_notes;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lyric_annotations') THEN
    INSERT INTO retired_feature_archive (feature, user_id, payload)
    SELECT 'LYRIC_ANNOTATION', la.user_id,
           JSON_OBJECT('song_id', sl.song_id, 'line_number', ll.line_number, 'annotation_text', la.annotation_text,
                       'source_url', la.source_url, 'created_at', la.created_at, 'updated_at', la.updated_at)
      FROM lyric_annotations la
      JOIN lyric_lines ll ON ll.lyric_line_id = la.lyric_line_id
      JOIN song_lyrics sl ON sl.lyric_id = ll.lyric_id;
  END IF;
END$$
DELIMITER ;
CALL mig_0017_archive();
DROP PROCEDURE IF EXISTS mig_0017_archive;

-- ---------------------------------------------------------------- 2b. weekly worlds
DROP VIEW IF EXISTS v_muse_world_summary;
DROP PROCEDURE IF EXISTS sp_rollback_world;
DROP PROCEDURE IF EXISTS sp_cleanup_expired_incognito;   -- referenced weekly_worlds; private sessions are retired
DROP TABLE IF EXISTS world_feedback;
DROP TABLE IF EXISTS weekly_worlds;
DROP TABLE IF EXISTS archetype_moods;
DROP TABLE IF EXISTS world_archetypes;

-- ---------------------------------------------------------------- 2c. listening insights
DROP PROCEDURE IF EXISTS sp_user_listening_summary;
DROP VIEW IF EXISTS v_weekly_mood_summary;
DROP VIEW IF EXISTS v_daily_listening_summary;
DROP VIEW IF EXISTS v_trending_songs;

-- ---------------------------------------------------------------- 2d. lyrics, notes, diary, per-mood ratings
DROP VIEW IF EXISTS v_song_lyric_annotation_summary;
DROP TABLE IF EXISTS lyric_annotations;
DROP TABLE IF EXISTS user_song_notes;
DROP TABLE IF EXISTS lyric_lines;
DROP TABLE IF EXISTS song_lyrics;
DROP TABLE IF EXISTS mood_diary_entries;
DROP PROCEDURE IF EXISTS sp_merge_songs;                 -- wrote to song_mood_ratings; song merging is retired
DROP VIEW IF EXISTS v_song_mood_rating_stats;
DROP TABLE IF EXISTS song_mood_ratings;

-- ---------------------------------------------------------------- 2e. retired third-party preview data
DROP TRIGGER IF EXISTS trg_sam_verified_bi;
DROP TRIGGER IF EXISTS trg_sam_verified_bu;
DROP PROCEDURE IF EXISTS sp_record_apple_match;
DROP TABLE IF EXISTS song_apple_music;

-- ---------------------------------------------------------------- 4. product name in visible text
-- Recommendation explanations are rendered from reason_types.template at read time.
UPDATE reason_types SET template = 'Rising on LOOP this week (+{pct}% plays)' WHERE reason_code = 'TRENDING';
UPDATE music_sources SET name = 'LOOP seed catalogue' WHERE code = 'MUSE_SEED_CATALOG';
