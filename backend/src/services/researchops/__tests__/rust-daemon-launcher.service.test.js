'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRustDaemonLaunchSpec,
  buildRustDaemonBackgroundLaunchCommand,
} = require('../rust-daemon-launcher.service');

test('buildRustDaemonLaunchSpec builds http serve args by default', () => {
  const spec = buildRustDaemonLaunchSpec({
    RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
  });

  assert.equal(spec.command, 'cargo');
  assert.deepEqual(spec.args.slice(-2), ['--serve', '127.0.0.1:7788']);
  assert.equal(spec.env.RESEARCHOPS_API_BASE_URL, 'https://example.com/api');
  assert.equal(spec.transport, 'http');
});

test('buildRustDaemonLaunchSpec builds unix serve args when transport is unix', () => {
  const spec = buildRustDaemonLaunchSpec({
    RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    RESEARCHOPS_RUST_DAEMON_TRANSPORT: 'unix',
    RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET: '/tmp/rust-daemon.sock',
  });

  assert.equal(spec.transport, 'unix');
  assert.deepEqual(spec.args.slice(-2), ['--serve-unix', '/tmp/rust-daemon.sock']);
});

test('buildRustDaemonLaunchSpec rejects missing api base url', () => {
  assert.throws(
    () => buildRustDaemonLaunchSpec({}),
    /RESEARCHOPS_API_BASE_URL is required/i,
  );
});

test('buildRustDaemonBackgroundLaunchCommand exposes nohup command and supervisor paths', () => {
  const result = buildRustDaemonBackgroundLaunchCommand({
    cwd: '/tmp/auto-researcher',
    env: {
      RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    },
  });

  assert.match(result.command, /nohup cargo .*--manifest-path/);
  assert.match(result.command, /rust-daemon\.pid/);
  assert.match(result.command, /rust-daemon\.log/);
  assert.match(result.supervisorPaths.pidFile, /rust-daemon\.pid$/);
});
