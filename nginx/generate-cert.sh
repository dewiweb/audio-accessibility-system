#!/bin/sh
# Génère un certificat auto-signé pour HTTPS local
# Usage: sh generate-cert.sh [IP_ou_hostname]
# Ex:    sh generate-cert.sh 192.168.100.251

HOST=${1:-192.168.100.251}
OUT=/etc/nginx/certs

mkdir -p "$OUT"

openssl req -x509 -nodes -days 825 \
  -newkey rsa:2048 \
  -keyout "$OUT/server.key" \
  -out "$OUT/server.crt" \
  -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$HOST" \
  -addext "subjectAltName=IP:$HOST,DNS:$HOST"

echo "✓ Certificat généré dans $OUT"
echo "  - $OUT/server.crt"
echo "  - $OUT/server.key"
echo ""
echo "Pour installer le certificat sur les appareils clients :"
echo "  Copier server.crt et l'importer comme 'CA de confiance' dans le navigateur/OS."
