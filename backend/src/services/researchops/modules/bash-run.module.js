const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const BaseModule = require('./base-module');
const { getDb } = require('../../../db');

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

function buildSshArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server?.port || 22),
  ];
  if (cleanString(server?.proxy_jump)) {
    args.push('-J', cleanString(server.proxy_jump));
  }
  return args;
}

function buildScpArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-P', String(server?.port || 22),
  ];
  if (cleanString(server?.proxy_jump)) {
    args.push('-J', cleanString(server.proxy_jump));
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

function buildRemoteScript(envVars = {}) {
  const exports = Object.entries(envVars)
    .filter(([key]) => isValidEnvKey(key))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
  return [
    'TARGET_CWD="$1"',
    'RUN_CMD="$2"',
    'case "$TARGET_CWD" in',
    "  '~'|'~/'*) TARGET_CWD=\"$HOME${TARGET_CWD#\\~}\" ;;",
    'esac',
    'if [ -n "$TARGET_CWD" ]; then',
    '  cd "$TARGET_CWD"',
    'fi',
    ...exports,
    'bash -lc "$RUN_CMD"',
    '',
  ].join('\n');
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

    return new Promise((resolve, reject) => {
      const child = execServer
        ? (() => {
          const remoteCmd = toRemoteShellCommand({ command, args, cmd });
          const sshArgs = [
            ...buildSshArgs(execServer, { connectTimeout: 15 }),
            `${execServer.user}@${execServer.host}`,
            'bash',
            '-s',
            '--',
            effectiveCwd,
            remoteCmd,
          ];
          const proc = spawn('ssh', sshArgs, {
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const remoteScript = buildRemoteScript(runtimeEnv);
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
        });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const maxCapture = 200000;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      context.registerCancelable(() => {
        child.kill('SIGTERM');
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
