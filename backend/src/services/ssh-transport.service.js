const os = require('os');
const { spawn } = require('child_process');
const keypairService = require('./keypair.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value = '') {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function parseProxyJump(proxyJump = '') {
  const value = cleanString(proxyJump);
  if (!value) return null;
  const match = value.match(/^((?:[^@]+)@)?([^:@]+)(?::(\d+))?$/);
  if (!match) return null;
  return {
    userAt: match[1] || '',
    host: match[2] || '',
    port: match[3] || '',
  };
}

function buildProxyCommand(proxyJump = '', proxyKeyPath = '', connectTimeout = 15) {
  const parsed = parseProxyJump(proxyJump);
  if (!parsed) return null;
  const keyPath = expandHome(proxyKeyPath || keypairService.MANAGED_KEY_PATH);
  const parts = [
    'ssh', '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-i', keyPath,
  ];
  if (parsed.port) parts.push('-p', parsed.port);
  parts.push('-W', '%h:%p', `${parsed.userAt}${parsed.host}`);
  return parts.join(' ');
}

function resolveTargetKeyPaths(server = {}) {
  const configuredKeyPath = expandHome(cleanString(server?.ssh_key_path || ''));
  const managedKeyPath = expandHome(keypairService.MANAGED_KEY_PATH);
  const candidates = [];

  if (configuredKeyPath) candidates.push(configuredKeyPath);
  if (managedKeyPath && managedKeyPath !== configuredKeyPath) {
    candidates.push(managedKeyPath);
  }
  if (candidates.length === 0) {
    candidates.push(expandHome(keypairService.MANAGED_KEY_PATH));
  }
  return candidates;
}

function shouldUseProxyJump(server = {}, targetKeyPath = '') {
  const proxyJump = cleanString(server?.proxy_jump);
  if (!proxyJump) return false;
  const configuredKeyPath = expandHome(cleanString(server?.ssh_key_path || ''));
  const effectiveTargetKeyPath = expandHome(cleanString(targetKeyPath || ''));
  return Boolean(configuredKeyPath) && configuredKeyPath === effectiveTargetKeyPath;
}

function buildSshArgs(server, {
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
  targetKeyPath = '',
} = {}) {
  const keyPath = expandHome(targetKeyPath || resolveTargetKeyPaths(server)[0]);
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', `StrictHostKeyChecking=${strictHostKeyChecking}`,
    '-i', keyPath,
    '-p', String(server?.port || 22),
  ];

  const proxyJump = cleanString(server?.proxy_jump);
  if (proxyJump) {
    if (shouldUseProxyJump(server, keyPath)) {
      args.push('-J', proxyJump);
    } else {
      const proxyKeyPath = cleanString(server?.ssh_key_path) || keypairService.MANAGED_KEY_PATH;
      const proxyCommand = buildProxyCommand(proxyJump, proxyKeyPath, connectTimeout);
      if (proxyCommand) args.push('-o', `ProxyCommand=${proxyCommand}`);
      else args.push('-J', proxyJump);
    }
  }

  return args;
}

function buildScpArgs(server, {
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
  targetKeyPath = '',
} = {}) {
  const keyPath = expandHome(targetKeyPath || resolveTargetKeyPaths(server)[0]);
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', `StrictHostKeyChecking=${strictHostKeyChecking}`,
    '-i', keyPath,
    '-P', String(server?.port || 22),
  ];

  const proxyJump = cleanString(server?.proxy_jump);
  if (proxyJump) {
    if (shouldUseProxyJump(server, keyPath)) {
      args.push('-J', proxyJump);
    } else {
      const proxyKeyPath = cleanString(server?.ssh_key_path) || keypairService.MANAGED_KEY_PATH;
      const proxyCommand = buildProxyCommand(proxyJump, proxyKeyPath, connectTimeout);
      if (proxyCommand) args.push('-o', `ProxyCommand=${proxyCommand}`);
      else args.push('-J', proxyJump);
    }
  }

  return args;
}

function getSshTarget(server = {}) {
  return `${server.user}@${server.host}`;
}

function buildShellCommand(command, args = []) {
  return [command, ...args].map((item) => shellEscape(item)).join(' ');
}

function buildSshTransportCommand(server, options = {}) {
  return buildShellCommand('ssh', buildSshArgs(server, options));
}

function buildSshCommandLine(server, remoteArgs = [], options = {}) {
  const remoteCommand = remoteArgs.map((item) => shellEscape(item)).join(' ');
  const sshArgs = [
    ...buildSshArgs(server, options),
    getSshTarget(server),
    ...(remoteCommand ? [remoteCommand] : []),
  ];
  return buildShellCommand('ssh', sshArgs);
}

function buildScpCommandLine(server, scpArgs = [], options = {}) {
  return buildShellCommand('scp', [
    ...buildScpArgs(server, options),
    ...scpArgs,
  ]);
}

function spawnWrapped(command, args = [], options = {}) {
  const spawnImpl = typeof options.spawnImpl === 'function' ? options.spawnImpl : spawn;
  const { spawnImpl: _omit, ...spawnOptions } = options;
  if (String(command || '').trim().toLowerCase() === 'bash') {
    return spawnImpl(command, args, spawnOptions);
  }
  const shellCommand = buildShellCommand(command, args);
  return spawnImpl('bash', ['-lc', shellCommand], spawnOptions);
}

function shouldRetryTransportError(error) {
  const message = String(error?.message || error?.stderr || '').toLowerCase();
  return (
    message.includes('connection closed')
    || message.includes('broken pipe')
    || message.includes('banner exchange')
    || message.includes('kex_exchange_identification')
    || message.includes('connection reset')
  );
}

function runSpawnedCommand(command, args = [], {
  timeoutMs = 30000,
  input = '',
  retries = 1,
  spawnImpl = null,
  ...spawnOptions
} = {}) {
  const attempts = Math.max(1, Number(retries) || 1);

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const runOnce = () => {
      attempt += 1;
      const child = spawnWrapped(command, args, {
        ...spawnOptions,
        spawnImpl,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill?.('SIGTERM');
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        if (attempt < attempts && shouldRetryTransportError(error)) {
          runOnce();
          return;
        }
        reject(error);
      });
      child.stdin?.on?.('error', () => {});
      if (input) child.stdin?.write?.(String(input));
      child.stdin?.end?.();

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          const error = new Error(`SSH command timed out after ${timeoutMs}ms`);
          error.code = 'SSH_TIMEOUT';
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        if (code === 0) {
          resolve({ stdout, stderr, code, signal: signal || null });
          return;
        }
        const error = new Error(String(stderr || '').trim() || `ssh exited with code ${code}`);
        error.code = 'SSH_COMMAND_FAILED';
        error.exitCode = code;
        error.signal = signal || null;
        error.stdout = stdout;
        error.stderr = stderr;
        if (attempt < attempts && shouldRetryTransportError(error)) {
          runOnce();
          return;
        }
        reject(error);
      });
    };

    runOnce();
  });
}

function exec(server, remoteArgs = [], {
  timeoutMs = 30000,
  input = '',
  retries = 3,
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
  targetKeyPath = '',
  spawnImpl = null,
  env = process.env,
  stdio = ['pipe', 'pipe', 'pipe'],
} = {}) {
  return runSpawnedCommand('bash', ['-lc', buildSshCommandLine(server, remoteArgs, {
    connectTimeout,
    strictHostKeyChecking,
    targetKeyPath,
  })], {
    timeoutMs,
    input,
    retries,
    spawnImpl,
    env,
    stdio,
  });
}

function script(server, scriptBody, scriptArgs = [], options = {}) {
  return exec(server, ['bash', '-s', '--', ...scriptArgs.map((item) => String(item ?? ''))], {
    ...options,
    input: String(scriptBody || ''),
  });
}

function copyTo(server, localPath, remotePath, {
  timeoutMs = 30000,
  retries = 3,
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
  targetKeyPath = '',
  spawnImpl = null,
  env = process.env,
  stdio = ['ignore', 'pipe', 'pipe'],
} = {}) {
  return runSpawnedCommand('bash', ['-lc', buildScpCommandLine(server, [
    localPath,
    `${getSshTarget(server)}:${remotePath}`,
  ], {
    connectTimeout,
    strictHostKeyChecking,
    targetKeyPath,
  })], {
    timeoutMs,
    retries,
    spawnImpl,
    env,
    stdio,
  });
}

function copyFrom(server, remotePath, localPath, {
  timeoutMs = 30000,
  retries = 3,
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
  targetKeyPath = '',
  spawnImpl = null,
  env = process.env,
  stdio = ['ignore', 'pipe', 'pipe'],
} = {}) {
  return runSpawnedCommand('bash', ['-lc', buildScpCommandLine(server, [
    `${getSshTarget(server)}:${remotePath}`,
    localPath,
  ], {
    connectTimeout,
    strictHostKeyChecking,
    targetKeyPath,
  })], {
    timeoutMs,
    retries,
    spawnImpl,
    env,
    stdio,
  });
}

function classifyError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('permission denied') || message.includes('publickey')) {
    return {
      code: 'SSH_AUTH_FAILED',
      message: 'SSH authentication failed (managed key is not authorized on target host)',
    };
  }
  if (
    message.includes('connection refused')
    || message.includes('no route to host')
    || message.includes('network is unreachable')
    || message.includes('connection reset')
  ) {
    return {
      code: 'SSH_HOST_UNREACHABLE',
      message: 'SSH target host is unreachable',
    };
  }
  if (message.includes('could not resolve hostname') || message.includes('name or service not known')) {
    return {
      code: 'SSH_HOST_UNREACHABLE',
      message: 'SSH target host is not reachable',
    };
  }
  if (message.includes('connection timed out') || message.includes('ssh command timed out')) {
    return {
      code: 'SSH_TIMEOUT',
      message: 'SSH command timed out',
    };
  }
  return {
    code: 'SSH_COMMAND_FAILED',
    message: String(error?.message || 'SSH command failed'),
  };
}

module.exports = {
  buildProxyCommand,
  buildScpArgs,
  buildScpCommandLine,
  buildShellCommand,
  buildSshArgs,
  buildSshCommandLine,
  buildSshTransportCommand,
  classifyError,
  copyFrom,
  copyTo,
  exec,
  expandHome,
  getSshTarget,
  parseProxyJump,
  resolveTargetKeyPaths,
  runSpawnedCommand,
  script,
  shellEscape,
  spawnWrapped,
};
