const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

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

const CERT_PATH = process.env.CERT_PATH || path.join(__dirname, '../certs/server.crt');
const KEY_PATH  = process.env.KEY_PATH  || path.join(__dirname, '../certs/server.key');
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT) || 8443;
const tlsAvailable = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

const servers = [];

if (tlsAvailable) {
  // HTTPS server
  const tlsOptions = {
    cert: fs.readFileSync(CERT_PATH),
    key:  fs.readFileSync(KEY_PATH),
  };
  const httpsServer = https.createServer(tlsOptions, app);
  expressWs(app, httpsServer);
  httpsServer.listen(HTTPS_PORT, config.server.host, () => {
    console.log(`\n🎧 Audio Accessibility System`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  HTTPS   : https://${config.server.host}:${HTTPS_PORT}`);
    console.log(`  Admin   : https://${config.server.host}:${HTTPS_PORT}/admin`);
    console.log(`  Public  : ${config.publicUrl}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  });
  servers.push(httpsServer);

  // HTTP → redirect HTTPS
  const redirectApp = express();
  redirectApp.use((req, res) => {
    const host = req.headers.host?.replace(/:.*$/, '');
    res.redirect(301, `https://${host}:${HTTPS_PORT}${req.url}`);
  });
  const httpServer = http.createServer(redirectApp);
  httpServer.listen(config.server.port, config.server.host, () => {
    console.log(`  HTTP :${config.server.port} → redirect HTTPS :${HTTPS_PORT}`);
  });
  servers.push(httpServer);
} else {
  // Pas de cert — HTTP seul
  const server = http.createServer(app);
  expressWs(app, server);
  server.listen(config.server.port, config.server.host, () => {
    console.log(`\n🎧 Audio Accessibility System`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Serveur : http://${config.server.host}:${config.server.port}`);
    console.log(`  Admin   : http://${config.server.host}:${config.server.port}/admin`);
    console.log(`  Public  : ${config.publicUrl}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  });
  servers.push(server);
}

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`${sig} received, shutting down...`);
  servers.forEach(s => s.close());
  setTimeout(() => process.exit(0), 2000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
