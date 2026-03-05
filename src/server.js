const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const apiRoutes = require('./routes/api');
const wsManager = require('./wsManager');

const app = express();
expressWs(app);

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

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`\n🎧 Audio Accessibility System`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Serveur : http://${config.server.host}:${config.server.port}`);
  console.log(`  Admin   : http://${config.server.host}:${config.server.port}/admin`);
  console.log(`  Public  : ${config.publicUrl}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

module.exports = app;
