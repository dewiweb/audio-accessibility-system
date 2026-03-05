# Déploiement Docker / Portainer

## Prérequis réseau

### Point critique : `network_mode: host`
Le container **doit** utiliser le mode réseau `host` pour recevoir les flux RTP/multicast AES67.
En mode bridge (défaut Docker), les paquets UDP multicast ne traversent pas jusqu'au container.

```
Réseau salle
├── Console son / Dante Controller → émet flux AES67 (RTP multicast 239.x.x.x)
├── Serveur Docker (réseau host) → reçoit RTP, sert HLS
└── AP WiFi → smartphones (PWA)
```

---

## 1. Build de l'image

### Sur le serveur Docker :
```bash
git clone https://github.com/votre-org/audio-accessibility-system.git
cd audio-accessibility-system
docker build -t audio-accessibility-system:latest .
```

---

## 2. Déploiement via Portainer

### Méthode A — Stack Portainer (recommandé)

1. Dans Portainer : **Stacks → Add stack**
2. Collez le contenu de `portainer-stack.yml`
3. Modifiez les variables d'environnement :

| Variable | Valeur |
|----------|--------|
| `ADMIN_PASSWORD` | Votre mot de passe régie |
| `PUBLIC_URL` | `http://192.168.x.x:3000` (IP du serveur Docker sur le réseau WiFi salle) |
| `MULTICAST_INTERFACE` | IP de l'interface réseau vers la régie (si plusieurs cartes réseau) |

4. **Deploy the stack**

### Méthode B — docker-compose depuis le serveur

```bash
cp .env.example .env
nano .env   # éditer les valeurs
docker compose up -d
```

---

## 3. Configuration AES67 depuis la régie

### Identifier vos flux AES67

Sur votre console Dante (Dante Controller ou Audinate) ou console AES67 native :

1. Ouvrez **Dante Controller → Receive**
2. Notez pour chaque flux à recevoir :
   - **Adresse multicast** (ex: `239.69.100.1`)
   - **Port UDP** (généralement `5004`)
   - **Format** : L24/48000 (24-bit PCM, 48kHz) — standard AES67

### Option A : Via adresse multicast directe

Dans l'interface admin (`/admin`), créez un canal :
- **Type source** : `AES67 / Dante (RTP multicast)`
- **Adresse multicast** : `239.69.100.1`
- **Port** : `5004`

### Option B : Via fichier SDP (plus fiable)

Exportez le fichier SDP depuis Dante Controller :
1. Dante Controller → sélectionner le flux → **Export SDP**
2. Copiez le fichier `.sdp` dans le dossier `sdp/` sur le serveur Docker
   ```bash
   scp audiodesc-fr.sdp user@serveur-docker:/opt/audio-access/sdp/
   ```
   *(ce dossier est monté en volume dans le container)*

3. Dans l'interface admin, créez un canal :
   - **Type source** : `AES67 via fichier SDP`
   - **Chemin SDP** : `/app/sdp/audiodesc-fr.sdp`

   ou collez directement le contenu SDP dans le champ texte.

### Format typique d'un fichier SDP AES67

```
v=0
o=- 1709123456 1709123456 IN IP4 192.168.1.50
s=Audiodescription FR
c=IN IP4 239.69.100.1/32
t=0 0
a=clock-domain:PTPv2 0
m=audio 5004 RTP/AVP 96
a=rtpmap:96 L24/48000/2
a=ptime:1
a=ts-refclk:ptp=IEEE1588-2008:AA-BB-CC-FF-FE-DD-EE-FF:0
a=mediaclk:direct=0
```

---

## 4. Configuration réseau recommandée

### Schéma réseau typique

```
┌─────────────────────────────────────────────────┐
│  Switch manageable (VLAN recommandé)            │
│                                                  │
│  ┌──────────────┐    ┌──────────────────────┐   │
│  │ Console son  │    │ Serveur Docker       │   │
│  │ Dante/AES67  │───▶│ eth0: 192.168.1.50  │   │
│  │ 192.168.1.10 │    │ network_mode: host   │   │
│  └──────────────┘    │ Port 3000 ouvert     │   │
│                      └──────────┬───────────┘   │
│                                 │                │
│                      ┌──────────▼───────────┐   │
│                      │ AP WiFi salle         │   │
│                      │ SSID: "AudioAccess"   │   │
│                      │ 192.168.1.x/24        │   │
│                      └──────────────────────┘   │
└─────────────────────────────────────────────────┘

Flux AES67 (RTP multicast) : 192.168.1.10 → 239.69.x.x:5004
Flux HLS (HTTP) : 192.168.1.50:3000 → smartphones WiFi
```

### Points d'attention réseau

- **IGMP Snooping** : activez-le sur le switch manageable pour que les paquets multicast ne saturent pas tout le réseau
- **PTP/IEEE1588** : AES67 utilise PTP pour la synchronisation horaire — pas nécessaire pour la simple réception FFmpeg mais utile pour la sync multi-flux
- **Firewall** : ouvrir UDP entrant sur les ports de vos flux RTP (5004, 5006, etc.) sur le serveur Docker

### Test de réception AES67 depuis Docker

```bash
# Tester la réception d'un flux multicast RTP dans le container
docker exec audio-access ffmpeg \
  -f rtp \
  -protocol_whitelist file,udp,rtp \
  -i rtp://239.69.100.1:5004 \
  -t 5 \
  -f null -

# Si ça tourne sans "Connection refused" → le flux est reçu ✓
```

---

## 5. Mise en service jour J

### Checklist avant ouverture des portes

```
□ Serveur Docker démarré, container audio-access = healthy
□ Interface admin /admin accessible depuis le réseau salle
□ Flux AES67 reçus et vérifiés (ffmpeg test)
□ Canaux créés dans l'admin pour chaque piste
□ Streams démarrés (bouton ▶)
□ Test écoute sur smartphone via QR code
□ QR code imprimé / affiché à l'entrée
□ Volume et qualité validés avec casque
```

### Démarrage des streams

1. Connectez-vous à `http://IP-SERVEUR:3000/admin`
2. Pour chaque canal : **▶ Démarrer** (ou **♪ Tonalité test** pour vérifier sans flux régie)
3. Scannez le QR code avec un smartphone → vérifier que l'audio est fluide

### QR Code

Le QR code est automatiquement généré et disponible :
- Dans l'interface admin, section **Vue d'ensemble**
- Via l'API : `GET /api/qrcode` → image base64 PNG

---

## 6. Logs et diagnostic

```bash
# Logs en temps réel
docker logs audio-access -f

# Statut container
docker ps | grep audio-access

# Logs Portainer : Containers → audio-access → Logs
```

### Problèmes fréquents

| Symptôme | Cause probable | Solution |
|----------|---------------|----------|
| Stream démarre puis s'arrête | Flux AES67 pas reçu | Vérifier adresse multicast et port |
| Coupures audio | Jitter réseau | Augmenter `RTP_BUFFER_MS` à 400-500 |
| Container ne démarre pas | Port 3000 occupé | Vérifier `netstat -tlnp \| grep 3000` |
| Multicast non reçu | Mode réseau bridge | Vérifier `network_mode: host` |
| Latence trop élevée | `HLS_LIST_SIZE` trop grand | Réduire à 2, `HLS_SEGMENT_DURATION` à 1 |
