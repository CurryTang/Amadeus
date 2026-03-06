const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const keypairService = require('../keypair.service');
const {
  buildResearchOpsSshArgs,
  resolveResearchOpsTargetKeyPaths,
} = require('../ssh-auth.service');

test('prefers the server ssh_key_path before the managed key', () => {
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const keyPaths = resolveResearchOpsTargetKeyPaths(server);

  assert.deepEqual(keyPaths, [
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    keypairService.MANAGED_KEY_PATH,
  ]);

  const sshArgs = buildResearchOpsSshArgs(server);
  const identityIndex = sshArgs.indexOf('-i');

  assert.equal(identityIndex >= 0, true);
  assert.equal(sshArgs[identityIndex + 1], path.join(os.homedir(), '.ssh', 'id_rsa'));
});

test('falls back to the managed key when no ssh_key_path is configured', () => {
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '',
    proxy_jump: '',
  };

  const keyPaths = resolveResearchOpsTargetKeyPaths(server);

  assert.deepEqual(keyPaths, [keypairService.MANAGED_KEY_PATH]);
});

test('uses ProxyJump when the configured key can authenticate both hop and target', () => {
  const server = {
    host: 'compute.example.edu',
    user: 'testuser',
    port: 22,
    ssh_key_path: '~/.ssh/id_rsa',
    proxy_jump: 'testuser@bastion.example.edu',
  };

  const sshArgs = buildResearchOpsSshArgs(server);

  assert.equal(sshArgs.includes('-J'), true);
  assert.equal(sshArgs.includes('testuser@bastion.example.edu'), true);
  assert.equal(sshArgs.some((item) => String(item).startsWith('ProxyCommand=')), false);
});
