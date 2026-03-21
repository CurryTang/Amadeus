#!/bin/bash
# session-monitor.sh — Push local Claude Code session info to ARIS API
# Cron: runs every 30s automatically

ARIS_API="${ARIS_API:-https://auto-reader.duckdns.org/api}"
ARIS_TOKEN="${ARIS_TOKEN:-***REDACTED_ADMIN_TOKEN***}"

# Collect running Claude Code sessions with reliable CWD detection
SESSIONS=$(/bin/ps -eo pid,pcpu,rss,lstart,etime,command | grep "claude.*--output-format" | grep -v grep | while read -r pid cpu rss dow mon day time year elapsed rest; do
  model=$(echo "$rest" | sed -n 's/.*--model \([^ ]*\).*/\1/p')
  [ -z "$model" ] && model="default"

  # Reliable CWD via lsof -d cwd
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep "^n" | head -1 | sed 's/^n//')
  [ -z "$cwd" ] && cwd="unknown"

  mem_mb=$((rss / 1024))

  # Parse start time from lstart (e.g., "Thu Mar 20 12:19:00 2026")
  start_ts=$(date -j -f "%a %b %d %T %Y" "$dow $mon $day $time $year" "+%s" 2>/dev/null || echo "0")
  now_ts=$(date "+%s")
  age_hours=$(( (now_ts - start_ts) / 3600 ))

  # Skip sessions older than 7 days
  [ "$age_hours" -gt 168 ] && continue

  # Determine if actively running (CPU > 0.5% = active)
  is_active="false"
  cpu_int=$(echo "$cpu" | awk '{printf "%d", $1}')
  [ "$cpu_int" -ge 1 ] && is_active="true"

  start_iso=$(date -j -f "%a %b %d %T %Y" "$dow $mon $day $time $year" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || echo "")

  printf '{"pid":%s,"cpu":%s,"memMb":%s,"elapsed":"%s","model":"%s","cwd":"%s","startedAt":"%s","isActive":%s},' \
    "$pid" "$cpu" "$mem_mb" "$elapsed" "$model" "$cwd" "$start_iso" "$is_active"
done)

# Remove trailing comma, wrap in array
SESSIONS="[${SESSIONS%,}]"

# Push to ARIS API
/usr/bin/curl -s -X POST "${ARIS_API}/aris/local-sessions" \
  -H "Authorization: Bearer ${ARIS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":${SESSIONS}}" >/dev/null 2>&1
