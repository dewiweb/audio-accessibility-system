# Configuration HTTPS — Stratégies TLS selon le contexte de déploiement

## Choix de la stratégie TLS selon le contexte

| Contexte | Stratégie | Friction utilisateur | Coût |
|----------|-----------|---------------------|------|
| **Développement / test** | Certificat auto-signé + `/welcome` | Accepter l'avertissement une fois par appareil | 0€ |
| **Appareils prêtés, préconfigurés** | Certificat auto-signé + CA installée sur les appareils | Aucune (préconfiguration à l'entrée) | 0€ |
| **BYOD — smartphones personnels** | **Let's Encrypt via DNS challenge** (recommandé) | **Aucune** | ~10€/an (nom de domaine) |

> **Pourquoi HTTP pur n'est pas une option** : un réseau WiFi de salle de spectacle est accessible à tous les occupants. Sans TLS, le trafic audio est lisible et modifiable par n'importe qui sur le réseau (Wireshark, ARP spoofing). Pour un système d'accessibilité médicale (audiodescription, renforcement malentendants), l'intégrité du contenu est non négociable. De plus, le Service Worker et la PWA exigent HTTPS.

> **Pourquoi une CA auto-hébergée (step-ca) ne résout pas le BYOD** : même avec un serveur ACME local (step-ca, smallstep), le certificat racine doit être installé manuellement sur chaque smartphone personnel — friction identique à l'acceptation manuelle d'un certificat auto-signé.

---

## Architecture actuelle

```
Smartphones (WiFi) → Node.js :8443 HTTPS (TLS natif)
                           ↑
                    Certificat TLS (auto-signé ou Let's Encrypt)
                    généré au 1er démarrage via src/tls.js
                    persisté dans le volume Docker audio-certs
```

Node.js gère TLS directement — **pas de reverse proxy nginx**. Ce choix simplifie le déploiement et est rendu possible par `network_mode: host` (obligatoire pour le multicast AES67/RTP).

---

## Génération automatique du certificat auto-signé

Le certificat est **généré automatiquement au premier démarrage** si absent du volume `audio-certs` :
- Validité **10 ans** (3650 jours)
- Persisté dans le volume Docker `audio-certs` — **non régénéré aux redémarrages suivants**
- CN et SAN configurés via la variable `TLS_CN` dans `.env` (défaut : `192.168.100.251`)

**Aucune action manuelle requise** pour la génération.

---

## 1. Déployer avec Docker Compose

```bash
# Copier et adapter le fichier .env
cp .env.example .env
# Éditer .env : ADMIN_PASSWORD, SESSION_SECRET, TLS_CN, PUBLIC_URL

docker compose up -d
```

Variables clés dans `.env` :
- `ADMIN_PASSWORD` — mot de passe admin
- `SESSION_SECRET` — chaîne aléatoire (min 32 chars) : `openssl rand -hex 32`
- `TLS_CN` — IP ou hostname du serveur sur le réseau salle (ex: `192.168.0.15`)
- `PUBLIC_URL` — URL HTTPS complète pour le QR code (ex: `https://192.168.0.15:8443`)
- `MULTICAST_INTERFACE` — IP de l'interface réseau AES67

---

## 2. Déployer dans Portainer

Utilisez **`portainer-stack.yml`** (sans nginx, TLS Node.js natif).

> `portainer-stack-https.yml` est une version obsolète avec architecture nginx — ne pas utiliser.

---

## 3. Récupérer le certificat généré (appareils préconfigurés)

Après le premier démarrage :

```bash
# Copier le certificat depuis le volume Docker
docker cp audio-access:/app/certs/server.crt ./server.crt
```

Distribuez ce `server.crt` aux appareils clients (voir section 4).

---

## 4. Installer le certificat sur les appareils clients

Pour éviter l'avertissement "Non sécurisé", installez `server.crt` comme **CA de confiance** sur chaque appareil.

### Android (Chrome)
1. Envoyer `server.crt` sur l'appareil (email, partage réseau)
2. **Paramètres → Sécurité → Chiffrement et informations → Installer un certificat → Certificat CA**
3. Sélectionner `server.crt`

### iOS / iPadOS (Safari)
1. Envoyer `server.crt` sur l'appareil → ouvrir → "Autoriser"
2. **Réglages → Général → Gestion VPN et appareils → [nom du profil] → Installer**
3. **Réglages → Général → À propos → Réglages de confiance des certificats → Activer** le certificat

### Windows (Chrome / Edge)
```powershell
certutil -addstore "Root" server.crt
```

### macOS
```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain server.crt
```

### MDM / déploiement en masse
Distribuez `server.crt` via votre solution MDM (Jamf, Intune, etc.) comme profil de configuration avec certificat CA de confiance.

---

## 5. Vérification

```bash
# Tester depuis le serveur (sans vérif cert)
curl -k https://localhost:8443/api/channels

# Tester avec le certificat (doit répondre sans -k)
curl --cacert ./server.crt https://192.168.0.15:8443/api/channels
```

Logs du container en temps réel :
```bash
docker logs -f audio-access
```

---

## Notes de sécurité (pour votre RSSI)

| Point | Valeur |
|-------|--------|
| TLS minimum | 1.2 |
| Ciphers | ECDHE + AES-GCM / CHACHA20 (ANSSI-compatibles) |
| Validité certificat auto-signé | 3650 jours (10 ans) |
| Port HTTPS | 8443 |
| Accès Node.js | `0.0.0.0:8443` en `network_mode: host` |
| Upload max | 500 Mo (fichiers audio) |
| HSTS | Non applicable (certificat auto-signé non reconnu par défaut) |

---

## Production BYOD — Let's Encrypt via DNS challenge

### Principe

Le **DNS challenge** (ACME DNS-01) permet d'obtenir un certificat Let's Encrypt reconnu par tous les navigateurs **sans que le serveur audio soit joignable depuis internet**. La validation se fait en déposant un enregistrement TXT dans le DNS public du domaine — le serveur audio reste en LAN fermé.

```
[Machine avec internet]
  └─ Certbot DNS challenge → Let's Encrypt CA
       └─ Dépose TXT _acme-challenge.audio.nom-salle.fr
            └─ Certificat émis → copié sur le serveur audio LAN

[Salle de spectacle — LAN isolé]
  Serveur audio (192.168.x.x:8443) ← certificat Let's Encrypt valide
  Routeur WiFi : audio.nom-salle.fr → 192.168.x.x (DNS local)
  Smartphones BYOD : https://audio.nom-salle.fr:8443 → aucun avertissement
```

### Prérequis

- Un nom de domaine (~10€/an, ex: OVH, Gandi, Namecheap)
- Accès à l'API DNS du registrar (pour Certbot)
- Certbot installé sur n'importe quelle machine avec internet (pas forcément le serveur audio)

### 1. Installer Certbot + plugin DNS

```bash
# Exemple avec OVH (adapter selon ton registrar)
pip install certbot certbot-dns-ovh

# Autres plugins disponibles :
# certbot-dns-cloudflare, certbot-dns-gandi, certbot-dns-namecheap, etc.
```

### 2. Configurer les credentials DNS

```bash
# Exemple OVH — créer ~/.secrets/certbot/ovh.ini
dns_ovh_endpoint = ovh-eu
dns_ovh_application_key = XXXXXXXX
dns_ovh_application_secret = XXXXXXXX
dns_ovh_consumer_key = XXXXXXXX

chmod 600 ~/.secrets/certbot/ovh.ini
```

Les credentials API se créent sur le portail du registrar (accès DNS en écriture uniquement).

### 3. Obtenir le certificat

```bash
certbot certonly \
  --dns-ovh \
  --dns-ovh-credentials ~/.secrets/certbot/ovh.ini \
  -d audio.nom-salle.fr \
  --preferred-challenges dns-01

# Certificat généré dans :
# /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem
# /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem
```

### 4. Copier le certificat dans le volume Docker

```bash
docker cp /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem \
  audio-access:/app/certs/server.crt

docker cp /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem \
  audio-access:/app/certs/server.key

docker restart audio-access
```

### 5. DNS local dans le routeur WiFi de la salle

Le routeur WiFi doit résoudre `audio.nom-salle.fr` vers l'IP locale du serveur :

- **dnsmasq** (Raspberry Pi, OpenWrt) : `address=/audio.nom-salle.fr/192.168.x.x`
- **Routeur professionnel** : entrée DNS statique (host override) dans l'interface admin
- **Fallback** : distribuer l'IP directe via le QR code (sans bénéfice du domaine)

Mettre à jour `PUBLIC_URL` dans `.env` :
```
TLS_CN=audio.nom-salle.fr
PUBLIC_URL=https://audio.nom-salle.fr:8443
```

### 6. Renouvellement (tous les 90 jours)

```bash
# Depuis n'importe quelle machine avec internet
certbot renew --dns-ovh --dns-ovh-credentials ~/.secrets/certbot/ovh.ini

# Recopier les fichiers renouvelés et redémarrer
docker cp /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem audio-access:/app/certs/server.crt
docker cp /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem audio-access:/app/certs/server.key
docker restart audio-access
```

Automatiser avec un cron (mensuel) :
```bash
0 3 1 * * certbot renew --dns-ovh --dns-ovh-credentials ~/.secrets/certbot/ovh.ini \
  && docker cp /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem audio-access:/app/certs/server.crt \
  && docker cp /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem audio-access:/app/certs/server.key \
  && docker restart audio-access
```

### Résultat

- QR code → `https://audio.nom-salle.fr:8443` → aucun avertissement sur tous les smartphones
- Certificat reconnu nativement — aucune installation requise côté utilisateur
- Serveur audio **jamais exposé sur internet**
- PWA installable, Service Worker actif, WebRTC fonctionnel
