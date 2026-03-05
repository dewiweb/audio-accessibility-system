#!/bin/bash
# Test de réception AES67/RTP depuis le container Docker
# Usage: bash scripts/test-aes67.sh [adresse_multicast] [port]
#
# Exemples:
#   bash scripts/test-aes67.sh 239.69.112.251 5004
#   bash scripts/test-aes67.sh /app/sdp/QSYS_AES67-2.sdp

set -e

MULTICAST="${1:-239.69.112.251}"
PORT="${2:-5004}"
DURATION=5
CONTAINER="audio-access"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test réception AES67"
echo "  Flux  : ${MULTICAST}:${PORT}"
echo "  Durée : ${DURATION}s"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Vérifier que le container tourne
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "⚠️  Container '${CONTAINER}' non démarré."
  echo "   Lancez d'abord: docker compose up -d"
  exit 1
fi

echo ""
echo "▶ Test 1 — Réception RTP multicast direct..."
RESULT=$(docker exec "${CONTAINER}" ffmpeg \
  -f rtp \
  -protocol_whitelist file,udp,rtp,crypto,data \
  -i "rtp://${MULTICAST}:${PORT}" \
  -t "${DURATION}" \
  -vn -af astats \
  -f null - 2>&1 || true)

if echo "$RESULT" | grep -q "Audio:"; then
  echo "✅ Flux reçu !"
  echo "$RESULT" | grep -E "Audio:|RMS|silence" | head -10
else
  echo "❌ Flux non reçu via RTP direct"
  echo "   Détails: $(echo "$RESULT" | tail -5)"
fi

echo ""
echo "▶ Test 2 — Réception via fichier SDP..."
SDP_PATH="/app/sdp/QSYS_AES67-2.sdp"
RESULT_SDP=$(docker exec "${CONTAINER}" ffmpeg \
  -f sdp \
  -protocol_whitelist file,udp,rtp,crypto,data \
  -i "${SDP_PATH}" \
  -t "${DURATION}" \
  -vn -f null - 2>&1 || true)

if echo "$RESULT_SDP" | grep -q "Audio:"; then
  echo "✅ Flux reçu via SDP !"
  echo "$RESULT_SDP" | grep -E "Audio:|L24|48000" | head -5
else
  echo "❌ Flux non reçu via SDP"
  echo "   Détails: $(echo "$RESULT_SDP" | tail -5)"
fi

echo ""
echo "▶ Test 3 — Vérification réseau multicast..."
IGMP_CHECK=$(docker exec "${CONTAINER}" sh -c \
  "cat /proc/net/igmp 2>/dev/null | grep -i $(printf '%02X%02X%02X%02X' $(echo ${MULTICAST} | tr '.' ' ') | rev) || echo 'non inscrit'" 2>&1 || echo "vérification non disponible")
echo "   IGMP membership: ${IGMP_CHECK}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Aide diagnostic"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Voir trafic multicast sur l'hôte:"
echo "  tcpdump -n udp and host ${MULTICAST} -i any -c 20"
echo ""
echo "  Lister toutes les adresses multicast actives:"
echo "  tcpdump -n udp and multicast -i any -c 30"
echo ""
echo "  Vérifier que le container est bien en network_mode: host:"
echo "  docker inspect ${CONTAINER} | grep NetworkMode"
