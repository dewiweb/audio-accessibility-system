# 🎧 Audio Accessibility System

Système de diffusion audio multicanal pour salles de spectacle, conférence et cinéma.  
Conçu pour l'**audiodescription**, le **renforcement audio** (malentendants) et l'**interprétation simultanée**.

## Fonctionnalités

- **Streaming HLS low-latency** — latence ~1-3 secondes, compatible tous navigateurs modernes
- **Multi-canaux simultanés** — autant de pistes que votre interface audio a d'entrées
- **PWA installable** — pas d'app à installer, QR code à l'entrée suffit
- **Interface admin temps réel** — tableau de bord régie avec WebSocket
- **Monitoring live** — nombre d'auditeurs par canal en temps réel
- **Sources flexibles** — ALSA, PulseAudio, RTSP, fichier, tonalité de test

## Architecture

```
Console son → Interface audio USB (ex: Focusrite 18i20)
                        ↓
               Raspberry Pi 4 / Mini-PC
               Node.js + FFmpeg + HLS
                        ↓
                  WiFi dédié salle
                  (SSID visible)
                        ↓
        ┌───────────────┴───────────────┐
        ▼                               ▼
  Smartphone auditeur           Tablette régie (admin)
  QR code → PWA                 /admin dashboard
  Choix canal + volume
```

## Matériel recommandé

| Composant | Recommandation | Prix indicatif |
|-----------|----------------|----------------|
| Serveur | Raspberry Pi 5 (4 GB) ou NUC Intel | 80–200 € |
| Interface audio | Focusrite Scarlett 18i8/18i20 (USB) | 200–400 € |
| WiFi AP | Unifi U6-Lite ou TP-Link EAP670 | 80–150 € |
| Alimentation | Onduleur 300W (continuité de service) | 50–100 € |

> **Note latence** : Pour le renforcement audio concert (< 200ms), préférez une solution DANTE/AES67 ou une boucle magnétique T en parallèle. Le HLS convient parfaitement pour l'audiodescription film/théâtre.

## Installation rapide

### Prérequis
- Linux (Ubuntu 22.04+ ou Raspberry Pi OS)
- Node.js >= 18
- FFmpeg >= 5.0
- Interface audio compatible ALSA/PulseAudio

### 1. Cloner et installer
```bash
git clone https://github.com/votre-org/audio-accessibility-system.git
cd audio-accessibility-system
npm install
```

### 2. Configurer
```bash
cp .env.example .env
nano .env
```

Variables importantes :
```bash
ADMIN_PASSWORD=votre-mot-de-passe-securise
PUBLIC_URL=http://192.168.1.100:3000   # IP de votre serveur sur le WiFi salle
```

### 3. Lancer en développement
```bash
npm run dev
```

### 4. Installation production (Linux)
```bash
sudo bash deploy/install.sh
```

## Utilisation

### Interface Admin (`/admin`)
1. Connectez-vous avec le mot de passe admin
2. Créez un canal : **"+ Nouveau"**
   - Nom : ex. `Audiodescription FR`
   - Source : `ALSA hw:1,0` (entrée de votre interface audio)
   - Langue, icône, couleur
3. Démarrez le stream : **▶ Démarrer**
4. Testez avec la tonalité : **♪ Tonalité test**

### Interface Auditeurs (`/`)
- Le public scanne le QR code affiché dans la salle
- Sélectionne le canal souhaité
- Appuie sur **Écouter**
- Contrôle le volume avec le slider

## Configuration des sources audio

### Interface ALSA (recommandé)
```json
{ "type": "alsa", "card": 1, "device": 0 }
```
Listez vos cartes : `arecord -l`

### PulseAudio
```json
{ "type": "pulse", "device": "alsa_input.usb-Focusrite_..." }
```
Listez vos sources : `pactl list sources short`

### Flux RTSP (ex: encodeur audio réseau)
```json
{ "type": "rtsp", "url": "rtsp://192.168.1.50/audio" }
```

### Fichier en boucle (démonstration)
```json
{ "type": "file", "path": "/opt/audio/audiodesc.mp3" }
```

## Optimisation latence

Pour réduire la latence HLS, dans `.env` :
```bash
HLS_SEGMENT_DURATION=1   # segments de 1 seconde (défaut)
HLS_LIST_SIZE=3          # fenêtre de 3 segments = ~3s de tampon
```

Pour une latence encore plus faible (renforcement audio) :
- Envisagez **WebRTC** — une évolution possible de ce projet
- Ou une **boucle de téléinduction** T (norme IEC 60118-4) en complément

## Structure du projet

```
audio-accessibility-system/
├── src/
│   ├── server.js          # Point d'entrée Express
│   ├── config.js          # Configuration centralisée
│   ├── channelManager.js  # Gestion des canaux (CRUD + stats)
│   ├── streamManager.js   # FFmpeg HLS streaming engine
│   ├── wsManager.js       # WebSocket temps réel
│   └── routes/
│       └── api.js         # API REST (public + admin)
├── public/
│   ├── index.html         # PWA auditeur
│   ├── admin.html         # Interface régie
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker
│   └── icons/             # Icônes PWA
├── deploy/
│   ├── install.sh         # Script installation Linux
│   ├── audio-access.service  # Systemd unit
│   └── nginx.conf         # Reverse proxy nginx
├── .env.example
└── package.json
```

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/channels` | Liste des canaux publics actifs |
| GET | `/api/channels/:id` | Détail + URL HLS d'un canal |
| GET | `/api/qrcode` | QR code PNG (base64) |
| POST | `/api/admin/auth` | Authentification admin |
| GET | `/api/admin/channels` | Tous les canaux (admin) |
| POST | `/api/admin/channels` | Créer un canal |
| PUT | `/api/admin/channels/:id` | Modifier un canal |
| DELETE | `/api/admin/channels/:id` | Supprimer un canal |
| POST | `/api/admin/channels/:id/start` | Démarrer le stream |
| POST | `/api/admin/channels/:id/stop` | Arrêter le stream |
| POST | `/api/admin/channels/:id/restart` | Relancer le stream |
| POST | `/api/admin/channels/:id/testtone` | Tonalité de test |
| GET | `/api/admin/sources/list` | Lister les entrées audio disponibles |

## WebSocket

Connexion : `ws://serveur:3000/ws` (auditeur) ou `ws://serveur:3000/ws?admin=true` (admin)

| Type message (→ serveur) | Action |
|--------------------------|--------|
| `{ type: "join:channel", channelId }` | Rejoindre un canal (comptage) |
| `{ type: "leave:channel" }` | Quitter le canal |
| `{ type: "ping" }` | Keepalive |

| Type message (← serveur) | Données |
|--------------------------|---------|
| `connected` | Liste initiale des canaux |
| `public:channels` | Mise à jour liste canaux |
| `stats:update` | Stats globales (admin) |
| `stream:started/stopped/error` | Événements stream (admin) |

## Conformité accessibilité

Ce système est conçu pour répondre aux obligations légales françaises :
- **Loi du 11 février 2005** (accessibilité des ERP)
- **Décret 2014-1332** (accessibilité des salles de spectacle)
- Recommandation : **boucle magnétique T** en complément pour les porteurs d'appareils auditifs avec mode T

## Licence

MIT — Libre d'utilisation, de modification et de distribution.
