#!/bin/bash
# session-monitor.sh — Push local Claude Code session info to ARIS API
# Run: ./scripts/session-monitor.sh (once) or with cron/launchd for periodic updates
# Env: ARIS_TOKEN (auth token), ARIS_API (base URL, default https://auto-reader.duckdns.org/api)

ARIS_API="${ARIS_API:-https://auto-reader.duckdns.org/api}"
ARIS_TOKEN="${ARIS_TOKEN:-***REDACTED_ADMIN_TOKEN***}"

# Collect running Claude Code sessions
SESSIONS=$(ps -eo pid,pcpu,rss,etime,command | grep "claude.*--output-format" | grep -v grep | while read -r line; do
  pid=$(echo "$line" | awk '{print $1}')
  cpu=$(echo "$line" | awk '{print $2}')
  rss=$(echo "$line" | awk '{print $3}')
  elapsed=$(echo "$line" | awk '{print $4}')
  model=$(echo "$line" | sed -n 's/.*--model \([^ ]*\).*/\1/p')
  # Get CWD from open files
  cwd=$(lsof -p "$pid" -Fn 2>/dev/null | grep "^n/" | grep -v ".dylib\|.so\|/dev/\|.vscode\|Library\|System\|usr/" | head -1 | sed 's/^n//')
  mem_mb=$((rss / 1024))
  [ -z "$model" ] && model="default"
  [ -z "$cwd" ] && cwd="unknown"
  printf '{"pid":%s,"cpu":%s,"memMb":%s,"elapsed":"%s","model":"%s","cwd":"%s"},' "$pid" "$cpu" "$mem_mb" "$elapsed" "$model" "$cwd"
done)

# Remove trailing comma, wrap in array
SESSIONS="[${SESSIONS%,}]"

# Push to ARIS API
/usr/bin/curl -s -X POST "${ARIS_API}/aris/local-sessions" \
  -H "Authorization: Bearer ${ARIS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":${SESSIONS}}" 2>/dev/null

echo ""
echo "[session-monitor] Pushed $(echo "$SESSIONS" | grep -o '"pid"' | wc -l | tr -d ' ') sessions"
