/**
 * tokenManager — Security by design
 *
 * Génère et vérifie des tokens HMAC-SHA256 à durée limitée pour l'authentification admin.
 * Le mot de passe n'est plus jamais transmis dans les headers des requêtes API après login.
 *
 * Format token : base64url(payload_json) + "." + base64url(HMAC-SHA256(payload))
 * Payload : { iat: timestamp_ms, exp: timestamp_ms }
 */

const crypto = require('crypto');
const config = require('./config');

const TOKEN_TTL_MS = parseInt(process.env.ADMIN_TOKEN_TTL_MS) || 8 * 60 * 60 * 1000; // 8h par défaut

function _b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function _hmac(payload) {
  return crypto.createHmac('sha256', config.security.sessionSecret)
    .update(payload)
    .digest();
}

/**
 * Génère un token valide pour la durée TOKEN_TTL_MS.
 */
function generate() {
  const now = Date.now();
  const payload = _b64url(JSON.stringify({ iat: now, exp: now + TOKEN_TTL_MS }));
  const sig = _b64url(_hmac(payload));
  return `${payload}.${sig}`;
}

/**
 * Vérifie un token. Retourne true si valide et non expiré, false sinon.
 * Utilise une comparaison à temps constant pour résister aux timing attacks.
 */
function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;

  // Vérification HMAC à temps constant
  const expectedSig = _b64url(_hmac(payload));
  const sigBuf  = Buffer.from(sig,         'base64url');
  const expBuf  = Buffer.from(expectedSig, 'base64url');
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  // Vérification expiration
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = { generate, verify, TOKEN_TTL_MS };
