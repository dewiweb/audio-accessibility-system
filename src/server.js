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

// ─── TLS ──────────────────────────────────────────────────────────────────────
const CERT_PATH = process.env.CERT_PATH || path.join(__dirname, '../certs/server.crt');
const KEY_PATH  = process.env.KEY_PATH  || path.join(__dirname, '../certs/server.key');

if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
  console.error(`[FATAL] Certificats TLS introuvables : ${CERT_PATH} / ${KEY_PATH}`);
  console.error(`[FATAL] Exécutez docker-entrypoint.sh ou générez les certs manuellement.`);
  process.exit(1);
}

const tlsOptions = {
  cert: fs.readFileSync(CERT_PATH),
  key:  fs.readFileSync(KEY_PATH),
};

// ─── Réseau : mode single ou double interface ─────────────────────────────────
// Single interface (dev / fallback) : PUBLIC_HOST non défini ou == ADMIN_HOST
//   et même port → un seul serveur HTTPS sur adminHost:adminPort
// Double interface (production) :
//   Serveur admin  → ADMIN_HOST:ADMIN_PORT   (réseau régie, admin + WS + API)
//   Serveur public → PUBLIC_HOST:PUBLIC_PORT  (WiFi public, /, /hls uniquement)
const adminHost  = config.server.adminHost;
const adminPort  = config.server.adminPort;
const publicHost = config.server.publicHost;
const publicPort = config.server.publicPort;

const isDualNetwork = (publicHost !== adminHost) || (publicPort !== adminPort);

// ─── Ensure directories ───────────────────────────────────────────────────────
[config.paths.hlsOutput, config.paths.uploads].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Middleware commun ────────────────────────────────────────────────────────
function buildMiddleware(app) {
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors());
  app.use(morgan('dev', {
    skip: (req) => req.path.startsWith('/hls/') && req.path.endsWith('.ts'),
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
}

// ─── Routes HLS (segments audio) ─────────────────────────────────────────────
function mountHls(app) {
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
}

// ─── Application admin (réseau régie) ────────────────────────────────────────
const adminApp = express();
buildMiddleware(adminApp);
adminApp.use(express.static(config.paths.public, { index: false }));
mountHls(adminApp);
adminApp.use('/api', apiRoutes);
adminApp.get('/', (req, res) => res.sendFile(path.join(config.paths.public, 'index.html')));
adminApp.get('/admin', (req, res) => res.sendFile(path.join(config.paths.public, 'admin.html')));
adminApp.use((req, res) => res.status(404).json({ error: 'Not found' }));
adminApp.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: err.message }); });

const adminServer = https.createServer(tlsOptions, adminApp);
adminServer.keepAliveTimeout = 65000;
adminServer.headersTimeout   = 66000;

// expressWs attaché au serveur admin (WebSocket admin + notifications)
expressWs(adminApp, adminServer);
wsManager.attach(expressWs, adminApp);

// ─── Application publique (WiFi écouteurs) ────────────────────────────────────
// En mode single-interface : publicServer réutilise adminServer (même bind)
let publicServer;

if (isDualNetwork) {
  const publicApp = express();
  buildMiddleware(publicApp);
  publicApp.use(express.static(config.paths.public, { index: false }));
  mountHls(publicApp);
  // API lecture seule (canaux publics) uniquement — pas de routes admin
  publicApp.use('/api', apiRoutes);
  publicApp.get('/', (req, res) => res.sendFile(path.join(config.paths.public, 'index.html')));
  // Bloquer /admin sur l'interface publique
  publicApp.get('/admin', (req, res) => res.status(403).json({ error: 'Admin not available on public interface' }));
  publicApp.use((req, res) => res.status(404).json({ error: 'Not found' }));
  publicApp.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: err.message }); });

  publicServer = https.createServer(tlsOptions, publicApp);
  publicServer.keepAliveTimeout = 65000;
  publicServer.headersTimeout   = 66000;
} else {
  publicServer = adminServer;
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
adminServer.listen(adminPort, adminHost, () => {
  console.log(`\n🎧 Audio Accessibility System`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (isDualNetwork) {
    console.log(`  Admin   : https://${adminHost}:${adminPort}/admin  [réseau régie]`);
    console.log(`  AES67   : interface ${config.audio.multicastInterface || adminHost}`);
  } else {
    console.log(`  HTTPS   : https://${adminHost}:${adminPort}`);
    console.log(`  Admin   : https://${adminHost}:${adminPort}/admin`);
  }
  console.log(`  Public  : ${config.publicUrl}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

if (isDualNetwork) {
  publicServer.listen(publicPort, publicHost, () => {
    console.log(`  Écoute  : https://${publicHost}:${publicPort}  [WiFi public]\n`);
  });
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = (sig) => {
  console.log(`${sig} received, shutting down...`);
  const close = (s) => new Promise(resolve => s.close(resolve));
  const servers = isDualNetwork ? [adminServer, publicServer] : [adminServer];
  Promise.all(servers.map(close)).then(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = adminApp;
