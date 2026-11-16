// Self-hosted playback boundary: only files from LOOP's persistent media folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// Load the file-system adapter with a tiny config stub so these unit tests do
// not need a database connection or the rest of the app's environment stack.
const config = { localMedia: { enabled: true, dir: '' } };
const localMediaPath = require.resolve('../../src/providers/localMedia');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent?.filename === localMediaPath && request === './config') return config;
  return originalLoad.call(this, request, parent, isMain);
};
let localMedia;
try { localMedia = require(localMediaPath); } finally { Module._load = originalLoad; }
const providers = require('../../src/providers');

let mediaDir;
before(() => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-local-media-'));
  config.localMedia.dir = mediaDir;
  config.localMedia.enabled = true;
});
after(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

test('the only runtime media adapter is LOOP Media Library', () => {
  const status = providers.status();
  assert.equal(status.length, 1);
  assert.equal(status[0].code, 'LOCAL_MEDIA');
  assert.equal(status[0].name, 'LOOP Media Library');
});

test('local media accepts supported file types and rejects traversal or remote URLs', () => {
  for (const name of ['track.mp3', 'track.m4a', 'track.wav', 'track.flac']) assert.ok(localMedia.resolveFile(name), name);
  for (const name of ['../track.mp3', '..%2ftrack.mp3', '/tmp/track.mp3', 'track.exe', 'https://host/track.mp3', 'a..b.mp3']) {
    assert.equal(localMedia.resolveFile(name), null, name);
  }
});

test('only files physically present in the configured LOOP media folder are listed and playable', () => {
  const file = path.join(mediaDir, 'owned-test.wav');
  fs.writeFileSync(file, Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(localMedia.list(), ['owned-test.wav']);
  assert.equal(localMedia.available('owned-test.wav'), true);
  assert.equal(localMedia.available('missing.wav'), false);
  assert.equal(localMedia.available('../owned-test.wav'), false);
});
