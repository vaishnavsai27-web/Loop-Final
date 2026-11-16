-- =====================================================================
--  0013 — Apple preview verification hardening (forward-only; 0012 is NOT edited)
--
--  Fixes found in review of 0012:
--   * match_status defaulted to VERIFIED -> a bare INSERT became playable.
--     New default is PENDING; PENDING rows are never playable.
--   * apple_track_id accepted 0 -> now CHECK (apple_track_id > 0).
--   * preview host check accepted ANY apple.com/mzstatic.com path -> now only
--     https://audio*.itunes.apple.com/<...>.m4a|mp3|aac (the Apple preview CDN).
--   * loop_app could INSERT/UPDATE verified rows directly -> direct INSERT/UPDATE
--     is revoked; the backend must call sp_record_apple_match(), which refuses
--     VERIFIED without a positive id, strong score and a valid preview URL.
--     (A trigger enforces the same rules for any other writer, e.g. a DBA.)
--  Rows that violate the new rules are removed: they are cache data that the
--  backend re-creates by re-verifying against Apple; no other table references them.
-- =====================================================================

DELETE FROM song_apple_music
 WHERE apple_track_id = 0
    OR preview_url NOT REGEXP '^https://audio[a-z0-9-]*[.]itunes[.]apple[.]com/.+[.](m4a|mp3|aac)$';

ALTER TABLE song_apple_music
  MODIFY match_status ENUM('PENDING','VERIFIED','UNAVAILABLE') NOT NULL DEFAULT 'PENDING',
  DROP CHECK chk_sam_preview,
  ADD CONSTRAINT chk_sam_preview CHECK (preview_url REGEXP '^https://audio[a-z0-9-]*[.]itunes[.]apple[.]com/.+[.](m4a|mp3|aac)$'),
  ADD CONSTRAINT chk_sam_track_positive CHECK (apple_track_id > 0);

DROP TRIGGER IF EXISTS trg_sam_verified_bi;
DROP TRIGGER IF EXISTS trg_sam_verified_bu;
DROP PROCEDURE IF EXISTS sp_record_apple_match;
DELIMITER $$
CREATE TRIGGER trg_sam_verified_bi BEFORE INSERT ON song_apple_music FOR EACH ROW
BEGIN
  IF NEW.match_status = 'VERIFIED' AND (NEW.apple_track_id <= 0 OR NEW.match_score < 0.74) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: VERIFIED needs a positive Apple track id and match_score >= 0.74';
  END IF;
END$$
CREATE TRIGGER trg_sam_verified_bu BEFORE UPDATE ON song_apple_music FOR EACH ROW
BEGIN
  IF NEW.match_status = 'VERIFIED' AND (NEW.apple_track_id <= 0 OR NEW.match_score < 0.74) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: VERIFIED needs a positive Apple track id and match_score >= 0.74';
  END IF;
END$$

-- Trusted write path. The backend calls this only after a successful Apple response
-- and verifyMatch() (backend/src/providers/appleMusic.js) returned VERIFIED / UNAVAILABLE.
CREATE PROCEDURE sp_record_apple_match(
  IN p_song_id INT UNSIGNED, IN p_track_id BIGINT UNSIGNED, IN p_storefront CHAR(2),
  IN p_track_name VARCHAR(300), IN p_artist_name VARCHAR(300), IN p_collection VARCHAR(300),
  IN p_view_url VARCHAR(500), IN p_artwork VARCHAR(500), IN p_preview VARCHAR(500),
  IN p_score DECIMAL(4,3), IN p_status VARCHAR(12))
BEGIN
  IF p_status NOT IN ('VERIFIED','UNAVAILABLE') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_record_apple_match: status must be VERIFIED or UNAVAILABLE';
  END IF;
  IF p_track_id IS NULL OR p_track_id = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_record_apple_match: apple track id must be positive';
  END IF;
  IF p_status = 'VERIFIED' AND (p_score < 0.74 OR p_preview IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_record_apple_match: VERIFIED needs score >= 0.74 and a preview URL';
  END IF;
  INSERT INTO song_apple_music
    (song_id, apple_track_id, storefront, track_name, artist_name, collection_name, track_view_url,
     artwork_url, preview_url, match_score, match_status, verified_at, last_checked_at)
  VALUES (p_song_id, p_track_id, p_storefront, p_track_name, p_artist_name, p_collection, p_view_url,
          p_artwork, COALESCE(p_preview, 'https://audio-ssl.itunes.apple.com/unavailable.m4a'), p_score, p_status, NOW(), NOW())
  ON DUPLICATE KEY UPDATE
    apple_track_id = VALUES(apple_track_id), storefront = VALUES(storefront), track_name = VALUES(track_name),
    artist_name = VALUES(artist_name), collection_name = VALUES(collection_name), track_view_url = VALUES(track_view_url),
    artwork_url = VALUES(artwork_url), preview_url = VALUES(preview_url), match_score = VALUES(match_score),
    match_status = VALUES(match_status), verified_at = VALUES(verified_at), last_checked_at = NOW();
END$$
DELIMITER ;

REVOKE INSERT, UPDATE ON __DB__.song_apple_music FROM '__APP_USER__'@'__APP_HOST__';
GRANT EXECUTE ON PROCEDURE __DB__.sp_record_apple_match TO '__APP_USER__'@'__APP_HOST__';
