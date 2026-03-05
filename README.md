# 🎧 Audio Accessibility System

> ⚠️ **Work In Progress** — Projet en cours de développement et de test. Non prêt pour la production.

Système de diffusion audio multicanal DIY pour salles de spectacle, conférence et cinéma (~450 places).  
Conçu pour l'**audiodescription**, le **renforcement audio** (malentendants) et l'**interprétation simultanée multilingue**.

La source audio est reçue via **AES67/RTP** depuis la console son, encodée en **HLS low-latency** par FFmpeg, et servie à des smartphones via une **PWA** (pas d'app à installer).

## Statut

| Composant | État |
|-----------|------|
| Backend Node.js + HLS streaming | ✅ Implémenté |
| Réception AES67/RTP multicast | ✅ Implémenté |
| Interface auditeur (PWA) | ✅ Implémenté |
| Interface admin régie | ✅ Implémenté |
| Docker / Portainer | ✅ Implémenté |
| CI/CD GitHub Actions → GHCR | ✅ Implémenté |
| Tests en conditions réelles | 🔄 En cours |
| WebRTC (latence < 200ms) | 📋 Prévu |

## Architecture

```
Console son (QSYS/Dante)
   │  flux AES67 — RTP multicast (L24/48000)
   ▼
Serveur Docker (network_mode: host)
   │  Node.js + FFmpeg → HLS segments
   ▼
AP WiFi salle
   │  HTTP
   ├──▶ Smartphone auditeur  →  PWA (QR code entrée)
   └──▶ Tablette régie       →  /admin (dashboard)
```

## Fonctionnalités

- **Réception AES67/RTP** — flux multicast ou via fichier SDP (compatible QSYS, Dante, etc.)
- **Streaming HLS low-latency** — ~1-3s de latence, compatible tous navigateurs modernes
- **Multi-canaux simultanés** — audiodesc, renforcement, interprétation simultanée...
- **PWA installable** — QR code à l'entrée, aucune app à installer
- **Interface admin temps réel** — WebSocket, start/stop streams, monitoring listeners
- **Sources flexibles** — AES67 (prioritaire), RTSP, fichier, tonalité de test, ALSA

## Infrastructure matérielle

Pour un déploiement en conditions réelles (450 clients simultanés), voir **[HARDWARE.md](HARDWARE.md)** :
recommandations serveur, plan WiFi, topologie réseau, câblage et estimation de coût.

## Déploiement Docker (via Portainer)

C'est la méthode de déploiement cible. L'image est publiée automatiquement sur GHCR à chaque push sur `main`.

### 1. Récupérer l'image

```
ghcr.io/dewiweb/audio-accessibility-system:latest
```

### 2. Déployer via Portainer

**Stacks → Add stack → Web editor**, coller le contenu de `portainer-stack.yml` et ajuster :

```yaml
ADMIN_PASSWORD: "votre-mot-de-passe"
PUBLIC_URL: "http://IP-SERVEUR:8080"
MULTICAST_INTERFACE: "IP-SERVEUR"   # interface réseau vers la régie AES67
```

> ⚠️ **`network_mode: host` est obligatoire** pour la réception des flux RTP multicast AES67. En mode bridge Docker, les paquets UDP multicast ne traversent pas.

### 3. Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `8080` | Port HTTP du serveur |
| `ADMIN_PASSWORD` | `changeme` | Mot de passe interface admin |
| `PUBLIC_URL` | — | URL publique pour le QR code |
| `RTP_BUFFER_MS` | `200` | Tampon jitter AES67 en ms |
| `MULTICAST_INTERFACE` | auto | IP de l'interface réseau vers la régie |
| `HLS_SEGMENT_DURATION` | `1` | Durée segment HLS en secondes |
| `HLS_LIST_SIZE` | `3` | Nombre de segments dans la playlist |
| `AUDIO_BITRATE` | `128k` | Bitrate encodage Opus |

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

### Autres sources supportées

```json
{ "type": "rtsp", "url": "rtsp://192.168.100.x/audio" }
{ "type": "file", "path": "/app/audio/audiodesc.mp3" }
{ "type": "testtone", "frequency": 440 }
{ "type": "alsa", "card": 0, "device": 0 }
```

## Développement local

```bash
git clone https://github.com/dewiweb/audio-accessibility-system.git
cd audio-accessibility-system
npm install
cp .env.example .env
npm run dev
```

Interface auditeur : `http://localhost:8080`  
Interface admin : `http://localhost:8080/admin`

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
│   └── docker-build.yml   # CI/CD → GHCR (build multi-arch amd64/arm64)
├── src/
│   ├── server.js          # Point d'entrée Express + WebSocket
│   ├── config.js          # Configuration centralisée
│   ├── channelManager.js  # Gestion des canaux (CRUD + comptage listeners)
│   ├── streamManager.js   # FFmpeg HLS engine (AES67, RTSP, fichier...)
│   ├── wsManager.js       # WebSocket temps réel (auditeurs + admin)
│   └── routes/api.js      # API REST (public + admin)
├── public/
│   ├── index.html         # PWA auditeur (sélection canal, lecteur, volume)
│   ├── admin.html         # Interface régie (dashboard, start/stop streams)
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service Worker (mode offline partiel)
├── sdp/
│   └── QSYS_AES67-2.sdp   # Exemple fichier SDP QSYS
├── scripts/
│   └── test-aes67.sh      # Script de test réception AES67
├── Dockerfile
├── docker-compose.yml
├── portainer-stack.yml    # Stack Portainer prête à l'emploi
└── DEPLOY-DOCKER.md       # Guide déploiement détaillé
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

Connexion : `ws://serveur:8080/ws` (auditeur) ou `ws://serveur:8080/ws?admin=true` (admin)

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
| `stream:started/stopped/error` | Événements stream (admin) |

## Conformité accessibilité

Ce système est conçu pour contribuer aux obligations légales françaises :
- **Loi du 11 février 2005** (accessibilité des ERP)
- **Décret 2014-1332** (accessibilité des salles de spectacle)
- Recommandation complémentaire : **boucle magnétique T** (norme IEC 60118-4) pour les porteurs d'appareils auditifs avec mode T

## Licence

MIT — Libre d'utilisation, de modification et de distribution.
