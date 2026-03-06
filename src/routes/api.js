const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { exec } = require('child_process');
const rateLimit = require('express-rate-limit');
const channelManager = require('../channelManager');
const streamManager = require('../streamManager');
const config = require('../config');
const authManager = require('../authManager');
const tokenManager = require('../tokenManager');
const { validateChannel, validateSdpSave, validateFilename } = require('../middleware/validate');
const QRCode = require('qrcode');

const IS_PROD = process.env.NODE_ENV === 'production';

const sdpDir = path.join(__dirname, '../../sdp');
const audioDir = path.join(__dirname, '../../uploads/audio');

const sdpStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(sdpDir)) fs.mkdirSync(sdpDir, { recursive: true });
    cb(null, sdpDir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const uploadSdp = multer({
  storage: sdpStorage,
  limits: { fileSize: 64 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.sdp') || file.mimetype === 'application/sdp' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .sdp sont acceptés'));
    }
  },
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    cb(null, audioDir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format audio non supporté. Formats acceptés: mp3, wav, ogg, flac, aac, m4a, opus'));
    }
  },
});

// Rate limiting sur les routes d'authentification (anti brute-force — ANSSI RGS)
const authLimiter = rateLimit({
  windowMs: config.security.rateLimitAuthWindow,
  max: config.security.rateLimitAuthMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  skipSuccessfulRequests: false,
});

// Rate limiting général sur toutes les routes admin (hors auth)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes.' },
});

// Middleware d'authentification admin par token HMAC (Security by design)
// Le mot de passe n'est plus jamais transmis dans les headers après le login initial.
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!tokenManager.verify(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Public routes ---

router.get('/channels', (req, res) => {
  res.json(channelManager.getPublicChannels());
});

router.get('/channels/:id', (req, res) => {
  const ch = channelManager.getChannel(req.params.id);
  if (!ch || !ch.active) return res.status(404).json({ error: 'Channel not found' });
  res.json({
    id: ch.id,
    name: ch.name,
    description: ch.description,
    language: ch.language,
    icon: ch.icon,
    color: ch.color,
    hlsUrl: `/hls/${ch.id}/stream.m3u8`,
    listenerCount: ch.listenerCount,
    sourceType: ch.source?.type || 'unknown',
    sourceLoop: ch.source?.loop === true,
  });
});

router.get('/qrcode', async (req, res) => {
  try {
    // En mode double interface, le QR code pointe sur l'URL WiFi public (écoute)
    // sinon sur PUBLIC_URL (mode single-interface)
    const url = process.env.PUBLIC_LISTENER_URL || config.publicUrl;
    const adminUrl = config.publicUrl;
    
    console.log('[QR Code] Generating for URL:', url);
    console.log('[QR Code] Public URL config:', config.publicUrl);
    
    if (!url) {
      console.error('[QR Code] No URL configured');
      return res.status(500).json({ error: 'No URL configured for QR code' });
    }
    
    const qr = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#1e1b4b', light: '#ffffff' },
    });
    
    console.log('[QR Code] Generated successfully');
    res.json({
      url,
      adminUrl: adminUrl !== url ? adminUrl : null,
      isDualNetwork: url !== adminUrl,
      qrcode: qr,
    });
  } catch (e) {
    console.error('[QR Code] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- Admin routes ---

router.get('/admin/stats', requireAdmin, (req, res) => {
  const stats = channelManager.getStats();
  const streams = streamManager.getActiveStreams();
  res.json({ ...stats, activeStreams: streams });
});

router.get('/admin/channels', requireAdmin, (req, res) => {
  res.json(channelManager.getAllChannels());
});

router.post('/admin/channels', requireAdmin, validateChannel, (req, res) => {
  const { name, description, language, icon, color, source } = req.body;
  if (!name || !source) return res.status(400).json({ error: 'name and source are required' });

  // If SDP content was pasted inline (no file path), save it to disk
  if (source.type === 'aes67' && source.sdpContent && !source.sdpFile) {
    if (!fs.existsSync(sdpDir)) fs.mkdirSync(sdpDir, { recursive: true });
    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const localPath = path.join(sdpDir, `${safeName}.sdp`);
    fs.writeFileSync(localPath, source.sdpContent);
    source.sdpFile = `/app/sdp/${safeName}.sdp`;
    delete source.sdpContent;
  } else if (source.type === 'aes67' && source.sdpContent && source.sdpFile) {
    // sdpFile already set (from upload) — discard redundant sdpContent
    delete source.sdpContent;
  }

  const channel = channelManager.createChannel({ name, description, language, icon, color, source });
  res.status(201).json(channel);
});

router.put('/admin/channels/:id', requireAdmin, validateChannel, (req, res) => {
  const updated = channelManager.updateChannel(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Channel not found' });
  res.json(updated);
});

router.delete('/admin/channels/:id', requireAdmin, (req, res) => {
  streamManager.stopStream(req.params.id);
  const ok = channelManager.deleteChannel(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Channel not found' });
  res.json({ success: true });
});

router.post('/admin/channels/:id/start', requireAdmin, (req, res) => {
  const channel = channelManager.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  try {
    const result = streamManager.startStream(req.params.id, channel.source);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/channels/:id/stop', requireAdmin, (req, res) => {
  const ok = streamManager.stopStream(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Stream not active' });
  res.json({ success: true });
});

router.post('/admin/channels/:id/restart', requireAdmin, (req, res) => {
  const ok = streamManager.restartStream(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Stream not active' });
  res.json({ success: true });
});

router.post('/admin/channels/:id/testtone', requireAdmin, (req, res) => {
  const channel = channelManager.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const freq = req.body.frequency || 440;
  try {
    const result = streamManager.startTestTone(req.params.id, freq);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/sdp/list', requireAdmin, (req, res) => {
  if (!fs.existsSync(sdpDir)) return res.json([]);
  const files = fs.readdirSync(sdpDir)
    .filter(f => f.endsWith('.sdp'))
    .map(f => ({
      filename: f,
      path: `/app/sdp/${f}`,
      size: fs.statSync(path.join(sdpDir, f)).size,
      content: fs.readFileSync(path.join(sdpDir, f), 'utf8'),
    }));
  res.json(files);
});

router.post('/admin/sdp/upload', requireAdmin, uploadSdp.single('sdpfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.json({
    filename: req.file.filename,
    path: `/app/sdp/${req.file.filename}`,
    size: req.file.size,
    content: fs.readFileSync(req.file.path, 'utf8'),
  });
}, (err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

router.post('/admin/sdp/save', requireAdmin, validateSdpSave, (req, res) => {
  const { filename, content } = req.body;
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.sdp$/i, '') + '.sdp';
  if (!fs.existsSync(sdpDir)) fs.mkdirSync(sdpDir, { recursive: true });
  const filePath = path.join(sdpDir, safe);
  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ filename: safe, path: `/app/sdp/${safe}`, size: content.length });
});

router.delete('/admin/sdp/:filename', requireAdmin, validateFilename, (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(sdpDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

router.get('/admin/audio/list', requireAdmin, (req, res) => {
  const audioExt = /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i;
  const files = [];

  if (fs.existsSync(audioDir)) {
    fs.readdirSync(audioDir)
      .filter(f => audioExt.test(f))
      .forEach(f => files.push({
        filename: f,
        path: `/app/uploads/audio/${f}`,
        size: fs.statSync(path.join(audioDir, f)).size,
      }));
  }

  const helpDir = path.join(__dirname, '../../public/audio/help');
  if (fs.existsSync(helpDir)) {
    fs.readdirSync(helpDir)
      .filter(f => audioExt.test(f))
      .forEach(f => files.push({
        filename: `[aide] ${f}`,
        path: `/app/public/audio/help/${f}`,
        size: fs.statSync(path.join(helpDir, f)).size,
      }));
  }

  res.json(files);
});

router.post('/admin/audio/upload', requireAdmin, (req, res) => {
  uploadAudio.single('audiofile')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    res.json({
      filename: req.file.filename,
      path: `/app/uploads/audio/${req.file.filename}`,
      size: req.file.size,
    });
  });
});

router.delete('/admin/audio/:filename', requireAdmin, validateFilename, (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(audioDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

router.get('/admin/sources/list', adminLimiter, requireAdmin, (req, res) => {
  // Exécution asynchrone pour ne pas bloquer la boucle d'événements Node.js
  const results = { alsa: [], pulse: [] };
  let pending = 2;
  const done = () => { if (--pending === 0) res.json(results); };

  exec('arecord -l 2>/dev/null', { timeout: 5000 }, (err, stdout) => {
    if (!err && stdout) {
      results.alsa = stdout.split('\n')
        .filter(l => l.startsWith('card'))
        .map(l => {
          const m = l.match(/card (\d+):.*\[(.+)\].*device (\d+):.*\[(.+)\]/);
          if (!m) return null;
          return { type: 'alsa', card: parseInt(m[1]), device: parseInt(m[3]), name: `${m[2]} - ${m[4]}` };
        }).filter(Boolean);
    }
    done();
  });

  exec('pactl list sources short 2>/dev/null', { timeout: 5000 }, (err, stdout) => {
    if (!err && stdout) {
      results.pulse = stdout.split('\n').filter(Boolean).map(l => {
        const parts = l.split('\t');
        return { type: 'pulse', device: parts[1], name: parts[1] };
      }).filter(d => d.device);
    }
    done();
  });
});

// ─── Routes Système (Volet 4 — Admin enrichie) ───────────────────────────────

// Infos système : CPU load, mémoire, disque HLS, uptime
router.get('/admin/system/info', adminLimiter, requireAdmin, (req, res) => {
  const os = require('os');
  const cpus = os.cpus();
  const loadAvg = os.loadavg(); // [1min, 5min, 15min]
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const uptime   = os.uptime(); // secondes

  // Espace disque du répertoire HLS (approximatif via du)
  exec(`df -k "${config.paths.hlsOutput}" 2>/dev/null | tail -1`, { timeout: 3000 }, (err, stdout) => {
    let disk = null;
    if (!err && stdout) {
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        disk = {
          total: parseInt(parts[1]) * 1024,
          used:  parseInt(parts[2]) * 1024,
          free:  parseInt(parts[3]) * 1024,
        };
      }
    }
    // Détection environnement containerisé
    let isContainerized = process.env.NODE_ENV === 'production' && 
      (process.env.DOCKER_CONTAINER || fs.existsSync('/.dockerenv'));
    
    // Vérifier les cgroups de manière asynchrone si nécessaire
    if (!isContainerized && fs.existsSync('/proc/1/cgroup')) {
      try {
        const cgroupContent = fs.readFileSync('/proc/1/cgroup', 'utf8');
        isContainerized = cgroupContent.includes('docker') || cgroupContent.includes('containerd');
      } catch (e) {
        // Ignorer les erreurs de lecture
      }
    }

    // Load average peu fiable dans certains conteneurs
    const loadAvgReliable = !isContainerized || (loadAvg[0] > 0 && loadAvg[1] > 0 && loadAvg[2] > 0);
    
    res.json({
      cpu: {
        count: cpus.length,
        model: cpus[0]?.model || 'unknown',
        loadAvg1:  Math.round(loadAvg[0] * 100) / 100,
        loadAvg5:  Math.round(loadAvg[1] * 100) / 100,
        loadAvg15: Math.round(loadAvg[2] * 100) / 100,
        loadPercent: loadAvgReliable ? Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100)) : 0,
        loadAvgReliable, // Indicateur pour le frontend
        isContainerized,
      },
      memory: {
        total: totalMem,
        free:  freeMem,
        used:  totalMem - freeMem,
        usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      disk,
      uptime,
      nodeVersion: process.version,
      platform: os.platform(),
    });
  });
});

// Interfaces réseau disponibles sur l'hôte
router.get('/admin/network/interfaces', adminLimiter, requireAdmin, (req, res) => {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.internal) continue; // skip loopback
      result.push({
        name,
        address: addr.address,
        family:  addr.family,
        netmask: addr.netmask,
        mac:     addr.mac,
      });
    }
  }
  res.json(result);
});

// Configuration réseau actuelle de l'application (lecture)
router.get('/admin/network/config', adminLimiter, requireAdmin, (req, res) => {
  res.json({
    adminHost:  process.env.ADMIN_HOST  || process.env.HOST || '0.0.0.0',
    adminPort:  parseInt(process.env.ADMIN_PORT  || process.env.HTTPS_PORT || 8443),
    publicHost: process.env.PUBLIC_HOST || process.env.HOST || '0.0.0.0',
    publicPort: parseInt(process.env.PUBLIC_PORT || process.env.HTTPS_PORT || 8443),
    publicUrl:  config.publicUrl,
    publicListenerUrl: process.env.PUBLIC_LISTENER_URL || null,
    isDualNetwork: (process.env.PUBLIC_HOST && process.env.PUBLIC_HOST !== (process.env.ADMIN_HOST || process.env.HOST || '0.0.0.0'))
      || (process.env.PUBLIC_PORT && process.env.PUBLIC_PORT !== (process.env.ADMIN_PORT || process.env.HTTPS_PORT || '8443')),
    multicastInterface: config.audio.multicastInterface || null,
    tlsCn: process.env.TLS_CN || null,
    nodeEnv: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });
});

// Version du système
router.get('/admin/version', requireAdmin, (req, res) => {
  try {
    const packageJson = require('../../package.json');
    res.json({
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description,
      nodeVersion: process.version,
      uptime: process.uptime(),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Unable to read version' });
  }
});

// Login : seul endpoint qui accepte le mot de passe — retourne un token HMAC signé
router.post('/admin/auth', authLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  try {
    const ok = await authManager.verifyPassword(password);
    if (!ok) {
      // Délai constant pour éviter les timing attacks
      await new Promise(r => setTimeout(r, 300));
      return res.status(401).json({ error: 'Incorrect password' });
    }
    // Génère un token HMAC à durée limitée (8h par défaut)
    const token = tokenManager.generate();
    res.json({ success: true, token, expiresIn: tokenManager.TOKEN_TTL_MS });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Changement de mot de passe — nécessite token valide + vérification mot de passe actuel
router.post('/admin/password', authLimiter, requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  try {
    const ok = await authManager.verifyPassword(currentPassword);
    if (!ok) {
      await new Promise(r => setTimeout(r, 300));
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await authManager.updatePassword(newPassword);
    console.log('[Admin] Mot de passe modifié en mémoire (runtime only)');
    res.json({ success: true, message: 'Password updated for current session' });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
