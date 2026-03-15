const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const os = require('os');
const path = require('path');

const transport = require('../ssh-transport.service');

function createFakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    written: '',
    on() {},
    write(chunk) {
      this.written += String(chunk ?? '');
    },
    end(chunk = '') {
      this.written += String(chunk ?? '');
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
      });
    },
  };
  child.kill = () => {};
  return child;
}

test('buildSshArgs prefers configured key path and uses ProxyJump when possible', () => {
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const args = transport.buildSshArgs(server);
  const identityIndex = args.indexOf('-i');

  assert.equal(args.includes('-J'), true);
  assert.equal(args.includes('testuser@bastion.example.edu'), true);
  assert.equal(args[identityIndex + 1], path.join(os.homedir(), '.ssh', 'id_rsa'));
});

test('buildSshCommandLine shell-wraps the ssh invocation and target command', () => {
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const commandLine = transport.buildSshCommandLine(server, ['bash', '-lc', 'echo ok']);

  assert.match(commandLine, /^'ssh' /);
  assert.match(commandLine, /'testuser@compute\.example\.edu'/);
  assert.match(commandLine, /echo ok/);
});

test('script sends stdin through the wrapped ssh command', async () => {
  const calls = [];
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const result = await transport.script(server, 'echo hello\n', ['/tmp/demo'], {
    timeoutMs: 1000,
    spawnImpl(command, args) {
      calls.push({ command, args });
      return createFakeChild({ stdout: 'ok\n' });
    },
  });

  assert.equal(result.stdout, 'ok\n');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'bash');
  assert.deepEqual(calls[0].args.slice(0, 2), ['-lc', transport.buildSshCommandLine(server, ['bash', '-s', '--', '/tmp/demo'])]);
});

test('copyTo shells out through scp with shared transport args', async () => {
  const calls = [];
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  await transport.copyTo(server, '/tmp/local.txt', '/remote/file.txt', {
    timeoutMs: 1000,
    spawnImpl(command, args) {
      calls.push({ command, args });
      return createFakeChild();
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'bash');
  assert.match(calls[0].args[1], /^'scp' /);
  assert.match(calls[0].args[1], /'\/tmp\/local\.txt'/);
  assert.match(calls[0].args[1], /'testuser@compute\.example\.edu:\/remote\/file\.txt'/);
});

test('script retries transient connection-close failures by default', async () => {
  let attempts = 0;
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const result = await transport.script(server, 'echo retry-ok\n', [], {
    timeoutMs: 1000,
    spawnImpl() {
      attempts += 1;
      if (attempts < 2) {
        return createFakeChild({
          code: 255,
          stderr: 'Connection closed by UNKNOWN port 65535\n',
        });
      }
      return createFakeChild({ stdout: 'retry-ok\n' });
    },
  });

  assert.equal(result.stdout, 'retry-ok\n');
  assert.equal(attempts, 2);
});
