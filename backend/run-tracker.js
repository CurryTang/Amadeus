#!/usr/bin/env node
/**
 * Standalone Paper Tracker Runner
 *
 * Runs the paper tracker scheduler locally without starting the HTTP server.
 * Connects to the same Turso DB and S3 as the DO server — papers imported here
 * are immediately visible on the production frontend.
 *
 * Usage:
 *   node run-tracker.js              # run once immediately, then on schedule
 *   node run-tracker.js --once       # run once and exit
 *
 * Set X_PLAYWRIGHT_STORAGE_STATE_PATH in .env to enable Twitter/Playwright tracking.
 */

require('dotenv').config();

const { initDatabase } = require('./src/db');
const paperTrackerService = require('./src/services/paper-tracker.service');

const RUN_ONCE = process.argv.includes('--once');
const INTERVAL_MS = parseInt(process.env.TRACKER_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);

async function main() {
  console.log('[LocalTracker] Connecting to database...');
  await initDatabase();
  console.log('[LocalTracker] Connected to Turso DB');

  if (RUN_ONCE) {
    console.log('[LocalTracker] Running all sources once...\n');
    const results = await paperTrackerService.runAll();
    if (results) {
      const total = results.reduce((s, r) => s + (r.imported || 0), 0);
      console.log(`\n[LocalTracker] Done — imported ${total} new paper(s)`);
      for (const r of results) {
        console.log(`  ${r.source}: +${r.imported || 0} imported, ${r.skipped || 0} skipped, ${r.failed || 0} failed`);
      }
    }
    process.exit(0);
  } else {
    console.log(`[LocalTracker] Starting scheduler (every ${INTERVAL_MS / 3600000}h)`);
    if (process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH) {
      console.log(`[LocalTracker] Playwright session: ${process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH}`);
    } else {
      console.log('[LocalTracker] Warning: X_PLAYWRIGHT_STORAGE_STATE_PATH not set — Twitter tracker will run without auth');
    }
    paperTrackerService.start(INTERVAL_MS);
  }
}

process.on('SIGINT', () => {
  console.log('\n[LocalTracker] Shutting down...');
  paperTrackerService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  paperTrackerService.stop();
  process.exit(0);
});

main().catch((e) => {
  console.error('[LocalTracker] Fatal error:', e.message);
  process.exit(1);
});
