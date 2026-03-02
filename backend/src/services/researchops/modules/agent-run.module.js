const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const BaseModule = require('./base-module');
const { getDb } = require('../../../db');
const config = require('../../../config');
const { terminateProcessTree } = require('../process-control');
const keypairService = require('../../keypair.service');

const TOP_PRIORITY_FILE_REMOVAL_RULE = [
  'TOP-PRIORITY RULE (apply before all other instructions):',
  'If you want to perform any file removal operation (rm, unlink, git rm, delete/move-to-trash), you must:',
  '1) Decompose the removal into explicit sub-steps.',
  '2) Explicitly list every target path and the reason for removing it.',
  '3) Request manual approval.',
  '4) Wait for explicit manual approval before executing any removal.',
].join('\n');

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
    sql: 'SELECT * FROM ssh_servers WHERE id = ?',
    args: [normalized],
  });
  if (result.rows?.length) return result.rows[0];
  result = await db.execute({
    sql: 'SELECT * FROM ssh_servers WHERE name = ?',
    args: [normalized],
  });
  return result.rows?.[0] || null;
}

function parseProxyJump(proxyJump = '') {
  const s = cleanString(proxyJump);
  if (!s) return null;
  const m = s.match(/^((?:[^@]+)@)?([^:@]+)(?::(\d+))?$/);
  if (!m) return null;
  return { userAt: m[1] || '', host: m[2], port: m[3] || null };
}

// Build a ProxyCommand using the proxy key (server ssh_key_path or id_rsa),
// so the jump-host connection uses a key authorized on that host.
function buildProxyCommandArg(proxyJump, proxyKeyPath, connectTimeout) {
  const parsed = parseProxyJump(proxyJump);
  if (!parsed) return null;
  const { userAt, host, port } = parsed;
  const parts = [
    'ssh', '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-i', proxyKeyPath,
  ];
  if (port) parts.push('-p', port);
  parts.push('-W', '%h:%p', `${userAt}${host}`);
  return parts.join(' ');
}

function buildSshArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = keypairService.MANAGED_KEY_PATH;
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
    // Use server's ssh_key_path (or id_rsa) for the proxy/jump-host auth,
    // since the managed key may only be authorized on the target, not the jump host.
    const proxyKeyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
    const proxyCmd = buildProxyCommandArg(proxyJump, proxyKeyPath, connectTimeout);
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
    const proxyKeyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
    const proxyCmd = buildProxyCommandArg(proxyJump, proxyKeyPath, connectTimeout);
    if (proxyCmd) {
      args.push('-o', `ProxyCommand=${proxyCmd}`);
    } else {
      args.push('-J', proxyJump);
    }
  }
  return args;
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function stageRuntimeFilesToRemote({
  execServer,
  context,
  step,
  runtimeEnv,
}) {
  if (!execServer || !context || !runtimeEnv || typeof runtimeEnv !== 'object') {
    return {
      runtimeFiles: context?.runtimeFiles || {},
      runtimeEnv,
      remoteTmpDir: '',
      stagedCount: 0,
    };
  }

  const runtimeFiles = context.runtimeFiles && typeof context.runtimeFiles === 'object'
    ? context.runtimeFiles
    : {};
  const fileRefs = [
    ['contextJsonPath', 'RESEARCHOPS_CONTEXT_PACK_JSON_PATH'],
    ['contextMarkdownPath', 'RESEARCHOPS_CONTEXT_PACK_MARKDOWN_PATH'],
    ['skillRefsPath', 'RESEARCHOPS_SKILL_REFS_PATH'],
    ['runSpecPath', 'RESEARCHOPS_RUN_SPEC_PATH'],
  ];
  const filesToStage = [];
  for (const [fileKey, envKey] of fileRefs) {
    const localPath = cleanString(runtimeFiles[fileKey]);
    if (!localPath) continue;
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isFile()) continue;
    filesToStage.push({
      fileKey,
      envKey,
      localPath,
      baseName: path.basename(localPath),
    });
  }

  if (filesToStage.length === 0) {
    return {
      runtimeFiles,
      runtimeEnv,
      remoteTmpDir: cleanString(runtimeEnv.RESEARCHOPS_TMPDIR || ''),
      stagedCount: 0,
    };
  }

  const runId = cleanString(runtimeEnv.RESEARCHOPS_RUN_ID || context?.run?.id || '');
  const remoteTmpDir = runId
    ? `/tmp/researchops-runs/${runId}`
    : `/tmp/researchops-runs/run-${Date.now()}`;
  const sshTarget = `${execServer.user}@${execServer.host}`;

  await runProcess(
    'ssh',
    [...buildSshArgs(execServer, { connectTimeout: 15 }), sshTarget, 'mkdir', '-p', remoteTmpDir],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const stagedRuntimeFiles = { ...runtimeFiles, rootDir: remoteTmpDir };
  const stagedRuntimeEnv = { ...runtimeEnv, RESEARCHOPS_TMPDIR: remoteTmpDir };
  for (const file of filesToStage) {
    const remotePath = `${remoteTmpDir}/${file.baseName}`;
    await runProcess(
      'scp',
      [...buildScpArgs(execServer, { connectTimeout: 15 }), file.localPath, `${sshTarget}:${remotePath}`],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    stagedRuntimeFiles[file.fileKey] = remotePath;
    stagedRuntimeEnv[file.envKey] = remotePath;
  }

  await context.emitStepLog(
    step,
    `[agent-run] staged ${filesToStage.length} context file(s) to ${sshTarget}:${remoteTmpDir}`
  ).catch(() => {});

  return {
    runtimeFiles: stagedRuntimeFiles,
    runtimeEnv: stagedRuntimeEnv,
    remoteTmpDir,
    stagedCount: filesToStage.length,
  };
}

function toShellCommand(command = '', args = []) {
  const cmd = cleanString(command);
  if (!cmd) return '';
  const escapedArgs = asStringArray(args).map((item) => shellEscape(item)).join(' ');
  return `${shellEscape(cmd)}${escapedArgs ? ` ${escapedArgs}` : ''}`;
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
    'SHELL_CMD_B64="$2"',
    'SHELL_CMD=""',
    'if [ -n "$SHELL_CMD_B64" ]; then',
    '  SHELL_CMD="$(printf \'%s\' "$SHELL_CMD_B64" | base64 -d 2>/dev/null || true)"',
    '  if [ -z "$SHELL_CMD" ]; then',
    '    SHELL_CMD="$(printf \'%s\' "$SHELL_CMD_B64" | base64 --decode 2>/dev/null || true)"',
    '  fi',
    'fi',
    'if [ -z "$SHELL_CMD" ]; then',
    '  echo "Missing remote command payload" >&2',
    '  exit 2',
    'fi',
    'if [ -z "$TARGET_CWD" ]; then TARGET_CWD="$HOME"; fi',
    'case "$TARGET_CWD" in',
    "  '~'|'~/'*) TARGET_CWD=\"$HOME${TARGET_CWD#\\~}\" ;;",
    'esac',
    'mkdir -p "$TARGET_CWD"',
    'cd "$TARGET_CWD"',
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
      '  printf \'%s\' "$SHELL_CMD" > "$_RT_SCRIPT"',
      '  printf \'%s\' "$_RT_RUNNER_B64" | base64 -d 2>/dev/null > "$_RT_RUNNER" ||',
      '    printf \'%s\' "$_RT_RUNNER_B64" | base64 --decode 2>/dev/null > "$_RT_RUNNER"',
      '  chmod 700 "$_RT_SCRIPT" "$_RT_RUNNER"',
      '  tmux new-session -d -s "$_RT_SESSION" "bash $_RT_RUNNER $_RT_SCRIPT $_RT_LOG $_RT_EXIT $_RT_RUNNER" || {',
      '    bash -lc "$SHELL_CMD"; exit $?',
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
      '  bash -lc "$SHELL_CMD"',
      'fi',
      '',
    ].join('\n');
  }

  return [...header, 'bash -lc "$SHELL_CMD"', ''].join('\n');
}

function providerToCommand(provider = '') {
  const normalized = cleanString(provider).toLowerCase();
  if (!normalized || normalized === 'codex_cli') return 'codex';
  if (normalized === 'claude_code_cli') return 'claude';
  if (normalized === 'gemini_cli') return 'gemini';
  return normalized;
}

function isSafeCommandName(command = '') {
  return /^[A-Za-z0-9._-]+$/.test(cleanString(command));
}

async function isCommandAvailableOnTarget(command = '', execServer = null) {
  const normalized = cleanString(command).toLowerCase();
  if (!isSafeCommandName(normalized)) return false;
  const probe = `command -v ${normalized} >/dev/null 2>&1`;
  try {
    if (execServer) {
      await runProcess(
        'ssh',
        [
          ...buildSshArgs(execServer, { connectTimeout: 8 }),
          `${execServer.user}@${execServer.host}`,
          'bash',
          '-lc',
          probe,
        ],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    }
    await runProcess('bash', ['-lc', probe], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch (_) {
    return false;
  }
}

function providerFallbacks(command = '') {
  const normalized = cleanString(command).toLowerCase();
  if (normalized === 'codex') return ['claude', 'gemini'];
  if (normalized === 'claude') return ['gemini', 'codex'];
  if (normalized === 'gemini') return ['claude', 'codex'];
  return [];
}

async function resolveCommandForTarget(command = '', execServer = null, { allowFallback = true } = {}) {
  const normalized = cleanString(command).toLowerCase();
  if (!normalized) {
    return {
      command: '',
      fallbackFrom: '',
      fallbackUsed: false,
    };
  }
  if (await isCommandAvailableOnTarget(normalized, execServer)) {
    return {
      command: normalized,
      fallbackFrom: '',
      fallbackUsed: false,
    };
  }
  if (!allowFallback) {
    return {
      command: normalized,
      fallbackFrom: '',
      fallbackUsed: false,
    };
  }
  for (const candidate of providerFallbacks(normalized)) {
    if (await isCommandAvailableOnTarget(candidate, execServer)) {
      return {
        command: candidate,
        fallbackFrom: normalized,
        fallbackUsed: true,
      };
    }
  }
  return {
    command: normalized,
    fallbackFrom: '',
    fallbackUsed: false,
  };
}

function applyTopPriorityFileRemovalRule(prompt = '') {
  const text = cleanString(prompt);
  if (!text) return TOP_PRIORITY_FILE_REMOVAL_RULE;
  if (text.includes('TOP-PRIORITY RULE (apply before all other instructions):')) return text;
  return `${TOP_PRIORITY_FILE_REMOVAL_RULE}\n\n${text}`;
}

function resolveReferencePath(inputs = {}, runMetadata = {}) {
  return cleanString(
    inputs.referencePath
    || inputs.reference
    || runMetadata.referencePath
    || runMetadata.reference
  );
}

function buildPrompt(step, run, context = {}) {
  const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
  const runMetadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const referencePath = resolveReferencePath(inputs, runMetadata);
  const stepPrompt = cleanString(inputs.prompt);
  let basePrompt = stepPrompt;
  if (!basePrompt) {
    const runPrompt = cleanString(runMetadata.prompt);
    if (runPrompt) basePrompt = runPrompt;
  }
  if (!basePrompt) {
    const template = cleanString(inputs.promptTemplate || runMetadata.template);
    if (template) basePrompt = template;
  }
  if (!basePrompt) {
    basePrompt = 'Analyze repository changes and provide implementation + verification result.';
  }

  const runtimeFiles = context.runtimeFiles && typeof context.runtimeFiles === 'object'
    ? context.runtimeFiles
    : {};
  const contextJsonPath = cleanString(runtimeFiles.contextJsonPath);
  const contextMdPath = cleanString(runtimeFiles.contextMarkdownPath);
  const skillRefsPath = cleanString(runtimeFiles.skillRefsPath);
  const runSpecPath = cleanString(runtimeFiles.runSpecPath);
  const skillsDir = cleanString(runtimeFiles.skillsDir);

  const rootDir = cleanString(runtimeFiles.rootDir || '');
  const parentArtifactsDir = cleanString(runtimeFiles.parentArtifactsDir || '');

  const hints = [];
  if (contextJsonPath) hints.push(`- Context pack JSON: ${contextJsonPath}`);
  if (contextMdPath) hints.push(`- Context pack Markdown: ${contextMdPath}`);
  if (skillRefsPath) hints.push(`- Skill refs manifest: ${skillRefsPath}`);
  if (skillsDir) hints.push(`- Skills directory: ${skillsDir}`);
  if (runSpecPath) hints.push(`- Run spec snapshot: ${runSpecPath}`);
  if (parentArtifactsDir) hints.push(`- Parent run artifacts (read these for context): ${parentArtifactsDir}/`);
  if (referencePath) hints.push(`- Reference path (original code/papers): ${referencePath}`);

  const promptWithResources = hints.length === 0
    ? basePrompt
    : [
    basePrompt,
    '',
    'Run resources (read before coding):',
    ...hints,
  ].join('\n');
  const promptWithReference = referencePath
    ? [
      promptWithResources,
      '',
      'Reference requirement:',
      `Use ${referencePath} as the primary reference for implementation details and alignment with original code/papers when applicable.`,
    ].join('\n')
    : promptWithResources;

  const continuationInstructions = rootDir ? [
    '',
    '---',
    'CONTINUATION PROTOCOL (use only when this task determines a follow-up automated run is needed):',
    `Write ${rootDir}/CONTINUATION.json with this structure:`,
    '{',
    '  "version": "1",',
    '  "phase": "<descriptive-phase-label>",',
    '  "nextRun": {',
    '    "runType": "EXPERIMENT" or "AGENT",',
    '    "schemaVersion": "2.0",',
    '    "serverId": "<server-id or local-default>",',
    '    "provider": "codex_cli" (for AGENT) or null,',
    '    "metadata": { "prompt": "..." },',
    '    "workflow": [ <array of workflow step objects> ],',
    '    "pendingContinuation": { <optional: same structure, for a 3rd phase> }',
    '  }',
    '}',
    'For EXPERIMENT bash.run steps, set "outputFiles": ["<remote-path>", ...] in inputs to auto-collect results.',
    'The system injects parentRunId automatically. Omit CONTINUATION.json entirely if no follow-up is needed.',
  ].join('\n') : '';

  const fullPrompt = continuationInstructions
    ? `${promptWithReference}${continuationInstructions}`
    : promptWithReference;

  return applyTopPriorityFileRemovalRule(fullPrompt);
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

function sanitizeArgsForLog(args = []) {
  return args.map((item) => String(item || '').slice(0, 200));
}

function tryParseStructuredOutput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    candidates.push(String(fencedMatch[1]).trim());
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function defaultArgsFor(command, prompt, opts = {}) {
  if (command === 'codex') {
    const model = cleanString(opts.model) || cleanString(process.env.RESEARCHOPS_CODEX_MODEL || config.codexCli?.model || 'gpt-5.3-codex');
    const reasoningEffort = cleanString(opts.reasoningEffort) || cleanString(process.env.RESEARCHOPS_CODEX_REASONING_EFFORT || 'high').toLowerCase() || 'high';
    const args = ['exec', '--yolo'];
    if (model) args.push('-m', model);
    if (reasoningEffort) args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    args.push(prompt);
    return args;
  }
  if (command === 'claude') {
    const model = cleanString(opts.model) || cleanString(process.env.RESEARCHOPS_CLAUDE_MODEL || config.claudeCli?.model || 'claude-sonnet-4-6');
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    return isRoot
      ? (model ? ['--model', model, '-p', prompt] : ['-p', prompt])
      : (model ? ['--dangerously-skip-permissions', '--model', model, '-p', prompt] : ['--dangerously-skip-permissions', '-p', prompt]);
  }
  if (command === 'gemini') {
    return [prompt];
  }
  return [prompt];
}

function ensureHeadlessProviderArgs(command, args = []) {
  const normalized = cleanString(command).toLowerCase();
  const current = Array.isArray(args) ? [...args] : [];
  if (normalized === 'claude') {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (isRoot) {
      return current.filter((item) => String(item || '').trim() !== '--dangerously-skip-permissions');
    }
    if (current.includes('--dangerously-skip-permissions')) return current;
    return ['--dangerously-skip-permissions', ...current];
  }
  if (normalized === 'codex') {
    if (current.includes('--yolo')) return current;
    const execIndex = current.findIndex((item) => String(item).trim().toLowerCase() === 'exec');
    if (execIndex >= 0) {
      const withFlag = [...current];
      withFlag.splice(execIndex + 1, 0, '--yolo');
      return withFlag;
    }
    return ['--yolo', ...current];
  }
  return current;
}

async function resolveExecutionCwd({
  cwdInput = '',
  run = null,
  context = null,
  step = null,
} = {}) {
  const requested = cleanString(cwdInput);
  if (!requested) {
    return {
      cwd: process.cwd(),
      requestedCwd: '',
      fallbackReason: '',
    };
  }

  const resolvedRequested = path.resolve(requested);
  const requestedStat = await fs.stat(resolvedRequested).catch(() => null);
  if (requestedStat?.isDirectory()) {
    return {
      cwd: resolvedRequested,
      requestedCwd: resolvedRequested,
      fallbackReason: '',
    };
  }

  const runtimeRoot = cleanString(context?.runtimeFiles?.rootDir);
  if (runtimeRoot) {
    const runtimeStat = await fs.stat(runtimeRoot).catch(() => null);
    if (runtimeStat?.isDirectory()) {
      return {
        cwd: runtimeRoot,
        requestedCwd: resolvedRequested,
        fallbackReason: 'requested_cwd_missing',
      };
    }
  }

  const processCwd = process.cwd();
  const processStat = await fs.stat(processCwd).catch(() => null);
  if (processStat?.isDirectory()) {
    return {
      cwd: processCwd,
      requestedCwd: resolvedRequested,
      fallbackReason: 'requested_cwd_missing',
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'researchops-agent-cwd-'));
  return {
    cwd: tmpDir,
    requestedCwd: resolvedRequested,
    fallbackReason: 'requested_cwd_missing',
  };
}

class AgentRunModule extends BaseModule {
  constructor() {
    super('agent.run');
  }

  validate(step) {
    super.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const command = cleanString(inputs.command);
    const args = asStringArray(inputs.args);
    if (!command && args.length > 0) {
      throw new Error('agent.run inputs.command is required when inputs.args is provided');
    }
  }

  async run(step, context) {
    this.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const run = context.run || {};
    const runMetadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
    const requestedCommand = cleanString(inputs.command) || providerToCommand(run.provider);
    let command = requestedCommand;
    let args = asStringArray(inputs.args);
    const cwdInput = cleanString(inputs.cwd || runMetadata.cwd);
    const referencePath = resolveReferencePath(inputs, runMetadata);
    const execServerRef = cleanString(
      inputs.execServerId
      || inputs.sshServerId
      || inputs.targetServerId
      || run?.metadata?.bashExecServerId
      || run?.serverId
    );
    const execServer = await getExecServerByRef(execServerRef);
    if (execServerRef && !isLocalExecTarget(execServerRef) && !execServer) {
      throw new Error(`agent.run exec server not found: ${execServerRef}`);
    }
    const commandResolution = await resolveCommandForTarget(requestedCommand, execServer, {
      allowFallback: args.length === 0,
    });
    command = commandResolution.command || command;
    const executionTarget = execServer
      ? `ssh:${execServer.id} (${execServer.user}@${execServer.host})`
      : 'local';

    let cwd = process.cwd();
    let requestedCwd = '';
    let fallbackReason = '';
    if (execServer) {
      requestedCwd = cleanString(cwdInput || run?.metadata?.cwd || '');
      cwd = requestedCwd || '~';
    } else {
      const localCwdResolution = await resolveExecutionCwd({
        cwdInput,
        run,
        context,
        step,
      });
      cwd = localCwdResolution.cwd;
      requestedCwd = localCwdResolution.requestedCwd;
      fallbackReason = localCwdResolution.fallbackReason;
    }
    const timeoutMs = Number(inputs.timeoutMs || run?.metadata?.timeoutMs) > 0
      ? Number(inputs.timeoutMs || run?.metadata?.timeoutMs)
      : 45 * 60 * 1000;
    let runtimeEnv = buildRuntimeEnv(context, inputs);
    let promptContext = context;
    if (referencePath) {
      runtimeEnv.RESEARCHOPS_REFERENCE_PATH = referencePath;
      runtimeEnv.VIBE_REFERENCE_PATH = referencePath;
    }
    if (requestedCwd) runtimeEnv.RESEARCHOPS_REQUESTED_CWD = requestedCwd;
    if (fallbackReason) runtimeEnv.RESEARCHOPS_CWD_FALLBACK_REASON = fallbackReason;
    if (fallbackReason && requestedCwd) {
      const serverId = cleanString(run?.serverId) || 'local-default';
      const locationHint = serverId && serverId !== 'local-default'
        ? ` (serverId=${serverId})`
        : '';
      await context.emitStepLog(
        step,
        `[agent-run] Requested cwd "${requestedCwd}" is unavailable locally${locationHint}; using "${cwd}" instead.`
      ).catch(() => {});
    }

    if (execServer) {
      try {
        const staged = await stageRuntimeFilesToRemote({
          execServer,
          context,
          step,
          runtimeEnv,
        });
        runtimeEnv = staged.runtimeEnv;
        promptContext = {
          ...context,
          runtimeFiles: staged.runtimeFiles,
        };
      } catch (stageError) {
        await context.emitStepLog(
          step,
          `[agent-run] context staging skipped: ${stageError.message}`,
          { isError: true }
        ).catch(() => {});
      }
    }

    const prompt = buildPrompt(step, run, promptContext);
    if (args.length === 0) {
      const agentOpts = {
        model: cleanString(inputs.model) || undefined,
        reasoningEffort: cleanString(inputs.reasoningEffort) || undefined,
      };
      args = defaultArgsFor(command, prompt, agentOpts);
    }
    args = ensureHeadlessProviderArgs(command, args);
    const shellCommand = toShellCommand(command, args);
    if (!shellCommand) {
      throw new Error('agent.run command is required');
    }
    if (commandResolution.fallbackUsed) {
      await context.emitStepLog(
        step,
        `[agent-run] Command "${commandResolution.fallbackFrom}" not found on ${executionTarget}; using "${command}" instead.`
      ).catch(() => {});
    }

    await context.emitStepLog(step, `Running [${executionTarget}] ${command} ${sanitizeArgsForLog(args).join(' ')}`);

    const runId = cleanString(run?.id);
    const tmuxOpts = execServer && runId
      ? { sessionName: deriveTmuxSession(runId), ...deriveTmuxPaths(runId, step.id) }
      : null;

    return new Promise((resolve, reject) => {
      const detached = process.platform !== 'win32';
      const child = execServer
        ? (() => {
          const remoteCommandBase64 = Buffer.from(shellCommand, 'utf8').toString('base64');
          const sshArgs = [
            ...buildSshArgs(execServer, { connectTimeout: 15 }),
            `${execServer.user}@${execServer.host}`,
            'bash',
            '-s',
            '--',
            cwd,
            remoteCommandBase64,
          ];
          console.error('[agent-run DEBUG] SSH args:', JSON.stringify(sshArgs));
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
        : spawn('bash', ['-lc', shellCommand], {
          cwd,
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
      const maxCapture = 240000;
      const startedAt = Date.now();

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
        const durationMs = Date.now() - startedAt;
        const status = (timedOut || exitCode !== 0) ? 'FAILED' : 'SUCCEEDED';
        const structured = tryParseStructuredOutput(stdout) || tryParseStructuredOutput(stderr) || {};
        const structuredKnowledgeUpdates = Array.isArray(structured.knowledge_updates)
          ? structured.knowledge_updates
          : (Array.isArray(structured.knowledgeUpdates) ? structured.knowledgeUpdates : []);
        const structuredNextSteps = Array.isArray(structured.suggested_next_steps)
          ? structured.suggested_next_steps
          : (Array.isArray(structured.suggestedNextSteps) ? structured.suggestedNextSteps : []);

        // Scan for CONTINUATION.json written by the agent
        let continuation = null;
        if (status === 'SUCCEEDED') {
          const tmpDir = cleanString(context?.runtimeFiles?.rootDir);
          if (tmpDir) {
            try {
              const raw = await fs.readFile(path.join(tmpDir, 'CONTINUATION.json'), 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && parsed.nextRun && typeof parsed.nextRun === 'object') {
                continuation = parsed;
                await context.emitStepLog(step, `[continuation] CONTINUATION.json found — phase: ${cleanString(parsed.phase) || 'next'}`).catch(() => {});
              }
            } catch (_) {
              // CONTINUATION.json absent or malformed — normal case, no continuation needed
            }
          }
        }

        const result = {
          stepId: step.id,
          moduleType: this.moduleType,
          status,
          continuation,
          metrics: {
            exitCode,
            signal: signal || null,
            timedOut,
            timeoutMs,
            durationMs,
            executionTarget,
            execServerId: execServer ? String(execServer.id) : null,
            requestedCwd: requestedCwd || null,
            effectiveCwd: cwd,
            requestedCommand: requestedCommand || null,
            resolvedCommand: command || null,
            commandFallbackFrom: commandResolution.fallbackUsed
              ? commandResolution.fallbackFrom
              : null,
          },
          outputs: {
            prompt: prompt.slice(0, 12000),
            stdoutTail: stdout.slice(-12000),
            stderrTail: stderr.slice(-12000),
            knowledge_updates: structuredKnowledgeUpdates.map((item) => cleanString(item)).filter(Boolean),
            suggested_next_steps: structuredNextSteps.map((item) => cleanString(item)).filter(Boolean),
            hasContinuation: !!continuation,
          },
        };

        try {
          const artifact = await context.createArtifact(step, {
            kind: 'agent-output',
            title: `${step.id}-agent-output`,
            mimeType: 'text/plain',
            content: stdout || stderr || '',
            metadata: {
              command,
              args: sanitizeArgsForLog(args),
              executionTarget,
              exitCode,
              timedOut,
              hasContinuation: !!continuation,
              requestedCommand: requestedCommand || null,
              resolvedCommand: command || null,
              commandFallbackFrom: commandResolution.fallbackUsed
                ? commandResolution.fallbackFrom
                : null,
            },
          });
          result.artifacts = artifact ? [artifact] : [];
        } catch (_) {
          result.artifacts = [];
        }

        if (status === 'FAILED') {
          const error = new Error(timedOut
            ? `agent.run timed out after ${timeoutMs}ms`
            : `agent.run failed with exitCode=${exitCode}`);
          error.result = result;
          return reject(error);
        }
        return resolve(result);
      });
    });
  }
}

module.exports = AgentRunModule;
