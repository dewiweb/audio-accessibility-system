require('dotenv').config();
const path = require('path');

// Avertissement si les secrets par défaut sont utilisés en production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme') {
    console.error('[FATAL] ADMIN_PASSWORD non défini ou valeur par défaut "changeme" — arrêt du serveur.');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error('[FATAL] SESSION_SECRET absent ou trop court (min 32 chars) — arrêt du serveur.');
    process.exit(1);
  }
}

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    // Double interface réseau :
    // ADMIN_HOST = IP interface régie (admin + AES67). Défaut = HOST.
    // PUBLIC_HOST = IP interface WiFi public (HLS écouteurs). Défaut = HOST (mode single).
    adminHost:  process.env.ADMIN_HOST  || process.env.HOST || '0.0.0.0',
    publicHost: process.env.PUBLIC_HOST || process.env.HOST || '0.0.0.0',
    adminPort:  parseInt(process.env.ADMIN_PORT)  || parseInt(process.env.HTTPS_PORT) || 8443,
    publicPort: parseInt(process.env.PUBLIC_PORT) || parseInt(process.env.HTTPS_PORT) || 8443,
  },
  security: {
    adminPassword: process.env.ADMIN_PASSWORD || 'admin1234',
    adminPasswordHash: null, // rempli au démarrage par authManager
    sessionSecret: process.env.SESSION_SECRET || 'audio-access-secret-CHANGE-ME-min32chars',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
    // Origines autorisées pour CORS — liste séparée par des virgules, ou '*' pour tests
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : null, // null = même origine uniquement (mode sécurisé par défaut)
    // Rate limiting authentification admin
    rateLimitAuthWindow: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000,
    rateLimitAuthMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  },
  audio: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    // 4s par défaut : 50 req/s pour 200 clients au lieu de 200 req/s avec 1s
    hlsSegmentDuration: parseInt(process.env.HLS_SEGMENT_DURATION) || 4,
    hlsListSize: parseInt(process.env.HLS_LIST_SIZE) || 4,
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
  // Priorité : PUBLIC_URL explicite, sinon https si HTTPS_PORT défini, sinon http (dev)
  publicUrl: process.env.PUBLIC_URL ||
    (process.env.HTTPS_PORT
      ? `https://localhost:${process.env.HTTPS_PORT}`
      : `http://localhost:${process.env.PORT || 3000}`),
};
