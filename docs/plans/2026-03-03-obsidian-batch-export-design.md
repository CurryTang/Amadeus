# Obsidian Batch Export — Design

## Goal
Allow users to multi-select papers in Library (research mode) and export all of them to their Obsidian vault in one action. Papers without AI notes get queued for generation first; once notes are ready the browser auto-exports them.

## Architecture

Frontend-only async approach — no new backend tables or endpoints. Reuses the existing `processing_queue` / scheduler infrastructure for notes generation.

**Approach selected:** Option A — localStorage batch tracker + frontend polling.

- Papers with notes → export to vault immediately (File System Access API)
- Papers without notes → enqueue via `POST /api/reader/queue/:id` + track in localStorage
- Background poller checks every 20s; when notes complete, writes to vault automatically
- Status visible in AI Settings → Exports tab

## Data Shape (localStorage key: `auto-researcher:obsidian-batch`)

```json
{
  "items": [
    {
      "docId": "abc123",
      "title": "Paper Title",
      "status": "queued | generating | exported | failed",
      "addedAt": 1709000000000
    }
  ]
}
```

Status transitions:
- `queued` — just enqueued via API
- `generating` — poll confirms still in progress
- `exported` — notes fetched + written to vault
- `failed` — generation failed or vault write threw

## Components

### New: `frontend/src/hooks/useObsidianExportBatch.js`
- Reads/writes `auto-researcher:obsidian-batch` from localStorage
- Exposes: `batchItems`, `addToBatch(docIds, documents, queueFn, exportToVault, rounds)`, `retryItem(docId, queueFn)`, `clearCompleted()`
- `setInterval` every 20s when pending items exist:
  - `GET /api/documents/:id` → check `processing_status`
  - `completed` → `GET /api/documents/:id/notes?inline=true` → `exportToVault(title, content)` → mark `exported`
  - `failed` → mark `failed`
  - else → mark/keep `generating`
- Interval auto-clears when no queued/generating items remain

### Modified: `frontend/src/App.jsx`
- Import and call `useObsidianExportBatch`
- Pass `vaultReady`, `exportToVault`, `rounds` down from `useAiNotesSettings`
- Add `→ Obsidian` button in research mode action bar (right side, before Cancel)
  - Disabled when: `!vaultReady || selectedDocIds.size === 0`
  - Tooltip when vault not connected: "Connect vault in AI Settings first"
- Click handler `handleObsidianBatch`:
  1. Split selected into `withNotes` / `withoutNotes` using `doc.hasNotes`
  2. For `withNotes`: fetch notes + `exportToVault` for each, show toast
  3. For `withoutNotes`: call `addToBatch(docIds, documents, ...)`
- Pass `batchItems`, `clearCompleted`, `retryItem` to `LibrarySettingsModal`

### Modified: `frontend/src/components/LibrarySettingsModal.jsx`
- Add "Exports" as 3rd tab
- Renders a list of `batchItems`:
  - Green dot "exported", spinner "generating", red "failed" with ↺ retry button
  - "Clear completed" button removes all `exported` entries
- Shows empty state when no items

### Modified: `frontend/src/index.css`
- `.obs-export-list`, `.obs-export-item`, `.obs-export-status--exported/generating/failed`
- `.obs-export-retry-btn`, `.obs-export-clear-btn`

## UI — Exports Tab Layout

```
┌──────────────────────────────────────────┐
│ AI Notes Settings                    [×] │
├──────────────┬─────────────┬─────────────┤
│ Generation   │ Integrations│   Exports   │
├──────────────────────────────────────────┤
│ Paper Title A          ● exported   [—] │
│ Paper Title B          ◌ generating      │
│ Paper Title C          ✗ failed    [↺]  │
│                                          │
│ [Clear completed]                        │
└──────────────────────────────────────────┘
```

## Error Handling
- If `exportToVault` throws (permission revoked) → mark `failed`; user can re-connect vault then retry
- If queue API call fails → skip that doc, log to console; don't add to batch
- Retry resets status to `queued` and calls `POST /api/reader/queue/:id` again

## Not in scope
- No backend changes
- No server-side persistence of export job state
- No notification when tab is closed and reopened (batch state is visible in Exports tab)
