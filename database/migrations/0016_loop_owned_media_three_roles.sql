-- 0016 — LOOP-owned media only; three user roles (User, Artist, Admin).
-- Forward-only: retains historical Apple/Spotify metadata tables but detaches
-- them from runtime playback. No catalogue, user, upload or listening data is dropped.

-- Remove the previous Apple-only enforcement and Apple-only playback view.
DROP TRIGGER IF EXISTS trg_sources_playback_apple_bi;
DROP TRIGGER IF EXISTS trg_sources_playback_apple_bu;
DROP VIEW IF EXISTS v_apple_playable_songs;

-- Keep exactly three application roles. Existing Curator users are demoted to
-- normal User access before the legacy role is removed.
UPDATE users u
JOIN roles old_role ON old_role.role_id = u.role_id AND old_role.code = 'CURATOR'
JOIN roles user_role ON user_role.code = 'LISTENER'
SET u.role_id = user_role.role_id;

DELETE rp FROM role_permissions rp
JOIN roles r ON r.role_id = rp.role_id
WHERE r.code = 'CURATOR';
DELETE FROM roles WHERE code = 'CURATOR';

UPDATE roles SET name = 'User' WHERE code = 'LISTENER';
UPDATE roles SET name = 'Artist' WHERE code = 'ARTIST';
UPDATE roles SET name = 'Admin' WHERE code = 'ADMIN';

-- Artists keep the same listening permissions as normal Users, plus creator tools.
INSERT IGNORE INTO role_permissions (role_id, permission_code)
SELECT artist_role.role_id, rp.permission_code
  FROM roles artist_role
  JOIN roles user_role ON user_role.code = 'LISTENER'
  JOIN role_permissions rp ON rp.role_id = user_role.role_id
 WHERE artist_role.code = 'ARTIST';

-- Ensure artist permissions are explicit and Admin remains the only reviewer.
INSERT INTO permissions (permission_code, description) VALUES
  ('artist.studio', 'View and manage the signed-in artist studio'),
  ('artist.upload', 'Create and manage original or authorized artist uploads'),
  ('artist.review', 'Review artist applications, upload rights and moderation reports')
ON DUPLICATE KEY UPDATE description = VALUES(description);
INSERT IGNORE INTO role_permissions (role_id, permission_code)
SELECT role_id, 'artist.studio' FROM roles WHERE code = 'ARTIST';
INSERT IGNORE INTO role_permissions (role_id, permission_code)
SELECT role_id, 'artist.upload' FROM roles WHERE code = 'ARTIST';
INSERT IGNORE INTO role_permissions (role_id, permission_code)
SELECT role_id, 'artist.review' FROM roles WHERE code = 'ADMIN';

-- Third-party catalogues/playback are disabled. The only metadata ingestion
-- source is LOOP's own checked-in file feed; playback uses LOOP-owned audio.
UPDATE music_sources
   SET is_enabled = 0,
       notes = 'Disabled: LOOP uses its own catalogue and stored audio only.'
 WHERE code IN ('APPLE_MUSIC','SPOTIFY','YOUTUBE_DATA','MUSICBRAINZ','JAMENDO','TMDB',
               'THEAUDIODB','EXTERNAL_PREVIEW','MUSE_SKETCH','AI');
UPDATE music_sources
   SET is_enabled = 1, fallback_source_id = NULL,
       notes = 'Audio stored in LOOP media folder; rights-cleared files only.'
 WHERE code = 'LOCAL_MEDIA';
UPDATE music_sources
   SET is_enabled = 1, fallback_source_id = NULL,
       notes = 'Artist-owned/licensed recordings, quarantined and scanned before Admin publication.'
 WHERE code = 'ARTIST_UPLOAD';

UPDATE music_sources
   SET is_enabled = 1, fallback_source_id = NULL,
       notes = 'LOOP-local JSON metadata feed; no remote service requests.'
 WHERE code = 'MUSE_CATALOG_FEED';

-- Deactivate every third-party or generated media row. Keep its record for
-- audit/history, but do not make it playable in LOOP.
UPDATE song_media sm
JOIN music_sources ms ON ms.source_id = sm.source_id
   SET sm.rights_status = 'RESTRICTED', sm.availability = 'UNAVAILABLE', sm.last_checked_at = NOW()
 WHERE ms.code NOT IN ('LOCAL_MEDIA','ARTIST_UPLOAD');

-- Restore LOOP-owned local full-track playback. The Apple Music table remains
-- as historical DBMS data only and is not referenced by any live playback view.
CREATE OR REPLACE VIEW v_song_playback AS
SELECT song_id, media_id, media_type, source_code, source_name, uri, attribution
FROM (
  SELECT sm.song_id, sm.media_id, sm.media_type, ms.code AS source_code,
         ms.name AS source_name, sm.uri,
         COALESCE(sm.attribution, ms.attribution_text) AS attribution,
         ROW_NUMBER() OVER (PARTITION BY sm.song_id ORDER BY sm.priority, ms.priority, sm.media_id) AS rn
    FROM song_media sm
    JOIN music_sources ms ON ms.source_id = sm.source_id
   WHERE ms.is_enabled = 1
     AND sm.media_type = 'USER_LOCAL'
     AND ms.code IN ('LOCAL_MEDIA','ARTIST_UPLOAD')
     AND sm.rights_status IN ('PERMITTED','ATTRIBUTION_REQUIRED')
     AND sm.availability = 'AVAILABLE'
) ranked
WHERE rn = 1;

CREATE OR REPLACE VIEW v_song_catalog AS
SELECT
  s.song_id, s.title, s.version_label, s.status, s.duration_sec, s.release_year, s.explicit,
  s.content_rating, s.popularity, s.isrc,
  a.artist_id, a.name AS artist_name, a.region_code AS artist_region,
  al.album_id, al.title AS album_title, al.album_type, f.film_id, f.title AS film_title,
  COALESCE(al.cover_color_1, g.color_hex) AS cover_color_1,
  COALESCE(al.cover_color_2, '#1F1B2E') AS cover_color_2,
  l.language_id, COALESCE(l.name, 'Instrumental') AS language_name,
  g.genre_id, g.name AS genre_name, g.color_hex AS genre_color,
  caf.energy, caf.valence, caf.danceability, caf.acousticness, caf.instrumentalness,
  caf.speechiness, caf.loudness_db, caf.tempo_bpm, caf.musical_key, caf.mode, caf.analysis_version,
  (SELECT GROUP_CONCAT(cm.mood_name ORDER BY cm.mood_rank SEPARATOR ',')
     FROM v_current_song_moods cm WHERE cm.song_id = s.song_id AND cm.mood_rank <= 3) AS mood_tags,
  pm.media_type AS playback_type, pm.source_code AS playback_source,
  pm.source_name AS playback_source_name, pm.media_type IS NOT NULL AS playable
FROM songs s
JOIN artists a ON a.artist_id = s.primary_artist_id
LEFT JOIN albums al ON al.album_id = s.album_id
LEFT JOIN films f ON f.film_id = al.film_id
LEFT JOIN languages l ON l.language_id = s.language_id
LEFT JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
LEFT JOIN genres g ON g.genre_id = sg.genre_id
LEFT JOIN v_current_audio_features caf ON caf.song_id = s.song_id
LEFT JOIN v_song_playback pm ON pm.song_id = s.song_id;

CREATE OR REPLACE VIEW v_recommendation_candidates AS
SELECT s.song_id, s.primary_artist_id AS artist_id, sg.genre_id, s.language_id, s.explicit, s.content_rating,
       s.popularity, s.duration_sec, a.region_code AS artist_region,
       af.energy, af.valence, af.danceability, af.acousticness, af.instrumentalness, af.speechiness, af.tempo_bpm
  FROM songs s
  JOIN artists a ON a.artist_id = s.primary_artist_id
  JOIN song_genres sg ON sg.song_id = s.song_id AND sg.is_primary = 1
  JOIN audio_features af ON af.song_id = s.song_id AND af.is_current = 1
 WHERE s.status = 'ACTIVE'
   AND EXISTS (SELECT 1 FROM v_song_playback p WHERE p.song_id = s.song_id);

GRANT SELECT ON __DB__.v_song_playback TO '__APP_USER__'@'__APP_HOST__';
