#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$BACKEND_DIR/.env.researchops-rust-daemon"
LOG_FILE="${RESEARCHOPS_RUST_DAEMON_LOG:-/tmp/researchops-rust-daemon.log}"
TRANSPORT="${RESEARCHOPS_RUST_DAEMON_TRANSPORT:-http}"
HTTP_ADDR="${RESEARCHOPS_RUST_DAEMON_HTTP_ADDR:-127.0.0.1:7788}"
UNIX_SOCKET="${RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET:-/tmp/researchops-local-daemon.sock}"

require_env() {
  key="$1"
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "[ResearchOpsRustBootstrap] $key is required" >&2
    exit 1
  fi
}

require_env RESEARCHOPS_API_BASE_URL

mkdir -p "$BACKEND_DIR"

cat >"$ENV_FILE" <<EOF
RESEARCHOPS_API_BASE_URL=$(printf '%s' "$RESEARCHOPS_API_BASE_URL")
RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS=$(printf '%s' "${RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS:-true}")
RESEARCHOPS_RUST_DAEMON_TRANSPORT=$(printf '%s' "$TRANSPORT")
RESEARCHOPS_RUST_DAEMON_HTTP_ADDR=$(printf '%s' "$HTTP_ADDR")
RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET=$(printf '%s' "$UNIX_SOCKET")
EOF

if [ -n "${ADMIN_TOKEN:-}" ]; then
  printf 'ADMIN_TOKEN=%s\n' "$(printf '%s' "$ADMIN_TOKEN")" >>"$ENV_FILE"
fi

if pgrep -f "researchops-local-daemon.*--serve" >/dev/null 2>&1; then
  pkill -f "researchops-local-daemon.*--serve" || true
  sleep 1
fi

if pgrep -f "researchops-local-daemon.*--serve-unix" >/dev/null 2>&1; then
  pkill -f "researchops-local-daemon.*--serve-unix" || true
  sleep 1
fi

cd "$BACKEND_DIR"

if [ "$TRANSPORT" = "unix" ]; then
  nohup env \
    RESEARCHOPS_API_BASE_URL="$RESEARCHOPS_API_BASE_URL" \
    RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS="${RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS:-true}" \
    RESEARCHOPS_RUST_DAEMON_TRANSPORT="$TRANSPORT" \
    RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET="$UNIX_SOCKET" \
    ADMIN_TOKEN="${ADMIN_TOKEN:-}" \
    npm run researchops:rust-daemon >>"$LOG_FILE" 2>&1 &
  echo "[ResearchOpsRustBootstrap] started rust daemon over unix socket (log: $LOG_FILE)"
  echo "[ResearchOpsRustBootstrap] socket: $UNIX_SOCKET"
else
  nohup env \
    RESEARCHOPS_API_BASE_URL="$RESEARCHOPS_API_BASE_URL" \
    RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS="${RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS:-true}" \
    RESEARCHOPS_RUST_DAEMON_TRANSPORT="$TRANSPORT" \
    RESEARCHOPS_RUST_DAEMON_HTTP_ADDR="$HTTP_ADDR" \
    ADMIN_TOKEN="${ADMIN_TOKEN:-}" \
    npm run researchops:rust-daemon >>"$LOG_FILE" 2>&1 &
  echo "[ResearchOpsRustBootstrap] started rust daemon over http (log: $LOG_FILE)"
  echo "[ResearchOpsRustBootstrap] address: $HTTP_ADDR"
fi

echo "[ResearchOpsRustBootstrap] wrote $ENV_FILE"
