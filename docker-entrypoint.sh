#!/bin/sh
# Génère automatiquement un certificat TLS auto-signé si absent
# puis démarre Node.js

CERT=/app/certs/server.crt
KEY=/app/certs/server.key
CN=${TLS_CN:-localhost}

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "[entrypoint] Génération du certificat TLS (CN=$CN, 10 ans)..."
  openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CERT" \
    -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" \
    -addext "subjectAltName=IP:$CN,DNS:$CN" 2>/dev/null \
  || openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$KEY" \
    -out "$CERT" \
    -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" 2>/dev/null
  echo "[entrypoint] ✓ Certificat généré : $CERT"
else
  if ! openssl x509 -checkend 2592000 -noout -in "$CERT" 2>/dev/null; then
    echo "[entrypoint] Certificat expiré — régénération..."
    openssl req -x509 -nodes -days 3650 \
      -newkey rsa:2048 -keyout "$KEY" -out "$CERT" \
      -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" 2>/dev/null
    echo "[entrypoint] ✓ Certificat renouvelé"
  else
    echo "[entrypoint] ✓ Certificat existant valide"
  fi
fi

exec node src/server.js
