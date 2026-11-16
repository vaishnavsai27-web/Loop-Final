-- 0015 — UNAVAILABLE rows no longer need a placeholder preview URL (forward-only).
-- 0013 stored a dummy audio-ssl URL for tracks with no official preview because preview_url was NOT NULL.
-- preview_url is now nullable; CHECK constraints pass for NULL, and VERIFIED still requires a real URL.
UPDATE song_apple_music SET preview_url = NULL WHERE preview_url = 'https://audio-ssl.itunes.apple.com/unavailable.m4a';

ALTER TABLE song_apple_music MODIFY preview_url VARCHAR(500) NULL;

DROP TRIGGER IF EXISTS trg_sam_verified_bi;
DROP TRIGGER IF EXISTS trg_sam_verified_bu;
DROP PROCEDURE IF EXISTS sp_record_apple_match;
DELIMITER $$
CREATE TRIGGER trg_sam_verified_bi BEFORE INSERT ON song_apple_music FOR EACH ROW
BEGIN
  IF NEW.match_status = 'VERIFIED' AND (NEW.apple_track_id <= 0 OR NEW.match_score < 0.74 OR NEW.preview_url IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: VERIFIED needs a positive Apple track id, match_score >= 0.74 and a preview URL';
  END IF;
END$$
CREATE TRIGGER trg_sam_verified_bu BEFORE UPDATE ON song_apple_music FOR EACH ROW
BEGIN
  IF NEW.match_status = 'VERIFIED' AND (NEW.apple_track_id <= 0 OR NEW.match_score < 0.74 OR NEW.preview_url IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LOOP policy: VERIFIED needs a positive Apple track id, match_score >= 0.74 and a preview URL';
  END IF;
END$$
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
          p_artwork, p_preview, p_score, p_status, NOW(), NOW())
  ON DUPLICATE KEY UPDATE
    apple_track_id = VALUES(apple_track_id), storefront = VALUES(storefront), track_name = VALUES(track_name),
    artist_name = VALUES(artist_name), collection_name = VALUES(collection_name), track_view_url = VALUES(track_view_url),
    artwork_url = VALUES(artwork_url), preview_url = VALUES(preview_url), match_score = VALUES(match_score),
    match_status = VALUES(match_status), verified_at = VALUES(verified_at), last_checked_at = NOW();
END$$
DELIMITER ;

GRANT EXECUTE ON PROCEDURE __DB__.sp_record_apple_match TO '__APP_USER__'@'__APP_HOST__';
