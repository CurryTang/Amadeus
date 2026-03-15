#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DEFAULT_API_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      out.outputPath = argv[i + 1];
      i += 1;
    } else if (arg === '--no-upload') {
      out.noUpload = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  console.log([
    'Setup X/Twitter Playwright session — login locally, auto-upload to server',
    '',
    'Usage:',
    '  npm run setup:x-session              # login + upload to server',
    '  npm run setup:x-session -- --no-upload  # save locally only',
    '',
    'Env vars (from backend/.env):',
    '  ADMIN_TOKEN         — auth token for the API (required for upload)',
    `  API_BASE_URL        — server URL (default: ${DEFAULT_API_URL})`,
  ].join('\n'));
}

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, () => { rl.close(); resolve(); });
  });
}

async function uploadSession(sessionJson, apiUrl, token) {
  // Use built-in fetch (Node 18+)
  const res = await fetch(`${apiUrl}/tracker/twitter/playwright/session-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionJson }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }

  const localPath = path.resolve(
    args.outputPath
    || process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH
    || path.join(os.homedir(), '.playwright', 'x-session.json'),
  );
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (_) {
    console.error('Playwright not installed. Run: npm install && npx playwright install chromium');
    process.exit(1);
  }

  // 1. Open browser for login
  console.log('Opening Chromium — log into X/Twitter in the browser window...');
  const browser = await chromium.launch({ headless: false });
  let sessionJson;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForEnter('\nPress Enter after you finish logging in: ');
    sessionJson = await context.storageState();
    // Save local copy
    fs.writeFileSync(localPath, JSON.stringify(sessionJson, null, 2));
    console.log(`\nSaved locally: ${localPath}`);
  } finally {
    await browser.close();
  }

  // 2. Auto-upload to server
  if (args.noUpload) {
    console.log('\nSkipped upload (--no-upload). To upload later, use the UI or re-run without --no-upload.');
    return;
  }

  const apiUrl = process.env.API_BASE_URL || DEFAULT_API_URL;
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    console.log('\nNo ADMIN_TOKEN in .env — skipping upload. Set it and re-run, or upload via the UI.');
    return;
  }

  console.log(`\nUploading to ${apiUrl} ...`);
  try {
    const result = await uploadSession(sessionJson, apiUrl, token);
    console.log(`Uploaded! Server path: ${result.path}`);
    console.log('\nDone — trackers are ready to use.');
  } catch (err) {
    console.error(`Upload failed: ${err.message}`);
    console.log('You can upload manually via the Paper Tracker UI.');
  }
}

main().catch((error) => {
  console.error(`Failed: ${error.message || error}`);
  process.exit(1);
});
