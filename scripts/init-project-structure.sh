#!/usr/bin/env bash
set -euo pipefail

# Initialize a new project folder structure.
# Usage:
#   ./scripts/init-project-structure.sh /path/to/ProjectName [--with-skills]

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/ProjectName [--with-skills]"
  exit 1
fi

TARGET_DIR="$1"
WITH_SKILLS="${2:-}"

mkdir -p "${TARGET_DIR}"/{scripts,data,relbench-new,models,rustler,dbinfer,main,cache_data,resource}
mkdir -p "${TARGET_DIR}/.claude/skills"

cat > "${TARGET_DIR}/resource/README.md" <<'EOF'
# Resource Folder

Put project references and constraints here.

Agent rule:
- Always consult `resource/` first before implementation decisions.
EOF

echo "Initialized structure at: ${TARGET_DIR}"

if [[ "${WITH_SKILLS}" == "--with-skills" ]]; then
  "$(cd "$(dirname "$0")/.." && pwd)/scripts/bootstrap-project-skills.sh" "${TARGET_DIR}"
fi
