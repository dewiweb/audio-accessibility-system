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

## Architecture

```
Smartphones (WiFi) → nginx :443 HTTPS → localhost:8080 (Node.js)
                           ↑
                    Certificat TLS (auto-signé ou Let's Encrypt)
                    généré/renouvelé automatiquement
                    persisté dans volume Docker audio-access-certs
```

> **Pourquoi nginx en network_mode: host ?**  
> L'app Node.js utilise `network_mode: host` (obligatoire pour le multicast AES67/RTP).  
> nginx doit être sur le même réseau host pour proxifier vers `localhost:8080`.

---

## Génération automatique du certificat

Le certificat est **généré automatiquement au premier démarrage** du container nginx (`nginx/entrypoint.sh`) :
- Validité **10 ans** (3650 jours)
- Persisté dans le volume Docker `audio-access-certs` — **non régénéré aux redémarrages suivants**
- Régénération automatique si le cert expire dans moins de 30 jours
- CN et SAN configurés via la variable `TLS_CN` dans le stack

**Aucune action manuelle requise** pour la génération.

---

## 1. Récupérer le certificat généré (pour le distribuer aux appareils)

Après le premier démarrage :

```bash
# Copier le certificat depuis le volume Docker
docker cp audio-access-nginx:/etc/nginx/certs/server.crt ./server.crt
```

Distribuez ce `server.crt` aux appareils clients (voir section 5).

---

## 2. Déployer dans Portainer

Utilisez **`portainer-stack-https.yml`** à la place de `portainer-stack.yml`.

Ajustez les variables d'environnement :
- `ADMIN_PASSWORD` — mot de passe admin
- `SESSION_SECRET` — chaîne aléatoire longue
- `PUBLIC_URL` — `https://192.168.100.251` (avec https !)
- `MULTICAST_INTERFACE` — IP de l'interface réseau AES67

---

## 5. Installer le certificat sur les appareils clients

Pour éviter l'avertissement "Non sécurisé" du navigateur, installez `server.crt` comme **CA de confiance** sur chaque appareil. C'est la bonne pratique RSSI.

### Android (Chrome)
1. Envoyer `server.crt` sur l'appareil (email, AirDrop, partage réseau)
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

## 6. Vérification

```bash
# Tester depuis le serveur
curl -k https://192.168.100.251/api/health

# Tester avec le certificat (doit répondre sans -k)
curl --cacert /opt/audio-access/certs/server.crt https://192.168.100.251/api/health
```

Logs nginx en temps réel :
```bash
docker logs -f audio-access-nginx
```

---

## Notes de sécurité (pour votre RSSI)

| Point | Valeur |
|-------|--------|
| TLS minimum | 1.2 |
| Chiffrements | `HIGH:!aNULL:!MD5` |
| Validité certificat | 825 jours (~2 ans) |
| HSTS | Désactivé par défaut (activer après déploiement cert sur tous les appareils) |
| Accès Node.js | `127.0.0.1:8080` uniquement (pas exposé en dehors du host) |
| Upload max | 512 Mo (fichiers audio) |

Pour activer HSTS (une fois le certificat installé partout) :
```nginx
# Dans nginx/audio-access.conf, décommenter :
add_header Strict-Transport-Security "max-age=31536000" always;
```

---

## Production BYOD — Let's Encrypt via DNS challenge

### Principe

Le **DNS challenge** (ACME DNS-01) permet d'obtenir un certificat Let's Encrypt reconnu par tous les navigateurs **sans que le serveur audio soit joignable depuis internet**. La validation se fait en déposant un enregistrement TXT dans le DNS public de ton domaine — le serveur audio reste en LAN fermé.

```
[Machine avec internet]
  └─ Certbot DNS challenge → Let's Encrypt CA
       └─ Dépose TXT _acme-challenge.audio.nom-salle.fr
            └─ Certificat émis → copié sur le serveur audio LAN

[Salle de spectacle — LAN isolé]
  Serveur audio (192.168.x.x) ← certificat Let's Encrypt valide
  Routeur WiFi : audio.nom-salle.fr → 192.168.x.x (DNS local)
  Smartphones BYOD : https://audio.nom-salle.fr → aucun avertissement
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

Les credentials API se créent sur le portail de ton registrar (accès DNS en écriture uniquement).

### 3. Obtenir le certificat

```bash
certbot certonly \
  --dns-ovh \
  --dns-ovh-credentials ~/.secrets/certbot/ovh.ini \
  -d audio.nom-salle.fr \
  --preferred-challenges dns-01

# Le certificat est généré dans :
# /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem
# /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem
```

### 4. Copier le certificat dans le volume Docker

```bash
# Copier vers le volume audio-access-certs
docker cp /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem \
  audio-access-nginx:/etc/nginx/certs/server.crt

docker cp /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem \
  audio-access-nginx:/etc/nginx/certs/server.key

docker restart audio-access-nginx
```

### 5. DNS local dans le routeur WiFi de la salle

Le routeur WiFi doit résoudre `audio.nom-salle.fr` vers l'IP locale du serveur. Configuration selon le modèle de routeur :

- **dnsmasq** (Raspberry Pi, OpenWrt) : `address=/audio.nom-salle.fr/192.168.x.x`
- **Routeur professionnel** : entrée DNS statique (host override) dans l'interface admin
- **Fallback** : distribuer l'IP directe via le QR code (perd le bénéfice du domaine)

### 6. Renouvellement (tous les 90 jours)

```bash
# Depuis n'importe quelle machine avec internet — pas le serveur audio
certbot renew --dns-ovh --dns-ovh-credentials ~/.secrets/certbot/ovh.ini

# Puis recopier les nouveaux fichiers (étape 4)
# Automatiser avec un cron :
0 3 1 * * certbot renew && \
  docker cp /etc/letsencrypt/live/audio.nom-salle.fr/fullchain.pem \
    audio-access-nginx:/etc/nginx/certs/server.crt && \
  docker cp /etc/letsencrypt/live/audio.nom-salle.fr/privkey.pem \
    audio-access-nginx:/etc/nginx/certs/server.key && \
  docker restart audio-access-nginx
```

### Résultat

- QR code → `https://audio.nom-salle.fr` → aucun avertissement sur **tous les smartphones** (iOS, Android, Windows)
- Certificat reconnu nativement — aucune installation requise côté utilisateur
- Serveur audio **jamais exposé sur internet**
- PWA installable, Service Worker actif, WebRTC fonctionnel
