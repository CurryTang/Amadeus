# Vibe Research Improvement Design
**Date:** 2026-03-03
**Approach:** B — Parallel split + fix + OpenAPI

---

## Overview

Holistic improvement of the vibe research module covering:
1. Backend route split (monolith → domain modules)
2. Response envelope standardization for agent-friendly API
3. OpenAPI spec for external agent auto-discovery
4. Three critical bug fixes
5. Three UX flow improvements

---

## Section 1 — Backend Route Split

Split `backend/src/routes/researchops.js` (~7600 lines) into domain-organized files:

```
backend/src/routes/researchops/
  index.js        — aggregator, mounts all sub-routers, no logic
  runs.js         — enqueue-v2, CRUD, events, artifacts, cancel/retry, checkpoints, workflow insert
  projects.js     — project CRUD, workspace, git restore, KB locator, files tree/content/search
  knowledge.js    — assets CRUD, groups, upload, link/unlink
  autopilot.js    — autopilot start/status/sessions
  dashboard.js    — dashboard aggregation, ideas CRUD, todos
  admin.js        — diagnostics, queue peek, manual dispatch trigger
```

**Migration:** `app.js` changes `require('./routes/researchops')` → `require('./routes/researchops/index')`. All existing URL paths remain identical — zero frontend impact.

Each file follows the same structure:
1. Imports (express Router, services, middleware)
2. Route definitions
3. `module.exports = router`

---

## Section 2 — Response Envelope + Error Codes

All endpoints migrate to a consistent response shape.

**Success response:**
```json
{
  "ok": true,
  "data": { ... },
  "meta": { "ts": "2026-03-03T12:00:00Z", "v": 2 }
}
```

**Error response:**
```json
{
  "ok": false,
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Run abc123 not found",
    "details": {}
  }
}
```

**Implementation:** A response helper middleware attaches `res.ok(data)` and `res.fail(code, message, httpStatus, details)` to every response object. Routes call these helpers uniformly.

**Named error codes** (agent-matchable without parsing message text):
- `RUN_NOT_FOUND`, `PROJECT_NOT_FOUND`, `ASSET_NOT_FOUND`
- `QUEUE_FULL`, `RUN_NOT_QUEUED`, `RUN_ALREADY_RUNNING`
- `CHECKPOINT_REQUIRED`, `CHECKPOINT_EXPIRED`
- `SSH_UNREACHABLE`, `SSH_AUTH_FAILED`
- `ARTIFACT_NOT_FOUND`, `ARTIFACT_EXPIRED`
- `VALIDATION_ERROR`, `UNAUTHORIZED`, `INTERNAL_ERROR`

---

## Section 3 — OpenAPI Spec

A hand-authored `backend/openapi.yaml` covering all researchops endpoints.

**Exposure:** `GET /api/openapi.json` (served dynamically from the YAML at startup).

**Spec contents:**
- All path/query/body parameters with types and required flags
- Response schemas matching the envelope pattern per endpoint
- Error catalog with all named codes
- Tags: `runs`, `projects`, `knowledge`, `autopilot`, `dashboard`
- One worked example per major endpoint (at minimum: `enqueue-v2`, `projects list`, `knowledge asset create`)
- `info.description` includes agent usage instructions (how to authenticate, rate limits, base URL pattern)

**Agent use:** Any Claude agent can `GET /api/openapi.json`, parse it, and derive tool definitions for all endpoints without reading source code.

---

## Section 4 — Bug Fixes

### BUG-2: SSH project execution (ENOENT)

**Root cause:** Orchestrator spawns `agent.run` locally using the SSH project's remote working directory path, which doesn't exist on the local machine.

**Fix:** In `orchestrator.js`, detect when `serverId !== 'local-default'` before spawning. Route execution through the SSH executor, passing the remote working directory as the execution context. The local path resolution must be bypassed entirely for remote projects.

**Files:** `backend/src/services/researchops/orchestrator.js`

---

### BUG-3: Queue stalling (runs stay QUEUED forever)

**Root cause:** The dispatch loop doesn't auto-start when a run is enqueued while the worker is idle, and doesn't recover after server restart.

**Fix:**
1. Call `triggerDispatch()` inside `enqueue-v2` after the run is written to the queue
2. Call `triggerDispatch()` on server startup (after store init) to pick up any orphaned QUEUED runs
3. Add a 60-second watchdog timer that checks for QUEUED runs and triggers dispatch if the worker slot is free

**Files:** `backend/src/routes/researchops/runs.js`, `backend/src/services/researchops/orchestrator.js`

---

### BUG-4: S3 artifact access (AccessDenied)

**Root cause:** Artifacts are stored as private S3 objects. The frontend links directly to S3 URLs, which return 403.

**Fix:** The `GET /runs/:runId/artifacts/:id/download` endpoint generates a **presigned S3 URL** (5-minute TTL) server-side and either:
- Returns `{ ok: true, data: { url: "https://s3.../..." } }` for the frontend to redirect
- Or responds with `302 Location: <presigned-url>` for direct browser redirect

The frontend's "Open" button calls this endpoint instead of linking to S3 directly.

**Files:** `backend/src/routes/researchops/runs.js`, S3 client utility

---

## Section 5 — UX Improvements

### 5.1 Live log tail

**What:** `VibeNodeWorkbench`'s "commands" tab subscribes to the existing SSE stream (`GET /runs/:runId/events`) when the node is in RUNNING state. Log lines render in real-time — no polling delay.

**Implementation:** Subscribe on node status change to RUNNING, unsubscribe on PASSED/FAILED/SKIPPED. Append `event.logLine` entries to a scrolling pre-formatted log view. Auto-scroll to bottom unless user has scrolled up.

**Files:** `frontend/src/components/vibe/VibeNodeWorkbench.jsx`

---

### 5.2 Quick bash runner

**What:** A lightweight panel accessible from `VibePlanEditor`'s toolbar. Lets the researcher fire a one-off bash command against the current project's server without creating a full run in the tree.

**Implementation:**
- Toolbar button "Quick Bash" opens a minimal modal: command input + server selector
- Submits via `enqueue-v2` with a single `bash.run` step workflow
- Modal shows inline live log tail while running (reuses SSE stream)
- Auto-dismisses on success; shows error inline on failure
- Run is created with `runType: "QUICK_BASH"` and excluded from the main tree/history by default (optionally shown via filter)

**Files:** `frontend/src/components/vibe/VibePlanEditor.jsx`, new `QuickBashModal.jsx`

---

### 5.3 Re-run + result snippets in history

**What:** `VibeRunHistory` improvements:

**Re-run button:** Each run row gets a "Re-run" button (icon only to save space). Clicking it fetches the original `runSpec` from `GET /runs/:runId` and re-enqueues via `POST /runs/enqueue-v2`. Clones all inputs including workflow, context refs, and skill refs.

**Result snippets:** Each row shows a 1-line result snippet below the run title — either the last agent output line, the error summary, or "completed successfully" — so you can scan history without opening each run.

**Implementation:**
- Backend: `GET /runs` response includes `resultSnippet: string | null` field (last meaningful log line or error code from the run's stored events)
- Frontend: render snippet in muted text below run title in `VibeRunHistory.jsx`

**Files:** `frontend/src/components/vibe/VibeRunHistory.jsx`, `backend/src/routes/researchops/runs.js`

---

## Implementation Order

1. Response helper middleware (prerequisite for everything else)
2. Route split (creates the module files, migrates handlers one domain at a time)
3. Bug fix BUG-3 (queue stalling) — highest impact, done during runs.js migration
4. Bug fix BUG-4 (S3 presigned URLs) — done during runs.js migration
5. Bug fix BUG-2 (SSH execution) — done during orchestrator review
6. OpenAPI spec (written after routes are split and stable)
7. UX: Live log tail
8. UX: Result snippets in history
9. UX: Quick bash runner

---

## Out of Scope

- Frontend route/URL changes
- Database schema changes
- Authentication system changes
- New run types beyond QUICK_BASH
- MCP server layer (deferred to future sprint)
