require('dotenv').config();
const path = require('path');

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    // Double interface réseau :
    // ADMIN_HOST = IP interface régie (admin + AES67). Défaut = HOST.
    // PUBLIC_HOST = IP interface WiFi public (HLS écouteurs). Défaut = HOST (mode single).
    // ADMIN_PORT / PUBLIC_PORT permettent des ports différents si besoin.
    adminHost:  process.env.ADMIN_HOST  || process.env.HOST || '0.0.0.0',
    publicHost: process.env.PUBLIC_HOST || process.env.HOST || '0.0.0.0',
    adminPort:  parseInt(process.env.ADMIN_PORT)  || parseInt(process.env.HTTPS_PORT) || 9443,
    publicPort: parseInt(process.env.PUBLIC_PORT) || parseInt(process.env.HTTPS_PORT) || 9443,
    // URL publique exposée aux écouteurs (peut différer de l'URL admin)
    publicListenerUrl: process.env.PUBLIC_LISTENER_URL || process.env.PUBLIC_URL || null,
  },
  security: {
    adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
    sessionSecret: process.env.SESSION_SECRET || 'audio-access-secret',
  },
  audio: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    hlsSegmentDuration: parseInt(process.env.HLS_SEGMENT_DURATION) || 1,
    hlsListSize: parseInt(process.env.HLS_LIST_SIZE) || 3,
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 48000,
    bitrate: process.env.AUDIO_BITRATE || '128k',
    // AES67/RTP buffer in milliseconds (compensates network jitter)
    rtpBufferMs: parseInt(process.env.RTP_BUFFER_MS) || 200,
    // Multicast interface (network interface name or IP)
    multicastInterface: process.env.MULTICAST_INTERFACE || '',
  },
  paths: {
    hlsOutput: process.env.HLS_OUTPUT_DIR || path.join(__dirname, '../public/hls'),
    uploads: process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'),
    public: path.join(__dirname, '../public'),
  },
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
};
