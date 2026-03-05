# Configuration HTTPS — Certificat auto-signé (réseau privé)

## Architecture

```
Smartphones (WiFi) → nginx :443 HTTPS → localhost:8080 (Node.js)
                           ↑
                    Certificat auto-signé
                    /opt/audio-access/certs/
```

> **Pourquoi nginx en network_mode: host ?**  
> L'app Node.js utilise `network_mode: host` (obligatoire pour le multicast AES67/RTP).  
> nginx doit être sur le même réseau host pour proxifier vers `localhost:8080`.

---

## 1. Préparer les répertoires sur le serveur Docker

```bash
mkdir -p /opt/audio-access/certs
mkdir -p /opt/audio-access/nginx
```

---

## 2. Générer le certificat auto-signé

Copiez `nginx/generate-cert.sh` sur le serveur et exécutez-le :

```bash
# Remplacez par l'IP réelle de votre serveur
chmod +x generate-cert.sh
sudo sh generate-cert.sh 192.168.100.251
```

Le certificat est généré dans `/etc/nginx/certs/` — copiez-le dans le dossier monté :

```bash
sudo cp /etc/nginx/certs/server.crt /opt/audio-access/certs/
sudo cp /etc/nginx/certs/server.key /opt/audio-access/certs/
```

Ou générez directement dans `/opt/audio-access/certs/` :

```bash
sudo openssl req -x509 -nodes -days 825 \
  -newkey rsa:2048 \
  -keyout /opt/audio-access/certs/server.key \
  -out /opt/audio-access/certs/server.crt \
  -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=192.168.100.251" \
  -addext "subjectAltName=IP:192.168.100.251"
```

---

## 3. Copier la config nginx

```bash
sudo cp nginx/audio-access.conf /opt/audio-access/nginx/audio-access.conf
```

---

## 4. Déployer dans Portainer

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
