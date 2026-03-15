#!/usr/bin/env bash
set -euo pipefail

DO_HOST="${DO_HOST:?Set DO_HOST to your server IP or hostname}"
DO_USER="${DO_USER:-root}"
DO_REPO_PATH="${DO_REPO_PATH:-/var/www/auto-researcher}"
DO_ENV_FILE="${DO_ENV_FILE:-$DO_REPO_PATH/backend/.env}"
PM2_APP_NAME="${PM2_APP_NAME:-auto-reader-api}"
FRP_DESKTOP_URL="${FRP_DESKTOP_URL:-http://127.0.0.1:7001}"

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required"
  exit 1
fi

echo "[set-do-tracker-proxy] applying DO env split on ${DO_USER}@${DO_HOST}"

ssh "${DO_USER}@${DO_HOST}" \
  "DO_ENV_FILE='${DO_ENV_FILE}' PM2_APP_NAME='${PM2_APP_NAME}' FRP_DESKTOP_URL='${FRP_DESKTOP_URL}' DO_REPO_PATH='${DO_REPO_PATH}' bash -s" <<'EOF'
set -euo pipefail
ENV_FILE="${DO_ENV_FILE}"
APP_NAME="${PM2_APP_NAME}"
FRP_URL="${FRP_DESKTOP_URL}"
REPO_PATH="${DO_REPO_PATH}"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing env file: $ENV_FILE"
  exit 1
fi

upsert() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#g" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

upsert TRACKER_ENABLED false
upsert TRACKER_PROXY_HEAVY_OPS true
upsert TRACKER_DESKTOP_URL "$FRP_URL"
upsert TRACKER_PROXY_TIMEOUT 120000
upsert PROCESSING_DESKTOP_URL "$FRP_URL"

cd "${REPO_PATH}/backend"
pm2 restart "$APP_NAME" --update-env
pm2 save
echo "updated and restarted $APP_NAME"
EOF

echo "[set-do-tracker-proxy] done"
