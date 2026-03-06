#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
INSTALL_ROOT="${HOME}/.researchops/agent-session-observer"
BIN_DIR="${INSTALL_ROOT}/bin"
SRC_DIR="${INSTALL_ROOT}/src"

mkdir -p "${BIN_DIR}" "${SRC_DIR}"

cp "${BACKEND_DIR}/scripts/researchops-agent-observer.js" "${BIN_DIR}/researchops-agent-observer"
chmod +x "${BIN_DIR}/researchops-agent-observer"

mkdir -p "${SRC_DIR}/services/agent-session-observer"
cp "${BACKEND_DIR}/src/services/agent-session-observer/observer-cli.js" "${SRC_DIR}/services/agent-session-observer/observer-cli.js"
cp "${BACKEND_DIR}/src/services/agent-session-observer/observer-store.js" "${SRC_DIR}/services/agent-session-observer/observer-store.js"
cp "${BACKEND_DIR}/src/services/agent-session-observer/indexer.js" "${SRC_DIR}/services/agent-session-observer/indexer.js"

cat > "${BIN_DIR}/researchops-agent-observer" <<EOF
#!/usr/bin/env node
require('${SRC_DIR}/services/agent-session-observer/observer-cli').main().catch((error) => {
  process.stderr.write(String(error && error.message ? error.message : error) + '\\n');
  process.exit(1);
});
EOF
chmod +x "${BIN_DIR}/researchops-agent-observer"

echo "Installed researchops-agent-observer to ${BIN_DIR}/researchops-agent-observer"
echo "Add ${BIN_DIR} to PATH or invoke it directly."
