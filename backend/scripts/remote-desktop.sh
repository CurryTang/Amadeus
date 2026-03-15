#!/bin/bash

# Remote Desktop Management Script
# Run this FROM the DO server to manage the desktop processing machine.
#
# Prerequisites: Desktop must have FRP SSH tunnel running (port 7002)
#
# Usage:
#   ./remote-desktop.sh ssh           # Open SSH shell to desktop
#   ./remote-desktop.sh status        # Check desktop services status
#   ./remote-desktop.sh restart       # Restart processing server
#   ./remote-desktop.sh restart-all   # Restart frpc + processing server
#   ./remote-desktop.sh logs          # Show processing server logs
#   ./remote-desktop.sh health        # Quick health check via FRP
#   ./remote-desktop.sh run <cmd>     # Run arbitrary command on desktop

set -e

DESKTOP_USER="${DESKTOP_USER:?Set DESKTOP_USER to your SSH username}"
DESKTOP_SSH_PORT=7002
DESKTOP_HOST="127.0.0.1"

SSH_CMD="ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -p $DESKTOP_SSH_PORT $DESKTOP_USER@$DESKTOP_HOST"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_connection() {
    if ! $SSH_CMD "echo ok" &>/dev/null; then
        echo -e "${RED}Cannot reach desktop via FRP SSH tunnel (port $DESKTOP_SSH_PORT)${NC}"
        echo ""
        echo "Possible causes:"
        echo "  1. Desktop FRP client not running"
        echo "  2. SSH server not running on desktop"
        echo "  3. FRP tunnel not established"
        echo ""
        echo "Quick health check via processing API:"
        curl -s --connect-timeout 3 http://127.0.0.1:7001/health 2>/dev/null && echo "" || echo -e "${RED}Processing API also unreachable${NC}"
        exit 1
    fi
}

case "${1:-help}" in
    ssh)
        echo "Connecting to desktop..."
        $SSH_CMD
        ;;

    status)
        check_connection
        echo "=== Desktop Service Status ==="
        $SSH_CMD "
            echo '--- FRP Client ---'
            systemctl --user is-active frpc 2>/dev/null || pgrep -af 'frpc -c' || echo 'NOT RUNNING'
            echo ''
            echo '--- Processing Server ---'
            systemctl --user is-active processing-server 2>/dev/null || pgrep -af processing-server || echo 'NOT RUNNING'
            echo ''
            echo '--- Main Backend ---'
            pgrep -af 'node.*src/index.js' || echo 'NOT RUNNING'
            echo ''
            echo '--- Health Check ---'
            curl -s http://127.0.0.1:3001/health 2>/dev/null || echo 'Processing server unreachable on :3001'
        "
        ;;

    restart)
        check_connection
        echo "Restarting processing server on desktop..."
        $SSH_CMD "
            if systemctl --user is-active processing-server &>/dev/null; then
                systemctl --user restart processing-server
                echo 'Restarted via systemd'
            else
                pkill -f processing-server.js || true
                sleep 1
                cd ~/auto-researcher/backend
                nohup node processing-server.js >> /tmp/processing-server.log 2>&1 &
                echo \"Restarted manually (PID: \$!)\"
            fi
            sleep 2
            curl -s http://127.0.0.1:3001/health 2>/dev/null && echo '' || echo 'WARNING: health check failed'
        "
        ;;

    restart-all)
        check_connection
        echo "Restarting FRP + processing server on desktop..."
        $SSH_CMD "
            if systemctl --user is-active frpc &>/dev/null; then
                systemctl --user restart frpc processing-server
                echo 'Restarted via systemd'
            else
                pkill -f processing-server.js || true
                pkill -f 'frpc -c' || true
                sleep 2
                cd ~/auto-researcher/backend
                nohup ./frpc -c frpc.toml > frpc.log 2>&1 &
                echo \"FRP restarted (PID: \$!)\"
                sleep 3
                nohup node processing-server.js >> /tmp/processing-server.log 2>&1 &
                echo \"Processing server restarted (PID: \$!)\"
            fi
        "
        ;;

    logs)
        check_connection
        LINES="${2:-50}"
        echo "=== Processing Server Logs (last $LINES lines) ==="
        $SSH_CMD "
            if systemctl --user is-active processing-server &>/dev/null; then
                journalctl --user -u processing-server --no-pager -n $LINES
            else
                tail -n $LINES /tmp/processing-server.log 2>/dev/null || echo 'No log file found'
            fi
        "
        ;;

    health)
        echo -n "Processing API (FRP :7001): "
        if curl -s --connect-timeout 3 http://127.0.0.1:7001/health 2>/dev/null; then
            echo -e " ${GREEN}OK${NC}"
        else
            echo -e "${RED}UNREACHABLE${NC}"
        fi

        echo -n "SSH tunnel (FRP :7002):     "
        if $SSH_CMD "echo ok" &>/dev/null; then
            echo -e "${GREEN}OK${NC}"
        else
            echo -e "${RED}UNREACHABLE${NC}"
        fi
        ;;

    run)
        shift
        check_connection
        $SSH_CMD "$@"
        ;;

    pull)
        check_connection
        echo "Pulling latest code on desktop..."
        $SSH_CMD "cd ~/auto-researcher && git pull origin master"
        ;;

    help|*)
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  ssh           Open SSH shell to desktop"
        echo "  status        Check desktop services"
        echo "  restart       Restart processing server"
        echo "  restart-all   Restart FRP + processing server"
        echo "  logs [N]      Show last N lines of logs (default 50)"
        echo "  health        Quick health check (no SSH needed for API)"
        echo "  pull          Git pull latest code on desktop"
        echo "  run <cmd>     Run arbitrary command on desktop"
        echo ""
        echo "Environment:"
        echo "  DESKTOP_USER  SSH user (required)"
        ;;
esac
