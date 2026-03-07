# Recommandations Hardware — Audio Accessibility System

Contexte : salle de spectacle jusqu'à 450 places (ERP), diffusion audio pour malentendants et déficients visuels. Conformité loi du 11 février 2005 et décret 2014-1332.

Deux scénarios de dimensionnement sont proposés selon le taux de connexion simultané attendu :
- **Scénario A — 200 clients simultanés** : taux de ~45% (usage réaliste — tous les spectateurs ne se connectent pas)
- **Scénario B — 450 clients simultanés** : pleine salle, tous connectés (dimensionnement maximal)

---

## Charge système

| Mode | Pipeline | Latence | Charge serveur |
|------|----------|---------|----------------|
| **WebRTC** (AES67 live) | FFmpeg → RTSP → MediaMTX → WHEP | ~100ms | DTLS/SRTP par client — CPU linéaire |
| **HLS** (fallback + fichiers) | FFmpeg → segments → Node.js HTTPS | ~3–4s | ~1 req HTTPS/s/client — keep-alive TLS |

- **Scénario A (200 clients)** : 4–6 canaux → ~800–1 200 connexions WebRTC + ~200 req/s HTTPS
- **Scénario B (450 clients)** : 4–6 canaux → jusqu'à 2 700 connexions WebRTC + ~700 req/s HTTPS

Bande passante réseau sortante : 200 clients × 128 kbps ≈ **25 Mbps** / 450 clients × 128 kbps ≈ **58 Mbps** — dans les deux cas largement sous la limite d'un lien GbE.

---

## Serveur de diffusion

> ⚠️ **AES-NI obligatoire** : MediaMTX chiffre chaque connexion WebRTC en DTLS/SRTP indépendamment. L'accélération matérielle AES-NI (présente sur tous les Intel/AMD modernes) divise la charge CPU par ~5. Vérifier sa présence : `grep aes /proc/cpuinfo`.

### Scénario A — 200 clients simultanés

| Composant | Minimum | Recommandé | Justification |
|-----------|---------|------------|---------------|
| CPU | 4 cœurs / 2.5 GHz + AES-NI | **Intel N100 / i5-10400T** | DTLS/SRTP ×200 clients + FFmpeg multicanal |
| RAM | 8 Go | **8 Go** | MediaMTX ~50 Mo/canal, FFmpeg ~30 Mo/canal, Node.js ~200 Mo |
| Réseau | 1× 1 GbE | **1× 1 GbE** | 200 clients × 128 kbps = 25 Mbps max |
| Stockage | SSD 32 Go | **SSD 32 Go** | Segments HLS, uploads audio, logs |
| OS | — | **Ubuntu Server 24.04 LTS** | Base Docker stable, LTS 5 ans |

**Modèles recommandés Scénario A** (silencieux, basse consommation) :
- **Beelink EQ12** (Intel N100, ~160 €) — AES-NI, 16 Go RAM, TDP 6W, passif/silencieux
- **Beelink Mini S12 Pro** (Intel N100, ~150 €) — identique, légèrement plus compact
- **HP EliteDesk 800 G6 Mini** (~250 € reconditionné) — i5-10500T, 6 cœurs, très fiable

### Scénario B — 450 clients simultanés

| Composant | Minimum | Recommandé | Justification |
|-----------|---------|------------|---------------|
| CPU | 6 cœurs / 3 GHz + AES-NI | **8 cœurs** (i7-12700 / Ryzen 7 5700G) | DTLS/SRTP ×450 clients + FFmpeg multicanal |
| RAM | 8 Go | **16 Go** | Marge pour pics de connexion simultanée |
| Réseau | 1× 1 GbE | **2× 1 GbE** (interfaces séparées) | Régie AES67 isolée du WiFi auditeurs |
| Stockage | SSD 32 Go | **SSD NVMe 64 Go** | Segments HLS, uploads audio, logs |
| OS | — | **Ubuntu Server 24.04 LTS** | Base Docker stable, LTS 5 ans |

**Modèles recommandés Scénario B** :
- **Beelink SER7** (Ryzen 7 7840HS, ~400 €) — 2e interface via USB 2.5G ou carte M.2
- **HP EliteDesk 800 G6 Mini** (~350 € reconditionné) — slot PCIe disponible
- **Dell OptiPlex 7090 Micro** (~380 € reconditionné) — robuste, pièces disponibles

> Les mini-PC n'ont souvent qu'une interface intégrée — prévoir une carte réseau additionnelle (USB 2.5G ~25 €, ou M.2/PCIe selon modèle).  
> `network_mode: host` Docker est obligatoire pour la réception multicast RTP AES67.

---

## Infrastructure réseau

### Topologie

```
  [Console son / Table de mixage]
          │ AES67 multicast RTP (L16/L24, 48kHz)
          │
  [Switch géré L2 — VLAN 10 régie]
          │
  [eth0 — Serveur Docker — eth1]
          │
  [Switch PoE géré L2 — VLAN 20 auditeurs]
     │         │         │
  [AP WiFi] [AP WiFi] [AP WiFi] ×8–10
     │
  [Smartphones auditeurs — SSID dédié]
```

**VLANs :**
- VLAN 10 — Régie / AES67 : isolé, aucun accès WiFi public
- VLAN 20 — Auditeurs WiFi : accès serveur uniquement, client isolation activé
- VLAN 30 — Admin : accès interface régie uniquement

### Switch — exigences critiques

**IGMP snooping obligatoire.** Sans lui, le multicast AES67 (1 000 paquets/s par canal) est broadcasté sur tous les ports dont les AP WiFi, saturant le réseau auditeurs et dégradant l'audio.

| Modèle | IGMP snooping | PoE+ | Prix indicatif |
|--------|--------------|------|----------------|
| **Cisco SG350-10P** | ✓ | ✓ | ~350 € |
| **Netgear M4250-10G2F** (série AV) | ✓ | ✓ | ~450 € |
| **TP-Link TL-SG3210** | ✓ | — | ~120 € |

> Le TP-Link TL-SG2210P (série non gérée intelligente) a un support IGMP snooping limité — à éviter pour AES67.

Câblage : **Cat6 minimum**, longueurs ≤90 m patch inclus.

---

## Infrastructure WiFi

La densité WiFi en salle fermée dépasse les capacités d'un AP domestique ou d'un seul AP professionnel.

### Dimensionnement

| Technologie | Clients/AP réaliste | AP — Scénario A (200 clients) | AP — Scénario B (450 clients) |
|-------------|--------------------|-----------------------------|-----------------------------|
| WiFi 5 (802.11ac) | 30–50 | **4–7 AP** | 9–15 AP |
| **WiFi 6 (802.11ax) 5 GHz** | 50–70 | **3–4 AP** | **7–9 AP** |
| WiFi 6E (802.11ax) 6 GHz | 70–100 | 2–3 AP | 5–7 AP |

### Modèles recommandés

- **Ubiquiti U6-Pro** (~180 €/u) — contrôleur self-hosted gratuit (UniFi Network), idéal pour gestion centralisée de la salle
- **TP-Link EAP670** (~110 €/u) — contrôleur Omada self-hosted gratuit, bon rapport qualité/prix
- **GL.iNet MT3000** (~90 €/u) + OpenWrt — solution 100% open-source, WiFi 6, pour techniciens

### Configuration WiFi requise

| Paramètre | Valeur | Raison |
|-----------|--------|--------|
| SSID | Dédié, sans captive portal | WebSocket et WHEP bloqués par portail captif |
| Bande | 5 GHz ou 6 GHz forcé | Éviter saturation 2.4 GHz en salle |
| DTIM | 3–5 | Économie batterie smartphones |
| RRM | Activé | Équilibrage automatique de charge entre AP |
| Client isolation | Activé | Les auditeurs ne doivent pas se voir entre eux |
| RSSI minimum | −75 dBm | Éjecte les clients trop éloignés (sticky client) |
| VLAN tag | VLAN 20 | Isolation réseau régie |

### QR code de connexion WiFi automatique

Le QR code affiché à l'entrée peut encoder simultanément la connexion WiFi **et** l'URL du système, évitant toute saisie manuelle au spectateur.

**Format du QR code WiFi (standard WPA) :**

```
WIFI:S:Assistance-Audio;T:WPA;P:bienvenue;;
```

- `S:` — nom du SSID
- `T:WPA` — type de sécurité (WPA2-Personal)
- `P:` — passphrase (choisir simple et mémorisable)

Le smartphone scanne le QR code → se connecte automatiquement au WiFi → ouvre l'URL du système. **Zéro saisie.**

**Compatibilité :**
- Android 10+ : connexion automatique native
- iOS 11+ : connexion automatique native (via l'app Appareil Photo)
- Fallback : saisie manuelle du SSID/mot de passe toujours possible

**Génération du QR code :**

```bash
# Exemple avec qrencode (Linux)
qrencode -o wifi-qr.png "WIFI:S:Assistance-Audio;T:WPA;P:bienvenue;;"
```

Ou via un générateur en ligne : [qr-code-generator.com](https://www.qr-code-generator.com) → type "WiFi".

> **Sécurité** : WPA2-Personal avec passphrase simple est suffisant pour ce contexte (réseau sans accès internet, trafic chiffré en TLS 1.3 de bout en bout). L'objectif est d'empêcher la capture passive du trafic WiFi, pas de contrôler l'accès au réseau.

---

## Smartphones

### Appareils prêtés à l'entrée (recommandé)

Utiliser des appareils maîtrisés permet de préconfigurer le certificat TLS et garantit la compatibilité WebRTC.

| Critère | Minimum | Notes |
|---------|---------|-------|
| Android | 10+ avec Chrome | WebRTC optimal |
| iPhone | 12+ / iOS 15.1+ avec Safari | WebRTC stable depuis iOS 15.1 |
| Tablettes | Android 2020+ | Éviter tablettes <2019 — WebRTC instable |
| Batterie | >3 000 mAh | Prévoir chargeurs en réserve |

### Certificat TLS — point bloquant sur iOS

Le serveur utilise un certificat auto-signé. Sur iOS, WebRTC peut **échouer silencieusement** si le certificat n'est pas approuvé en CA de confiance.

**Solutions par ordre de préférence :**

1. **CA interne sur appareils prêtés** — installer le certificat racine via profil MDM avant distribution. Transparent pour l'utilisateur. Voir `HTTPS-SETUP.md`.
2. **Let's Encrypt + DNS interne** — si un résolveur DNS local est disponible, un certificat public élimine le problème sur tous les appareils sans configuration.
3. **Acceptation manuelle** — l'utilisateur visite `https://[ip]:8443` et accepte l'avertissement avant de scanner le QR code. Solution de secours uniquement.

### BYOD (smartphones personnels des spectateurs)

Possible mais non garanti : le spectateur doit accepter le certificat manuellement. Le QR code peut pointer vers une page de bienvenue qui guide cette étape avant la lecture audio.

---

## À ne pas faire

- ❌ **Raspberry Pi ou nano-PC ARM sans AES-NI** — CPU insuffisant pour MediaMTX DTLS au-delà de ~50 clients
- ❌ **Switch sans IGMP snooping** (ex: switches non gérés) — multicast AES67 flood le réseau WiFi
- ❌ **WiFi partagé avec le réseau régie** — jitter RTP imprévisible, dégradation audio
- ❌ **SSID avec captive portal** — bloque WebSocket et WHEP irrémédiablement
- ❌ **AP unique pour toute la salle** — saturation garantie à partir de ~50 clients en streaming continu
- ❌ **HTTP (non-TLS)** — WebRTC exige HTTPS/WSS, non négociable

---

## Estimation de coût

### Scénario A — 200 clients simultanés

| Poste | Solution | Coût estimé |
|-------|----------|-------------|
| Serveur | Beelink EQ12 ou Mini S12 Pro | 150–170 € |
| Switch régie (IGMP) | TP-Link TL-SG3210 | 120 € |
| Switch auditeurs PoE | TP-Link TL-SG108PE (8 ports PoE) | 80 € |
| AP WiFi 6 ×4 | TP-Link EAP670 ×4 (~110 €/u) ou Ubiquiti U6-Pro ×4 (~180 €/u) | 440–720 € |
| Câblage Cat6 + connectique | — | 100–200 € |
| **Total** | | **~890–1 290 €** |

### Scénario B — 450 clients simultanés

| Poste | Solution | Coût estimé |
|-------|----------|-------------|
| Serveur | Beelink SER7 ou HP EliteDesk 800 G6 reconditionné + carte réseau 2e interface | 380–750 € |
| Switch régie (IGMP) | Cisco SG350-10P ou Netgear M4250 | 350–450 € |
| Switch auditeurs PoE | TP-Link TL-SG3210 + injecteurs PoE séparés ou switch PoE dédié | 120–300 € |
| AP WiFi 6 ×8 | TP-Link EAP670 ×8 (~110 €/u) ou Ubiquiti U6-Pro ×8 (~180 €/u) | 880–1 440 € |
| Câblage Cat6 + connectique | — | 150–300 € |
| **Total** | | **~1 880–3 240 €** |

> Les smartphones prêtés à l'entrée constituent un poste variable non inclus (amortissement sur plusieurs saisons, ou location de dispositifs dédiés).
