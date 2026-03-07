#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.researchops-rust-daemon'), override: true });

const { spawn } = require('node:child_process');
const { buildRustDaemonLaunchSpec } = require('../src/services/researchops/rust-daemon-launcher.service');

function main() {
  const spec = buildRustDaemonLaunchSpec(process.env);
  const child = spawn(spec.command, spec.args, {
    cwd: path.join(__dirname, '..'),
    env: spec.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

try {
  main();
} catch (error) {
  console.error('[ResearchOpsRustDaemon] fatal:', error);
  process.exit(1);
}
