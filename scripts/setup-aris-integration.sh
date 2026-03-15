#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

MCP_SERVER_PATH="${ROOT_DIR}/backend/src/mcp/auto-researcher-mcp-server.js"

print_next_steps() {
  echo "[aris] Installed AIRS project files into: ${TARGET_DIR}"
  echo "[aris] Claude Code skills: ${TARGET_DIR}/.claude/skills"
  echo "[aris] Claude Code instructions: ${TARGET_DIR}/CLAUDE.md"
  echo "[aris] MCP server: ${MCP_SERVER_PATH}"
  echo "[aris] Register the MCP server in Claude Code:"
  echo "  claude mcp add auto-researcher -s project -- node ${MCP_SERVER_PATH}"
  echo "[aris] Optional compatibility alias for older Zotero-shaped skills:"
  echo "  claude mcp add zotero -s project -- node ${MCP_SERVER_PATH}"
}

node "${ROOT_DIR}/scripts/materialize-aris-project-files.js" "${TARGET_DIR}"
print_next_steps
