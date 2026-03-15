#!/usr/bin/env bash
set -euo pipefail

DO_HOST="${DO_HOST:?Set DO_HOST to your server IP or hostname}"
DO_USER="${DO_USER:-root}"
DO_REPO_PATH="${DO_REPO_PATH:-/var/www/auto-researcher}"
DO_API_LOCAL_URL="${DO_API_LOCAL_URL:-http://127.0.0.1:3000/api/health}"
DO_FRP_LOCAL_URL="${DO_FRP_LOCAL_URL:-http://127.0.0.1:7001/health}"
PUBLIC_TRACKER_STATUS_URL="${PUBLIC_TRACKER_STATUS_URL:?Set PUBLIC_TRACKER_STATUS_URL to your public API URL}"

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required"
  exit 1
fi

echo "[verify-frp-offload] checking DO local API health"
ssh "${DO_USER}@${DO_HOST}" "curl -fsS ${DO_API_LOCAL_URL}" >/dev/null
echo "  ok: DO API reachable"

echo "[verify-frp-offload] checking FRP tunnel health from DO"
ssh "${DO_USER}@${DO_HOST}" "curl -fsS ${DO_FRP_LOCAL_URL}" >/dev/null
echo "  ok: FRP target reachable"

echo "[verify-frp-offload] checking tracker status endpoint"
curl -fsS "${PUBLIC_TRACKER_STATUS_URL}" >/dev/null
echo "  ok: public tracker status reachable"

echo "[verify-frp-offload] checking tracker scheduler log mode on DO"
ssh "${DO_USER}@${DO_HOST}" "cd ${DO_REPO_PATH}/backend && pm2 logs auto-reader-api --nostream --lines 120 | grep -E 'Paper tracker scheduler is disabled on this node|TRACKER_ENABLED=false' || true"

echo "[verify-frp-offload] completed"
