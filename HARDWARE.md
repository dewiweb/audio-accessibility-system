# Recommandations Hardware — 450 clients simultanés en production

## Contexte de charge

- 450 smartphones en lecture HLS simultanée
- Segments de 1s → chaque client fait ~1 requête HTTPS/s par canal
- 4–6 canaux possibles en simultané → jusqu'à ~600–700 requêtes HTTPS/s au pic
- Flux TLS keep-alive configuré (65s) → réutilisation des connexions, facteur ×5–10 d'allègement

---

## Serveur de diffusion (nœud central)

| Composant | Recommandation | Justification |
|-----------|----------------|---------------|
| CPU | 8 cœurs (ex: Intel i7-12700 ou AMD Ryzen 7 5700G) | FFmpeg multicanal + Node.js HTTPS |
| RAM | 16 Go | Buffers HLS, segments en cache, WS 450 clients |
| Réseau | 2× 1 GbE (LACP si carte dispo) ou 1× 2.5 GbE | ~450 × 128 kbps = ~58 Mbps audio + overhead TLS |
| Stockage | SSD NVMe 256 Go | Écriture/lecture segments HLS à haute fréquence |
| OS | Ubuntu Server 24.04 LTS | Base Docker stable, support long terme |

Exemples de machines open-source friendly : HP EliteDesk 800 G6, Dell OptiPlex 7090, ou mini-PC type Beelink SER7 (Ryzen 7 7840HS) — suffisants pour ce cas d'usage.

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

## Câblage & switch

- **Switch géré L2** (ex: TP-Link TL-SG2210P, Netgear GS308E) — firmware open-source possible sur certains modèles
- **PoE+ (802.3at)** pour alimenter les AP sans bloc secteur
- **VLANs** :
  - VLAN 10 = régie / AES67
  - VLAN 20 = WiFi auditeurs
  - VLAN 30 = admin

---

## Estimation de coût (open-source, marché actuel)

| Poste | Solution | Coût estimé |
|-------|----------|-------------|
| Serveur | Mini-PC NUC-like (i7 / 16 Go / NVMe) + carte réseau USB/PCIe si 2e interface nécessaire | 420–750 € |
| AP WiFi 6 ×8 | TP-Link EAP670 (~110 €/u) ou Ubiquiti U6-Pro (~180 €/u) | 880–1 440 € |
| Switch PoE géré | TP-Link TL-SG2210P | 80–150 € |
| Câblage Cat6 | — | 100–200 € |
| **Total** | | **~1 400–2 250 €** |
