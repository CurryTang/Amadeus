const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const BaseModule = require('./base-module');
const { getDb } = require('../../../db');
const { terminateProcessTree } = require('../process-control');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function shellEscape(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function isValidEnvKey(key = '') {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key || ''));
}

function asBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function buildRuntimeEnv(context, inputs = {}) {
  const out = {};
  const runtimeEnv = context?.runtimeEnv && typeof context.runtimeEnv === 'object'
    ? context.runtimeEnv
    : {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!key) continue;
    out[key] = String(value ?? '');
  }
  const inputEnv = inputs?.env && typeof inputs.env === 'object' ? inputs.env : {};
  for (const [key, value] of Object.entries(inputEnv)) {
    if (!key) continue;
    out[key] = String(value ?? '');
  }
  return out;
}

// Parse a proxy_jump string like "user@host:port" or "user@host" into components.
function parseProxyJump(proxyJump = '') {
  const s = cleanString(proxyJump);
  if (!s) return null;
  const m = s.match(/^((?:[^@]+)@)?([^:@]+)(?::(\d+))?$/);
  if (!m) return null;
  return { userAt: m[1] || '', host: m[2], port: m[3] || null };
}

// Build a ProxyCommand string for the given proxy_jump and key.
// Uses ProxyCommand instead of -J to ensure StrictHostKeyChecking options
// propagate correctly for tunnel endpoints (e.g. 127.0.0.1:9022 → scully).
function buildProxyCommand(proxyJump, keyPath, connectTimeout) {
  const parsed = parseProxyJump(proxyJump);
  if (!parsed) return null;
  const { userAt, host, port } = parsed;
  const parts = [
    'ssh', '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-i', keyPath,
  ];
  if (port) parts.push('-p', port);
  parts.push('-W', '%h:%p', `${userAt}${host}`);
  return parts.join(' ');
}

function buildSshArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server?.port || 22),
  ];
  const proxyJump = cleanString(server?.proxy_jump);
  if (proxyJump) {
    const proxyCmd = buildProxyCommand(proxyJump, keyPath, connectTimeout);
    if (proxyCmd) {
      args.push('-o', `ProxyCommand=${proxyCmd}`);
    } else {
      args.push('-J', proxyJump);
    }
  }
  return args;
}

function buildScpArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-P', String(server?.port || 22),
  ];
  const proxyJump = cleanString(server?.proxy_jump);
  if (proxyJump) {
    const proxyCmd = buildProxyCommand(proxyJump, keyPath, connectTimeout);
    if (proxyCmd) {
      args.push('-o', `ProxyCommand=${proxyCmd}`);
    } else {
      args.push('-J', proxyJump);
    }
  }
  return args;
}

function inferMimeType(filePath = '') {
  const p = cleanString(filePath).toLowerCase();
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.csv')) return 'text/csv';
  if (p.endsWith('.tsv')) return 'text/tab-separated-values';
  if (p.endsWith('.md')) return 'text/markdown';
  if (p.endsWith('.txt') || p.endsWith('.log')) return 'text/plain';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.pdf')) return 'application/pdf';
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'text/yaml';
  return 'application/octet-stream';
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function toRootCandidates(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }
  const single = cleanString(value);
  if (!single) return [];
  return [single];
}

function normalizeAutoCaptureDirs(value) {
  const defaults = ['docs', 'results', 'submissions'];
  const raw = Array.isArray(value) ? value : defaults;
  const normalized = new Set();
  raw.forEach((item) => {
    const token = cleanString(item).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!token) return;
    if (token.includes('..')) return;
    normalized.add(token);
  });
  if (normalized.size === 0) {
    defaults.forEach((item) => normalized.add(item));
  }
  return [...normalized];
}

function normalizeAutoCaptureRoots(value) {
  const defaults = ['REPORT.md'];
  const raw = value === undefined ? defaults : toRootCandidates(value);
  const normalized = new Set();
  raw.forEach((item) => {
    const token = cleanString(item).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!token) return;
    if (token.includes('..')) return;
    normalized.add(token);
  });
  return normalized.size > 0 ? [...normalized] : defaults;
}

function toRelativeWithin(baseDir, candidatePath) {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(base, candidate);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

async function listLocalDeliverableCandidates(cwd, {
  dirs = [],
  rootFiles = [],
  maxFiles = 24,
  maxBytes = 5 * 1024 * 1024,
} = {}) {
  const queue = [];
  const dirRoots = dirs.map((dir) => path.resolve(cwd, dir));
  const dirPrefixes = new Set(dirs.map((dir) => cleanString(dir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')));

  async function walkDirectory(currentPath) {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.git')) continue;
        // eslint-disable-next-line no-await-in-loop
        await walkDirectory(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = toRelativeWithin(cwd, fullPath);
      if (!rel) continue;
      const top = rel.split('/')[0];
      if (!dirPrefixes.has(top)) continue;
      let stat = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        stat = await fs.stat(fullPath);
      } catch (_) {
        stat = null;
      }
      if (!stat || !stat.isFile()) continue;
      if (Number(stat.size) > maxBytes) continue;
      queue.push({
        relPath: rel,
        absPath: fullPath,
        size: Number(stat.size) || 0,
        mtimeMs: Number(stat.mtimeMs) || 0,
      });
    }
  }

  for (const dirRoot of dirRoots) {
    // eslint-disable-next-line no-await-in-loop
    await walkDirectory(dirRoot);
  }

  for (const rootFile of rootFiles) {
    const absPath = path.resolve(cwd, rootFile);
    let stat = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      stat = await fs.stat(absPath);
    } catch (_) {
      stat = null;
    }
    if (!stat || !stat.isFile()) continue;
    if (Number(stat.size) > maxBytes) continue;
    const rel = toRelativeWithin(cwd, absPath);
    if (!rel) continue;
    queue.push({
      relPath: rel,
      absPath,
      size: Number(stat.size) || 0,
      mtimeMs: Number(stat.mtimeMs) || 0,
    });
  }

  queue.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const deduped = [];
  const seen = new Set();
  for (const item of queue) {
    if (seen.has(item.relPath)) continue;
    seen.add(item.relPath);
    deduped.push(item);
    if (deduped.length >= maxFiles) break;
  }
  return deduped;
}

async function listRemoteDeliverableCandidates(execServer, cwd, {
  dirs = [],
  rootFiles = [],
  maxFiles = 24,
  maxBytes = 5 * 1024 * 1024,
} = {}) {
  const escapedRoot = shellEscape(cwd);
  const escapedDirs = dirs.map((item) => shellEscape(item)).join(' ');
  const escapedRoots = rootFiles.map((item) => shellEscape(item)).join(' ');
  const script = [
    'set -euo pipefail',
    `ROOT=${escapedRoot}`,
    `MAX_FILES=${Number(maxFiles)}`,
    `MAX_BYTES=${Number(maxBytes)}`,
    'collect() {',
    '  local rel="$1"',
    '  local full="$2"',
    '  if [ ! -f "$full" ]; then return; fi',
    '  local size',
    '  size=$(wc -c < "$full" 2>/dev/null || echo 0)',
    '  if [ "${size:-0}" -gt "$MAX_BYTES" ]; then return; fi',
    '  local mtime',
    '  mtime=$(stat -c %Y "$full" 2>/dev/null || echo 0)',
    '  printf "%s\\t%s\\t%s\\n" "$rel" "${size:-0}" "${mtime:-0}"',
    '}',
    'for d in ' + (escapedDirs || "''") + '; do',
    '  [ -z "$d" ] && continue',
    '  if [ -d "$ROOT/$d" ]; then',
    '    while IFS= read -r full; do',
    '      [ -z "$full" ] && continue',
    '      rel="${full#"$ROOT"/}"',
    '      collect "$rel" "$full"',
    '    done < <(find "$ROOT/$d" -type f 2>/dev/null)',
    '  fi',
    'done',
    'for rf in ' + (escapedRoots || "''") + '; do',
    '  [ -z "$rf" ] && continue',
    '  collect "$rf" "$ROOT/$rf"',
    'done',
    'exit 0',
  ].join('\n');

  const sshArgs = [
    ...buildSshArgs(execServer, { connectTimeout: 15 }),
    `${execServer.user}@${execServer.host}`,
    'bash',
    '-s',
  ];

  const output = await new Promise((resolve, reject) => {
    const proc = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdin.write(`${script}\n`);
    proc.stdin.end();
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(stdout);
      return reject(new Error(stderr.trim() || `ssh exited ${code}`));
    });
  });

  const rows = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length < 3) return null;
      const [relPath, sizeRaw, mtimeRaw] = parts;
      const rel = cleanString(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel || rel.includes('..')) return null;
      const size = Number(sizeRaw);
      const mtime = Number(mtimeRaw);
      if (!Number.isFinite(size) || size < 0) return null;
      if (!Number.isFinite(mtime) || mtime < 0) return null;
      return {
        relPath: rel,
        size,
        mtimeMs: mtime * 1000,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const deduped = [];
  const seen = new Set();
  for (const item of rows) {
    if (seen.has(item.relPath)) continue;
    seen.add(item.relPath);
    deduped.push(item);
    if (deduped.length >= maxFiles) break;
  }
  return deduped;
}

function isLocalExecTarget(rawValue = '') {
  const value = cleanString(rawValue).toLowerCase();
  if (!value) return true;
  return ['local', 'local-default', 'self', 'current'].includes(value);
}

async function getExecServerByRef(ref = '') {
  const normalized = cleanString(ref);
  if (!normalized || isLocalExecTarget(normalized)) return null;
  const db = getDb();
  let result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE id = ?`,
    args: [normalized],
  });
  if (result.rows?.length) return result.rows[0];
  result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE name = ?`,
    args: [normalized],
  });
  return result.rows?.[0] || null;
}

function resolveSharedFsConfig(server = null) {
  if (!server || typeof server !== 'object') {
    return {
      enabled: false,
      verified: false,
      group: '',
      serverPath: '',
    };
  }
  const group = cleanString(server.shared_fs_group).toLowerCase();
  const remotePath = cleanString(server.shared_fs_remote_path)
    || cleanString(server.shared_fs_local_path);
  return {
    enabled: asBooleanFlag(server.shared_fs_enabled),
    verified: asBooleanFlag(server.shared_fs_verified),
    group,
    serverPath: remotePath,
  };
}

function remainderWithinPrefix(targetPath = '', prefixPath = '') {
  const target = cleanString(targetPath) ? path.resolve(cleanString(targetPath)) : '';
  const prefix = cleanString(prefixPath) ? path.resolve(cleanString(prefixPath)) : '';
  if (!target || !prefix) return null;
  if (target === prefix) return '';
  const normalizedPrefix = prefix.endsWith(path.sep) ? prefix : `${prefix}${path.sep}`;
  if (!target.startsWith(normalizedPrefix)) return null;
  return target.slice(normalizedPrefix.length);
}

function resolveRemoteCwd({ cwd, execServer, sourceServer }) {
  const original = cleanString(cwd) ? path.resolve(cwd) : process.cwd();
  if (!execServer) {
    return {
      originalCwd: original,
      effectiveCwd: original,
      mapped: false,
      mappingReason: '',
    };
  }

  const execShared = resolveSharedFsConfig(execServer);
  if (!execShared.enabled || !execShared.verified || !execShared.group || !execShared.serverPath) {
    return {
      originalCwd: original,
      effectiveCwd: original,
      mapped: false,
      mappingReason: '',
    };
  }

  const execRemainder = remainderWithinPrefix(original, execShared.serverPath);
  if (execRemainder !== null) {
    return {
      originalCwd: original,
      effectiveCwd: path.join(execShared.serverPath, execRemainder),
      mapped: false,
      mappingReason: 'already_on_exec_server_path',
    };
  }

  const sourceShared = resolveSharedFsConfig(sourceServer);
  if (
    sourceShared.enabled
    && sourceShared.verified
    && sourceShared.group
    && sourceShared.group === execShared.group
    && sourceShared.serverPath
  ) {
    const sourceRemainder = remainderWithinPrefix(original, sourceShared.serverPath);
    if (sourceRemainder !== null) {
      return {
        originalCwd: original,
        effectiveCwd: path.join(execShared.serverPath, sourceRemainder),
        mapped: true,
        mappingReason: 'source_server_path_to_exec_server_path',
      };
    }
  }

  return {
    originalCwd: original,
    effectiveCwd: original,
    mapped: false,
    mappingReason: '',
  };
}

// Derive a short tmux session name from a run ID (deterministic, ≤20 chars)
function deriveTmuxSession(runId) {
  return `resops-${String(runId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}

// Derive deterministic log/exit file paths for a run step
function deriveTmuxPaths(runId, stepId) {
  const safeStep = String(stepId || 'step').replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = `/tmp/researchops-runs/${runId}`;
  return { logFile: `${base}/${safeStep}.log`, exitFile: `${base}/${safeStep}.exit` };
}

// Fire-and-forget SSH command for remote cleanup (e.g. killing a tmux session)
function spawnRemoteFireAndForget(server, cmd) {
  if (!server || !cleanString(cmd)) return;
  try {
    const proc = spawn('ssh', [
      ...buildSshArgs(server, { connectTimeout: 10 }),
      `${server.user}@${server.host}`,
      'bash', '-c', cmd,
    ], { stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32' });
    if (typeof proc.unref === 'function') proc.unref();
  } catch (_) { /* fire-and-forget */ }
}

function buildRemoteScript(envVars = {}, tmuxOpts = null) {
  const exports = Object.entries(envVars)
    .filter(([key]) => isValidEnvKey(key))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
  const header = [
    'TARGET_CWD="$1"',
    'RUN_CMD_B64="$2"',
    'RUN_CMD=""',
    'if [ -n "$RUN_CMD_B64" ]; then',
    '  RUN_CMD="$(printf \'%s\' "$RUN_CMD_B64" | base64 -d 2>/dev/null || true)"',
    '  if [ -z "$RUN_CMD" ]; then',
    '    RUN_CMD="$(printf \'%s\' "$RUN_CMD_B64" | base64 --decode 2>/dev/null || true)"',
    '  fi',
    'fi',
    'if [ -z "$RUN_CMD" ]; then',
    '  echo "Missing remote command payload" >&2',
    '  exit 2',
    'fi',
    'case "$TARGET_CWD" in',
    "  '~'|'~/'*) TARGET_CWD=\"$HOME${TARGET_CWD#\\~}\" ;;",
    'esac',
    'if [ -n "$TARGET_CWD" ]; then',
    '  cd "$TARGET_CWD"',
    'fi',
    ...exports,
  ];

  if (tmuxOpts && tmuxOpts.sessionName) {
    const { sessionName, logFile, exitFile } = tmuxOpts;
    // Runner script executed inside the tmux session (base64-encoded to avoid quoting issues)
    const runnerLines = [
      '#!/usr/bin/env bash',
      'bash -l "$1" > "$2" 2>&1',
      'printf \'%d\\n\' "$?" > "$3"',
      'rm -f "$1" "$4"',
    ].join('\n');
    const runnerB64 = Buffer.from(runnerLines, 'utf8').toString('base64');
    return [
      ...header,
      `_RT_SESSION=${shellEscape(sessionName)}`,
      `_RT_LOG=${shellEscape(logFile)}`,
      `_RT_EXIT=${shellEscape(exitFile)}`,
      `_RT_RUNNER_B64=${shellEscape(runnerB64)}`,
      'mkdir -p "$(dirname "$_RT_LOG")" "$(dirname "$_RT_EXIT")"',
      'rm -f "$_RT_LOG" "$_RT_EXIT"',
      'touch "$_RT_LOG"',
      'if command -v tmux >/dev/null 2>&1; then',
      '  tmux kill-session -t "$_RT_SESSION" 2>/dev/null || true',
      '  _RT_SCRIPT="$(mktemp /tmp/resops-cmd-XXXXX.sh)"',
      '  _RT_RUNNER="$(mktemp /tmp/resops-run-XXXXX.sh)"',
      '  printf \'%s\' "$RUN_CMD" > "$_RT_SCRIPT"',
      '  printf \'%s\' "$_RT_RUNNER_B64" | base64 -d 2>/dev/null > "$_RT_RUNNER" ||',
      '    printf \'%s\' "$_RT_RUNNER_B64" | base64 --decode 2>/dev/null > "$_RT_RUNNER"',
      '  chmod 700 "$_RT_SCRIPT" "$_RT_RUNNER"',
      '  tmux new-session -d -s "$_RT_SESSION" "bash $_RT_RUNNER $_RT_SCRIPT $_RT_LOG $_RT_EXIT $_RT_RUNNER" || {',
      '    bash -lc "$RUN_CMD"; exit $?',
      '  }',
      '  tail -n +1 -f "$_RT_LOG" &',
      '  _RT_TAIL=$!',
      '  while ! [ -f "$_RT_EXIT" ]; do sleep 0.3; done',
      '  sleep 1',
      '  kill "$_RT_TAIL" 2>/dev/null || true',
      '  wait "$_RT_TAIL" 2>/dev/null || true',
      '  tmux kill-session -t "$_RT_SESSION" 2>/dev/null || true',
      '  _RT_RC="$(cat "$_RT_EXIT" 2>/dev/null || echo 1)"',
      '  rm -f "$_RT_LOG" "$_RT_EXIT" 2>/dev/null || true',
      '  exit "$_RT_RC"',
      'else',
      '  bash -lc "$RUN_CMD"',
      'fi',
      '',
    ].join('\n');
  }

  return [...header, 'bash -lc "$RUN_CMD"', ''].join('\n');
}

function toRemoteShellCommand({ command = '', args = [], cmd = '' } = {}) {
  if (cleanString(cmd)) return cmd;
  const head = cleanString(command);
  if (!head) return '';
  const escapedArgs = asStringArray(args).map((item) => shellEscape(item)).join(' ');
  return `${shellEscape(head)}${escapedArgs ? ` ${escapedArgs}` : ''}`;
}

class BashRunModule extends BaseModule {
  constructor() {
    super('bash.run');
  }

  validate(step) {
    super.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const cmd = cleanString(inputs.cmd);
    const command = cleanString(inputs.command);
    if (!cmd && !command) {
      throw new Error('bash.run requires inputs.cmd or inputs.command');
    }
  }

  async run(step, context) {
    this.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const command = cleanString(inputs.command);
    const args = asStringArray(inputs.args);
    const cmd = cleanString(inputs.cmd);
    const cwd = cleanString(inputs.cwd || context.run?.metadata?.cwd) || process.cwd();
    const timeoutMs = Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 15 * 60 * 1000;
    const runtimeEnv = buildRuntimeEnv(context, inputs);
    const outputFiles = asStringArray(inputs.outputFiles);
    const autoCaptureOutputs = toBoolean(inputs.autoCaptureOutputs, true);
    const autoCaptureDirs = normalizeAutoCaptureDirs(inputs.autoCaptureDirs);
    const autoCaptureRoots = normalizeAutoCaptureRoots(inputs.autoCaptureRootFiles);
    const autoCaptureMaxFiles = toPositiveInt(inputs.autoCaptureMaxFiles, 24, { min: 1, max: 200 });
    const autoCaptureMaxBytes = toPositiveInt(inputs.autoCaptureMaxBytes, 5 * 1024 * 1024, {
      min: 1024,
      max: 50 * 1024 * 1024,
    });
    const execServerRef = cleanString(
      inputs.execServerId
      || inputs.sshServerId
      || inputs.targetServerId
      || context.run?.metadata?.bashExecServerId
      || context.run?.serverId
    );
    const sourceServerRef = cleanString(
      context.run?.metadata?.cwdSourceServerId
      || context.run?.metadata?.sourceServerId
    );
    const execServer = await getExecServerByRef(execServerRef);
    const sourceServer = sourceServerRef && !isLocalExecTarget(sourceServerRef)
      ? await getExecServerByRef(sourceServerRef)
      : null;
    if (execServerRef && !isLocalExecTarget(execServerRef) && !execServer) {
      throw new Error(`bash.run exec server not found: ${execServerRef}`);
    }
    const executionTarget = execServer
      ? `ssh:${execServer.id} (${execServer.user}@${execServer.host})`
      : 'local';
    const cwdResolution = resolveRemoteCwd({
      cwd,
      execServer,
      sourceServer,
    });
    const effectiveCwd = execServer ? cwdResolution.effectiveCwd : cwdResolution.originalCwd;

    const procSpec = command
      ? { command, args }
      : { command: 'bash', args: ['-lc', cmd] };

    await context.emitStepLog(step, `Running [${executionTarget}] ${procSpec.command} ${procSpec.args.join(' ')}`);
    if (execServer && cwdResolution.mapped && cwdResolution.originalCwd !== cwdResolution.effectiveCwd) {
      await context.emitStepLog(
        step,
        `[shared-fs] mapped cwd ${cwdResolution.originalCwd} -> ${cwdResolution.effectiveCwd} (${cwdResolution.mappingReason})`
      );
    }

    const runId = cleanString(context.run?.id);
    const tmuxOpts = execServer && runId
      ? { sessionName: deriveTmuxSession(runId), ...deriveTmuxPaths(runId, step.id) }
      : null;

    return new Promise((resolve, reject) => {
      const detached = process.platform !== 'win32';
      const child = execServer
        ? (() => {
          const remoteCmd = toRemoteShellCommand({ command, args, cmd });
          const remoteCmdBase64 = Buffer.from(remoteCmd, 'utf8').toString('base64');
          const sshArgs = [
            ...buildSshArgs(execServer, { connectTimeout: 15 }),
            `${execServer.user}@${execServer.host}`,
            'bash',
            '-s',
            '--',
            effectiveCwd,
            remoteCmdBase64,
          ];
          const proc = spawn('ssh', sshArgs, {
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached,
          });
          const remoteScript = buildRemoteScript(runtimeEnv, tmuxOpts);
          proc.stdin.on('error', () => {});
          proc.stdin.end(remoteScript);
          return proc;
        })()
        : spawn(procSpec.command, procSpec.args, {
          cwd: effectiveCwd,
          env: {
            ...process.env,
            ...runtimeEnv,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached,
        });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const maxCapture = 200000;

      const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree({
          pid: child.pid,
          child,
          detached,
          graceMs: 3500,
        }).catch(() => {});
        if (execServer && tmuxOpts) {
          const cleanCmd = `tmux kill-session -t ${shellEscape(tmuxOpts.sessionName)} 2>/dev/null; rm -f ${shellEscape(tmuxOpts.logFile)} ${shellEscape(tmuxOpts.exitFile)}`;
          spawnRemoteFireAndForget(execServer, cleanCmd);
        }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      context.registerCancelable(() => {
        terminateProcessTree({
          pid: child.pid,
          child,
          detached,
          graceMs: 3500,
        }).catch(() => {});
        if (execServer && tmuxOpts) {
          const cleanCmd = `tmux kill-session -t ${shellEscape(tmuxOpts.sessionName)} 2>/dev/null; rm -f ${shellEscape(tmuxOpts.logFile)} ${shellEscape(tmuxOpts.exitFile)}`;
          spawnRemoteFireAndForget(execServer, cleanCmd);
        }
      });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout = `${stdout}${text}`.slice(-maxCapture);
        context.emitStepLog(step, text).catch(() => {});
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr = `${stderr}${text}`.slice(-maxCapture);
        context.emitStepLog(step, text, { isError: true }).catch(() => {});
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', async (code, signal) => {
        clearTimeout(timer);
        const exitCode = Number.isFinite(Number(code)) ? Number(code) : -1;
        const result = {
          stepId: step.id,
          moduleType: this.moduleType,
          status: (timedOut || exitCode !== 0) ? 'FAILED' : 'SUCCEEDED',
          metrics: {
            exitCode,
            signal: signal || null,
            timedOut,
            timeoutMs,
            executionTarget,
            execServerId: execServer ? String(execServer.id) : null,
            cwdMapped: cwdResolution.mapped,
            cwdMappingReason: cwdResolution.mappingReason || null,
            requestedCwd: cwdResolution.originalCwd,
            effectiveCwd,
          },
          outputs: {
            stdoutTail: stdout.slice(-8000),
            stderrTail: stderr.slice(-8000),
          },
        };

        try {
          const artifact = await context.createArtifact(step, {
            kind: 'log',
            title: `${step.id}-bash-output`,
            mimeType: 'text/plain',
            content: [
              `# step ${step.id}`,
              '',
              `executionTarget: ${executionTarget}`,
              `command: ${procSpec.command}`,
              `args: ${procSpec.args.join(' ')}`,
              `cwdRequested: ${cwdResolution.originalCwd}`,
              `cwdEffective: ${effectiveCwd}`,
              `cwdMapped: ${cwdResolution.mapped}`,
              `exitCode: ${exitCode}`,
              `timedOut: ${timedOut}`,
              '',
              '## stdout',
              stdout || '(empty)',
              '',
              '## stderr',
              stderr || '(empty)',
              '',
            ].join('\n'),
          });
          result.artifacts = artifact ? [artifact] : [];
        } catch (_) {
          // non-fatal artifact persistence failure
          result.artifacts = [];
        }

        // SCP-fetch declared output files from the remote server and upload as artifacts
        if (result.status === 'SUCCEEDED' && execServer && outputFiles.length > 0) {
          const fetchedArtifacts = [];
          for (const remotePath of outputFiles) {
            const localName = `bash-output-${Date.now()}-${path.basename(remotePath)}`;
            const localPath = path.join(os.tmpdir(), localName);
            try {
              const scpArgs = [
                ...buildScpArgs(execServer, { connectTimeout: 15 }),
                `${execServer.user}@${execServer.host}:${remotePath}`,
                localPath,
              ];
              await new Promise((res, rej) => {
                const scp = spawn('scp', scpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                scp.on('close', (c) => (c === 0 ? res() : rej(new Error(`SCP exited ${c}`))));
                scp.on('error', rej);
              });
              const fileContent = await fs.readFile(localPath);
              const mimeType = inferMimeType(remotePath);
              const fetchedArtifact = await context.createArtifact(step, {
                kind: 'experiment-output',
                title: path.basename(remotePath),
                mimeType,
                content: fileContent,
                metadata: { remotePath, execServerId: String(execServer.id) },
              });
              if (fetchedArtifact) fetchedArtifacts.push(fetchedArtifact);
            } catch (scpErr) {
              await context.emitStepLog(
                step,
                `[output-file-warning] SCP fetch failed for ${remotePath}: ${scpErr.message}`,
                { isError: true }
              ).catch(() => {});
            } finally {
              await fs.unlink(localPath).catch(() => {});
            }
          }
          result.artifacts = [...(result.artifacts || []), ...fetchedArtifacts];
        }

        // Auto-capture deliverables from common output locations.
        if (result.status === 'SUCCEEDED' && autoCaptureOutputs) {
          try {
            const existingArtifacts = await context.listArtifacts();
            const existingPaths = new Set(
              (Array.isArray(existingArtifacts) ? existingArtifacts : [])
                .map((item) => cleanString(item?.path))
                .filter(Boolean)
            );
            const captured = [];
            const candidates = execServer
              ? await listRemoteDeliverableCandidates(execServer, effectiveCwd, {
                dirs: autoCaptureDirs,
                rootFiles: autoCaptureRoots,
                maxFiles: autoCaptureMaxFiles,
                maxBytes: autoCaptureMaxBytes,
              })
              : await listLocalDeliverableCandidates(effectiveCwd, {
                dirs: autoCaptureDirs,
                rootFiles: autoCaptureRoots,
                maxFiles: autoCaptureMaxFiles,
                maxBytes: autoCaptureMaxBytes,
              });

            for (const candidate of candidates) {
              if (!candidate?.relPath || existingPaths.has(candidate.relPath)) continue;
              if (candidate.relPath.startsWith('.git/')) continue;
              let fileBuffer = null;
              try {
                if (execServer) {
                  const remotePath = path.posix.join(
                    effectiveCwd.replace(/\\/g, '/'),
                    candidate.relPath.replace(/\\/g, '/')
                  );
                  const tempPath = path.join(
                    os.tmpdir(),
                    `researchops-deliverable-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(candidate.relPath)}`
                  );
                  const scpArgs = [
                    ...buildScpArgs(execServer, { connectTimeout: 15 }),
                    `${execServer.user}@${execServer.host}:${remotePath}`,
                    tempPath,
                  ];
                  await new Promise((res, rej) => {
                    const scp = spawn('scp', scpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                    scp.on('close', (c) => (c === 0 ? res() : rej(new Error(`SCP exited ${c}`))));
                    scp.on('error', rej);
                  });
                  // eslint-disable-next-line no-await-in-loop
                  fileBuffer = await fs.readFile(tempPath);
                  // eslint-disable-next-line no-await-in-loop
                  await fs.unlink(tempPath).catch(() => {});
                } else {
                  const absolutePath = path.resolve(effectiveCwd, candidate.relPath);
                  // eslint-disable-next-line no-await-in-loop
                  fileBuffer = await fs.readFile(absolutePath);
                }
              } catch (readErr) {
                // eslint-disable-next-line no-await-in-loop
                await context.emitStepLog(
                  step,
                  `[deliverable-capture-warning] Failed to read ${candidate.relPath}: ${readErr.message}`,
                  { isError: true }
                ).catch(() => {});
                continue;
              }

              if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) continue;
              if (fileBuffer.length > autoCaptureMaxBytes) continue;

              try {
                const deliverableArtifact = await context.createArtifact(step, {
                  kind: 'deliverable',
                  title: path.basename(candidate.relPath),
                  mimeType: inferMimeType(candidate.relPath),
                  content: fileBuffer,
                  pathHint: candidate.relPath,
                  metadata: {
                    autoCaptured: true,
                    source: execServer ? 'ssh' : 'local',
                    remoteServerId: execServer ? String(execServer.id) : null,
                    bytes: fileBuffer.length,
                  },
                });
                if (deliverableArtifact) {
                  captured.push(deliverableArtifact);
                  existingPaths.add(candidate.relPath);
                }
              } catch (captureErr) {
                // eslint-disable-next-line no-await-in-loop
                await context.emitStepLog(
                  step,
                  `[deliverable-capture-warning] Failed to persist ${candidate.relPath}: ${captureErr.message}`,
                  { isError: true }
                ).catch(() => {});
              }
            }

            if (captured.length > 0) {
              result.artifacts = [...(result.artifacts || []), ...captured];
              await context.emitStepLog(
                step,
                `[deliverable-capture] auto-promoted ${captured.length} file(s) to run artifacts`
              ).catch(() => {});
            }
          } catch (autoCaptureError) {
            await context.emitStepLog(
              step,
              `[deliverable-capture-warning] ${autoCaptureError.message}`,
              { isError: true }
            ).catch(() => {});
          }
        }

        if (result.status === 'FAILED') {
          const message = timedOut
            ? `bash.run timed out after ${timeoutMs}ms`
            : `bash.run failed with exitCode=${exitCode}`;
          const error = new Error(message);
          error.result = result;
          return reject(error);
        }
        return resolve(result);
      });
    });
  }
}

module.exports = BashRunModule;
module.exports.deriveTmuxSession = deriveTmuxSession;
module.exports.deriveTmuxPaths = deriveTmuxPaths;
module.exports.buildSshArgs = buildSshArgs;
module.exports.spawnRemoteFireAndForget = spawnRemoteFireAndForget;
