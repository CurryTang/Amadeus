#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  validate-frp-offload.sh --role <do|local> [--env <path>] [--desktop-url <url>] [--skip-health]

Examples:
  validate-frp-offload.sh --role do --env backend/.env
  validate-frp-offload.sh --role local --env backend/.env --desktop-url http://127.0.0.1:7001
EOF
}

ROLE=""
ENV_FILE="backend/.env"
DESKTOP_URL=""
SKIP_HEALTH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      ROLE="${2:-}"
      shift 2
      ;;
    --env)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --desktop-url)
      DESKTOP_URL="${2:-}"
      shift 2
      ;;
    --skip-health)
      SKIP_HEALTH=1
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$ROLE" ]]; then
  echo "Missing required --role <do|local>" >&2
  usage
  exit 2
fi

if [[ "$ROLE" != "do" && "$ROLE" != "local" ]]; then
  echo "Invalid role: $ROLE (expected do|local)" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 2
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "${!key:-}"
    return 0
  fi
  line="${line#*=}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ "$line" =~ ^\".*\"$ || "$line" =~ ^\'.*\'$ ]]; then
    line="${line:1:${#line}-2}"
  fi
  printf '%s' "$line"
}

fail() {
  echo "[FAIL] $1"
  exit 1
}

pass() {
  echo "[PASS] $1"
}

expect_eq() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(read_env_value "$key")"
  if [[ "$actual" != "$expected" ]]; then
    fail "$key expected '$expected' but got '${actual:-<empty>}'"
  fi
  pass "$key=$expected"
}

if [[ "$ROLE" == "do" ]]; then
  expect_eq "TRACKER_ENABLED" "false"
  expect_eq "TRACKER_PROXY_HEAVY_OPS" "true"
else
  expect_eq "TRACKER_ENABLED" "true"
fi

if [[ "$SKIP_HEALTH" -eq 0 ]]; then
  tracker_desktop_url="$(read_env_value "TRACKER_DESKTOP_URL")"
  processing_desktop_url="$(read_env_value "PROCESSING_DESKTOP_URL")"
  target_url="${DESKTOP_URL:-${tracker_desktop_url:-${processing_desktop_url:-http://127.0.0.1:7001}}}"
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required for health checks (or use --skip-health)"
  fi
  health_url="${target_url%/}/health"
  status_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$health_url" || true)"
  if [[ "$status_code" != "200" ]]; then
    fail "Desktop health check failed: $health_url returned HTTP $status_code"
  fi
  pass "Desktop health check OK: $health_url"
fi

echo "Offload validation completed for role=$ROLE"
