#!/usr/bin/env node
/**
 * Obsidian Sync Daemon
 *
 * Polls the auto-researcher API for papers with completed notes that haven't
 * been exported to Obsidian yet, downloads the notes, and writes them as .md
 * files to the configured Obsidian vault folder.
 *
 * Usage:
 *   node tools/obsidian-sync/index.js
 *
 * Environment variables (or .env file):
 *   API_URL        — Backend API URL (default: https://auto-reader.duckdns.org/api)
 *   AUTH_TOKEN      — Admin auth token
 *   VAULT_PATH      — Absolute path to Obsidian vault root
 *   SUBFOLDER       — Subfolder inside vault for papers (default: Papers)
 *   POLL_INTERVAL   — Seconds between polls (default: 60)
 */

const fs = require('fs');
const path = require('path');

// Load .env from the daemon directory
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_URL = process.env.API_URL || 'https://auto-reader.duckdns.org/api';
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const VAULT_PATH = process.env.VAULT_PATH || '/Users/czk/Documents/dl/deeplearning/notes';
const SUBFOLDER = process.env.SUBFOLDER || 'Papers';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60', 10) * 1000;

if (!AUTH_TOKEN) {
  console.error('[obsidian-sync] AUTH_TOKEN is required. Set it in .env or environment.');
  process.exit(1);
}

const outputDir = path.join(VAULT_PATH, SUBFOLDER);

function sanitizeFilename(title) {
  return title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function fetchJson(urlPath) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function postJson(urlPath, body = {}) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function poll() {
  try {
    const data = await fetchJson('/documents/obsidian-pending');
    const docs = data.documents || [];
    if (docs.length === 0) return;

    console.log(`[obsidian-sync] ${docs.length} paper(s) pending export`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`[obsidian-sync] Created vault subfolder: ${outputDir}`);
    }

    for (const doc of docs) {
      try {
        // Fetch notes content
        const notesData = await fetchJson(`/documents/${doc.id}/notes?inline=true`);
        const content = notesData.notesContent || notesData.content || '';
        if (!content.trim()) {
          console.warn(`[obsidian-sync] Doc ${doc.id} has empty notes, skipping`);
          continue;
        }

        // Write to vault
        const fileName = `${sanitizeFilename(doc.title)}.md`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[obsidian-sync] Exported: ${fileName} (${content.length} chars)`);

        // Mark as exported
        await postJson(`/documents/${doc.id}/obsidian-exported`);
      } catch (err) {
        console.error(`[obsidian-sync] Failed to export doc ${doc.id} (${doc.title}):`, err.message);
      }
    }
  } catch (err) {
    console.error('[obsidian-sync] Poll error:', err.message);
  }
}

async function main() {
  console.log('[obsidian-sync] Starting Obsidian sync daemon');
  console.log(`  API:      ${API_URL}`);
  console.log(`  Vault:    ${VAULT_PATH}`);
  console.log(`  Folder:   ${SUBFOLDER}/`);
  console.log(`  Interval: ${POLL_INTERVAL / 1000}s`);
  console.log('');

  // Initial poll
  await poll();

  // Schedule periodic polls
  setInterval(poll, POLL_INTERVAL);
}

main().catch((err) => {
  console.error('[obsidian-sync] Fatal error:', err);
  process.exit(1);
});
