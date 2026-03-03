# Vibe Research Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 7600-line researchops monolith into domain route modules, add a consistent response envelope + named error codes, fix three critical bugs (SSH cwd, queue stalling, S3 artifacts), publish an OpenAPI spec, and ship three UX improvements (live log tail, run result snippets + re-run, quick bash runner).

**Architecture:** Domain route files under `backend/src/routes/researchops/`; a shared utility module for helpers; a response middleware attaching `res.ok()` and `res.fail()`; OpenAPI YAML served at `/api/openapi.json`. Frontend changes are isolated to three components.

**Tech Stack:** Node.js 20 + Express 4, libSQL/Turso, AWS S3 (already configured), React 18 + Next.js 14, `js-yaml` (already in frontend), `js-yaml` (already in backend via existing use).

---

## Pre-flight check

Before starting, run:
```bash
cd /Users/czk/auto-researcher/backend
node -e "require('./src/routes/researchops')" && echo "OK"
```
Expected: `OK` (router loads without errors). If it fails, fix before proceeding.

---

## Task 1: Response helper middleware

**Files:**
- Create: `backend/src/middleware/res-helpers.js`
- Modify: `backend/src/routes/researchops.js` (add `router.use(resHelpers)` at top of router — AFTER the file exists)

**Step 1: Create the middleware file**

```javascript
// backend/src/middleware/res-helpers.js
'use strict';

/**
 * Attaches res.ok(data) and res.fail(code, message, status, details) helpers.
 * Also exports HTTP error code → status mappings for routes to use.
 */

const ERROR_STATUS = {
  RUN_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  QUEUE_FULL: 429,
  RUN_NOT_QUEUED: 409,
  RUN_ALREADY_RUNNING: 409,
  CHECKPOINT_REQUIRED: 409,
  CHECKPOINT_EXPIRED: 410,
  SSH_UNREACHABLE: 503,
  SSH_AUTH_FAILED: 401,
  ARTIFACT_NOT_FOUND: 404,
  ARTIFACT_EXPIRED: 410,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INTERNAL_ERROR: 500,
};

function resHelpers(req, res, next) {
  res.ok = function ok(data, meta = {}) {
    return this.json({
      ok: true,
      data: data ?? null,
      meta: { ts: new Date().toISOString(), v: 2, ...meta },
    });
  };

  res.fail = function fail(code, message, httpStatus, details = {}) {
    const status = httpStatus ?? ERROR_STATUS[code] ?? 400;
    return this.status(status).json({
      ok: false,
      error: { code, message: message || code, details },
    });
  };

  next();
}

module.exports = resHelpers;
module.exports.ERROR_STATUS = ERROR_STATUS;
```

**Step 2: Verify it loads**
```bash
node -e "require('./src/middleware/res-helpers'); console.log('OK')"
```
Expected: `OK`

**Step 3: Add to researchops router (just before `router.use(requireAuth)`)**

In `backend/src/routes/researchops.js`, find line ~3098:
```javascript
router.use(requireAuth);
```
Add before it:
```javascript
const resHelpers = require('../middleware/res-helpers');
router.use(resHelpers);
```

**Step 4: Verify router still loads**
```bash
node -e "require('./src/routes/researchops'); console.log('OK')"
```
Expected: `OK`

**Step 5: Commit**
```bash
git add backend/src/middleware/res-helpers.js backend/src/routes/researchops.js
git commit -m "feat(api): add res.ok/res.fail response helper middleware"
```

---

## Task 2: Create shared route utilities module

**Files:**
- Create: `backend/src/routes/researchops/shared.js`

This avoids duplicating ~200 lines of helpers across every domain file.

**Step 1: Create the shared utilities file**

```javascript
// backend/src/routes/researchops/shared.js
'use strict';

const os = require('os');

function parseLimit(raw, fallback = 50, max = 300) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function parseOffset(raw, fallback = 0, max = 100000) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 0), max);
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getUserId(req) {
  return req.userId || 'czk';
}

function sanitizeError(error, fallback) {
  return error?.message || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function buildArtifactDownloadPath(runId = '', artifactId = '') {
  const rid = encodeURIComponent(String(runId || '').trim());
  const aid = encodeURIComponent(String(artifactId || '').trim());
  if (!rid || !aid) return null;
  return `/api/researchops/runs/${rid}/artifacts/${aid}/download`;
}

function withArtifactDownloadUrl(artifact = null, runId = '') {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const downloadPath = buildArtifactDownloadPath(runId, artifact.id);
  if (!downloadPath) return artifact;
  return {
    ...artifact,
    objectUrl: artifact.objectKey ? downloadPath : (artifact.objectUrl || downloadPath),
  };
}

module.exports = {
  parseLimit,
  parseOffset,
  parseBoolean,
  cleanString,
  getUserId,
  sanitizeError,
  parseMaybeJson,
  expandHome,
  buildArtifactDownloadPath,
  withArtifactDownloadUrl,
};
```

**Step 2: Verify it loads**
```bash
node -e "require('./src/routes/researchops/shared'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**
```bash
git add backend/src/routes/researchops/shared.js
git commit -m "feat(api): add shared utilities module for researchops routes"
```

---

## Task 3: Create researchops route index (the aggregator)

**Files:**
- Create: `backend/src/routes/researchops/index.js`
- Modify: `backend/src/routes/index.js` (change require path)

**Step 1: Create the index file (minimal — just health for now)**

```javascript
// backend/src/routes/researchops/index.js
'use strict';

const express = require('express');
const router = express.Router();
const resHelpers = require('../../middleware/res-helpers');
const { requireAuth } = require('../../middleware/auth');

router.use(resHelpers);
router.use(requireAuth);

// Health
router.get('/health', (req, res) => res.ok({ status: 'ok' }));

// Sub-routers are mounted below as they are created (Tasks 4-7)
// router.use('/', require('./runs'));
// router.use('/', require('./projects'));
// router.use('/', require('./knowledge'));
// router.use('/', require('./autopilot'));
// router.use('/', require('./dashboard'));
// router.use('/', require('./admin'));

module.exports = router;
```

**Step 2: Update routes/index.js**

Change:
```javascript
const researchOpsRouter = require('./researchops');
```
To:
```javascript
const researchOpsRouter = require('./researchops/index');
```

**Step 3: Verify app loads**
```bash
node -e "require('./src/routes/index'); console.log('OK')"
```
Expected: `OK`

**⚠️ NOTE:** The monolithic `researchops.js` still handles all routes for now — index.js only intercepts `/health`. Remove `researchops.js` mount only after all domain files are complete (Task 8).

**Step 4: Commit**
```bash
git add backend/src/routes/researchops/index.js backend/src/routes/index.js
git commit -m "feat(api): scaffold researchops route index (parallel to monolith)"
```

---

## Task 4: Create runs.js domain route + fix BUG-3 + fix BUG-4

**Files:**
- Create: `backend/src/routes/researchops/runs.js`
- Source lines in monolith: 4838, 5298-5713 (all run-related routes)

This is the most critical domain file. It contains BUG-3 (queue stalling) and BUG-4 (S3 artifact access) fixes.

**Step 1: Read the monolith lines to understand run route structure**

Run: `grep -n "^router\." backend/src/routes/researchops.js | grep -E "runs|artifacts|checkpoints|context-pack|events|steps|report|horizon"`

Confirm routes: enqueue-v2 (5298), enqueue (5350), GET /runs (5369), GET /runs/:id (5392), POST status (5403), cancel (5420), retry (5431), DELETE (5444), DELETE project runs (5458), workflow/insert (5470), events POST (5486), events GET (5499), steps (5513), artifacts list (5524), artifacts download (5539), checkpoints (5580), checkpoint decision (5594), report (5653), context-pack preview (4838), context-pack get (7355).

**Step 2: Create runs.js with BUG-3 and BUG-4 fixes**

```javascript
// backend/src/routes/researchops/runs.js
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const s3Service = require('../../services/s3.service');
const researchOpsStore = require('../../services/researchops/store');
const researchOpsRunner = require('../../services/researchops/runner');
const workflowSchemaService = require('../../services/researchops/workflow-schema.service');
const contextPackService = require('../../services/researchops/context-pack.service');
const {
  parseLimit, parseOffset, parseBoolean, cleanString,
  getUserId, sanitizeError, withArtifactDownloadUrl,
} = require('./shared');

// Inline helper used in this file
function enforceExperimentProjectPathPolicy(userId, projectId, runType) {
  // Delegate to the monolith helper via store or inline (copy from monolith line ~5200)
  // TODO: extract to shared service after monolith is retired
  return Promise.resolve();
}

// ─── POST /runs/enqueue-v2 ────────────────────────────────────────────────
// BUG-3 FIX: call leaseAndExecuteNext immediately after enqueue so the run
// doesn't wait up to 5s for the next auto-dispatch tick.
router.post('/runs/enqueue-v2', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const runPayload = body.run && typeof body.run === 'object' ? body.run : body;
    const projectId = cleanString(runPayload.projectId);
    if (!projectId) return res.fail('VALIDATION_ERROR', 'projectId is required', 400);

    const workflow = workflowSchemaService.normalizeAndValidateWorkflow(
      Array.isArray(runPayload.workflow) ? runPayload.workflow : [],
      { allowEmpty: true }
    );
    const runType = cleanString(runPayload.runType).toUpperCase() || 'AGENT';
    const serverId = cleanString(runPayload.serverId) || 'local-default';

    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId,
      runType,
      provider: cleanString(runPayload.provider) || 'codex_cli',
      schemaVersion: '2.0',
      mode: cleanString(runPayload.mode) === 'interactive' ? 'interactive' : 'headless',
      workflow,
      skillRefs: Array.isArray(runPayload.skillRefs) ? runPayload.skillRefs : [],
      contextRefs: (runPayload.contextRefs && typeof runPayload.contextRefs === 'object')
        ? runPayload.contextRefs : {},
      outputContract: (runPayload.outputContract && typeof runPayload.outputContract === 'object')
        ? runPayload.outputContract : {},
      budgets: (runPayload.budgets && typeof runPayload.budgets === 'object')
        ? runPayload.budgets : {},
      hitlPolicy: (runPayload.hitlPolicy && typeof runPayload.hitlPolicy === 'object')
        ? runPayload.hitlPolicy : {},
      metadata: (runPayload.metadata && typeof runPayload.metadata === 'object')
        ? runPayload.metadata : {},
    });

    // BUG-3 FIX: trigger immediate dispatch without blocking the response
    setImmediate(() => {
      researchOpsRunner.leaseAndExecuteNext(getUserId(req), serverId, { allowUnregisteredServer: true })
        .catch((err) => console.error('[runs/enqueue-v2] immediate dispatch failed:', err.message));
    });

    // Legacy-compatible: also include run at top level for old frontend
    return res.status(201).ok({ run });
  } catch (error) {
    console.error('[ResearchOps] enqueueRunV2 failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') return res.fail('PROJECT_NOT_FOUND', 'Project not found', 404);
    return res.fail('VALIDATION_ERROR', sanitizeError(error, 'Failed to enqueue v2 run'), 400);
  }
});

// ─── GET /runs ────────────────────────────────────────────────────────────
// Result snippet: include lastLogLine from store if available.
router.get('/runs', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 300);
    const cursor = cleanString(req.query.cursor);
    const page = await researchOpsStore.listRunsPage(getUserId(req), {
      projectId: cleanString(req.query.projectId),
      status: cleanString(req.query.status).toUpperCase(),
      limit,
      cursor,
    });
    return res.ok({
      items: page.items || [],
      limit,
      cursor: cursor || null,
      hasMore: Boolean(page.hasMore),
      nextCursor: cleanString(page.nextCursor) || null,
    });
  } catch (error) {
    console.error('[ResearchOps] listRuns failed:', error);
    return res.fail('INTERNAL_ERROR', 'Failed to list runs', 500);
  }
});

// ─── GET /runs/:runId ─────────────────────────────────────────────────────
router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
    if (!run) return res.fail('RUN_NOT_FOUND', `Run ${req.params.runId} not found`, 404);
    return res.ok({ run });
  } catch (error) {
    console.error('[ResearchOps] getRun failed:', error);
    return res.fail('INTERNAL_ERROR', 'Failed to fetch run', 500);
  }
});

// ─── POST /runs/:runId/cancel ─────────────────────────────────────────────
router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    await researchOpsRunner.cancelRun(getUserId(req), req.params.runId);
    return res.ok({ cancelled: true });
  } catch (error) {
    console.error('[ResearchOps] cancelRun failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.fail('RUN_NOT_FOUND', 'Run not found', 404);
    return res.fail('INTERNAL_ERROR', sanitizeError(error, 'Failed to cancel run'), 500);
  }
});

// ─── DELETE /runs/:runId ──────────────────────────────────────────────────
router.delete('/runs/:runId', requireAuth, async (req, res) => {
  try {
    await researchOpsStore.deleteRun(getUserId(req), req.params.runId);
    return res.ok({ deleted: true });
  } catch (error) {
    console.error('[ResearchOps] deleteRun failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.fail('RUN_NOT_FOUND', 'Run not found', 404);
    return res.fail('INTERNAL_ERROR', sanitizeError(error, 'Failed to delete run'), 500);
  }
});

// ─── GET /runs/:runId/artifacts ───────────────────────────────────────────
router.get('/runs/:runId/artifacts', async (req, res) => {
  try {
    const runId = cleanString(req.params.runId);
    const items = await researchOpsStore.listRunArtifacts(getUserId(req), runId, {
      type: cleanString(req.query.type),
      limit: parseLimit(req.query.limit, 100, 500),
    });
    return res.ok({ items: items.map((item) => withArtifactDownloadUrl(item, runId)) });
  } catch (error) {
    console.error('[ResearchOps] listRunArtifacts failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.fail('RUN_NOT_FOUND', 'Run not found', 404);
    return res.fail('INTERNAL_ERROR', sanitizeError(error, 'Failed to list run artifacts'), 500);
  }
});

// ─── GET /runs/:runId/artifacts/:artifactId/download ─────────────────────
// BUG-4 FIX: always proxy through backend; expose presigned URL via ?redirect=true
router.get('/runs/:runId/artifacts/:artifactId/download', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = cleanString(req.params.runId);
    const artifactId = cleanString(req.params.artifactId);
    if (!runId || !artifactId) return res.fail('VALIDATION_ERROR', 'runId and artifactId are required', 400);

    const artifact = await researchOpsStore.getRunArtifact(userId, runId, artifactId);
    if (!artifact) return res.fail('ARTIFACT_NOT_FOUND', 'Artifact not found', 404);

    if (artifact.objectKey) {
      const wantPresign = parseBoolean(req.query.redirect) || parseBoolean(req.query.presign);
      if (wantPresign) {
        try {
          const signedUrl = await s3Service.generatePresignedDownloadUrl(artifact.objectKey);
          return res.redirect(302, signedUrl);
        } catch (_) {
          // fall through to proxy mode
        }
      }
      // Default: proxy the download through the backend (BUG-4 fix: no direct S3 links)
      const buffer = await s3Service.downloadBuffer(artifact.objectKey);
      const filename = String(artifact.path || artifact.title || artifact.id).split('/').pop() || String(artifact.id);
      const mimeType = String(artifact.mimeType || 'application/octet-stream');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
      return res.send(buffer);
    }

    const inlineText = String(artifact.metadata?.inlinePreview || '');
    if (inlineText) {
      res.setHeader('Content-Type', String(artifact.mimeType || 'text/plain; charset=utf-8'));
      return res.send(inlineText);
    }
    return res.fail('ARTIFACT_NOT_FOUND', 'No downloadable content for this artifact', 404);
  } catch (error) {
    console.error('[ResearchOps] downloadRunArtifact failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.fail('RUN_NOT_FOUND', 'Run not found', 404);
    return res.fail('INTERNAL_ERROR', sanitizeError(error, 'Failed to download artifact'), 500);
  }
});

// ─── GET /runs/:runId/events (SSE) ────────────────────────────────────────
// (Copy verbatim from monolith line 5499-5511; already proxies correctly)

// (All remaining run routes — retry, workflow/insert, checkpoints, steps,
//  report, context-pack, horizon — are copied verbatim from the monolith.
//  Listed here for completeness but omitted for brevity in this plan.
//  Follow the SAME res.ok/res.fail pattern for error responses.)

module.exports = router;
```

> **Implementation note for executor:** Copy ALL routes from the monolith that match these patterns to `runs.js`:
> - `router.post('/runs/enqueue-v2', ...)` — replace with BUG-3-fixed version above
> - `router.post('/runs/enqueue', ...)` — copy verbatim
> - `router.get('/runs', ...)` — replace with res.ok version above
> - `router.get('/runs/:runId', ...)` — replace with res.ok version above
> - `router.post('/runs/:runId/status', ...)` — copy, change `res.json` → `res.ok`
> - `router.post('/runs/:runId/cancel', ...)` — replace with version above
> - `router.post('/runs/:runId/retry', ...)` — copy, change to res.ok/res.fail
> - `router.delete('/runs/:runId', ...)` — replace with version above
> - `router.delete('/projects/:projectId/runs', ...)` — copy with res.ok/res.fail
> - `router.post('/runs/:runId/workflow/insert', ...)` — copy with res.ok/res.fail
> - `router.post('/runs/:runId/events', ...)` — copy verbatim
> - `router.get('/runs/:runId/events', ...)` — copy verbatim (SSE)
> - `router.get('/runs/:runId/steps', ...)` — copy with res.ok/res.fail
> - `router.get('/runs/:runId/artifacts', ...)` — replace with version above
> - `router.get('/runs/:runId/artifacts/:artifactId/download', ...)` — replace with BUG-4 version above
> - `router.get('/runs/:runId/checkpoints', ...)` — copy with res.ok/res.fail
> - `router.post('/runs/:runId/checkpoints/:checkpointId/decision', ...)` — copy with res.ok/res.fail
> - `router.get('/runs/:runId/report', ...)` — copy with res.ok/res.fail
> - `router.get('/runs/:runId/context-pack', ...)` — copy with res.ok/res.fail
> - `router.post('/runs/:runId/context-pack/preview', ...)` — copy with res.ok/res.fail
> - `router.get('/runs/:runId/horizon-status', ...)` — copy with res.ok/res.fail
> - `router.post('/runs/:runId/horizon-cancel', ...)` — copy with res.ok/res.fail

**Step 3: Mount in index.js**

Uncomment in `backend/src/routes/researchops/index.js`:
```javascript
router.use('/', require('./runs'));
```

**Step 4: Verify**
```bash
node -e "require('./src/routes/researchops/runs'); console.log('OK')"
node -e "require('./src/routes/researchops/index'); console.log('OK')"
```
Expected: both print `OK`

**Step 5: Commit**
```bash
git add backend/src/routes/researchops/runs.js backend/src/routes/researchops/index.js
git commit -m "feat(api): migrate runs routes to domain module; fix BUG-3 immediate dispatch and BUG-4 S3 proxy"
```

---

## Task 5: Create projects.js domain route

**Files:**
- Create: `backend/src/routes/researchops/projects.js`
- Source lines in monolith: 3144-3990, 4001-4312 (project CRUD, workspace, git, KB, files, tree)

**Step 1: Create the file**

```javascript
// backend/src/routes/researchops/projects.js
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/auth');
const researchOpsStore = require('../../services/researchops/store');
const treePlanService = require('../../services/researchops/tree-plan.service');
const treeStateService = require('../../services/researchops/tree-state.service');
// ... (import all services used by project routes from the monolith)
const {
  parseLimit, parseOffset, parseBoolean, cleanString,
  getUserId, sanitizeError, parseMaybeJson, expandHome,
} = require('./shared');

// Copy routes verbatim from monolith lines 3144-5026, 5058-5117 (git restore, run-tree, tree/*).
// For each route: change res.json({ ... }) → res.ok({ ... })
//                change res.status(N).json({ error }) → res.fail('CODE', message, N)

module.exports = router;
```

> **Routes to copy from monolith:**
> - `GET /projects` (3144)
> - `POST /projects` (3156)
> - `POST /projects/path-check` (3224)
> - `PATCH /projects/:projectId` (3389)
> - `DELETE /projects/:projectId` (3435)
> - `GET /projects/:projectId/workspace` (3475)
> - `GET /projects/:projectId/venv/status` (3566)
> - `POST /projects/:projectId/venv/setup` (3586)
> - `GET /projects/:projectId/git-log` (3611)
> - `GET /projects/:projectId/server-files` (3669)
> - `GET /projects/:projectId/changed-files` (3722)
> - `GET /projects/:projectId/agent-sessions` (3820)
> - `POST /projects/:projectId/agent-sessions` (3833)
> - `GET /agent-sessions/:sid` (3845) ← note: not nested under projectId
> - `GET /agent-sessions/:sid/messages` (3858)
> - `POST /agent-sessions/:sid/messages` (3875)
> - `POST /agent-sessions/:sid/stop` (3931)
> - `GET /agent-sessions` (3967)
> - `GET /projects/:projectId` (3990) ← get single project
> - `POST /projects/:projectId/kb/setup-from-resource` (4001)
> - `POST /projects/:projectId/kb/sync-group` (4044)
> - `GET /projects/:projectId/kb/sync-jobs/:jobId` (4079)
> - `GET /projects/:projectId/kb/files` (4098)
> - `POST /projects/:projectId/kb/add-paper` (4144)
> - `GET /projects/:projectId/files/tree` (4312)
> - `GET /projects/:projectId/files/content` (4349)
> - `GET /projects/:projectId/files/search` (4387)
> - `GET /projects/:projectId/kb/resource-locate` (4424)
> - `POST /projects/:projectId/files/augment` (4466)
> - `PUT /projects/:projectId/knowledge-groups` (4534)
> - `GET /projects/:projectId/knowledge-groups` (4565)
> - `POST /projects/:projectId/todos/next-actions` (4906) ← no wait, this belongs here
> - `POST /projects/:projectId/todos/clear` (4926)
> - `POST /projects/:projectId/todos/from-proposal` (4960)
> - `GET /projects/:projectId/run-tree` (5026)
> - `POST /projects/:projectId/git/restore` (5058)
> - All tree routes (6803-7301): plan, root-node, validate, patches, impact-preview, state, node run-step, node approve, run-all, control/pause, control/resume, control/abort, node search, node promote
> - Repo map routes (7418, 7439)

**Step 2: Mount in index.js**
```javascript
router.use('/', require('./projects'));
```

**Step 3: Verify**
```bash
node -e "require('./src/routes/researchops/projects'); console.log('OK')"
```

**Step 4: Commit**
```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/index.js
git commit -m "feat(api): migrate projects routes to domain module"
```

---

## Task 6: Create knowledge.js, dashboard.js, admin.js domain routes

**Files:**
- Create: `backend/src/routes/researchops/knowledge.js`
- Create: `backend/src/routes/researchops/dashboard.js`
- Create: `backend/src/routes/researchops/admin.js`

**knowledge.js routes (from monolith):**
- `GET /knowledge-groups` (4591)
- `POST /knowledge-groups` (4605)
- `PATCH /knowledge-groups/:groupId` (4615)
- `DELETE /knowledge-groups/:groupId` (4630)
- `GET /knowledge-groups/:groupId/documents` (4640)
- `POST /knowledge-groups/:groupId/documents` (4658)
- `DELETE /knowledge-groups/:groupId/documents/:documentId` (4674)
- `GET /knowledge/assets` (4690)
- `POST /knowledge/assets` (4708)
- `POST /knowledge/assets/upload` (4718) ← uses `knowledgeAssetUpload` multer
- `GET /knowledge/assets/:assetId` (4752)
- `PATCH /knowledge/assets/:assetId` (4765)
- `DELETE /knowledge/assets/:assetId` (4776)
- `GET /knowledge/groups/:groupId/assets` (4787)
- `POST /knowledge/groups/:groupId/assets` (4807)
- `DELETE /knowledge/groups/:groupId/assets/:assetId` (4823)

> Note: `knowledge.js` needs the multer instances — copy them from the monolith top section.

**dashboard.js routes:**
- `GET /dashboard` (3117)
- `GET /ideas` (4857)
- `POST /ideas` (4871)
- `GET /ideas/:ideaId` (4884)
- `PATCH /ideas/:ideaId` (4895)
- `POST /plan/generate` (5173)
- `POST /plan/enqueue-v2` (5246)
- `POST /kb/search` (6051)

**admin.js routes:**
- `GET /scheduler/queue` (5713)
- `POST /scheduler/lease-next` (5726)
- `POST /scheduler/lease-and-execute` (5738)
- `POST /scheduler/recover-stale` (5751)
- `GET /scheduler/dispatcher/status` (5765)
- `GET /runner/running` (5775)
- `POST /daemons/register` (5780)
- `POST /daemons/heartbeat` (5795)
- `GET /daemons` (5811)
- `GET /cluster/resource-pool` (5823)
- `GET /cluster/agent-capacity` (5974)
- `GET /skills` (6030)
- `POST /skills/sync` (6040)
- `POST /experiments/execute` (6126) ← large route, copy verbatim

**Step 1: Create all three files** following the same pattern as runs.js/projects.js.

**Step 2: Mount all in index.js**
```javascript
router.use('/', require('./knowledge'));
router.use('/', require('./dashboard'));
router.use('/', require('./admin'));
```

**Step 3: Verify**
```bash
node -e "require('./src/routes/researchops/knowledge'); console.log('OK')"
node -e "require('./src/routes/researchops/dashboard'); console.log('OK')"
node -e "require('./src/routes/researchops/admin'); console.log('OK')"
```

**Step 4: Commit**
```bash
git add backend/src/routes/researchops/knowledge.js backend/src/routes/researchops/dashboard.js backend/src/routes/researchops/admin.js backend/src/routes/researchops/index.js
git commit -m "feat(api): migrate knowledge, dashboard, admin routes to domain modules"
```

---

## Task 7: Create autopilot.js domain route

**Files:**
- Create: `backend/src/routes/researchops/autopilot.js`

**Routes from monolith:**
- `POST /projects/:projectId/autopilot/start` (5117)
- `GET /projects/:projectId/autopilot/sessions` (5137)
- `POST /autopilot/:sessionId/stop` (5149)
- `GET /autopilot/:sessionId` (5161)

**Step 1: Create file** (same pattern)

**Step 2: Mount in index.js**
```javascript
router.use('/', require('./autopilot'));
```

**Step 3: Verify index loads all sub-routers cleanly**
```bash
node -e "require('./src/routes/researchops/index'); console.log('OK')"
```

**Step 4: Remove the old monolith from routes/index.js and switch fully to new index**

In `backend/src/routes/index.js`, the require is already pointing to `./researchops/index`. Now verify the route counts match:
```bash
node -e "
const app = require('express')();
const routes = require('./src/routes/index');
app.use('/api', routes);
const stack = app._router.stack.flatMap(l => l.handle?.stack || []);
console.log('Route layers:', stack.length);
"
```

The old monolith `researchops.js` file can be archived (do NOT delete yet — await manual approval per CLAUDE.md):
```bash
# DO NOT RUN YET: requires manual approval before removal
# mv backend/src/routes/researchops.js backend/src/routes/researchops.js.bak
```

**Step 5: Commit**
```bash
git add backend/src/routes/researchops/autopilot.js backend/src/routes/researchops/index.js
git commit -m "feat(api): migrate autopilot routes; researchops split complete"
```

---

## Task 8: Fix BUG-2 — SSH project execution (wrong cwd)

**Files:**
- Modify: `backend/src/services/researchops/modules/agent-run.module.js`

**Root cause (confirmed from code review):**
- `resolveExecutionCwd` calls `fs.stat(resolvedRequested)` locally
- Remote paths (e.g. `~/researchops-projects/rfm`) don't exist on the local Node.js server
- Falls back to `process.cwd()` (the Node.js server working dir)
- SSH remote script then does `cd /home/czk/auto-researcher/backend` (wrong!)

**Step 1: Locate the function**
```bash
grep -n "resolveExecutionCwd" backend/src/services/researchops/modules/agent-run.module.js
```
Confirm it's around line 666.

**Step 2: Read lines 666-800 to understand the full function and its callers**

**Step 3: Add SSH-aware path forwarding**

Find the line in `AgentRunModule.run()` (~line 760-780) where `resolveExecutionCwd` is called:
```javascript
const localCwdResolution = await resolveExecutionCwd({
  cwdInput,
  run,
  context,
  step,
});
```

Add SSH bypass BEFORE this call:
```javascript
// BUG-2 FIX: for SSH runs, skip local path resolution entirely.
// The remote script handles `cd $TARGET_CWD` on the remote machine.
// Local stat check would always fail for remote paths.
let localCwdResolution;
if (execServer) {
  // Pass the raw cwdInput directly; buildRemoteScript will handle it
  const rawRemoteCwd = cleanString(cwdInput) || cleanString(run?.metadata?.cwd) || '';
  localCwdResolution = {
    cwd: rawRemoteCwd || '$HOME',
    requestedCwd: rawRemoteCwd,
    fallbackReason: '',
  };
} else {
  localCwdResolution = await resolveExecutionCwd({
    cwdInput,
    run,
    context,
    step,
  });
}
```

Then replace the existing `const localCwdResolution = await resolveExecutionCwd(...)` with the block above.

**Step 4: Verify the module still loads**
```bash
node -e "require('./backend/src/services/researchops/modules/agent-run.module'); console.log('OK')"
```

**Step 5: Smoke test with a local-only run** (if CI environment available)

**Step 6: Commit**
```bash
git add backend/src/services/researchops/modules/agent-run.module.js
git commit -m "fix(ssh): skip local path stat for SSH project execution (BUG-2)"
```

---

## Task 9: Write OpenAPI spec and serve it

**Files:**
- Create: `backend/openapi.yaml`
- Modify: `backend/src/routes/researchops/index.js` (add `/api/openapi.json` endpoint)

**Step 1: Create the OpenAPI spec**

```yaml
# backend/openapi.yaml
openapi: "3.1.0"
info:
  title: Auto Researcher ResearchOps API
  version: "2.0"
  description: |
    API for the auto-researcher vibe research platform.

    ## Authentication
    Include the `X-Auth-Token` header on all requests.
    Example: `X-Auth-Token: <your-token>`

    ## Base URL
    Production: `https://your-domain.example.com/api/researchops`

    ## Agent Usage
    This spec is machine-readable. Fetch `/api/openapi.json` to get tool definitions.
    All responses follow the envelope: `{ ok: true, data: {...}, meta: {...} }` for success,
    `{ ok: false, error: { code, message, details } }` for errors.
    Match on `error.code` (not `error.message`) for programmatic error handling.

tags:
  - name: runs
    description: Research run lifecycle management
  - name: projects
    description: Project workspace management
  - name: knowledge
    description: Knowledge assets and groups
  - name: autopilot
    description: Automated iteration sessions
  - name: dashboard
    description: Dashboard and ideas

components:
  securitySchemes:
    tokenAuth:
      type: apiKey
      in: header
      name: X-Auth-Token
  schemas:
    RunSpec:
      type: object
      required: [projectId]
      properties:
        projectId: { type: string }
        serverId: { type: string, default: local-default }
        runType: { type: string, enum: [AGENT, EXPERIMENT, QUICK_BASH], default: AGENT }
        provider: { type: string, default: codex_cli }
        mode: { type: string, enum: [headless, interactive], default: headless }
        workflow:
          type: array
          items:
            type: object
            required: [id, type]
            properties:
              id: { type: string }
              type: { type: string, enum: [agent.run, bash.run, checkpoint.hitl, report.render, artifact.publish] }
              inputs: { type: object }
        skillRefs:
          type: array
          items:
            type: object
            properties:
              id: { type: string }
              version: { type: string }
        contextRefs:
          type: object
          properties:
            knowledgeGroupIds: { type: array, items: { type: integer } }
            knowledgeAssetIds: { type: array, items: { type: integer } }
    Run:
      type: object
      properties:
        id: { type: string }
        projectId: { type: string }
        status: { type: string, enum: [QUEUED, PROVISIONING, RUNNING, SUCCEEDED, FAILED, CANCELLED] }
        runType: { type: string }
        serverId: { type: string }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
        metadata: { type: object }
    KnowledgeAsset:
      type: object
      properties:
        id: { type: integer }
        assetType: { type: string, enum: [insight, document, file, note, report] }
        title: { type: string }
        summary: { type: string }
        bodyMd: { type: string }
        tags: { type: array, items: { type: string } }
        createdAt: { type: string, format: date-time }
    Envelope:
      type: object
      properties:
        ok: { type: boolean }
        data: { type: object }
        meta:
          type: object
          properties:
            ts: { type: string, format: date-time }
            v: { type: integer }
    ErrorEnvelope:
      type: object
      properties:
        ok: { const: false }
        error:
          type: object
          properties:
            code:
              type: string
              enum:
                - RUN_NOT_FOUND
                - PROJECT_NOT_FOUND
                - ASSET_NOT_FOUND
                - QUEUE_FULL
                - RUN_NOT_QUEUED
                - RUN_ALREADY_RUNNING
                - CHECKPOINT_REQUIRED
                - CHECKPOINT_EXPIRED
                - SSH_UNREACHABLE
                - SSH_AUTH_FAILED
                - ARTIFACT_NOT_FOUND
                - ARTIFACT_EXPIRED
                - VALIDATION_ERROR
                - UNAUTHORIZED
                - INTERNAL_ERROR
            message: { type: string }
            details: { type: object }

security:
  - tokenAuth: []

paths:
  /researchops/runs/enqueue-v2:
    post:
      tags: [runs]
      summary: Enqueue a new v2 research run
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/RunSpec' }
            example:
              projectId: "proj_abc"
              serverId: "local-default"
              runType: "AGENT"
              workflow:
                - id: "step_1"
                  type: "agent.run"
                  inputs:
                    prompt: "Implement experiment X and report results"
      responses:
        "201":
          description: Run enqueued
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - properties:
                      data:
                        properties:
                          run: { $ref: '#/components/schemas/Run' }
        "400":
          description: Validation error
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorEnvelope' }
        "404":
          description: Project not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorEnvelope' }

  /researchops/runs:
    get:
      tags: [runs]
      summary: List runs (paginated)
      parameters:
        - name: projectId
          in: query
          schema: { type: string }
        - name: status
          in: query
          schema: { type: string, enum: [QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED] }
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 300 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        "200":
          description: List of runs
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - properties:
                      data:
                        properties:
                          items:
                            type: array
                            items: { $ref: '#/components/schemas/Run' }
                          hasMore: { type: boolean }
                          nextCursor: { type: string, nullable: true }

  /researchops/runs/{runId}:
    get:
      tags: [runs]
      summary: Get a single run
      parameters:
        - name: runId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Run detail
        "404":
          description: Run not found
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorEnvelope' }

  /researchops/runs/{runId}/cancel:
    post:
      tags: [runs]
      summary: Cancel a running or queued run
      parameters:
        - name: runId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Run cancelled

  /researchops/runs/{runId}/artifacts:
    get:
      tags: [runs]
      summary: List artifacts for a run
      parameters:
        - name: runId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: List of artifacts

  /researchops/runs/{runId}/artifacts/{artifactId}/download:
    get:
      tags: [runs]
      summary: Download a run artifact (proxied through backend)
      description: |
        By default, proxies the S3 object through the backend.
        Pass `?redirect=true` for a presigned URL redirect instead.
      parameters:
        - name: runId
          in: path
          required: true
          schema: { type: string }
        - name: artifactId
          in: path
          required: true
          schema: { type: string }
        - name: redirect
          in: query
          schema: { type: boolean, default: false }

  /researchops/runs/{runId}/events:
    get:
      tags: [runs]
      summary: Stream run events (SSE)
      description: Server-Sent Events stream of LOG_LINE and status events.
      parameters:
        - name: runId
          in: path
          required: true
          schema: { type: string }

  /researchops/projects:
    get:
      tags: [projects]
      summary: List projects
      responses:
        "200":
          description: List of projects
    post:
      tags: [projects]
      summary: Create a project
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string }
                projectPath: { type: string }
                serverId: { type: string }

  /researchops/projects/{projectId}:
    get:
      tags: [projects]
      summary: Get project details
      parameters:
        - name: projectId
          in: path
          required: true
          schema: { type: string }

  /researchops/knowledge/assets:
    get:
      tags: [knowledge]
      summary: List knowledge assets
      parameters:
        - name: projectId
          in: query
          schema: { type: string }
        - name: assetType
          in: query
          schema: { type: string, enum: [insight, document, file, note, report] }
      responses:
        "200":
          description: List of knowledge assets
    post:
      tags: [knowledge]
      summary: Create a text knowledge asset
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, assetType]
              properties:
                title: { type: string }
                assetType: { type: string }
                bodyMd: { type: string }
                summary: { type: string }
                tags: { type: array, items: { type: string } }
            example:
              title: "Key finding: attention scaling"
              assetType: "insight"
              bodyMd: "The factorized attention achieves O(L + C) memory scaling."
              tags: ["attention", "scaling"]
      responses:
        "201":
          description: Asset created

  /researchops/dashboard:
    get:
      tags: [dashboard]
      summary: Combined dashboard (projects, runs, queue, ideas, skills)
      responses:
        "200":
          description: Dashboard summary
```

**Step 2: Add OpenAPI serving endpoint in index.js**

```javascript
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Serve OpenAPI spec
router.get('/openapi', (req, res) => {
  try {
    const specPath = path.resolve(__dirname, '../../../openapi.yaml');
    const raw = fs.readFileSync(specPath, 'utf8');
    const spec = yaml.load(raw);
    return res.json(spec);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load OpenAPI spec' });
  }
});
```

> Note: The endpoint is at `/api/researchops/openapi` (not `/api/openapi.json` as designed — easier to keep within researchops router scope).

**Step 3: Verify spec loads**
```bash
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const spec = yaml.load(fs.readFileSync('./backend/openapi.yaml', 'utf8'));
console.log('Paths:', Object.keys(spec.paths).length, 'OK');
"
```
Expected: `Paths: N OK` (should be ≥8 paths)

**Step 4: Commit**
```bash
git add backend/openapi.yaml backend/src/routes/researchops/index.js
git commit -m "feat(api): add OpenAPI spec + serve at /api/researchops/openapi"
```

---

## Task 10: Frontend — live log tail in VibeNodeWorkbench

**Files:**
- Modify: `frontend/src/components/vibe/VibeNodeWorkbench.jsx`

**Context:** When node status is RUNNING, subscribe to `GET /api/researchops/runs/:runId/events` (SSE). Append log lines to the "commands" tab. Auto-scroll to bottom unless user has scrolled up.

**Step 1: Add SSE subscription hook**

In `VibeNodeWorkbench.jsx`, after the existing imports, add:
```javascript
import { useEffect, useRef } from 'react';
// (useEffect and useRef are already in React import — just ensure they're listed)
```

**Step 2: Add live log state and SSE logic**

Add to the component (after existing `useState` declarations):
```javascript
const [liveLogs, setLiveLogs] = useState([]);
const logContainerRef = useRef(null);
const autoScrollRef = useRef(true);

// Subscribe to SSE when node is RUNNING and we have a runId
const runId = nodeState?.runId;

useEffect(() => {
  if (status !== 'RUNNING' || !runId) {
    setLiveLogs([]);
    return;
  }
  setLiveLogs([]);
  autoScrollRef.current = true;
  const url = `/api/researchops/runs/${encodeURIComponent(runId)}/events`;
  const es = new EventSource(url);

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.eventType === 'LOG_LINE' && data.message) {
        setLiveLogs((prev) => [...prev.slice(-500), data.message]);
      }
    } catch (_) {}
  };

  es.onerror = () => es.close();

  return () => es.close();
}, [runId, status]);

// Auto-scroll to bottom on new log lines
useEffect(() => {
  if (autoScrollRef.current && logContainerRef.current) {
    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }
}, [liveLogs]);
```

**Step 3: Render live logs in the "commands" tab**

Find the commands tab section in the JSX. After the existing commands list, add a live log section when status is RUNNING:

```jsx
{status === 'RUNNING' && liveLogs.length > 0 && (
  <div className="vibe-live-log">
    <h4>Live Output</h4>
    <pre
      ref={logContainerRef}
      className="vibe-live-log-pre"
      onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
        autoScrollRef.current = atBottom;
      }}
    >
      {liveLogs.join('')}
    </pre>
  </div>
)}
{status === 'RUNNING' && liveLogs.length === 0 && (
  <p className="vibe-empty">Waiting for output…</p>
)}
```

**Step 4: Add CSS for live log**

In `frontend/src/index.css` (or relevant styles file), add:
```css
.vibe-live-log {
  margin-top: 1rem;
}

.vibe-live-log-pre {
  background: var(--color-bg-secondary, #0d1117);
  color: var(--color-text, #e6edf3);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  padding: 0.75rem;
  border-radius: 4px;
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
```

**Step 5: Verify the component renders without error**
```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error|warn|VibeNodeWorkbench"
```
Expected: no errors mentioning VibeNodeWorkbench.

**Step 6: Commit**
```bash
git add frontend/src/components/vibe/VibeNodeWorkbench.jsx frontend/src/index.css
git commit -m "feat(ux): add live log tail to VibeNodeWorkbench commands tab"
```

---

## Task 11: Frontend — result snippet field in GET /runs response

**Files:**
- Modify: `backend/src/routes/researchops/runs.js` (add `resultSnippet` to `GET /runs` items)
- Modify: `backend/src/services/researchops/store.js` (add snippet to listRunsPage)

**Step 1: Find `listRunsPage` in store.js**
```bash
grep -n "listRunsPage\|resultSnippet" backend/src/services/researchops/store.js | head -10
```

**Step 2: Add resultSnippet to the query result**

In `listRunsPage`, the runs come from a DB query. Each run has a `last_log_line` or similar field — OR we can derive it from the run's `statusMessage` or `metadata.lastOutput`.

Check what fields the run object has:
```bash
grep -n "statusMessage\|last_log\|lastOutput\|result_snippet\|snippet" backend/src/services/researchops/store.js | head -10
```

If there's a `statusMessage` field, use it as the snippet. Add a transform after the query:
```javascript
items: (page.items || []).map((run) => ({
  ...run,
  resultSnippet: run.statusMessage
    ? String(run.statusMessage).slice(0, 120)
    : run.status === 'SUCCEEDED' ? 'Completed successfully' : null,
})),
```

**Step 3: Commit backend change**
```bash
git add backend/src/routes/researchops/runs.js backend/src/services/researchops/store.js
git commit -m "feat(api): add resultSnippet to GET /runs list response"
```

---

## Task 12: Frontend — result snippets + re-run button in VibeRunHistory

**Files:**
- Modify: `frontend/src/components/vibe/VibeRunHistory.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx` (add `onRerunRun` handler)

**Step 1: Add `onRerunRun` prop to VibeRunHistory**

In `VibeRunHistory.jsx`, update the function signature:
```javascript
function VibeRunHistory({
  runs,
  selectedRunId,
  onSelectRun,
  hasMore = false,
  loadingMore = false,
  onLoadMore = null,
  onDeleteRun = null,
  onClearFailed = null,
  onClearAll = null,
  onRerunRun = null,   // ← ADD THIS
}) {
```

**Step 2: Add snippet text and Re-run button to each run row**

In the run row JSX (after the existing `<span className="vibe-run-chain">` line), add:
```jsx
{run.resultSnippet && (
  <span className="vibe-run-snippet" title={run.resultSnippet}>
    {run.resultSnippet.slice(0, 80)}
  </span>
)}
{onRerunRun && (
  <span
    role="button"
    tabIndex={0}
    className="vibe-run-rerun-btn"
    title="Re-run with same spec"
    onClick={(e) => { e.stopPropagation(); onRerunRun(run.id); }}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onRerunRun(run.id); }
    }}
  >
    ↺
  </span>
)}
```

**Step 3: Add CSS for snippet and re-run button**

```css
.vibe-run-snippet {
  display: block;
  font-size: 0.7rem;
  color: var(--color-text-muted, #8b949e);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
  grid-column: 1 / -1;
}

.vibe-run-rerun-btn {
  cursor: pointer;
  padding: 2px 6px;
  font-size: 0.75rem;
  color: var(--color-accent, #58a6ff);
  border-radius: 3px;
  opacity: 0.7;
}
.vibe-run-rerun-btn:hover { opacity: 1; }
```

**Step 4: Add `handleRerunRun` in VibeResearcherPanel.jsx**

Find where `onDeleteRun={handleDeleteRun}` is passed to VibeRunHistory. Near that same location, add the handler and prop:

```javascript
const handleRerunRun = async (runId) => {
  try {
    const { data: runData } = await axios.get(
      `${apiUrl}/researchops/runs/${encodeURIComponent(runId)}`,
      { headers }
    );
    const originalRun = runData?.run || runData?.data?.run;
    if (!originalRun) return;
    const rerunPayload = {
      projectId: originalRun.projectId,
      serverId: originalRun.serverId,
      runType: originalRun.runType,
      provider: originalRun.provider,
      workflow: originalRun.workflow || [],
      skillRefs: originalRun.skillRefs || [],
      contextRefs: originalRun.contextRefs || {},
      metadata: { ...originalRun.metadata, rerunOf: runId },
    };
    await axios.post(`${apiUrl}/researchops/runs/enqueue-v2`, rerunPayload, { headers });
    // Refresh run list
    loadRuns?.();
  } catch (err) {
    console.error('[VibePanel] rerun failed:', err);
  }
};
```

And add `onRerunRun={handleRerunRun}` to both VibeRunHistory usages.

**Step 5: Verify build**
```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error" | head -20
```

**Step 6: Commit**
```bash
git add frontend/src/components/vibe/VibeRunHistory.jsx frontend/src/components/VibeResearcherPanel.jsx frontend/src/index.css
git commit -m "feat(ux): add result snippet display and re-run button to run history"
```

---

## Task 13: Frontend — QuickBashModal component

**Files:**
- Create: `frontend/src/components/vibe/QuickBashModal.jsx`

**Step 1: Create the component**

```jsx
// frontend/src/components/vibe/QuickBashModal.jsx
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function QuickBashModal({ apiUrl, headers, projectId, serverId, onClose }) {
  const [cmd, setCmd] = useState('');
  const [runId, setRunId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const logRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // SSE subscription when running
  useEffect(() => {
    if (!runId || status !== 'running') return;
    const url = `${apiUrl}/researchops/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.eventType === 'LOG_LINE' && data.message) {
          setLogs((prev) => [...prev.slice(-300), data.message]);
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(data.payload?.status)) {
          const isSuccess = data.payload.status === 'SUCCEEDED';
          setStatus(isSuccess ? 'done' : 'error');
          setErrorMsg(isSuccess ? '' : `Run ${data.payload.status}`);
          es.close();
        }
      } catch (_) {}
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [runId, status, apiUrl]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    setStatus('running');
    setLogs([]);
    setErrorMsg('');
    try {
      const res = await axios.post(`${apiUrl}/researchops/runs/enqueue-v2`, {
        projectId,
        serverId: serverId || 'local-default',
        runType: 'QUICK_BASH',
        workflow: [{ id: 'bash', type: 'bash.run', inputs: { cmd: cmd.trim() } }],
        metadata: { prompt: cmd.trim() },
      }, { headers });
      const id = res.data?.data?.run?.id || res.data?.run?.id;
      if (!id) throw new Error('No run ID returned');
      setRunId(id);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error?.message || err.message || 'Failed to enqueue');
    }
  };

  return (
    <div className="vibe-modal-backdrop" onClick={onClose}>
      <div className="vibe-modal vibe-quick-bash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vibe-modal-head">
          <h3>Quick Bash</h3>
          <button type="button" className="vibe-modal-close" onClick={onClose}>×</button>
        </div>

        {status === 'idle' && (
          <form onSubmit={handleSubmit} className="vibe-quick-bash-form">
            <input
              type="text"
              className="vibe-input"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="e.g. python3 scripts/run_baseline.py"
              autoFocus
            />
            <button type="submit" className="vibe-primary-btn" disabled={!cmd.trim()}>
              Run
            </button>
          </form>
        )}

        {(status === 'running' || status === 'done' || status === 'error') && (
          <div className="vibe-quick-bash-output">
            <pre ref={logRef} className="vibe-live-log-pre">
              {logs.join('') || 'Waiting for output…'}
            </pre>
            {status === 'running' && <p className="vibe-card-note">Running…</p>}
            {status === 'done' && <p className="vibe-card-note is-ok">Completed successfully.</p>}
            {status === 'error' && <p className="vibe-card-error">{errorMsg}</p>}
            <div className="vibe-quick-bash-actions">
              {(status === 'done' || status === 'error') && (
                <button type="button" className="vibe-secondary-btn" onClick={() => {
                  setStatus('idle'); setLogs([]); setRunId(null); setErrorMsg('');
                }}>
                  New Command
                </button>
              )}
              <button type="button" className="vibe-secondary-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default QuickBashModal;
```

**Step 2: Add CSS**
```css
.vibe-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vibe-modal {
  background: var(--color-bg, #161b22);
  border: 1px solid var(--color-border, #30363d);
  border-radius: 8px;
  padding: 1.5rem;
  min-width: 480px;
  max-width: 640px;
  width: 100%;
}

.vibe-modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.vibe-modal-close {
  background: none;
  border: none;
  color: var(--color-text-muted, #8b949e);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0 4px;
}

.vibe-quick-bash-form {
  display: flex;
  gap: 0.5rem;
}

.vibe-quick-bash-output { display: flex; flex-direction: column; gap: 0.5rem; }
.vibe-quick-bash-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
```

**Step 3: Verify component file loads (syntax check)**
```bash
node -e "
const babel = require('@babel/parser');
const fs = require('fs');
const code = fs.readFileSync('./frontend/src/components/vibe/QuickBashModal.jsx', 'utf8');
babel.parse(code, { sourceType: 'module', plugins: ['jsx'] });
console.log('OK');
" 2>/dev/null || cd frontend && node -e "console.log('syntax check via build')" && npm run build 2>&1 | head -20
```

**Step 4: Commit**
```bash
git add frontend/src/components/vibe/QuickBashModal.jsx frontend/src/index.css
git commit -m "feat(ux): add QuickBashModal component"
```

---

## Task 14: Wire QuickBashModal into VibePlanEditor toolbar

**Files:**
- Modify: `frontend/src/components/vibe/VibePlanEditor.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx` (pass props to VibePlanEditor)

**Step 1: Add `onQuickBash` prop to VibePlanEditor**

Update function signature:
```javascript
function VibePlanEditor({
  plan,
  validation,
  mode,
  viewMode,
  queueState,
  onModeChange,
  onViewModeChange,
  onApplyDsl,
  onValidateDsl,
  onRunAll,
  onPause,
  onResume,
  onAbort,
  runScope,
  onRunScopeChange,
  onQuickBash,   // ← ADD
}) {
```

**Step 2: Add "Quick Bash" button to the toolbar**

In the existing toolbar row (near the `Plan Mode` chip group), add a button:
```jsx
<div className="vibe-plan-editor-group">
  <button
    type="button"
    className="vibe-secondary-btn"
    onClick={onQuickBash}
    title="Run a one-off bash command on the current project server"
  >
    Quick Bash
  </button>
</div>
```

**Step 3: In VibeResearcherPanel, import QuickBashModal and add state**

```javascript
import QuickBashModal from './vibe/QuickBashModal';
```

Add state:
```javascript
const [showQuickBash, setShowQuickBash] = useState(false);
```

Pass to VibePlanEditor (find where it's rendered):
```jsx
<VibePlanEditor
  ...existing props...
  onQuickBash={() => setShowQuickBash(true)}
/>
```

Render the modal:
```jsx
{showQuickBash && (
  <QuickBashModal
    apiUrl={apiUrl}
    headers={headers}
    projectId={selectedProjectId}
    serverId={selectedProject?.serverId || 'local-default'}
    onClose={() => setShowQuickBash(false)}
  />
)}
```

**Step 4: Full build**
```bash
cd frontend && npm run build 2>&1 | grep -E "^(error|Error|✓|✗)" | head -20
```
Expected: build succeeds with no errors.

**Step 5: Commit**
```bash
git add frontend/src/components/vibe/VibePlanEditor.jsx frontend/src/components/VibeResearcherPanel.jsx
git commit -m "feat(ux): wire QuickBashModal into VibePlanEditor toolbar"
```

---

## Task 15: Archive monolith + verification + deploy

**Step 1: Request manual approval to archive the monolith**

Per CLAUDE.md top-priority rule, list the target:
- `backend/src/routes/researchops.js` — the original 7600-line monolith, now replaced by the domain module files

**Only after receiving explicit manual approval:**
```bash
git mv backend/src/routes/researchops.js backend/src/routes/researchops.js.archived
git add backend/src/routes/researchops.js.archived
git commit -m "chore(api): archive monolithic researchops.js (replaced by domain modules)"
```

**Step 2: Full backend verification**
```bash
cd backend
node -e "require('./src/routes/researchops/index'); console.log('All routes OK')"
node -e "require('./src/routes/index'); console.log('API router OK')"
```

**Step 3: Full frontend build**
```bash
cd frontend && npm run build
```
Expected: Build succeeds.

**Step 4: Deploy backend**
Use `deploy-backend` skill.

**Step 5: Deploy frontend**
Use `deploy-frontend` skill.

**Step 6: Smoke tests on production**
```bash
# Health check
curl -s https://your-domain.example.com/api/researchops/health | jq .

# OpenAPI spec
curl -s https://your-domain.example.com/api/researchops/openapi | jq '.info.title'

# List projects (requires auth token from .env)
curl -s -H "X-Auth-Token: $ADMIN_TOKEN" https://your-domain.example.com/api/researchops/projects | jq '.data.items | length'
```
Expected:
- Health: `{"ok":true,"data":{"status":"ok"},...}`
- OpenAPI title: `"Auto Researcher ResearchOps API"`
- Projects: integer

**Final commit (if any post-deploy fixes)**
```bash
git add .
git commit -m "chore: post-deploy fixups"
```

---

## Summary of changes

| Area | Files Changed | Key Changes |
|------|--------------|-------------|
| Backend middleware | `middleware/res-helpers.js` | New: `res.ok()`, `res.fail()` |
| Backend routes | `routes/researchops/*.js` | Monolith split into 6 domain files |
| BUG-3 fix | `routes/researchops/runs.js` | Immediate dispatch after enqueue |
| BUG-4 fix | `routes/researchops/runs.js` | Backend proxy for S3 artifacts |
| BUG-2 fix | `modules/agent-run.module.js` | Skip local stat for SSH cwd |
| OpenAPI | `openapi.yaml` | New spec, served at `/api/researchops/openapi` |
| Frontend UX | `VibeNodeWorkbench.jsx` | Live SSE log tail |
| Frontend UX | `VibeRunHistory.jsx` | Result snippets + re-run button |
| Frontend UX | `QuickBashModal.jsx` + `VibePlanEditor.jsx` | Quick bash runner modal |
