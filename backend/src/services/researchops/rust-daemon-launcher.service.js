'use strict';

const path = require('node:path');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRustDaemonLaunchSpec(env = process.env) {
  const apiBaseUrl = cleanString(env?.RESEARCHOPS_API_BASE_URL || env?.AUTO_RESEARCHER_API_URL);
  if (!apiBaseUrl) {
    throw new Error('RESEARCHOPS_API_BASE_URL is required');
  }
  const transport = cleanString(env?.RESEARCHOPS_RUST_DAEMON_TRANSPORT).toLowerCase() === 'unix'
    ? 'unix'
    : 'http';
  const args = [
    'run',
    '--manifest-path',
    path.join('rust', 'researchops-local-daemon', 'Cargo.toml'),
    '--quiet',
    '--',
  ];
  if (transport === 'unix') {
    args.push(
      '--serve-unix',
      cleanString(env?.RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET) || '/tmp/researchops-local-daemon.sock',
    );
  } else {
    args.push(
      '--serve',
      cleanString(env?.RESEARCHOPS_RUST_DAEMON_HTTP_ADDR) || '127.0.0.1:7788',
    );
  }
  return {
    command: 'cargo',
    args,
    transport,
    env: {
      ...env,
      PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
      RESEARCHOPS_API_BASE_URL: apiBaseUrl,
      RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS: cleanString(env?.RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS) || 'true',
    },
  };
}

module.exports = {
  buildRustDaemonLaunchSpec,
};
