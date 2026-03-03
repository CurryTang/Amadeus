const os = require('os');
const { spawn } = require('child_process');
const keypairService = require('./keypair.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const keyPath = expandHome(proxyKeyPath || '~/.ssh/id_rsa');
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

function buildResearchOpsSshArgs(server, {
  connectTimeout = 15,
  strictHostKeyChecking = 'accept-new',
} = {}) {
  const managedKey = keypairService.MANAGED_KEY_PATH;
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', `StrictHostKeyChecking=${strictHostKeyChecking}`,
    '-i', managedKey,
    '-p', String(server?.port || 22),
  ];

  const proxyJump = cleanString(server?.proxy_jump);
  if (proxyJump) {
    const proxyKeyPath = cleanString(server?.ssh_key_path) || '~/.ssh/id_rsa';
    const proxyCommand = buildProxyCommand(proxyJump, proxyKeyPath, connectTimeout);
    if (proxyCommand) {
      args.push('-o', `ProxyCommand=${proxyCommand}`);
    } else {
      args.push('-J', proxyJump);
    }
  }

  return args;
}

function runSshCommand(server, remoteArgs = [], {
  timeoutMs = 30000,
  input = '',
} = {}) {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      ...buildResearchOpsSshArgs(server),
      `${server.user}@${server.host}`,
      ...remoteArgs,
    ];

    const proc = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    proc.stdin.on('error', () => {
      // Ignore EPIPE when remote closes early.
    });

    proc.stdin.end(String(input || ''));

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`SSH command timed out after ${timeoutMs}ms`);
        error.code = 'SSH_TIMEOUT';
        return reject(error);
      }
      if (code === 0) return resolve({ stdout, stderr, code });
      const message = String(stderr || '').trim() || `ssh exited with code ${code}`;
      const error = new Error(message);
      error.code = 'SSH_COMMAND_FAILED';
      error.exitCode = code;
      error.stderr = stderr;
      return reject(error);
    });
  });
}

function classifySshError(error) {
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
  buildResearchOpsSshArgs,
  runSshCommand,
  classifySshError,
};
