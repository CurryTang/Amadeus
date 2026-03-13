#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

ARIS_SKILLS_REPO="${ARIS_SKILLS_REPO:-https://github.com/CurryTang/Auto-claude-code-research-in-sleep.git}"
ARIS_SKILLS_REF="${ARIS_SKILLS_REF:-main}"
ARIS_INSTALL_DIR="${ARIS_INSTALL_DIR:-${TARGET_DIR}/.claude/skills/aris}"
ARIS_OVERLAY_DIR="${ROOT_DIR}/resource/integrations/aris/overlay"
MCP_SERVER_PATH="${ROOT_DIR}/backend/src/mcp/auto-researcher-mcp-server.js"

mkdir -p "$(dirname "${ARIS_INSTALL_DIR}")"

clone_or_update_repo() {
  if [[ -d "${ARIS_INSTALL_DIR}/.git" ]]; then
    if [[ -n "$(git -C "${ARIS_INSTALL_DIR}" status --short)" ]]; then
      echo "[aris] Refusing to update ${ARIS_INSTALL_DIR} because it has local changes."
      echo "[aris] Commit or discard the changes in that clone first."
      exit 1
    fi

    echo "[aris] Updating ARIS clone at ${ARIS_INSTALL_DIR}"
    git -C "${ARIS_INSTALL_DIR}" remote set-url origin "${ARIS_SKILLS_REPO}"
    git -C "${ARIS_INSTALL_DIR}" fetch --depth 1 origin "${ARIS_SKILLS_REF}"
    git -C "${ARIS_INSTALL_DIR}" checkout -B auto-researcher-integration FETCH_HEAD
    return 0
  fi

  echo "[aris] Cloning ${ARIS_SKILLS_REPO} into ${ARIS_INSTALL_DIR}"
  git clone --depth 1 --branch "${ARIS_SKILLS_REF}" "${ARIS_SKILLS_REPO}" "${ARIS_INSTALL_DIR}"
}

apply_overlay() {
  if [[ ! -d "${ARIS_OVERLAY_DIR}" ]]; then
    echo "[aris] No overlay directory found at ${ARIS_OVERLAY_DIR}; skipping overlay."
    return 0
  fi

  echo "[aris] Applying Auto Researcher overlay from ${ARIS_OVERLAY_DIR}"
  cp -R "${ARIS_OVERLAY_DIR}/." "${ARIS_INSTALL_DIR}/"
}

print_next_steps() {
  echo "[aris] Installed clone: ${ARIS_INSTALL_DIR}"
  echo "[aris] MCP server: ${MCP_SERVER_PATH}"
  echo "[aris] Register the MCP server in Claude Code:"
  echo "  claude mcp add auto-researcher -s project -- node ${MCP_SERVER_PATH}"
  echo "[aris] Optional compatibility alias for older Zotero-shaped skills:"
  echo "  claude mcp add zotero -s project -- node ${MCP_SERVER_PATH}"
}

clone_or_update_repo
apply_overlay
print_next_steps
