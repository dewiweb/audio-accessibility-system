#!/bin/sh
# Génère automatiquement un certificat TLS auto-signé si absent
# puis démarre Node.js

CERT=/app/certs/server.crt
KEY=/app/certs/server.key
CN=${TLS_CN:-localhost}

generate_cert() {
  # ANSSI guide TLS : préférer ECDSA P-256, durée 1 an (365 jours)
  # SAN obligatoire pour que les navigateurs acceptent le certificat
  SAN_EXT="subjectAltName=DNS:${CN},IP:${CN}"
  openssl req -x509 -nodes -days 365 \
    -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout "$KEY" -out "$CERT" \
    -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" \
    -addext "$SAN_EXT" 2>/dev/null \
  && return 0
  # Fallback RSA 3072 si ECDSA non disponible (openssl < 1.1)
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:3072 \
    -keyout "$KEY" -out "$CERT" \
    -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" 2>/dev/null
}

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "[entrypoint] Génération du certificat TLS ECDSA P-256 (CN=$CN, 1 an)..."
  generate_cert
  echo "[entrypoint] ✓ Certificat généré : $CERT"
else
  # Renouvellement si expiration dans moins de 30 jours
  if ! openssl x509 -checkend 2592000 -noout -in "$CERT" 2>/dev/null; then
    echo "[entrypoint] Certificat expiré ou expirant — régénération..."
    generate_cert
    echo "[entrypoint] ✓ Certificat renouvelé"
  else
    echo "[entrypoint] ✓ Certificat existant valide"
  fi
fi

exec node src/server.js
