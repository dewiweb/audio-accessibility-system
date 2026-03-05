#!/bin/sh
# Génère automatiquement un certificat TLS auto-signé si absent
# Validité 10 ans — exécuté au démarrage du container nginx

CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key
CN=${TLS_CN:-localhost}

mkdir -p /etc/nginx/certs

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "[nginx-entrypoint] Génération du certificat TLS auto-signé (CN=$CN, 10 ans)..."
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
         -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN"
  echo "[nginx-entrypoint] ✓ Certificat généré : $CERT"
else
  # Vérifier si le cert expire dans moins de 30 jours
  if ! openssl x509 -checkend 2592000 -noout -in "$CERT" 2>/dev/null; then
    echo "[nginx-entrypoint] Certificat expiré ou proche de l'expiration — régénération..."
    openssl req -x509 -nodes -days 3650 \
      -newkey rsa:2048 \
      -keyout "$KEY" \
      -out "$CERT" \
      -subj "/C=FR/ST=Local/L=Local/O=AudioAccessibility/CN=$CN" 2>/dev/null
    echo "[nginx-entrypoint] ✓ Certificat renouvelé"
  else
    echo "[nginx-entrypoint] ✓ Certificat valide : $CERT"
  fi
fi

# Démarrer nginx
exec nginx -g "daemon off;"
