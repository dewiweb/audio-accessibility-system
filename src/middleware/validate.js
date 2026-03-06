/**
 * validate.js — Security by design
 *
 * Validation et sanitisation centralisées des inputs API.
 * Toutes les routes admin passent par ces middlewares avant traitement.
 */

const path = require('path');

// Caractères autorisés pour les noms de fichiers (whitelist stricte)
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

// Longueurs maximales acceptables
const LIMITS = {
  channelName:   80,
  description:  200,
  language:       8,
  icon:          10,
  color:          7,  // #rrggbb
  sdpContent: 8192,
  filename:      80,
  url:          512,
  password:     128,
};

function clamp(str, max) {
  return typeof str === 'string' ? str.slice(0, max) : str;
}

/**
 * Sanitise une chaîne : supprime les caractères de contrôle, limite la longueur.
 */
function sanitizeStr(val, maxLen) {
  if (val === undefined || val === null) return val;
  return String(val)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // caractères de contrôle
    .slice(0, maxLen);
}

/**
 * Protection path traversal : refuse tout chemin contenant "../", "//" ou commençant par "/"
 * en dehors des préfixes autorisés.
 */
function isSafePath(filePath, allowedPrefixes = ['/app/']) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.normalize(filePath);
  // Reject traversal sequences
  if (normalized.includes('..')) return false;
  // Must start with one of the allowed prefixes
  return allowedPrefixes.some(prefix => normalized.startsWith(prefix));
}

/**
 * Middleware : valide et sanitise le body d'une création/mise à jour de canal.
 */
function validateChannel(req, res, next) {
  const b = req.body;

  if (b.name !== undefined) {
    b.name = sanitizeStr(b.name, LIMITS.channelName);
    if (!b.name || !b.name.trim()) {
      return res.status(400).json({ error: 'Le nom du canal est requis.' });
    }
  }
  if (b.description !== undefined) b.description = sanitizeStr(b.description, LIMITS.description);
  if (b.language    !== undefined) b.language    = sanitizeStr(b.language, LIMITS.language);
  if (b.icon        !== undefined) b.icon        = sanitizeStr(b.icon, LIMITS.icon);

  // Couleur : doit être #rrggbb
  if (b.color !== undefined) {
    if (b.color && !/^#[0-9a-fA-F]{6}$/.test(b.color)) {
      return res.status(400).json({ error: 'Couleur invalide (format attendu : #rrggbb).' });
    }
  }

  // Validation source
  if (b.source) {
    const s = b.source;
    const allowedTypes = ['aes67', 'alsa', 'pulse', 'rtsp', 'file', 'testtone'];
    if (s.type && !allowedTypes.includes(s.type)) {
      return res.status(400).json({ error: `Type de source invalide : ${s.type}` });
    }

    // AES67 : adresse multicast (format 239.x.x.x)
    if (s.multicastAddress !== undefined) {
      if (s.multicastAddress && !/^2(?:2[4-9]|3\d)(?:\.\d{1,3}){3}$/.test(s.multicastAddress)) {
        return res.status(400).json({ error: 'Adresse multicast invalide (plage 224.x.x.x–239.x.x.x attendue).' });
      }
    }

    // Port UDP
    if (s.port !== undefined) {
      const port = parseInt(s.port);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({ error: 'Port invalide.' });
      }
      s.port = port;
    }

    // Chemin de fichier SDP/audio : protection path traversal
    if (s.sdpFile && !isSafePath(s.sdpFile, ['/app/sdp/'])) {
      return res.status(400).json({ error: 'Chemin fichier SDP invalide.' });
    }
    if (s.path && !isSafePath(s.path, ['/app/uploads/', '/app/public/audio/help/'])) {
      return res.status(400).json({ error: 'Chemin fichier audio invalide.' });
    }

    // Contenu SDP : taille max
    if (s.sdpContent !== undefined) {
      s.sdpContent = sanitizeStr(s.sdpContent, LIMITS.sdpContent);
    }

    // URL RTSP
    if (s.url !== undefined) {
      s.url = sanitizeStr(s.url, LIMITS.url);
      if (s.url && !/^rtsp:\/\//i.test(s.url)) {
        return res.status(400).json({ error: 'URL RTSP invalide (doit commencer par rtsp://).' });
      }
    }

    // Gain : bornes
    if (s.gain !== undefined) {
      const gain = parseInt(s.gain);
      if (isNaN(gain) || gain < -40 || gain > 40) {
        return res.status(400).json({ error: 'Gain invalide (plage : -40 à +40 dB).' });
      }
      s.gain = gain;
    }

    // Fréquence tone de test
    if (s.frequency !== undefined) {
      const freq = parseInt(s.frequency);
      if (isNaN(freq) || freq < 20 || freq > 20000) {
        return res.status(400).json({ error: 'Fréquence invalide (plage : 20–20000 Hz).' });
      }
      s.frequency = freq;
    }

    // Boucle fichier (loop) : booléen, uniquement pour type file
    if (s.loop !== undefined) {
      s.loop = Boolean(s.loop);
    }

    // Sélection de paire de canaux AES67 : tableau de 2 entiers 1-basés [1..16]
    if (s.channelMap !== undefined) {
      if (!Array.isArray(s.channelMap) || s.channelMap.length !== 2) {
        return res.status(400).json({ error: 'channelMap doit être un tableau de 2 entiers (ex: [1, 2]).' });
      }
      const [l, r] = s.channelMap.map(n => parseInt(n));
      if (isNaN(l) || isNaN(r) || l < 1 || l > 16 || r < 1 || r > 16) {
        return res.status(400).json({ error: 'channelMap : valeurs attendues entre 1 et 16.' });
      }
      s.channelMap = [l, r];
    }

    // Downmix : valeurs autorisées
    if (s.downmix !== undefined) {
      const allowed = ['stereo', 'stereo-loud', 'binaural', 'mono-to-stereo'];
      if (s.downmix && !allowed.includes(s.downmix)) {
        return res.status(400).json({ error: `downmix invalide. Valeurs acceptées : ${allowed.join(', ')}.` });
      }
    }
  }

  next();
}

/**
 * Middleware : valide le body d'une sauvegarde SDP.
 */
function validateSdpSave(req, res, next) {
  const { filename, content } = req.body;

  if (!filename || typeof filename !== 'string' || !filename.trim()) {
    return res.status(400).json({ error: 'Nom de fichier requis.' });
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.sdp$/i, '');
  if (!SAFE_FILENAME_RE.test(safeName + '.sdp')) {
    return res.status(400).json({ error: 'Nom de fichier invalide.' });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Contenu SDP requis.' });
  }
  if (content.length > LIMITS.sdpContent) {
    return res.status(400).json({ error: `Contenu SDP trop long (max ${LIMITS.sdpContent} caractères).` });
  }

  next();
}

/**
 * Middleware : valide le nom de fichier dans les routes DELETE /sdp/:filename et /audio/:filename.
 */
function validateFilename(req, res, next) {
  const name = req.params.filename;
  if (!name || !SAFE_FILENAME_RE.test(name)) {
    return res.status(400).json({ error: 'Nom de fichier invalide.' });
  }
  next();
}

module.exports = { validateChannel, validateSdpSave, validateFilename, isSafePath, sanitizeStr };
