'use strict';

const path = require('node:path');
const { buildRustDaemonSupervisorPaths } = require('./rust-daemon-supervisor.service');

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

function buildRustDaemonBackgroundLaunchCommand({ cwd = process.cwd(), env = process.env } = {}) {
  const spec = buildRustDaemonLaunchSpec(env);
  const supervisorPaths = buildRustDaemonSupervisorPaths({ cwd, env });
  const command = [
    `mkdir -p '${supervisorPaths.dataDir.replace(/'/g, `'\"'\"'`)}'`,
    `nohup ${spec.command} ${spec.args.map((arg) => `'${String(arg).replace(/'/g, `'\"'\"'`)}'`).join(' ')} > '${supervisorPaths.logFile.replace(/'/g, `'\"'\"'`)}' 2>&1 &`,
    `echo $! > '${supervisorPaths.pidFile.replace(/'/g, `'\"'\"'`)}'`,
  ].join(' && ');
  return {
    command,
    supervisorPaths,
  };
}

module.exports = {
  buildRustDaemonLaunchSpec,
  buildRustDaemonBackgroundLaunchCommand,
};
