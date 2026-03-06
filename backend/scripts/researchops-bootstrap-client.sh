#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$BACKEND_DIR/.env.researchops-client"
LOG_FILE="${RESEARCHOPS_PROCESSING_LOG:-/tmp/auto-researcher-processing-server.log}"

require_env() {
  key="$1"
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "[ResearchOpsBootstrap] $key is required" >&2
    exit 1
  fi
}

require_env RESEARCHOPS_API_BASE_URL
require_env RESEARCHOPS_BOOTSTRAP_ID
require_env RESEARCHOPS_BOOTSTRAP_SECRET

mkdir -p "$BACKEND_DIR"

cat >"$ENV_FILE" <<EOF
RESEARCHOPS_API_BASE_URL=$(printf '%s' "$RESEARCHOPS_API_BASE_URL")
RESEARCHOPS_BOOTSTRAP_ID=$(printf '%s' "$RESEARCHOPS_BOOTSTRAP_ID")
RESEARCHOPS_BOOTSTRAP_SECRET=$(printf '%s' "$RESEARCHOPS_BOOTSTRAP_SECRET")
RESEARCHOPS_DAEMON_HOSTNAME=$(printf '%s' "${RESEARCHOPS_DAEMON_HOSTNAME:-$(hostname)}")
RESEARCHOPS_DAEMON_HEARTBEAT_MS=$(printf '%s' "${RESEARCHOPS_DAEMON_HEARTBEAT_MS:-30000}")
RESEARCHOPS_DAEMON_POLL_MS=$(printf '%s' "${RESEARCHOPS_DAEMON_POLL_MS:-1500}")
EOF

if [ -n "${ADMIN_TOKEN:-}" ]; then
  printf 'ADMIN_TOKEN=%s\n' "$(printf '%s' "$ADMIN_TOKEN")" >>"$ENV_FILE"
fi

if pgrep -f "processing-server.js" >/dev/null 2>&1; then
  pkill -f "processing-server.js" || true
  sleep 1
fi

cd "$BACKEND_DIR"
nohup node --no-deprecation processing-server.js >>"$LOG_FILE" 2>&1 &

echo "[ResearchOpsBootstrap] wrote $ENV_FILE"
echo "[ResearchOpsBootstrap] started processing-server.js (log: $LOG_FILE)"
