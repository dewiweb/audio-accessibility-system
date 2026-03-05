# Configuration HTTPS — Certificat auto-signé (réseau privé)

## Architecture

```
Smartphones (WiFi) → nginx :443 HTTPS → localhost:8080 (Node.js)
                           ↑
                    Certificat auto-signé 10 ans
                    généré automatiquement au 1er démarrage
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
