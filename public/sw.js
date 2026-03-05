/**
 * Service Worker — RGPD by design
 *
 * Politique de cache stricte :
 * - SEULES les librairies JavaScript statiques (hls.min.js) et le manifest PWA
 *   sont mis en cache. Ces fichiers ne contiennent aucune donnée personnelle.
 * - Les flux HLS (audio), les réponses API, les pages HTML et les WebSockets
 *   ne sont JAMAIS mis en cache : ils peuvent contenir des données de session
 *   ou des informations de contexte.
 * - Aucun cookie, aucun identifiant utilisateur ne transite par ce service worker.
 */

const CACHE_NAME = 'audio-access-v8';

// Uniquement les assets statiques sans données personnelles
const STATIC_ASSETS = [
  '/manifest.json',
  '/hls.min.js',
];

// Préfixes qui ne doivent JAMAIS être mis en cache
const NO_CACHE_PREFIXES = [
  '/hls/',    // flux audio en direct
  '/api/',    // données de session et de configuration
  '/ws',      // WebSocket
  '/admin',   // interface d'administration
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les données sensibles ou dynamiques
  if (NO_CACHE_PREFIXES.some(p => url.pathname.startsWith(p))) {
    return; // Passe directement au réseau sans interception
  }

  // Ne jamais mettre en cache les navigations HTML
  // (index.html peut contenir des états de session)
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Ne mettre en cache que les assets statiques déclarés explicitement
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Toute autre ressource non listée : réseau uniquement
  // (pas de mise en cache implicite)
});
