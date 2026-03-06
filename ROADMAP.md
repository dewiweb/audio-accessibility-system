# Roadmap — Audio Accessibility System

Améliorations planifiées, classées par priorité et domaine.

---

## 🔐 Certificats TLS / HTTPS

### Let's Encrypt via DNS-01 (sans reverse proxy, sans IP publique exposée)
- **Problème actuel** : le certificat auto-signé génère un avertissement de sécurité navigateur
  que les utilisateurs grand public ne savent pas contourner.
- **Solution recommandée** : `acme.sh` avec challenge DNS-01
  - Créer un sous-domaine sur un provider gratuit (**DuckDNS** : `audio-salle.duckdns.org`)
    ou un domaine propre (OVH, Gandi ~10 €/an)
  - Le domaine pointe sur l'IP LAN du serveur (DNS split-horizon ou résolution locale)
  - `acme.sh` contacte Let's Encrypt via l'API DNS du provider — **pas besoin de port 80 ouvert**
  - Renouvellement automatique toutes les 60 jours via cron dans le container
- **Variables à ajouter** : `ACME_DOMAIN`, `ACME_DNS_PROVIDER`, `ACME_DNS_TOKEN`
- **Effort estimé** : 1 jour (intégration dans `docker-entrypoint.sh` + test)

### PKI interne (alternative enterprise)
- Créer une CA racine auto-signée, la distribuer sur tous les appareils de la salle
- Émettre des certificats signés par cette CA pour le serveur
- Avantage : pas de dépendance internet, valide sur IP privée
- Effort : moyen, nécessite gestion des appareils (MDM ou installation manuelle)

---

## 🌐 Réseau

### Double interface réseau ✅ (implémenté v0.3.29)
- Serveur admin + AES67 sur interface régie (`ADMIN_HOST`)
- Serveur HLS public sur interface WiFi salle (`PUBLIC_HOST`)
- Fallback single-interface si `PUBLIC_HOST` non défini

### QR code dynamique par interface
- Le QR code affiché en régie devrait pointer sur `PUBLIC_LISTENER_URL`
  (URL WiFi salle) plutôt que sur l'URL admin
- Vérifier que `/api/qrcode` utilise `PUBLIC_LISTENER_URL` quand défini

### Support IPv6
- Bind sur `::` pour couvrir IPv6 (requis pour certains réseaux WiFi modernes)

---

## 💿 Image ISO live + installeur

### Objectif
Image bootable sur clé USB (~2 Go) contenant :
- **Mode live** : démarrage sans installation, idéal pour test sur site
- **Mode installeur** : installation sur SSD/NVMe interne en quelques clics

### Stack technique recommandé
- **OS base** : Debian 12 Bookworm (stable, LTS, dépôts stables)
- **Outil de build** : `live-build` (outil officiel Debian)
- **Environnement graphique** : **Labwc** (Wayland, <50 Mo RAM) ou **Openbox** (X11, ultra-léger)
- **Terminal** : `foot` (Wayland) ou `xterm`
- **Gestionnaire réseau UI** : `nm-applet` + NetworkManager
- **Navigateur** : Chromium en mode kiosk pour l'interface admin

### Préconfigurations OS à inclure
- Kernel `PREEMPT_RT` ou `lowlatency` pour réduire la latence audio
- Désactivation des services inutiles (bluetooth, cups, avahi si non requis)
- `realtime-privileges` pour l'utilisateur audio (`/etc/security/limits.d/audio.conf`)
- `tuned` profile `latency-performance`
- Montage automatique des volumes de données (Docker ou natif)
- Firewall `nftables` préconfiguré (ports 9443, 5004 multicast RTP)
- `docker` + `docker-compose` pré-installés
- Auto-login sur TTY1 + lancement automatique de l'environnement graphique
- Script de premier démarrage : choix interface réseau, mot de passe admin

### Structure du projet ISO (dépôt séparé recommandé : `audio-access-iso`)
```
audio-access-iso/
├── build.sh              # script principal live-build
├── auto/
│   ├── config            # paramètres live-build
│   └── build
├── config/
│   ├── package-lists/    # listes de paquets
│   ├── hooks/            # scripts post-install
│   ├── includes.chroot/  # fichiers à copier dans le système
│   │   ├── etc/          # configs système
│   │   └── opt/audio-access/  # app + docker-compose
│   └── preseed/          # réponses automatiques installeur Debian
└── README.md
```

### Effort estimé : 2-3 semaines

---

## 🖥️ Interface admin enrichie

### Gestion des interfaces réseau
- Lister les interfaces réseau disponibles (`ip link`)
- Configurer IP statique / DHCP via `nmcli` (appelé depuis Node.js avec sudoers restreint)
- Afficher l'état de chaque interface (up/down, IP, débit)
- Changer `ADMIN_HOST` / `PUBLIC_HOST` depuis l'UI (redémarrage du serveur requis)

### Gestion audio I/O système
- Lister les périphériques ALSA/PulseAudio/PipeWire disponibles
- Sélectionner le périphérique d'entrée ALSA pour les canaux de type `alsa`
- Tester un périphérique (lecture de tonalité de test)
- Afficher les niveaux VU-mètre en temps réel (via WebSocket)

### Gestion mot de passe système
- Changer le mot de passe du compte OS `audio-access` (via `passwd` + sudoers)
- Distinct du mot de passe admin de l'application (déjà géré)

### Monitoring système
- Affichage CPU / RAM / disque en temps réel (via WebSocket)
- Alertes si espace disque faible (segments HLS non nettoyés)
- Logs FFmpeg en direct par canal

### Redémarrage / arrêt depuis l'UI
- Bouton "Redémarrer le service" (relance Node.js)
- Bouton "Redémarrer le système" (appel `systemctl reboot` via sudoers)
- Bouton "Arrêter le système" (`systemctl poweroff`)

### Architecture recommandée
- Démon Node.js séparé (`system-agent`) tournant en `root` avec liste blanche de commandes
- Communication via socket Unix local depuis le serveur principal
- Évite d'exposer des commandes système via HTTPS

---

## 🎵 Audio

### Monitoring VU-mètre en temps réel
- FFmpeg `-filter_complex ebur128` ou `astats` → WebSocket → bargraph dans l'UI
- Utile pour vérifier que le flux AES67 est bien reçu et au bon niveau

### Support SRT / RIST (alternatives à AES67)
- SRT (Secure Reliable Transport) pour flux audio sur réseau IP non fiable
- RIST pour contribution broadcast professionnelle

### Normalisation audio automatique
- `loudnorm` filter FFmpeg (EBU R128) pour normaliser le niveau des fichiers uploadés
- Option par canal dans l'interface admin

---

## 📱 Application client

### Mode hors-ligne (Service Worker amélioré)
- Mise en cache de l'UI pour fonctionner sans réseau initial
- Reconnexion automatique transparente

### Sous-titres / transcription en temps réel
- Intégration Whisper (OpenAI) ou Vosk (offline) pour transcription STT
- Affichage des sous-titres synchronisés dans l'interface écouteur
- Utile pour sourds profonds + audiodescription textuelle

### Contrôle de vitesse de lecture
- Pour fichiers audio : ralentir/accélérer (0.75× à 1.5×) via Web Audio API
- Utile pour audiodescription complexe

---

## 🔧 Infrastructure

### GitHub Actions : build et push image Docker automatique ✅
- Pipeline existant à vérifier/enrichir

### Tests automatisés
- Tests unitaires sur `streamManager.js` (démarrage/arrêt flux, filtres audio)
- Tests d'intégration API (jest + supertest)
- Test de charge HLS (k6 ou artillery : simuler 200 clients simultanés)

### Métriques Prometheus + Grafana
- Exporter métriques : nb clients actifs par canal, latence HLS, erreurs FFmpeg
- Dashboard Grafana pour supervision en production

---

*Dernière mise à jour : mars 2026*
