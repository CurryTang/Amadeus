#!/bin/bash
# session-monitor.sh — Push local Claude Code session info to ARIS API
# Cron: runs every 30s automatically
#
# Detection: scans ~/.claude/projects/*/session.jsonl files for recent activity.
# Catches all session types: CLI, VS Code extension, SDK, etc.

ARIS_API="${ARIS_API:-https://auto-reader.duckdns.org/api}"
ARIS_TOKEN="${ARIS_TOKEN:?Set ARIS_TOKEN env var}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSIONS=$(node "${SCRIPT_DIR}/session-monitor.js" 2>/dev/null)

/usr/bin/curl -s -X POST "${ARIS_API}/aris/local-sessions" \
  -H "Authorization: Bearer ${ARIS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":${SESSIONS:-[]}}" >/dev/null 2>&1
