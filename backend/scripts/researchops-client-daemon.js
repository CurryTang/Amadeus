#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.researchops-client'), override: true });

const os = require('os');
const { startClientDaemon } = require('../src/services/researchops/client-daemon.service');

async function main() {
  const apiBaseUrl = String(
    process.env.RESEARCHOPS_API_BASE_URL
    || process.env.AUTO_RESEARCHER_API_URL
    || 'http://127.0.0.1:3000/api'
  ).trim();
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bootstrapId = String(process.env.RESEARCHOPS_BOOTSTRAP_ID || '').trim();
  const bootstrapSecret = String(process.env.RESEARCHOPS_BOOTSTRAP_SECRET || '').trim();
  const hostname = String(process.env.RESEARCHOPS_DAEMON_HOSTNAME || os.hostname()).trim();
  const heartbeatMs = Math.max(Number(process.env.RESEARCHOPS_DAEMON_HEARTBEAT_MS) || 30000, 5000);
  const pollMs = Math.max(Number(process.env.RESEARCHOPS_DAEMON_POLL_MS) || 1500, 250);

  if (!adminToken) {
    console.warn('[ResearchOpsDaemon] ADMIN_TOKEN is empty; auth must be disabled on the backend for this to work.');
  }

  const daemon = startClientDaemon({
    apiBaseUrl,
    adminToken,
    bootstrapId,
    bootstrapSecret,
    hostname,
    heartbeatMs,
    pollMs,
    logger: console,
  });
  if (!daemon.enabled) {
    throw new Error('RESEARCHOPS_API_BASE_URL is required to start the client daemon');
  }
  await daemon.promise;
}

main().catch((error) => {
  console.error('[ResearchOpsDaemon] fatal:', error);
  process.exit(1);
});
