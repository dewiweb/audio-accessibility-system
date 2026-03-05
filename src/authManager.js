const bcrypt = require('bcryptjs');
const config = require('./config');

// Initialisation synchrone au démarrage : hash du mot de passe admin en mémoire.
// Le mot de passe en clair n'est conservé que le temps du hash, puis effacé.
function init() {
  const plain = config.security.adminPassword;
  config.security.adminPasswordHash = bcrypt.hashSync(plain, config.security.bcryptRounds);
  // Effacement de la valeur en clair dès que le hash est disponible
  config.security.adminPassword = null;
  console.log('[Auth] Mot de passe admin hashé en mémoire (bcrypt, rounds=' + config.security.bcryptRounds + ')');
}

// Vérification asynchrone du mot de passe soumis contre le hash en mémoire
async function verifyPassword(candidate) {
  if (!config.security.adminPasswordHash) return false;
  return bcrypt.compare(candidate, config.security.adminPasswordHash);
}

// Mise à jour du hash après changement de mot de passe
async function updatePassword(newPlain) {
  config.security.adminPasswordHash = await bcrypt.hash(newPlain, config.security.bcryptRounds);
}

module.exports = { init, verifyPassword, updatePassword };
