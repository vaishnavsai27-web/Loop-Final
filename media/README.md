# LOOP media folder

Put audio files here **only if LOOP owns them or is licensed to stream them**, then register each one to a song in
**Admin → LOOP media**. Supported: mp3, m4a, aac, ogg, opus, wav, flac. File names: letters, digits, `.`, `_`, `-`.

Files are streamed only to signed-in users through `/api/media/:id`. Everything in this folder except this README is
git-ignored. Artist uploads are quarantined in `artist-quarantine/` here until an Admin publishes them.
Change the location with `LOCAL_MEDIA_DIR`. Serverless hosts (Vercel) never use this folder.
