const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const https = require('https');

const crypto = require('crypto');
const config = require('./config');
const authManager = require('./authManager');
const apiRoutes = require('./routes/api');
const wsManager = require('./wsManager');

// Initialisation du hash bcrypt du mot de passe admin au démarrage
authManager.init();

// TLS — requis, process.exit(1) si absent
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
  // ANSSI RGS B1 / guide TLS : TLS 1.2 minimum, TLS 1.3 recommandé
  minVersion: 'TLSv1.2',
  // Ciphers ANSSI-compatibles : ECDHE + AES-GCM/CHACHA20, pas de RC4/3DES/export
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_AES_128_GCM_SHA256',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
  ].join(':'),
  honorCipherOrder: true,
};

const app = express();
const server = https.createServer(tlsOptions, app);

// Keep-alive : réutilisation des connexions TLS entre requêtes HLS
// Crucial pour 450 clients : évite un handshake TLS à chaque segment
server.keepAliveTimeout = 65000;
server.headersTimeout   = 66000;

// expressWs doit être initialisé avec le serveur HTTPS avant toute route WS
expressWs(app, server);

// Ensure directories exist
[config.paths.hlsOutput, config.paths.uploads].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- CORS ---
// Par défaut : même origine uniquement (pas de cross-origin).
// En production sur réseau local, ALLOWED_ORIGINS peut lister les origines autorisées.
const corsOptions = config.security.allowedOrigins
  ? {
      origin: (origin, callback) => {
        if (!origin || config.security.allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS: origine non autorisée'));
        }
      },
      credentials: false,
    }
  : { origin: false }; // Bloque tout cross-origin si ALLOWED_ORIGINS non défini
app.use(cors(corsOptions));

// --- Helmet : headers HTTP sécurisés (ANSSI guide HTTP) ---
// La CSP est gérée séparément via le middleware cspWithNonce ci-dessous
// pour permettre l'utilisation d'un nonce par requête (supprime 'unsafe-inline').
app.use(helmet({
  contentSecurityPolicy: false, // géré par cspWithNonce
  // HSTS : 1 an, inclure sous-domaines
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: false,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: false,
  hidePoweredBy: true,
}));

// --- CSP avec nonce par requête (Security by design — supprime 'unsafe-inline') ---
// Un nonce cryptographiquement aléatoire est généré à chaque requête de page HTML.
// Il est injecté dans le header CSP ET dans le HTML via res.locals.cspNonce,
// ce qui permet aux balises <style nonce="..."> légitimes d'être exécutées
// sans avoir besoin de 'unsafe-inline'.
app.use((req, res, next) => {
  // Nonce 128 bits en base64url
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64url');
  const nonce = res.locals.cspNonce;
  const host  = req.headers.host || '';

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' blob:`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data:`,
    `connect-src 'self' wss://${host} https://${host}`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `font-src 'none'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
});

// --- Morgan : logs HTTP anonymisés (RGPD — pas d'IP en clair) ---
// On tronque l'IP : 192.168.1.42 → 192.168.1.x
morgan.token('anon-ip', (req) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  return ip.replace(/(\d+\.\d+\.\d+\.)\d+/, '$1x')
           .replace(/([\da-f]+:[\da-f]+:[\da-f]+:[\da-f]+:)[\da-f:]+/i, '$1x');
});
const logFormat = ':anon-ip :method :url :status :res[content-length] - :response-time ms';
app.use(morgan(logFormat, {
  skip: (req) => req.path.startsWith('/hls/') && req.path.endsWith('.ts'),
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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

// Injection du nonce CSP dans les pages HTML (Security by design)
// Chaque <style> devient <style nonce="{nonce}"> ce qui élimine le besoin de 'unsafe-inline'.
function serveHtmlWithNonce(htmlFile) {
  return (req, res) => {
    const filePath = path.join(config.paths.public, htmlFile);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      const nonce = res.locals.cspNonce;
      // Injecte le nonce sur toutes les balises <style> et <script> (avec ou sans src)
      // script-src avec nonce exige le nonce sur TOUS les scripts, y compris externes
      const patched = html
        .replace(/<style>/g,  `<style nonce="${nonce}">`)
        .replace(/<script>/g, `<script nonce="${nonce}">`)
        .replace(/<script src=/g, `<script nonce="${nonce}" src=`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(patched);
    });
  };
}

// Serve listener app
app.get('/', serveHtmlWithNonce('index.html'));

// Serve admin app — rediriger si query params présents (credentials en GET = sécurité + boucle)
app.get('/admin', (req, res, next) => {
  if (Object.keys(req.query).length > 0) {
    return res.redirect(302, '/admin');
  }
  next();
}, serveHtmlWithNonce('admin.html'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler — erreurs opaques en production (ANSSI : ne pas exposer les stack traces)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[Error] ${status} ${req.method} ${req.path} — ${err.message}`);
  if (process.env.NODE_ENV === 'production') {
    res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
  } else {
    res.status(status).json({ error: err.message, stack: err.stack });
  }
});

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
