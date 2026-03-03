#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      out.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
  }
  return out;
}

function usage() {
  console.log([
    'Setup X/Twitter Playwright session storage state',
    '',
    'Usage:',
    '  node scripts/setup-x-session.js [--out /absolute/path/x-session.json]',
    '',
    'Defaults:',
    '  --out uses X_PLAYWRIGHT_STORAGE_STATE_PATH when present,',
    '  otherwise ~/.playwright/x-session.json',
  ].join('\n'));
}

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const defaultPath = process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH
    || path.join(os.homedir(), '.playwright', 'x-session.json');
  const outputPath = path.resolve(args.outputPath || defaultPath);
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (error) {
    console.error('Playwright is not installed. Run: npm install && npx playwright install chromium');
    process.exit(1);
  }

  console.log(`Opening Chromium for X login...`);
  console.log(`Session file target: ${outputPath}`);

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForEnter('After you finish login in the opened browser, press Enter here to save session: ');
    await context.storageState({ path: outputPath });
    console.log(`Saved X Playwright session: ${outputPath}`);
    console.log('');
    console.log('Set this in backend/.env on the same machine:');
    console.log(`X_PLAYWRIGHT_STORAGE_STATE_PATH=${outputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Failed to setup X session: ${error.message || error}`);
  process.exit(1);
});
