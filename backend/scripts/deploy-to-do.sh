#!/bin/bash

# Deploy FRP Server to DO Server
# This script sets up FRP server on your DO server

set -e

REMOTE_HOST="${REMOTE:-${DO_SERVER_IP:?Set DO_SERVER_IP env var to your server IP}}"
REMOTE_USER="${REMOTE_USER:-root}"
FRP_VERSION="0.56.0"

echo "==================================="
echo "Deploying FRP Server to DO Server"
echo "==================================="
echo "Remote: $REMOTE_USER@$REMOTE_HOST"
echo ""

# Check SSH connection
echo "Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 "$REMOTE_USER@$REMOTE_HOST" "echo 'SSH OK'"; then
    echo "ERROR: Cannot connect to $REMOTE_HOST"
    echo "Please ensure:"
    echo "  1. SSH keys are set up"
    echo "  2. Server is accessible"
    echo "  3. User has proper permissions"
    exit 1
fi

echo "✓ SSH connection successful"
echo ""

# Detect architecture on remote server
echo "Detecting remote server architecture..."
ARCH=$(ssh "$REMOTE_USER@$REMOTE_HOST" "uname -m")
OS=$(ssh "$REMOTE_USER@$REMOTE_HOST" "uname -s | tr '[:upper:]' '[:lower:]'")

case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l) ARCH="arm" ;;
esac

echo "Remote OS: $OS"
echo "Remote Architecture: $ARCH"
echo ""

# Download and install FRP on remote server
FRP_FILENAME="frp_${FRP_VERSION}_${OS}_${ARCH}.tar.gz"
FRP_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FRP_FILENAME}"

echo "Installing FRP on remote server..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<EOF
set -e

# Download FRP
echo "Downloading FRP..."
cd /tmp
wget -q --show-progress "$FRP_URL" -O "$FRP_FILENAME"

# Extract
echo "Extracting..."
tar -xzf "$FRP_FILENAME"

# Install binary
echo "Installing binary..."
cd "frp_${FRP_VERSION}_${OS}_${ARCH}"
cp frps /usr/local/bin/
chmod +x /usr/local/bin/frps

# Create directories
mkdir -p /etc/frp
mkdir -p /var/log/frp

# Cleanup
cd /tmp
rm -rf "frp_${FRP_VERSION}_${OS}_${ARCH}" "$FRP_FILENAME"

echo "✓ FRP binary installed"
EOF

# Copy configuration
echo ""
echo "Copying FRP configuration..."
scp frps.toml "$REMOTE_USER@$REMOTE_HOST:/etc/frp/frps.toml"
echo "✓ Configuration uploaded"

# Create systemd service
echo ""
echo "Creating systemd service..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<'EOF'
cat > /etc/systemd/system/frps.service <<'SYSTEMD_EOF'
[Unit]
Description=FRP Server Service
After=network.target

[Service]
Type=simple
User=root
Restart=on-failure
RestartSec=5s
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
ExecReload=/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable frps
systemctl start frps
EOF

echo "✓ Service created and started"
echo ""

# Check firewall and open ports
echo "Configuring firewall..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<'EOF'
if command -v ufw &> /dev/null; then
    echo "Configuring UFW..."
    ufw allow 7000/tcp comment "FRP Control"
    ufw allow 7001/tcp comment "FRP Data"
    ufw allow 7500/tcp comment "FRP Dashboard"
    echo "✓ UFW rules added"
elif command -v firewall-cmd &> /dev/null; then
    echo "Configuring firewalld..."
    firewall-cmd --permanent --add-port=7000/tcp
    firewall-cmd --permanent --add-port=7001/tcp
    firewall-cmd --permanent --add-port=7500/tcp
    firewall-cmd --reload
    echo "✓ Firewall rules added"
else
    echo "⚠ No firewall detected - please open ports 7000, 7001, 7500 manually"
fi
EOF

# Update backend .env on remote
echo ""
echo "Updating backend .env..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<'EOF'
cd /root/auto-researcher/backend

# Backup existing .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Add processing configuration if not exists
if ! grep -q "PROCESSING_ENABLED" .env; then
    echo "" >> .env
    echo "# Desktop Processing via FRP" >> .env
    echo "PROCESSING_ENABLED=true" >> .env
    echo "PROCESSING_DESKTOP_URL=http://127.0.0.1:7001" >> .env
    echo "PROCESSING_TIMEOUT=300000" >> .env
fi

# Disable local reader to save resources
if grep -q "^READER_ENABLED=" .env; then
    sed -i 's/^READER_ENABLED=.*/READER_ENABLED=false/' .env
else
    echo "READER_ENABLED=false" >> .env
fi

echo "✓ .env updated"
EOF

# Restart PM2 apps
echo ""
echo "Restarting backend services..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash <<'EOF'
cd /root/auto-researcher/backend
pm2 restart all
EOF

echo "✓ Backend restarted"

# Check FRP status
echo ""
echo "Checking FRP status..."
ssh "$REMOTE_USER@$REMOTE_HOST" "systemctl status frps --no-pager -l | head -20"

echo ""
echo "==================================="
echo "✓ Deployment Complete!"
echo "==================================="
echo ""
echo "FRP Server is running on:"
echo "  Control Port: 7000"
echo "  Data Port: 7001"
echo "  Dashboard: http://$REMOTE_HOST:7500"
echo "    Username: admin"
echo "    Password: <your-frp-dashboard-password>"
echo ""
echo "FRP Token (save this for desktop):"
echo "  <your-frp-token>"
echo ""
echo "Next: Set up desktop processing server"
echo "  Run: ./scripts/start-desktop.sh"
echo ""
