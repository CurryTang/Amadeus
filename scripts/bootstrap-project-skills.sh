#!/usr/bin/env bash
set -euo pipefail

# Bootstrap agent skills for a project root.
# Usage:
#   ./scripts/bootstrap-project-skills.sh
#   ./scripts/bootstrap-project-skills.sh /path/to/project

TARGET_DIR="${1:-$(pwd)}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

SKILLS_DIR="${TARGET_DIR}/.claude/skills"
RESOURCE_DIR="${TARGET_DIR}/resource"
EXTERNAL_SKILLS_REPO="https://github.com/Orchestra-Research/AI-Research-SKILLs.git"
EXTERNAL_SKILLS_DIR="${SKILLS_DIR}/AI-Research-SKILLs"

mkdir -p "${SKILLS_DIR}"
mkdir -p "${RESOURCE_DIR}"

if [[ -d "${EXTERNAL_SKILLS_DIR}/.git" ]]; then
  echo "[bootstrap] Updating AI-Research-SKILLs at ${EXTERNAL_SKILLS_DIR}"
  git -C "${EXTERNAL_SKILLS_DIR}" pull --ff-only
else
  echo "[bootstrap] Cloning AI-Research-SKILLs into ${EXTERNAL_SKILLS_DIR}"
  git clone --depth 1 "${EXTERNAL_SKILLS_REPO}" "${EXTERNAL_SKILLS_DIR}"
fi

echo "[bootstrap] Ensured folders:"
echo "  - ${SKILLS_DIR}"
echo "  - ${RESOURCE_DIR}"
echo "[bootstrap] Done."
