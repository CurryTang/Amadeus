'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { copyTo, script } = require('../ssh-transport.service');
const { buildSshCommandLine, shellEscape } = require('../ssh-transport.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const REMOTE_INSTALL_ROOT = '.researchops/agent-session-observer';
const REMOTE_BIN_PATH = `${REMOTE_INSTALL_ROOT}/bin/researchops-agent-observer`;
const OBSERVER_INSTALL_VERSION = '2026-03-06-v1';
const OBSERVER_SOURCE_FILES = [
  'backend/src/services/agent-session-observer/observer-cli.js',
  'backend/src/services/agent-session-observer/observer-store.js',
  'backend/src/services/agent-session-observer/indexer.js',
];

function getWorkspaceRoot() {
  return path.resolve(__dirname, '../../../../');
}

function isMissingObserverError(error) {
  const message = cleanString(error?.message || error?.stderr || '').toLowerCase();
  return (
    message.includes('researchops-agent-observer')
    && (
      message.includes('no such file')
      || message.includes('command not found')
      || message.includes('cannot find module')
    )
  );
}

function buildRemoteInstallRootShellPath() {
  return '$HOME/.researchops/agent-session-observer';
}

function buildRemoteObserverCommand(observerCommand = REMOTE_BIN_PATH, args = []) {
  const normalizedCommand = cleanString(observerCommand) || REMOTE_BIN_PATH;
  const command = normalizedCommand === REMOTE_BIN_PATH
    ? `"$HOME/${REMOTE_BIN_PATH}"`
    : shellEscape(normalizedCommand);
  return [command, ...args.map((item) => shellEscape(String(item ?? '')))].join(' ');
}

async function ensureRemoteObserverInstalled({
  server,
  copyToFn = copyTo,
  scriptFn = script,
} = {}) {
  if (!server) throw new Error('server is required');

  const workspaceRoot = getWorkspaceRoot();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'researchops-observer-install-'));

  try {
    const packageJsonPath = path.join(tempDir, 'package.json');
    await fs.writeFile(packageJsonPath, `${JSON.stringify({
      name: 'researchops-agent-session-observer',
      private: true,
      version: OBSERVER_INSTALL_VERSION,
      type: 'commonjs',
      dependencies: {
        '@libsql/client': '0.5.6',
      },
    }, null, 2)}\n`, 'utf8');

    const wrapperPath = path.join(tempDir, 'researchops-agent-observer');
    await fs.writeFile(wrapperPath, [
      '#!/usr/bin/env node',
      "const os = require('os');",
      "const path = require('path');",
      "require(path.join(os.homedir(), '.researchops', 'agent-session-observer', 'src', 'services', 'agent-session-observer', 'observer-cli')).main().catch((error) => {",
      '  process.stderr.write(String(error && error.message ? error.message : error) + "\\n");',
      '  process.exit(1);',
      '});',
      '',
    ].join('\n'), 'utf8');

    await scriptFn(server, `
set -eu
INSTALL_ROOT="${buildRemoteInstallRootShellPath()}"
mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/src/services/agent-session-observer"
`, [], { timeoutMs: 30000 });

    for (const relativePath of OBSERVER_SOURCE_FILES) {
      const localPath = path.join(workspaceRoot, relativePath);
      const remotePath = `${REMOTE_INSTALL_ROOT}/src/services/agent-session-observer/${path.basename(relativePath)}`;
      // eslint-disable-next-line no-await-in-loop
      await copyToFn(server, localPath, remotePath, { timeoutMs: 30000 });
    }
    await copyToFn(server, packageJsonPath, `${REMOTE_INSTALL_ROOT}/package.json`, { timeoutMs: 30000 });
    await copyToFn(server, wrapperPath, `${REMOTE_INSTALL_ROOT}/bin/researchops-agent-observer`, { timeoutMs: 30000 });

    await scriptFn(server, `
set -eu
INSTALL_ROOT="${buildRemoteInstallRootShellPath()}"
if ! command -v node >/dev/null 2>&1; then
  echo "node is required on target host" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required on target host" >&2
  exit 1
fi
cd "$INSTALL_ROOT"
npm install --omit=dev --no-audit --no-fund
chmod +x "$INSTALL_ROOT/bin/researchops-agent-observer"
printf '%s\\n' '${OBSERVER_INSTALL_VERSION}' > "$INSTALL_ROOT/.version"
`, [], { timeoutMs: 120000 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runRemoteObserverCommand({
  server,
  args = [],
  observerCommand = REMOTE_BIN_PATH,
  timeoutMs = 15000,
} = {}) {
  if (!server) throw new Error('server is required');
  const remoteArgs = ['bash', '-lc', buildRemoteObserverCommand(observerCommand, args)];
  const commandLine = buildSshCommandLine(server, remoteArgs, { connectTimeout: 15 });
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', commandLine], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('SSH observer command timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(cleanString(stderr) || `SSH observer command failed with exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (error) {
        reject(new Error(`Failed to parse SSH observer JSON: ${error.message}`));
      }
    });
  });
}

async function runObserverCommandWithAutoInstall({
  server,
  args = [],
  runRemoteFn = runRemoteObserverCommand,
  ensureInstalledFn = ensureRemoteObserverInstalled,
} = {}) {
  try {
    return await runRemoteFn({ server, args });
  } catch (error) {
    if (!isMissingObserverError(error)) throw error;
    await ensureInstalledFn({ server });
    return runRemoteFn({ server, args });
  }
}

async function listObservedSessionsViaSshObserver({
  server,
  gitRoot = '',
  runRemoteFn = runRemoteObserverCommand,
  ensureInstalledFn = ensureRemoteObserverInstalled,
} = {}) {
  return runObserverCommandWithAutoInstall({
    server,
    args: ['list', '--git-root', cleanString(gitRoot), '--sync', '--json'],
    runRemoteFn,
    ensureInstalledFn,
  });
}

async function getObservedSessionViaSshObserver({
  server,
  sessionId = '',
  runRemoteFn = runRemoteObserverCommand,
  ensureInstalledFn = ensureRemoteObserverInstalled,
} = {}) {
  return runObserverCommandWithAutoInstall({
    server,
    args: ['get', '--session-id', cleanString(sessionId), '--sync', '--json'],
    runRemoteFn,
    ensureInstalledFn,
  });
}

async function getObservedSessionExcerptViaSshObserver({
  server,
  sessionId = '',
  limit = 120,
  runRemoteFn = runRemoteObserverCommand,
  ensureInstalledFn = ensureRemoteObserverInstalled,
} = {}) {
  return runObserverCommandWithAutoInstall({
    server,
    args: ['excerpt', '--session-id', cleanString(sessionId), '--limit', String(Number(limit) || 120), '--sync', '--json'],
    runRemoteFn,
    ensureInstalledFn,
  });
}

module.exports = {
  ensureRemoteObserverInstalled,
  getObservedSessionExcerptViaSshObserver,
  getObservedSessionViaSshObserver,
  isMissingObserverError,
  listObservedSessionsViaSshObserver,
  runObserverCommandWithAutoInstall,
  runRemoteObserverCommand,
};
