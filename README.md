# 🎧 Audio Accessibility System

Système de diffusion audio multicanal DIY pour salles de spectacle, conférence et cinéma (~450 places).  
Conçu pour l'**audiodescription**, le **renforcement audio** (malentendants) et l'**interprétation simultanée multilingue**.

La source audio est reçue via **AES67/RTP** depuis la console son, encodée en **HLS** par FFmpeg, et servie à des smartphones via une **PWA** (pas d'app à installer).

## Statut

| Composant | État |
|-----------|------|
| Backend Node.js + HLS streaming | ✅ Opérationnel |
| Réception AES67/RTP multicast | ✅ Opérationnel |
| Source fichier MP3 (loop / arrêt propre) | ✅ Opérationnel |
| Interface auditeur PWA | ✅ Opérationnel |
| Interface admin régie | ✅ Opérationnel |
| Sécurité (HTTPS/TLS, JWT, CSP, bcrypt) | ✅ Opérationnel |
| Docker / Portainer | ✅ Opérationnel |
| CI/CD GitHub Actions → GHCR (amd64 + arm64) | ✅ Opérationnel |
| Tests en conditions réelles (450 clients) | 🔄 En cours |
| WebRTC (latence < 200ms) | 📋 Prévu |

## Architecture

```
Console son (QSYS/Dante)
   │  flux AES67 — RTP multicast (L24/48000)
   ▼
Serveur Docker (network_mode: host)
   │  Node.js + FFmpeg → HLS segments (HTTPS/TLS 8443)
   ▼
AP WiFi salle (VLAN dédié)
   │  HTTPS + WSS
   ├──▶ Smartphone auditeur  →  PWA (QR code entrée, sans app)
   └──▶ Tablette régie       →  /admin (dashboard temps réel)
```

## Fonctionnalités

- **Réception AES67/RTP** — flux multicast ou via fichier SDP (compatible QSYS, Dante, etc.)
- **Streaming HLS** — ~1-3s de latence, compatible tous navigateurs modernes
- **Multi-canaux simultanés** — audiodesc, renforcement, interprétation simultanée...
- **PWA installable** — QR code à l'entrée, aucune app à installer, aucun compte
- **Interface admin temps réel** — WebSocket, start/stop streams, monitoring listeners
- **Sources flexibles** — AES67 (prioritaire), RTSP, fichier MP3 (loop ou arrêt propre), tonalité de test, ALSA
- **Sécurité by design** — HTTPS/TLS obligatoire, JWT, bcrypt, CSP avec nonce, validation des entrées
- **RGPD by design** — aucune donnée personnelle collectée, comptage auditeurs anonyme et agrégé

## Infrastructure matérielle

Pour un déploiement en conditions réelles (450 clients simultanés), voir **[HARDWARE.md](HARDWARE.md)** :
recommandations serveur, plan WiFi, topologie réseau, câblage et estimation de coût.

## Déploiement Docker (via Portainer)

C'est la méthode de déploiement cible. L'image est publiée automatiquement sur GHCR à chaque tag `v*.*.*`.

### 1. Récupérer l'image

```
ghcr.io/dewiweb/audio-accessibility-system:latest        # amd64
ghcr.io/dewiweb/audio-accessibility-system:latest-arm64  # arm64 (Raspberry Pi)
```

### 2. Déployer via Portainer

**Stacks → Add stack → Web editor**, coller le contenu de `portainer-stack.yml` et ajuster :

```yaml
ADMIN_PASSWORD: "votre-mot-de-passe-fort"
JWT_SECRET: "secret-aleatoire-32-chars-minimum"
PUBLIC_URL: "https://IP-SERVEUR:8443"
MULTICAST_INTERFACE: "IP-SERVEUR"   # interface réseau vers la régie AES67
```

> ⚠️ **`network_mode: host` est obligatoire** pour la réception des flux RTP multicast AES67. En mode bridge Docker, les paquets UDP multicast ne traversent pas.

> 🔒 Le serveur écoute uniquement en **HTTPS sur le port 8443**. Un certificat TLS auto-signé est généré automatiquement au premier démarrage. Les clients doivent l'accepter ou le faire approuver en CA de confiance.

### 3. Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `8443` | Port HTTPS du serveur |
| `ADMIN_PASSWORD` | `changeme` | Mot de passe interface admin (hashé bcrypt en mémoire) |
| `JWT_SECRET` | — | Secret JWT (≥ 32 chars, **obligatoire en production**) |
| `PUBLIC_URL` | — | URL publique HTTPS pour le QR code |
| `RTP_BUFFER_MS` | `200` | Tampon jitter AES67 en ms |
| `MULTICAST_INTERFACE` | auto | IP de l'interface réseau vers la régie |
| `HLS_SEGMENT_DURATION` | `1` | Durée segment HLS en secondes |
| `HLS_LIST_SIZE` | `3` | Nombre de segments dans la playlist live |
| `AUDIO_BITRATE` | `128k` | Bitrate encodage AAC |

## Configuration des sources audio

### AES67 / RTP multicast (recommandé)

Via adresse multicast directe :
```json
{ "type": "aes67", "multicastAddress": "239.69.112.251", "port": 5004 }
```

Via fichier SDP exporté depuis la console (plus fiable) :
```json
{ "type": "aes67", "sdpFile": "/app/sdp/QSYS_AES67-2.sdp" }
```

Les fichiers `.sdp` sont à déposer dans `sdp/` — ce dossier est monté en volume dans le container.

#### Flux multicanaux (4, 8, 16 canaux)

Un flux AES67 peut contenir jusqu'à 16 canaux dans un seul flux RTP. Paramètres optionnels :

| Paramètre | Type | Description |
|-----------|------|-------------|
| `channels` | int | Nombre total de canaux dans le flux (1, 2, 4, 8, 16) |
| `channelMap` | [int, int] | Paire de canaux à extraire en stéréo L/R (index 1-basés, ex: `[3, 4]`) |
| `downmix` | string | Mode de downmix multicanal → stéréo (voir tableau ci-dessous) |
| `gain` | int | Ajustement de volume en dB (−20 à +20, 0 = pas de changement) |

Modes `downmix` disponibles :

| Valeur | Usage |
|--------|-------|
| `mono-to-stereo` | Flux mono (audiodescription voix) → stéréo dupliquée L+R |
| `stereo` | Downmix standard ITU-R BS.775 — 5.1/7.1 → stéréo |
| `stereo-loud` | Mix renforcé malentendants — LFE + surround boostés (+Centre×0.45, +LFE×0.55) |
| `binaural` | Rendu binaural HRTF — son 3D pour casque (filtre `headphone` FFmpeg) |

Exemples :

```json
{ "type": "aes67", "sdpFile": "/app/sdp/stream.sdp", "channels": 8, "channelMap": [3, 4] }
{ "type": "aes67", "sdpFile": "/app/sdp/film.sdp", "channels": 6, "downmix": "stereo-loud", "gain": 6 }
{ "type": "aes67", "multicastAddress": "239.69.0.1", "port": 5004, "channels": 1, "downmix": "mono-to-stereo" }
```

> ℹ️ `channelMap` et `downmix` sont mutuellement exclusifs : si `channelMap` est défini, `downmix` est ignoré.  
> Tout ceci est configurable directement depuis l'interface admin (formulaire de création et d'édition du canal).

### Autres sources supportées

```json
{ "type": "rtsp", "url": "rtsp://192.168.100.x/audio" }
{ "type": "file", "path": "/app/uploads/audio/fichier.mp3", "loop": true }
{ "type": "file", "path": "/app/uploads/audio/fichier.mp3", "loop": false }
{ "type": "testtone", "frequency": 440 }
{ "type": "alsa", "card": 0, "device": 0 }
```

Pour les sources `file` :
- `loop: true` — lecture en boucle infinie (mode live HLS, FFmpeg `-stream_loop -1`)
- `loop: false` — lecture unique puis arrêt propre du stream (`stream:vod_ended` notifié aux clients)

## Développement local

```bash
git clone https://github.com/dewiweb/audio-accessibility-system.git
cd audio-accessibility-system
npm install
cp .env.example .env
npm run dev
```

Interface auditeur : `https://localhost:8443`  
Interface admin : `https://localhost:8443/admin`

> Le certificat auto-signé généré au démarrage doit être accepté dans le navigateur.
> Sans source AES67 locale, utiliser la tonalité de test depuis l'interface admin.

## Test de réception AES67

```bash
# Depuis le container
bash scripts/test-aes67.sh 239.69.112.251 5004

# Ou manuellement
docker exec audio-access ffmpeg \
  -f sdp -protocol_whitelist file,udp,rtp,crypto,data \
  -i /app/sdp/QSYS_AES67-2.sdp \
  -t 5 -f null - 2>&1 | grep -E "Audio:|error"
```

## Structure du projet

```
audio-accessibility-system/
├── .github/workflows/
│   └── docker-build.yml      # CI/CD → GHCR (build multi-arch amd64/arm64)
├── .windsurf/rules/
│   └── project-rules.md      # Règles workspace (sécurité/a11y/RGPD)
├── src/
│   ├── server.js             # Point d'entrée Express HTTPS + WebSocket
│   ├── config.js             # Configuration centralisée
│   ├── authManager.js        # Authentification bcrypt
│   ├── tokenManager.js       # Gestion JWT
│   ├── channelManager.js     # Gestion des canaux (CRUD + comptage listeners)
│   ├── streamManager.js      # FFmpeg HLS engine (AES67, RTSP, fichier, loop...)
│   ├── wsManager.js          # WebSocket temps réel (auditeurs + admin)
│   ├── middleware/
│   │   └── validate.js       # Validation et sanitisation des entrées API
│   └── routes/api.js         # API REST (public + admin)
├── public/
│   ├── index.html            # PWA auditeur (sélection canal, lecteur, volume)
│   ├── admin.html            # Interface régie (dashboard, start/stop streams)
│   ├── manifest.json         # PWA manifest
│   └── sw.js                 # Service Worker (cache strict, RGPD by design)
├── sdp/
│   └── QSYS_AES67-2.sdp      # Exemple fichier SDP QSYS
├── scripts/
│   └── test-aes67.sh         # Script de test réception AES67
├── Dockerfile
├── docker-compose.yml
├── portainer-stack.yml       # Stack Portainer prête à l'emploi
├── DEPLOY-DOCKER.md          # Guide déploiement détaillé
└── HARDWARE.md               # Recommandations matérielles (450 clients)
```

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/channels` | Canaux publics actifs |
| GET | `/api/channels/:id` | Détail + URL HLS |
| GET | `/api/qrcode` | QR code PNG (base64) |
| POST | `/api/admin/auth` | Authentification admin |
| GET | `/api/admin/channels` | Tous les canaux |
| POST | `/api/admin/channels` | Créer un canal |
| PUT | `/api/admin/channels/:id` | Modifier un canal |
| DELETE | `/api/admin/channels/:id` | Supprimer un canal |
| POST | `/api/admin/channels/:id/start` | Démarrer le stream |
| POST | `/api/admin/channels/:id/stop` | Arrêter le stream |
| POST | `/api/admin/channels/:id/restart` | Relancer le stream |
| POST | `/api/admin/channels/:id/testtone` | Tonalité de test |
| GET | `/api/admin/sdp/list` | Fichiers SDP disponibles |
| GET | `/api/admin/sources/list` | Entrées ALSA/Pulse disponibles |

## WebSocket

Connexion : `wss://serveur:8443/ws` (auditeur) ou `wss://serveur:8443/ws?adminToken=<token>` (admin)

| Message → serveur | Action |
|-------------------|--------|
| `{ type: "join:channel", channelId }` | Rejoindre un canal (comptage) |
| `{ type: "leave:channel" }` | Quitter le canal |
| `{ type: "ping" }` | Keepalive |

| Message ← serveur | Données |
|-------------------|---------|
| `connected` | Liste initiale des canaux |
| `public:channels` | Mise à jour liste canaux |
| `stats:update` | Stats globales (admin) |
| `stream:started` | Stream démarré (admin) |
| `stream:stopped` | Stream arrêté (admin) |
| `stream:error` | Erreur stream (admin) |
| `stream:vod_ended` | Fichier MP3 terminé sans loop (public + admin) |

## Conformité accessibilité

Ce système est conçu pour contribuer aux obligations légales françaises :
- **Loi du 11 février 2005** (accessibilité des ERP)
- **Décret 2014-1332** (accessibilité des salles de spectacle)
- Recommandation complémentaire : **boucle magnétique T** (norme IEC 60118-4) pour les porteurs d'appareils auditifs avec mode T

## Licence

MIT — Libre d'utilisation, de modification et de distribution.
