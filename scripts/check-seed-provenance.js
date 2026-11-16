#!/usr/bin/env node
// Protect the self-hosted media model: seed only LOOP catalogue metadata, never external sources or audio.
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['database/07_seed.sql'];
const RULES = [
  [/INSERT\s+(IGNORE\s+)?INTO\s+`?song_media`?/i, 'seed inserts a media/playback row; audio must be added through Admin or approved Artist publishing'],
  [/INSERT\s+(IGNORE\s+)?INTO\s+`?song_apple_music`?/i, 'seed inserts a retired external catalogue match'],
  [/audio[a-z0-9-]*\.itunes\.apple\.com|mzstatic\.com|open\.spotify\.com|youtube\.com|youtu\.be/i, 'seed contains a third-party music media URL'],
  [/'MUSE_SKETCH'[^;]*,\s*1,\s*0,/is, 'retired demo playback source is enabled in the seed'],
  [/https?:\/\//i, 'seed contains an external URL; the new catalogue must be LOOP-local'],
  [/'(?:MUSICBRAINZ|TMDB|SPOTIFY|YOUTUBE_DATA|APPLE_MUSIC|JAMENDO|THEAUDIODB|EXTERNAL_PREVIEW)'/i, 'seed registers an external provider source'],
];

function scan(root = process.cwd()) {
  const problems = [];
  for (const rel of FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [re, msg] of RULES) if (re.test(text)) problems.push(`${rel}: ${msg}`);
    const block = text.match(/INSERT\s+INTO\s+music_sources\b[\s\S]*?\bVALUES\s*([\s\S]*?);/i)?.[1] || '';
    const codes = [...block.matchAll(/\('([^']+)'/g)].map((m) => m[1]);
    const allowed = new Set(['MUSE_SEED_CATALOG', 'MUSE_CATALOG_FEED', 'MANUAL_ENTRY']);
    for (const code of codes) if (!allowed.has(code)) problems.push(`${rel}: unexpected music source in seed: ${code}`);
    if (!block) problems.push(`${rel}: could not find music_sources seed block`);
  }
  return problems;
}

if (require.main === module) {
  const problems = scan();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('seed policy OK: LOOP-local catalogue metadata only; no external sources, audio, or media URLs');
}
module.exports = { scan, RULES };
