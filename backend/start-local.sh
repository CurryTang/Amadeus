#!/bin/bash

# Simple script to start FRP client and processing server locally
# This is for the desktop machine

set -e

echo "==================================="
echo "Starting Desktop Processing"
echo "==================================="

# Check if we're in the right directory
if [ ! -f "processing-server.js" ]; then
    echo "ERROR: Must run from backend directory"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Kill existing processes
echo "Stopping any existing processes..."
pkill -f "frpc -c frpc.toml" 2>/dev/null || true
pkill -f "processing-server.js" 2>/dev/null || true
sleep 2

# Start FRP client
echo "Starting FRP client..."
./frpc -c frpc.toml > frpc.log 2>&1 &
FRP_PID=$!

sleep 3

# Check if FRP connected
if ! ps -p $FRP_PID > /dev/null 2>&1; then
    echo "✗ FRP client failed to start"
    cat frpc.log
    exit 1
fi

if ! grep -q "login to server success" frpc.log 2>/dev/null; then
    echo "⚠ FRP may not have connected - check frpc.log"
fi

echo "✓ FRP client running (PID: $FRP_PID)"

# Start processing server (with Node.js 20+ from nvm)
echo "Starting processing server..."
# Source nvm and use Node.js 20+ (required for Gemini CLI)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1
node processing-server.js > processing-server.log 2>&1 &
PROC_PID=$!

sleep 3

# Check if processing server started
if ! ps -p $PROC_PID > /dev/null 2>&1; then
    echo "✗ Processing server failed to start"
    cat processing-server.log
    exit 1
fi

echo "✓ Processing server running (PID: $PROC_PID)"

echo ""
echo "==================================="
echo "✓ Desktop Processing Started!"
echo "==================================="
echo ""
echo "FRP Client: PID $FRP_PID (logs: frpc.log)"
echo "Processing Server: PID $PROC_PID (logs: processing-server.log)"
echo ""
echo "To stop:"
echo "  pkill -f frpc"
echo "  pkill -f processing-server"
echo ""
echo "To monitor:"
echo "  tail -f frpc.log"
echo "  tail -f processing-server.log"
echo ""
