#!/bin/bash

# Desktop Processing Server Start Script
# This script starts both FRP client and processing server.
#
# Usage:
#   cd backend && ./scripts/start-desktop.sh          # normal start
#   cd backend && ./scripts/start-desktop.sh --bg      # run in background
#
# Prerequisites:
#   1. frpc binary in backend/ (or installed globally)
#   2. frpc.toml configured with correct server address and token
#   3. .env with API keys (TURSO, AWS, Gemini/Codex CLI creds, etc.)
#   4. node_modules installed (npm install)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

BACKGROUND=false
if [[ "$1" == "--bg" || "$1" == "--background" ]]; then
    BACKGROUND=true
fi

echo "==================================="
echo "Starting Desktop Processing Setup"
echo "==================================="
echo "Backend dir: $BACKEND_DIR"
echo ""

# --- Preflight checks ---

# Find frpc binary: local first, then PATH
FRPC_BIN=""
if [ -x "./frpc" ]; then
    FRPC_BIN="./frpc"
elif command -v frpc &>/dev/null; then
    FRPC_BIN="$(command -v frpc)"
else
    echo "ERROR: frpc binary not found!"
    echo "  Place it in $BACKEND_DIR/frpc or install globally."
    echo "  Download: https://github.com/fatedier/frp/releases"
    exit 1
fi
echo "FRP client: $FRPC_BIN"

# Find frpc config: frpc-local.toml (machine-specific) > frpc.toml
FRPC_CONFIG=""
if [ -f "frpc-local.toml" ]; then
    FRPC_CONFIG="frpc-local.toml"
elif [ -f "frpc.toml" ]; then
    FRPC_CONFIG="frpc.toml"
else
    echo "ERROR: No frpc config found!"
    echo "  Expected frpc-local.toml or frpc.toml in $BACKEND_DIR"
    exit 1
fi
echo "FRP config: $FRPC_CONFIG"

# Check .env
if [ ! -f ".env" ]; then
    echo ""
    echo "WARNING: .env file not found!"
    echo "  Copy .env.desktop.example to .env and fill in API keys."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check node_modules
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo ""

# --- Stop existing processes ---
echo "Stopping any existing processes..."
pkill -f "frpc -c $FRPC_CONFIG" 2>/dev/null || true
pkill -f "processing-server.js" 2>/dev/null || true
sleep 1

# --- Start FRP client ---
echo "Starting FRP client..."
nohup "$FRPC_BIN" -c "$FRPC_CONFIG" > frpc.log 2>&1 &
FRP_PID=$!
echo "FRP client started (PID: $FRP_PID)"

# Wait for FRP to connect
echo "Waiting for FRP connection..."
for i in $(seq 1 10); do
    if grep -q "login to server success" frpc.log 2>/dev/null; then
        echo "FRP connected to server!"
        break
    fi
    if grep -q "connect to server error" frpc.log 2>/dev/null; then
        echo "ERROR: FRP could not connect to server. Check frpc.log"
        cat frpc.log
        exit 1
    fi
    sleep 1
done

if ! grep -q "login to server success" frpc.log 2>/dev/null; then
    echo "WARNING: FRP may not have connected (timeout). Check frpc.log"
fi

# --- Start processing server ---
echo ""
if $BACKGROUND; then
    echo "Starting processing server in background..."
    nohup node processing-server.js >> /tmp/processing-server.log 2>&1 &
    PS_PID=$!
    sleep 2
    if kill -0 "$PS_PID" 2>/dev/null; then
        echo "Processing server started (PID: $PS_PID)"
        echo ""
        echo "=== Desktop processing is running ==="
        echo "  FRP client PID:        $FRP_PID"
        echo "  Processing server PID: $PS_PID"
        echo "  Processing server log: /tmp/processing-server.log"
        echo "  FRP log:               $BACKEND_DIR/frpc.log"
        echo ""
        echo "Stop with: pkill -f processing-server.js; pkill -f 'frpc -c'"
    else
        echo "ERROR: Processing server failed to start. Check /tmp/processing-server.log"
        exit 1
    fi
else
    echo "Starting processing server (foreground)..."
    echo "Press Ctrl+C to stop both FRP and processing server."
    echo ""

    # Trap Ctrl+C to also stop FRP
    trap 'echo ""; echo "Stopping..."; kill $FRP_PID 2>/dev/null; exit 0' INT TERM

    node processing-server.js
fi
