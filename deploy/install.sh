#!/bin/bash
# Installation script for Audio Accessibility System
# Run as root: sudo bash install.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Audio Accessibility System — Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Lancez ce script en tant que root (sudo bash install.sh)"
  exit 1
fi

# Install system dependencies
echo "[1/6] Installation des dépendances système..."
apt-get update -qq
apt-get install -y -qq nodejs npm ffmpeg nginx curl

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Node.js >= 18 requis. Installation via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Create user
echo "[2/6] Création de l'utilisateur système..."
id -u audioserver &>/dev/null || useradd -r -s /bin/false -d /opt/audio-access audioserver
usermod -a -G audio audioserver

# Create directories
echo "[3/6] Création des répertoires..."
mkdir -p /opt/audio-access
cp -r . /opt/audio-access/
chown -R audioserver:audioserver /opt/audio-access

# Install Node dependencies
echo "[4/6] Installation des dépendances Node.js..."
cd /opt/audio-access
sudo -u audioserver npm install --production

# Configure environment
echo "[5/6] Configuration..."
if [ ! -f /opt/audio-access/.env ]; then
  cp /opt/audio-access/.env.example /opt/audio-access/.env
  # Generate random secret
  SECRET=$(openssl rand -hex 32)
  sed -i "s/changeme-secret-key/$SECRET/" /opt/audio-access/.env
  echo ""
  echo "⚠️  IMPORTANT: Éditez /opt/audio-access/.env pour configurer:"
  echo "   - ADMIN_PASSWORD (mot de passe admin)"
  echo "   - PUBLIC_URL (URL publique du serveur, ex: http://192.168.1.100)"
  echo ""
fi

# Install systemd service
cp /opt/audio-access/deploy/audio-access.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable audio-access

# Configure nginx
cp /opt/audio-access/deploy/nginx.conf /etc/nginx/sites-available/audio-access
ln -sf /etc/nginx/sites-available/audio-access /etc/nginx/sites-enabled/audio-access
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Start service
echo "[6/6] Démarrage du service..."
systemctl start audio-access

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Installation terminée !"
echo ""
echo "  Interface auditeurs : http://$(hostname -I | awk '{print $1}')"
echo "  Interface admin     : http://$(hostname -I | awk '{print $1}')/admin"
echo ""
echo "  Logs : journalctl -u audio-access -f"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
