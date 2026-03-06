# Recommandations Hardware — 450 clients simultanés en production

## Contexte de charge

Le système utilise deux modes de diffusion en parallèle :

**Mode WebRTC (AES67 live — prioritaire)**
- FFmpeg → RTSP → MediaMTX → WHEP navigateur (~100ms latence)
- MediaMTX ouvre une connexion DTLS/SRTP par client → charge CPU linéaire
- 450 clients × 4–6 canaux WebRTC = charge DTLS significative (voir CPU ci-dessous)

**Mode HLS (fallback + fichiers audio)**
- 450 smartphones × 1 requête HTTPS/s par canal
- 4–6 canaux possibles → jusqu'à ~600–700 requêtes HTTPS/s au pic
- Keep-alive TLS configuré (65s) → réutilisation connexions, facteur ×5–10 d'allègement

---

## Serveur de diffusion (nœud central)

| Composant | Recommandation | Justification |
|-----------|----------------|---------------|
| CPU | 8 cœurs (ex: Intel i7-12700 ou AMD Ryzen 7 5700G) | DTLS MediaMTX 450 clients + FFmpeg multicanal + Node.js |
| RAM | 16 Go | MediaMTX ~50 Mo/canal, FFmpeg ~30 Mo/canal, Node.js ~200 Mo, WS 450 clients |
| Réseau | **2 interfaces réseau distinctes** (voir topologie) | Interface régie (AES67) séparée interface WiFi public |
| Stockage | SSD NVMe 64 Go minimum | Segments HLS fallback, logs, uploads audio |
| OS | Ubuntu Server 24.04 LTS | Base Docker stable, support long terme |

> ⚠️ **CPU critique** : MediaMTX gère le chiffrement DTLS de chaque connexion WebRTC. À 450 clients simultanés, prévoir un i7 8 cœurs minimum. Un Raspberry Pi ou équivalent ARM basse consommation est **insuffisant**.

Exemples validés : HP EliteDesk 800 G6, Dell OptiPlex 7090, mini-PC **Beelink SER7** (Ryzen 7 7840HS) — silencieux, fanless possible, rack-mountable avec adaptateur.

---

## Infrastructure WiFi — point critique

450 clients WiFi dans une salle est le vrai défi du système. Dans un environnement avec d'autres réseaux WiFi co-présents :

### Contraintes

- **802.11ac (WiFi 5)** : ~30–50 clients par AP en charge réelle (streaming continu)
- **802.11ax (WiFi 6/6E)** : 60–100 clients par AP en charge
- **Bandes disponibles** : 5 GHz (moins encombrée) et 6 GHz (WiFi 6E, quasi-vierge en salle)

### Plan d'accès recommandé

| Nombre d'AP | Technologie | Clients/AP | Total |
|-------------|-------------|------------|-------|
| 8–10 AP | WiFi 6 (802.11ax) 5 GHz | ~50 | 400–500 ✓ |
| 6–8 AP | WiFi 6E (802.11ax) 6 GHz | ~70 | 420–560 ✓ |

### Solutions open-source recommandées

- **OpenWrt** sur matériel compatible — WiFi 6 bien supporté : **GL.iNet MT3000 (Beryl AX)**, **Banana Pi BPI-R3**, TP-Link EAP615-Wall (support partiel/expérimental sur EAP670)
- **OpenWifi** (TIP — Telecom Infra Project) — stack WiFi enterprise open-source
- **Ubiquiti UniFi** avec contrôleur self-hosted (gratuit, non open-source mais déployable sans cloud)
- **hostapd** en solution full open-source sur matériel dédié

### Configuration WiFi critique

- SSID dédié isolé sur VLAN spécifique (séparation du réseau régie)
- Band steering 5/6 GHz forcé pour éviter la saturation du 2.4 GHz
- `DTIM = 3–5` pour économiser la batterie des smartphones
- **RRM** (Radio Resource Management) activé pour équilibrage automatique de charge
- **Client isolation** activé (les auditeurs ne doivent pas se voir entre eux)
- Débit minimum forcé (éjecte les clients trop loin → évite l'effet "sticky client") :
  - UniFi : paramètre "Minimum RSSI" + "BSS Transition"
  - OpenWrt/hostapd : `basic_rates` / `supported_rates` (équivalent ~24 Mbps MCS)
  - Valeur cible : exclure les clients sous −75 dBm RSSI

---

## Topologie réseau

```
Serveur Docker ──── Switch PoE géré ──── AP WiFi ×8-10
     │                    │
     │               AP WiFi ×8-10    (couverture redondante)
     │
  Console son (AES67 — réseau régie isolé, interface dédiée)
```

> ⚠️ Le serveur doit avoir **2 interfaces réseau** : une vers le réseau AES67/régie, une vers le WiFi public.  
> Les mini-PC n'ont souvent qu'une seule interface intégrée — prévoir une carte réseau additionnelle (USB 2.5G ou PCIe selon le modèle).  
> `network_mode: host` Docker reste obligatoire pour la réception multicast RTP.

---

## Switch & câblage

- **Switch géré L2** avec **IGMP snooping obligatoire** — sans ça, le multicast AES67 flood tout le réseau et sature les AP WiFi
  - Recommandé : **Cisco SG350**, **Netgear M4250** (série AV), TP-Link TL-SG2210P
- **PoE+ (802.3at)** pour alimenter les AP sans bloc secteur
- **VLANs** :
  - VLAN 10 = régie / AES67 (isolé, pas d'accès WiFi)
  - VLAN 20 = WiFi auditeurs (accès serveur uniquement, client isolation activé)
  - VLAN 30 = admin

> ⚠️ **IGMP snooping** : sans cette fonctionnalité activée sur le switch, les paquets RTP multicast AES67 (1000 paquets/s par canal) sont broadcastés sur tous les ports, y compris les AP WiFi — ce qui dégrade immédiatement la qualité audio pour tous les auditeurs.

---

## Smartphones prêtés à l'entrée

### Compatibilité WebRTC
- **Android 10+** avec Chrome — WebRTC optimal
- **iPhone 12+ / iOS 15.1+** avec Safari — WebRTC stable
- Éviter les tablettes Android <2019 — WebRTC parfois instable

### Certificat TLS — point bloquant
Le serveur utilise un certificat auto-signé. Sur smartphone non préconfiguré :
- Le navigateur affiche un avertissement HTTPS
- **WebRTC peut échouer silencieusement sur iOS** si le certificat n'est pas approuvé

**Solutions par ordre de préférence :**

1. **CA interne installée sur les appareils prêtés** — générer un certificat racine, l'installer en CA de confiance via MDM (Mobile Device Management) avant distribution. Solution la plus propre.
2. **Let's Encrypt avec domaine DNS local** — si un serveur DNS interne est disponible, un certificat valide publiquement élimine le problème.
3. **Acceptation manuelle à l'entrée** — procédure guidée sur écran d'accueil avant distribution du smartphone (solution de dépannage uniquement).

> Le fichier `HTTPS-SETUP.md` documente la génération du certificat auto-signé avec SAN.

---

## Estimation de coût (open-source, marché actuel)

| Poste | Solution | Coût estimé |
|-------|----------|-------------|
| Serveur | Mini-PC NUC-like (i7 / 16 Go / NVMe) + carte réseau USB/PCIe si 2e interface nécessaire | 420–750 € |
| AP WiFi 6 ×8 | TP-Link EAP670 (~110 €/u) ou Ubiquiti U6-Pro (~180 €/u) | 880–1 440 € |
| Switch PoE géré | TP-Link TL-SG2210P | 80–150 € |
| Câblage Cat6 | — | 100–200 € |
| **Total** | | **~1 400–2 250 €** |
