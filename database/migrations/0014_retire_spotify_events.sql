-- 0014 — retire Spotify embed activity (forward-only).
-- LOOP plays Apple Music previews only. Migration 0011's table was never granted to loop_app
-- and its API route has been removed, so nothing can write to or read from it any more.
DROP VIEW IF EXISTS v_spotify_embed_activity;
DROP TABLE IF EXISTS spotify_embed_events;
