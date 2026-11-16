// The runtime media adapter is deliberately limited to LOOP-owned files.
const localMedia = require('./localMedia');

function status() {
  return [{ code: localMedia.code, name: 'LOOP Media Library', ...localMedia.check() }];
}

module.exports = { localMedia, status };
