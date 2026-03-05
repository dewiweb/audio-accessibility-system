const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const channelManager = require('../channelManager');
const streamManager = require('../streamManager');
const config = require('../config');
const QRCode = require('qrcode');

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

function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-password'] || req.query.adminPassword;
  if (auth !== config.security.adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
  });
});

router.get('/qrcode', async (req, res) => {
  try {
    const url = config.publicUrl;
    const qr = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#1e1b4b', light: '#ffffff' },
    });
    res.json({ url, qrcode: qr });
  } catch (e) {
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

router.post('/admin/channels', requireAdmin, (req, res) => {
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

router.put('/admin/channels/:id', requireAdmin, (req, res) => {
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

router.post('/admin/sdp/save', requireAdmin, (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'filename et content requis' });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.sdp$/i, '') + '.sdp';
  if (!fs.existsSync(sdpDir)) fs.mkdirSync(sdpDir, { recursive: true });
  const filePath = path.join(sdpDir, safe);
  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ filename: safe, path: `/app/sdp/${safe}`, size: content.length });
});

router.delete('/admin/sdp/:filename', requireAdmin, (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(sdpDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

router.get('/admin/audio/list', requireAdmin, (req, res) => {
  if (!fs.existsSync(audioDir)) return res.json([]);
  const files = fs.readdirSync(audioDir)
    .filter(f => /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(f))
    .map(f => ({
      filename: f,
      path: `/app/uploads/audio/${f}`,
      size: fs.statSync(path.join(audioDir, f)).size,
    }));
  res.json(files);
});

router.post('/admin/audio/upload', requireAdmin, uploadAudio.single('audiofile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.json({
    filename: req.file.filename,
    path: `/app/uploads/audio/${req.file.filename}`,
    size: req.file.size,
  });
}, (err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

router.delete('/admin/audio/:filename', requireAdmin, (req, res) => {
  const safe = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(audioDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

router.get('/admin/sources/list', requireAdmin, (req, res) => {
  const { execSync } = require('child_process');
  let alsaDevices = [];
  let pulseDevices = [];
  try {
    const raw = execSync('arecord -l 2>/dev/null').toString();
    const lines = raw.split('\n').filter(l => l.startsWith('card'));
    alsaDevices = lines.map(l => {
      const m = l.match(/card (\d+):.*\[(.+)\].*device (\d+):.*\[(.+)\]/);
      if (!m) return null;
      return { type: 'alsa', card: parseInt(m[1]), device: parseInt(m[3]), name: `${m[2]} - ${m[4]}` };
    }).filter(Boolean);
  } catch (e) {}
  try {
    const raw = execSync('pactl list sources short 2>/dev/null').toString();
    const lines = raw.split('\n').filter(Boolean);
    pulseDevices = lines.map(l => {
      const parts = l.split('\t');
      return { type: 'pulse', device: parts[1], name: parts[1] };
    }).filter(d => d.device);
  } catch (e) {}
  res.json({ alsa: alsaDevices, pulse: pulseDevices });
});

router.post('/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password !== config.security.adminPassword) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ success: true, token: config.security.adminPassword });
});

module.exports = router;
