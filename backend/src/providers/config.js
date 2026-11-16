// Configuration for LOOP-owned local audio only. No external service credentials are read.
const runtime = require('../config/env');
const { localMediaEnabled } = require('./runtimeCapabilities');

module.exports = {
  localMedia: {
    enabled: localMediaEnabled({ isServerless: runtime.isServerless, configured: process.env.LOCAL_MEDIA_ENABLED }),
    dir: process.env.LOCAL_MEDIA_DIR || '',
  },
};
