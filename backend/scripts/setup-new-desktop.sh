#!/bin/bash

# Setup Auto-Reader Desktop Processing on a New Machine
#
# This script prepares a new computer to serve as the desktop processing
# backend for the auto-reader system. After setup, the machine will:
#   1. Connect to the DO server via FRP tunnel
#   2. Run processing-server.js to handle paper analysis requests
#   3. Optionally run the full backend with scheduler
#
# Prerequisites:
#   - Node.js 18+ installed
#   - Git access to the repo
#   - CLI tools installed: gemini, codex (at least one)
#
# Usage:
#   git clone https://github.com/CurryTang/Amadeus.git
#   cd auto-researcher/backend
#   ./scripts/setup-new-desktop.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

FRP_VERSION="0.56.0"
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# Map architecture names
case $ARCH in
    x86_64)   ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l)   ARCH="arm" ;;
esac

echo "============================================"
echo "  Auto-Reader Desktop Processing Setup"
echo "============================================"
echo ""
echo "OS: $OS ($ARCH)"
echo "Backend dir: $BACKEND_DIR"
echo ""

# --- Step 1: Install dependencies ---
echo "--- Step 1: Node.js dependencies ---"
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
else
    echo "node_modules already exists. Skipping npm install."
fi
echo ""

# --- Step 2: Download FRP client ---
echo "--- Step 2: FRP client binary ---"
if [ -x "./frpc" ]; then
    echo "frpc binary already exists."
    ./frpc --version 2>/dev/null || true
elif command -v frpc &>/dev/null; then
    echo "frpc found in PATH: $(command -v frpc)"
else
    echo "Downloading frpc v${FRP_VERSION}..."
    FRP_FILENAME="frp_${FRP_VERSION}_${OS}_${ARCH}.tar.gz"
    FRP_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FRP_FILENAME}"

    wget -q --show-progress "$FRP_URL" -O "/tmp/${FRP_FILENAME}" || {
        echo "ERROR: Failed to download FRP. Try manually:"
        echo "  $FRP_URL"
        exit 1
    }

    tar -xzf "/tmp/${FRP_FILENAME}" -C /tmp/
    cp "/tmp/frp_${FRP_VERSION}_${OS}_${ARCH}/frpc" ./frpc
    chmod +x ./frpc
    rm -rf "/tmp/frp_${FRP_VERSION}_${OS}_${ARCH}" "/tmp/${FRP_FILENAME}"
    echo "frpc installed to $BACKEND_DIR/frpc"
fi
echo ""

# --- Step 3: Configure FRP client ---
echo "--- Step 3: FRP client configuration ---"
if [ -f "frpc-local.toml" ]; then
    echo "frpc-local.toml already exists. Skipping."
elif [ -f "frpc.toml" ]; then
    echo "Copying frpc.toml -> frpc-local.toml for local customization."
    cp frpc.toml frpc-local.toml
    echo ""
    echo "Current server address:"
    grep "serverAddr" frpc-local.toml
    echo ""
    read -p "Change server address? (Enter new address or press Enter to keep): " NEW_ADDR
    if [ -n "$NEW_ADDR" ]; then
        sed -i "s/serverAddr = .*/serverAddr = \"$NEW_ADDR\"/" frpc-local.toml
    fi

    echo ""
    echo "Current auth token:"
    grep "auth.token" frpc-local.toml | head -1
    echo ""
    read -p "Change auth token? (Enter new token or press Enter to keep): " NEW_TOKEN
    if [ -n "$NEW_TOKEN" ]; then
        sed -i "s/auth.token = .*/auth.token = \"$NEW_TOKEN\"/" frpc-local.toml
    fi

    echo "FRP config saved to frpc-local.toml"
else
    echo "ERROR: No frpc.toml template found in repo!"
    echo "Creating a basic one..."
    cat > frpc-local.toml <<'TOML'
# FRP Client Configuration (Desktop)
serverAddr = "YOUR_SERVER_IP"
serverPort = 7000

auth.method = "token"
auth.token = "REPLACE_WITH_YOUR_TOKEN"

log.to = "./frpc.log"
log.level = "info"
log.maxDays = 7

[[proxies]]
name = "llm-processing"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3001
remotePort = 7001
TOML
    echo "Created frpc-local.toml — edit it with your token."
fi
echo ""

# --- Step 4: Configure .env ---
echo "--- Step 4: Environment configuration ---"
if [ -f ".env" ]; then
    echo ".env already exists."

    # Ensure PROCESSING_ENABLED=false is set
    if ! grep -q "PROCESSING_ENABLED" .env; then
        echo "" >> .env
        echo "# Desktop processes locally — disable FRP self-proxy" >> .env
        echo "PROCESSING_ENABLED=false" >> .env
        echo "Added PROCESSING_ENABLED=false to .env"
    fi
else
    if [ -f ".env.desktop.example" ]; then
        cp .env.desktop.example .env
        echo "Copied .env.desktop.example -> .env"
        echo ""
        echo "IMPORTANT: Edit .env and fill in your API keys:"
        echo "  - TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (required)"
        echo "  - AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (required)"
        echo "  - At least one LLM API key or CLI tool"
        echo ""
        read -p "Open .env in editor now? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ${EDITOR:-nano} .env
        fi
    else
        echo "ERROR: No .env.desktop.example template found."
        echo "Please create .env manually with required API keys."
        exit 1
    fi
fi
echo ""

# --- Step 5: Check CLI tools ---
echo "--- Step 5: CLI tools check ---"
TOOLS_OK=false
if command -v gemini &>/dev/null; then
    echo "  gemini CLI: found ($(command -v gemini))"
    TOOLS_OK=true
else
    echo "  gemini CLI: NOT FOUND"
fi
if command -v codex &>/dev/null; then
    echo "  codex CLI:  found ($(command -v codex))"
    TOOLS_OK=true
else
    echo "  codex CLI:  NOT FOUND"
fi
if command -v claude &>/dev/null; then
    echo "  claude CLI: found ($(command -v claude))"
    TOOLS_OK=true
else
    echo "  claude CLI: NOT FOUND"
fi

if ! $TOOLS_OK; then
    echo ""
    echo "WARNING: No LLM CLI tools found!"
    echo "  Install at least one: gemini, codex, or claude"
    echo "  Processing will fail without CLI tools."
fi
echo ""

# --- Step 6: Test FRP connection ---
echo "--- Step 6: Quick FRP connection test ---"
FRPC_BIN="./frpc"
[ -x "$FRPC_BIN" ] || FRPC_BIN="$(command -v frpc 2>/dev/null || true)"
FRPC_CONFIG="frpc-local.toml"
[ -f "$FRPC_CONFIG" ] || FRPC_CONFIG="frpc.toml"

if [ -n "$FRPC_BIN" ] && [ -f "$FRPC_CONFIG" ]; then
    echo "Testing FRP connection..."
    timeout 10 "$FRPC_BIN" -c "$FRPC_CONFIG" &
    TEST_PID=$!
    sleep 5
    if grep -q "login to server success" frpc.log 2>/dev/null; then
        echo "FRP connection: OK"
    else
        echo "FRP connection: FAILED (check frpc.log)"
    fi
    kill $TEST_PID 2>/dev/null || true
    wait $TEST_PID 2>/dev/null || true
else
    echo "Skipping FRP test (missing binary or config)"
fi
echo ""

# --- Done ---
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
echo "To start the desktop processing server:"
echo "  cd $BACKEND_DIR"
echo "  ./scripts/start-desktop.sh          # foreground"
echo "  ./scripts/start-desktop.sh --bg     # background"
echo ""
echo "To also run the full backend (with paper scheduler):"
echo "  npm run dev"
echo ""
echo "Architecture:"
echo "  DO Server (API proxy) --FRP--> This machine (processing)"
echo "  DO:7001 tunnels to localhost:3001 (processing-server.js)"
echo ""
