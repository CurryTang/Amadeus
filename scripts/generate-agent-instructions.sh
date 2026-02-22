#!/usr/bin/env bash
set -euo pipefail

# Generate CLAUDE.md and AGENTS.md from local templates.
# Usage:
#   ./scripts/generate-agent-instructions.sh [target-dir] [project-name] [--force]

TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"
PROJECT_NAME="${2:-$(basename "${TARGET_DIR}")}"
FORCE="${3:-}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="${ROOT_DIR}/.claude/skills/agent-instructions-generator/templates"

CLAUDE_OUT="${TARGET_DIR}/CLAUDE.md"
AGENTS_OUT="${TARGET_DIR}/AGENTS.md"

if [[ ! -d "${TEMPLATE_DIR}" ]]; then
  echo "Missing template directory: ${TEMPLATE_DIR}"
  exit 1
fi

if [[ "${FORCE}" != "--force" ]]; then
  if [[ -f "${CLAUDE_OUT}" || -f "${AGENTS_OUT}" ]]; then
    echo "Target already has CLAUDE.md or AGENTS.md. Re-run with --force to overwrite."
    exit 1
  fi
fi

sed \
  -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
  -e "s|__RESOURCE_PATH__|resource/|g" \
  "${TEMPLATE_DIR}/CLAUDE.md.template" > "${CLAUDE_OUT}"

sed \
  -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
  -e "s|__RESOURCE_PATH__|resource/|g" \
  "${TEMPLATE_DIR}/AGENTS.md.template" > "${AGENTS_OUT}"

echo "Generated:"
echo "  - ${CLAUDE_OUT}"
echo "  - ${AGENTS_OUT}"
