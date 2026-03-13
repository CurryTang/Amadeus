#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NEXT_DIR="${ROOT_DIR}/.next"
STANDALONE_DIR="${NEXT_DIR}/standalone"

if [[ ! -d "${STANDALONE_DIR}" ]]; then
  echo "[prepare-standalone] Missing ${STANDALONE_DIR}. Run next build first." >&2
  exit 1
fi

mkdir -p "${STANDALONE_DIR}/.next"

if [[ -d "${NEXT_DIR}/static" ]]; then
  cp -R "${NEXT_DIR}/static" "${STANDALONE_DIR}/.next/"
fi

if [[ -d "${ROOT_DIR}/public" ]]; then
  cp -R "${ROOT_DIR}/public" "${STANDALONE_DIR}/"
fi

echo "[prepare-standalone] Standalone assets copied into ${STANDALONE_DIR}"
