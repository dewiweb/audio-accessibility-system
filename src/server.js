const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const https = require('https');

const config = require('./config');
const apiRoutes = require('./routes/api');
const wsManager = require('./wsManager');

const app = express();

// Ensure directories exist
[config.paths.hlsOutput, config.paths.uploads].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files - public app
app.use(express.static(config.paths.public, { index: false }));

// HLS streams - low cache headers for live streaming
app.use('/hls', (req, res, next) => {
  if (req.path.endsWith('.m3u8')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (req.path.endsWith('.ts')) {
    res.setHeader('Cache-Control', 'max-age=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
}, express.static(config.paths.hlsOutput));

// API routes
app.use('/api', apiRoutes);

// WebSocket
wsManager.attach(expressWs, app);

// Serve listener app
app.get('/', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

// Serve admin app
app.get('/admin', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'admin.html'));
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

const CERT_PATH  = process.env.CERT_PATH  || path.join(__dirname, '../certs/server.crt');
const KEY_PATH   = process.env.KEY_PATH   || path.join(__dirname, '../certs/server.key');
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT) || 8443;

if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
  console.error(`[FATAL] Certificats TLS introuvables : ${CERT_PATH} / ${KEY_PATH}`);
  console.error(`[FATAL] Exécutez docker-entrypoint.sh ou générez les certs manuellement.`);
  process.exit(1);
}

const tlsOptions = {
  cert: fs.readFileSync(CERT_PATH),
  key:  fs.readFileSync(KEY_PATH),
};

const server = https.createServer(tlsOptions, app);
expressWs(app, server);

server.listen(HTTPS_PORT, config.server.host, () => {
  console.log(`\n🎧 Audio Accessibility System`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  HTTPS   : https://${config.server.host}:${HTTPS_PORT}`);
  console.log(`  Admin   : https://${config.server.host}:${HTTPS_PORT}/admin`);
  console.log(`  Public  : ${config.publicUrl}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`${sig} received, shutting down...`);
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
