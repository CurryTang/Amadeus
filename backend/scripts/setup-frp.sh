#!/bin/bash

# FRP Setup Script
# This script helps you download and configure FRP for both server and client

set -e

FRP_VERSION="0.56.0"
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# Map architecture names
case $ARCH in
    x86_64)
        ARCH="amd64"
        ;;
    aarch64|arm64)
        ARCH="arm64"
        ;;
    armv7l)
        ARCH="arm"
        ;;
esac

echo "==================================="
echo "FRP Setup Script"
echo "==================================="
echo "OS: $OS"
echo "Architecture: $ARCH"
echo "FRP Version: $FRP_VERSION"
echo ""

# Download FRP
FRP_FILENAME="frp_${FRP_VERSION}_${OS}_${ARCH}.tar.gz"
FRP_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FRP_FILENAME}"

echo "Downloading FRP..."
wget -q --show-progress "$FRP_URL" -O "/tmp/${FRP_FILENAME}"

echo "Extracting FRP..."
tar -xzf "/tmp/${FRP_FILENAME}" -C /tmp/

FRP_DIR="/tmp/frp_${FRP_VERSION}_${OS}_${ARCH}"

echo ""
echo "==================================="
echo "Choose installation type:"
echo "1) DO Server (proxy only)"
echo "2) Desktop (processing server)"
echo "3) Both (for testing)"
echo "==================================="
read -p "Enter choice (1-3): " INSTALL_TYPE

case $INSTALL_TYPE in
    1)
        echo "Installing FRP Server for DO..."
        sudo cp "$FRP_DIR/frps" /usr/local/bin/
        sudo chmod +x /usr/local/bin/frps

        # Create config directory
        sudo mkdir -p /etc/frp
        sudo cp frps.toml /etc/frp/frps.toml

        # Create log directory
        sudo mkdir -p /var/log/frp

        # Update token in config
        read -p "Enter a secure token for FRP authentication: " FRP_TOKEN
        sudo sed -i "s/your_secure_frp_token_here/$FRP_TOKEN/g" /etc/frp/frps.toml

        # Update dashboard password
        read -p "Enter a password for FRP dashboard: " DASHBOARD_PASSWORD
        sudo sed -i "s/change_this_password/$DASHBOARD_PASSWORD/g" /etc/frp/frps.toml

        echo "Creating systemd service..."
        sudo tee /etc/systemd/system/frps.service > /dev/null <<EOF
[Unit]
Description=FRP Server Service
After=network.target

[Service]
Type=simple
User=root
Restart=on-failure
RestartSec=5s
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable frps
        sudo systemctl start frps

        echo ""
        echo "✓ FRP Server installed and started"
        echo "✓ Dashboard: http://YOUR_SERVER_IP:7500"
        echo "✓ Save this token for desktop client: $FRP_TOKEN"
        ;;

    2)
        echo "Installing FRP Client for Desktop..."
        sudo cp "$FRP_DIR/frpc" /usr/local/bin/
        sudo chmod +x /usr/local/bin/frpc

        # Copy config to backend directory
        cp frpc.toml ./frpc-local.toml

        # Update token
        read -p "Enter the FRP token from DO server: " FRP_TOKEN
        sed -i "s/your_secure_frp_token_here/$FRP_TOKEN/g" ./frpc-local.toml

        # Update server address
        read -p "Enter DO server IP address (default: YOUR_SERVER_IP): " SERVER_IP
        SERVER_IP=${SERVER_IP:-YOUR_SERVER_IP}
        sed -i "s/YOUR_SERVER_IP/$SERVER_IP/g" ./frpc-local.toml

        echo ""
        echo "✓ FRP Client installed"
        echo "✓ Config saved to: ./frpc-local.toml"
        echo ""
        echo "To start FRP client:"
        echo "  frpc -c ./frpc-local.toml"
        ;;

    3)
        echo "Installing both FRP Server and Client..."
        sudo cp "$FRP_DIR/frps" /usr/local/bin/
        sudo cp "$FRP_DIR/frpc" /usr/local/bin/
        sudo chmod +x /usr/local/bin/frps
        sudo chmod +x /usr/local/bin/frpc
        echo "✓ Both binaries installed"
        echo "Run this script again to configure each separately"
        ;;

    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Cleanup
rm -rf "$FRP_DIR"
rm "/tmp/${FRP_FILENAME}"

echo ""
echo "==================================="
echo "Installation complete!"
echo "==================================="
