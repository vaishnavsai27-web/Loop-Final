-- =====================================================================
--  0012 — Apple Music 30-second previews are the ONLY playback source
--
--  Product rule: the LOOP player plays official Apple Music previews and
--  nothing else. This migration makes that rule a property of the DATABASE,
--  not just of application code:
--
--   * song_apple_music     one verified Apple catalogue match per LOOP song
--                          (track id, storefront, store link, artwork, the
--                          https preview URL, match score, check timestamps).
--                          CHECK constraints reject a non-https preview, a
--                          preview/artwork/store URL outside Apple's hosts,
--                          and a score outside 0..1.
--   * v_song_playback      redefined: it now exposes ONLY VERIFIED Apple
--                          previews. v_song_catalog.playable and
--                          v_recommendation_candidates already filter on this
--                          view, so every SQL recommendation returns Apple
--                          catalogue songs with a valid preview — a song that
--                          has no verified preview can never be recommended.
--   * v_apple_playable_songs  readable list of playable songs + Apple data.
--   * v_song_catalog       gains apple_track_id / apple_store_url /
--                          apple_artwork_url (appended; existing columns keep
--                          their positions).
--   * music_sources        APPLE_MUSIC row; the other PLAYBACK-type sources
--                          (local files, external preview provider, demo
--                          sketch) are switched off, and triggers refuse to
--                          enable any non-Apple PLAYBACK source again.
--
--  Nothing is deleted: song_media rows, artist uploads and the review
--  workflow stay as DBMS data; they are simply never offered for playback.
--  Re-runnable: IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS song_apple_music (
  song_id          INT UNSIGNED  NOT NULL,
  apple_track_id   BIGINT UNSIGNED NOT NULL,
  storefront       CHAR(2)       NOT NULL,
  track_name       VARCHAR(300)  NOT NULL,
  artist_name      VARCHAR(300)  NOT NULL,
  collection_name  VARCHAR(300)  NULL,
  track_view_url   VARCHAR(500)  NOT NULL,
  artwork_url      VARCHAR(500)  NULL,
  preview_url      VARCHAR(500)  NOT NULL,
  match_score      DECIMAL(4,3)  NOT NULL,
  match_status     ENUM('VERIFIED','UNAVAILABLE') NOT NULL DEFAULT 'VERIFIED',
  verified_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (song_id),
  KEY idx_sam_track (apple_track_id, storefront),
  KEY idx_sam_status_checked (match_status, last_checked_at),
  CONSTRAINT fk_sam_song FOREIGN KEY (song_id) REFERENCES songs (song_id) ON DELETE CASCADE,
  CONSTRAINT chk_sam_storefront CHECK (storefront REGEXP '^[a-z]{2}$'),
  CONSTRAINT chk_sam_score CHECK (match_score BETWEEN 0 AND 1),
  CONSTRAINT chk_sam_preview CHECK (preview_url REGEXP '^https://([A-Za-z0-9-]+[.])*(apple[.]com|mzstatic[.]com)/'),
  CONSTRAINT chk_sam_store_url CHECK (track_view_url REGEXP '^https://(music|itunes|geo[.]music)[.]apple[.]com/'),
  CONSTRAINT chk_sam_artwork CHECK (artwork_url IS NULL OR artwork_url REGEXP '^https://([A-Za-z0-9-]+[.])*mzstatic[.]com/')
) ENGINE=InnoDB;

GRANT SELECT, INSERT, UPDATE, DELETE ON __DB__.song_apple_music TO '__APP_USER__'@'__APP_HOST__';

-- ---------------------------------------------------------------- source registry
INSERT IGNORE INTO music_sources
  (code, name, source_type, access_method, base_url, license_name, rights_scope, requires_attribution, attribution_text, priority, is_enabled, requires_credentials, notes)
VALUES
  ('APPLE_MUSIC', 'Apple Music (30-second previews)', 'PLAYBACK', 'API', 'https://itunes.apple.com',
   'Apple Music / iTunes Search API terms', 'METADATA,AUDIO_PREVIEW,ARTWORK', 1, 'Preview courtesy of Apple Music.', 1, 1, 0,
   'The only playback source in LOOP. Official 30-second previews returned by the public iTunes Search/Lookup API; no audio is stored, proxied or re-hosted.');
UPDATE music_sources SET is_enabled = 1, priority = 1 WHERE code = 'APPLE_MUSIC';

-- Switch every other PLAYBACK-type source off (rows are kept; they just cannot be enabled).
UPDATE music_sources SET is_enabled = 0 WHERE source_type = 'PLAYBACK' AND code <> 'APPLE_MUSIC';
UPDATE music_sources
   SET notes = 'Stored for rights review only. LOOP plays Apple Music previews only; uploads are never played in the LOOP player.'
 WHERE code = 'ARTIST_UPLOAD';

DROP TRIGGER IF EXISTS trg_sources_playback_apple_bi;
DROP TRIGGER IF EXISTS trg_sources_playback_apple_bu;
DELIMITER $$
CREATE TRIGGER trg_sources_playback_apple_bi BEFORE INSERT ON music_sources FOR EACH ROW
BEGIN
  IF NEW.source_type = 'PLAYBACK' AND NEW.code <> 'APPLE_MUSIC' AND NEW.is_enabled = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: APPLE_MUSIC is the only PLAYBACK source that may be enabled';
  END IF;
END$$
CREATE TRIGGER trg_sources_playback_apple_bu BEFORE UPDATE ON music_sources FOR EACH ROW
BEGIN
  IF NEW.source_type = 'PLAYBACK' AND NEW.code <> 'APPLE_MUSIC' AND NEW.is_enabled = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: APPLE_MUSIC is the only PLAYBACK source that may be enabled';
  END IF;
END$$
DELIMITER ;

-- ---------------------------------------------------------------- views
-- Same column list as 0003 so v_song_catalog / v_recommendation_candidates keep working.
-- media_id carries the Apple track id (there is no song_media row for an Apple preview).
CREATE OR REPLACE VIEW v_song_playback AS
SELECT sam.song_id,
       sam.apple_track_id AS media_id,
       'PREVIEW'          AS media_type,
       ms.code            AS source_code,
       ms.name            AS source_name,
       sam.preview_url    AS uri,
       ms.attribution_text AS attribution
  FROM song_apple_music sam
  JOIN music_sources ms ON ms.code = 'APPLE_MUSIC' AND ms.is_enabled = 1
 WHERE sam.match_status = 'VERIFIED';

CREATE OR REPLACE VIEW v_apple_playable_songs AS
SELECT s.song_id, s.title, a.name AS artist_name, s.status,
       sam.apple_track_id, sam.storefront, sam.track_name AS apple_track_name, sam.artist_name AS apple_artist_name,
       sam.track_view_url, sam.artwork_url, sam.preview_url, sam.match_score, sam.verified_at, sam.last_checked_at
  FROM songs s
  JOIN artists a ON a.artist_id = s.primary_artist_id
  JOIN song_apple_music sam ON sam.song_id = s.song_id AND sam.match_status = 'VERIFIED'
  JOIN music_sources ms ON ms.code = 'APPLE_MUSIC' AND ms.is_enabled = 1;

CREATE OR REPLACE VIEW v_song_catalog AS
SELECT
  s.song_id, s.title, s.version_label, s.status, s.duration_sec, s.release_year, s.explicit,
  s.content_rating, s.popularity, s.isrc,
  a.artist_id, a.name AS artist_name, a.region_code AS artist_region,
  al.album_id, al.title AS album_title, al.album_type, f.film_id, f.title AS film_title,
  COALESCE(al.cover_color_1, g.color_hex) AS cover_color_1,
  COALESCE(al.cover_color_2, '#1F1B2E')   AS cover_color_2,
  l.language_id, COALESCE(l.name, 'Instrumental') AS language_name,
  g.genre_id, g.name AS genre_name, g.color_hex AS genre_color,
  caf.energy, caf.valence, caf.danceability, caf.acousticness, caf.instrumentalness,
  caf.speechiness, caf.loudness_db, caf.tempo_bpm, caf.musical_key, caf.mode, caf.analysis_version,
  (SELECT GROUP_CONCAT(cm.mood_name ORDER BY cm.mood_rank SEPARATOR ',')
     FROM v_current_song_moods cm WHERE cm.song_id = s.song_id AND cm.mood_rank <= 3) AS mood_tags,
  pm.media_type AS playback_type, pm.source_code AS playback_source, pm.source_name AS playback_source_name,
  pm.media_type IS NOT NULL AS playable,
  sam.apple_track_id AS apple_track_id,
  sam.track_view_url AS apple_store_url,
  sam.artwork_url    AS apple_artwork_url
FROM songs s
JOIN artists a ON a.artist_id = s.primary_artist_id
LEFT JOIN albums al ON al.album_id = s.album_id
LEFT JOIN films f   ON f.film_id = al.film_id
LEFT JOIN languages l ON l.language_id = s.language_id
LEFT JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
LEFT JOIN genres g ON g.genre_id = sg.genre_id
LEFT JOIN v_current_audio_features caf ON caf.song_id = s.song_id
LEFT JOIN v_song_playback pm ON pm.song_id = s.song_id
LEFT JOIN song_apple_music sam ON sam.song_id = s.song_id AND sam.match_status = 'VERIFIED';

GRANT SELECT ON __DB__.v_apple_playable_songs TO '__APP_USER__'@'__APP_HOST__';
