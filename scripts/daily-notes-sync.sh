#!/usr/bin/env bash
# daily-notes-sync.sh — Automated daily paper notes → Obsidian vault sync
#
# This script runs locally on the Mac via launchd/cron. It:
# 1. Triggers daily paper selection on the backend (if not already done)
# 2. Fetches all documents with completed notes that haven't been exported
# 3. Downloads the note content and writes .md files to the Obsidian vault
# 4. Marks them as exported on the backend
#
# Usage:
#   ./scripts/daily-notes-sync.sh
#
# Environment (set in launchd plist or export before running):
#   API_URL          — backend API base URL (default: https://auto-reader.duckdns.org/api)
#   ADMIN_TOKEN      — Bearer token for API auth
#   OBSIDIAN_VAULT   — path to Obsidian vault papers folder

set -euo pipefail

API_URL="${API_URL:-https://auto-reader.duckdns.org/api}"
ADMIN_TOKEN="${ADMIN_TOKEN:-ed9f158b1d2f7d722a69909420701f6ef647b5336503696c34e8243e6ca4086f}"
OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/Users/czk/Documents/dl/deeplearning/notes/papers}"

AUTH="Authorization: Bearer ${ADMIN_TOKEN}"
LOG_PREFIX="[daily-notes-sync]"

log() { echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Ensure vault directory exists
if [ ! -d "$OBSIDIAN_VAULT" ]; then
  log "ERROR: Obsidian vault not found at $OBSIDIAN_VAULT"
  exit 1
fi

# Step 1: Trigger daily paper selection (idempotent — skips if already selected today)
log "Triggering daily paper selection..."
select_resp=$(curl -sf -X POST "${API_URL}/daily-papers/select" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1) || {
  log "WARN: Daily paper selection failed (may already exist or no unread papers): ${select_resp}"
}

# Step 2: Fetch obsidian-pending documents
log "Fetching documents pending Obsidian export..."
pending_json=$(curl -sf "${API_URL}/documents/obsidian-pending" \
  -H "$AUTH" 2>&1) || {
  log "ERROR: Failed to fetch obsidian-pending documents"
  exit 1
}

# Parse document IDs and titles using node (available on Mac)
doc_count=$(echo "$pending_json" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const docs = data.documents || [];
  console.log(docs.length);
")

if [ "$doc_count" = "0" ]; then
  log "No documents pending export. Done."
  exit 0
fi

log "Found ${doc_count} documents to export."

# Step 3: For each document, fetch notes and write to vault
echo "$pending_json" | node -e "
  const fs = require('fs');
  const path = require('path');
  const https = require('https');
  const http = require('http');

  const data = JSON.parse(fs.readFileSync('/dev/stdin','utf8'));
  const docs = data.documents || [];
  const vault = process.env.OBSIDIAN_VAULT || '/Users/czk/Documents/dl/deeplearning/notes/papers';
  const apiUrl = process.env.API_URL || 'https://auto-reader.duckdns.org/api';
  const token = process.env.ADMIN_TOKEN || '';

  async function fetchJson(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers: { 'Authorization': 'Bearer ' + token } }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error('Invalid JSON: ' + body.slice(0,200))); }
        });
      });
      req.on('error', reject);
    });
  }

  async function postJson(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const parsed = new URL(url);
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.end('{}');
    });
  }

  function sanitizeTitle(title) {
    return title
      .replace(/[\\\\/:*?\"<>|]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  (async () => {
    let exported = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        // Fetch notes content
        const notesData = await fetchJson(apiUrl + '/documents/' + doc.id + '/notes?inline=true');
        const content = notesData.notesContent || notesData.content || notesData.notes || '';
        if (!content.trim()) {
          console.error('[daily-notes-sync] No content for doc ' + doc.id + ' (' + doc.title + ')');
          failed++;
          continue;
        }

        // Write to vault
        const safeName = sanitizeTitle(doc.title);
        const filePath = path.join(vault, safeName + '.md');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('[daily-notes-sync] Exported: ' + safeName + '.md');

        // Mark as exported
        await postJson(apiUrl + '/documents/' + doc.id + '/obsidian-exported');
        exported++;
      } catch (err) {
        console.error('[daily-notes-sync] Failed doc ' + doc.id + ': ' + err.message);
        failed++;
      }
    }

    console.log('[daily-notes-sync] Done. Exported: ' + exported + ', Failed: ' + failed);
  })();
" || {
  log "ERROR: Export script failed"
  exit 1
}

log "Sync complete."
