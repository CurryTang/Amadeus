# Vibe Research V2 Implementation Plan

Date: 2026-02-23  
Status: Implemented (phases 0-4)

## Objectives

1. Support human-in-the-loop autonomous research with reproducible, object-based runs.
2. Keep `skills/` as first-class runtime dependencies and make skill usage explicit per run.
3. Provide dual outputs for agents and humans: machine-readable logs/metadata and human-readable deliverables.
4. Add a fast Knowledge Hub window to capture and manage advanced insights from model interactions (for example Claude Opus 4.6 and GPT-5 Pro) and files, then feed them into coding-agent runs.
5. Preserve current DO control plane + FRP local heavy executor architecture.

## Current Baseline (already in repo)

1. Run lifecycle and queue in ResearchOps exist (`backend/src/services/researchops/store.js`, `backend/src/routes/researchops.js`).
2. Skills local+remote catalog flow exists (`docs/skill-object-schema.md`).
3. Knowledge groups exist but currently bind only document rows (`knowledge_group_documents`).
4. Vibe Knowledge Space modal exists but is document-centric, not insight/file-centric.
5. FRP offload flow exists and should remain the default heavy path (`docs/DO_FRP_TAILSCALE.md`).

## Architecture Decisions

1. Keep control-plane responsibilities on DO.
2. Keep heavy run execution and context assembly on local executor via FRP.
3. Keep run orchestration metadata in MongoDB (`researchops_*` domain).
4. Keep knowledge content inventory in sqlite + object storage for file/blob content.
5. Introduce a typed module runtime for runs, while keeping legacy command mode as fallback.
6. Use additive schema migration only; no destructive migrations in v2.

## V2 Object Contracts

### 1) RunSpec (new canonical run payload)

```json
{
  "schemaVersion": "2.0",
  "projectId": "proj_x",
  "serverId": "local-default",
  "mode": "headless",
  "runType": "AGENT",
  "provider": "codex_cli",
  "skillRefs": [
    { "id": "skill_frp-heavy-offload", "version": "d41d8cd98f00", "required": true }
  ],
  "contextRefs": {
    "knowledgeGroupIds": [12, 18],
    "knowledgeAssetIds": [204, 219],
    "insightAssetIds": [301, 302]
  },
  "workflow": [
    { "id": "plan", "type": "agent.run", "inputs": { "promptTemplate": "planner.md" } },
    { "id": "verify", "type": "bash.run", "inputs": { "cmd": "npm test --silent" } },
    { "id": "report", "type": "report.render", "inputs": { "format": "md+json" } }
  ],
  "outputContract": {
    "summaryRequired": true,
    "requiredArtifacts": ["result_manifest", "run_summary_md"],
    "tables": ["leaderboard"],
    "figures": ["ablation_plot"]
  },
  "budgets": {
    "maxRuntimeMinutes": 90,
    "maxToolCalls": 120,
    "maxCostUsd": 20
  },
  "hitlPolicy": {
    "requiresApprovalOn": ["apply_patch", "db_write", "external_publish"]
  }
}
```

### 2) ModuleResult (output of every workflow step)

```json
{
  "stepId": "verify",
  "moduleType": "bash.run",
  "status": "SUCCEEDED",
  "startedAt": "2026-02-23T12:00:00.000Z",
  "endedAt": "2026-02-23T12:00:06.100Z",
  "metrics": { "exitCode": 0, "durationMs": 6100 },
  "artifacts": [
    { "kind": "log", "path": "logs/verify.log", "mimeType": "text/plain" }
  ],
  "outputs": {
    "stdoutTail": "all tests passed"
  }
}
```

### 3) RunEvent V2 (append-only stream)

```json
{
  "eventType": "STEP_RESULT",
  "status": "SUCCEEDED",
  "sequence": 37,
  "message": "Step verify completed",
  "payload": {
    "runId": "run_x",
    "stepId": "verify",
    "moduleType": "bash.run",
    "artifactCount": 1
  },
  "timestamp": "2026-02-23T12:00:06.100Z"
}
```

New event types to add:
1. `STEP_STARTED`
2. `STEP_LOG`
3. `STEP_RESULT`
4. `ARTIFACT_CREATED`
5. `CHECKPOINT_REQUIRED`
6. `CHECKPOINT_DECIDED`
7. `RUN_SUMMARY`

Legacy events (`RUN_STATUS`, `LOG_LINE`, `RESULT_SUMMARY`) remain valid.

### 4) KnowledgeAsset (new unified knowledge object)

```json
{
  "id": 301,
  "assetType": "insight",
  "title": "Opus insight on retrieval failure mode",
  "summary": "Retriever misses contradictory evidence due to tag bias",
  "bodyMd": "## Observation\n...",
  "source": {
    "provider": "claude_opus_4_6",
    "sessionId": "sess_abc",
    "messageId": "msg_123",
    "capturedAt": "2026-02-23T11:33:00.000Z"
  },
  "file": {
    "objectKey": null,
    "mimeType": "text/markdown",
    "sizeBytes": 4210
  },
  "tags": ["retrieval", "risk", "planner"],
  "metadata": {
    "confidence": "high",
    "author": "czk"
  },
  "createdAt": "2026-02-23T11:33:00.000Z",
  "updatedAt": "2026-02-23T11:33:00.000Z"
}
```

`assetType` enum:
1. `document`
2. `insight`
3. `file`
4. `note`
5. `report`

## Database and Storage Migration

### SQLite migrations (knowledge domain)

Add tables:
1. `knowledge_assets`
2. `knowledge_group_assets`
3. `knowledge_asset_versions`

Suggested DDL:

```sql
CREATE TABLE IF NOT EXISTS knowledge_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'czk',
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT,
  external_document_id INTEGER,
  source_provider TEXT,
  source_session_id TEXT,
  source_message_id TEXT,
  source_url TEXT,
  object_key TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  content_sha256 TEXT,
  tags TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (external_document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_assets_user_updated
ON knowledge_assets(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_assets_type_updated
ON knowledge_assets(user_id, asset_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_group_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES knowledge_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  UNIQUE(group_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_group_assets_group
ON knowledge_group_assets(group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_asset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  body_md TEXT,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, version)
);
```

Migration/backfill:
1. For each row in `documents`, upsert one `knowledge_assets` row with `asset_type='document'` and `external_document_id=documents.id`.
2. For each row in `knowledge_group_documents`, map to `knowledge_group_assets` through the new document asset id.
3. Keep old tables and old API operational until frontend migration is complete.

### MongoDB migrations (run domain)

Add run fields:
1. `schemaVersion`
2. `workflow`
3. `skillRefs`
4. `contextRefs`
5. `outputContract`
6. `budgets`
7. `hitlPolicy`

Add collections:
1. `researchops_run_steps`
2. `researchops_run_artifacts`
3. `researchops_run_checkpoints`

Indexes:
1. `researchops_run_steps`: `{ runId: 1, stepId: 1 }` unique.
2. `researchops_run_artifacts`: `{ runId: 1, createdAt: -1 }`.
3. `researchops_run_checkpoints`: `{ runId: 1, status: 1, createdAt: -1 }`.

### Object storage layout

Use run-scoped prefixes:
1. `runs/<runId>/logs/...`
2. `runs/<runId>/artifacts/...`
3. `runs/<runId>/report/result_manifest.json`
4. `runs/<runId>/context/knowledge-pack.json`
5. `runs/<runId>/context/knowledge-pack.md`

## Backend Implementation Plan

Files to add:
1. `backend/src/services/researchops/orchestrator.js`
2. `backend/src/services/researchops/modules/base-module.js`
3. `backend/src/services/researchops/modules/agent-run.module.js`
4. `backend/src/services/researchops/modules/bash-run.module.js`
5. `backend/src/services/researchops/modules/checkpoint.module.js`
6. `backend/src/services/researchops/modules/report-render.module.js`
7. `backend/src/services/researchops/knowledge-assets.service.js`
8. `backend/src/services/researchops/context-pack.service.js`

Files to update:
1. `backend/src/services/researchops/store.js`
2. `backend/src/services/researchops/runner.js`
3. `backend/src/routes/researchops.js`
4. `backend/src/db/index.js`

New APIs:
1. `POST /api/researchops/runs/enqueue-v2`
2. `GET /api/researchops/runs/:runId/steps`
3. `GET /api/researchops/runs/:runId/artifacts`
4. `GET /api/researchops/runs/:runId/report`
5. `POST /api/researchops/runs/:runId/checkpoints/:checkpointId/decision`
6. `GET /api/researchops/knowledge/assets`
7. `POST /api/researchops/knowledge/assets`
8. `PATCH /api/researchops/knowledge/assets/:assetId`
9. `DELETE /api/researchops/knowledge/assets/:assetId`
10. `GET /api/researchops/knowledge/groups/:groupId/assets`
11. `POST /api/researchops/knowledge/groups/:groupId/assets`
12. `DELETE /api/researchops/knowledge/groups/:groupId/assets/:assetId`

Compatibility:
1. Keep current `POST /runs/enqueue` path.
2. If `schemaVersion` missing, execute legacy runner path.
3. If `schemaVersion='2.0'`, execute orchestrator path.

## Frontend Implementation Plan

Files to add:
1. `frontend/src/components/VibeKnowledgeHubModal.jsx`
2. `frontend/src/components/KnowledgeAssetCard.jsx`
3. `frontend/src/models/KnowledgeAsset.js`

Files to update:
1. `frontend/src/components/VibeResearcherPanel.jsx`
2. `frontend/src/App.jsx`
3. `frontend/src/styles/*` (new styles for Knowledge Hub)

Knowledge Hub window behavior:
1. Open from Vibe workspace action as `Knowledge Hub`.
2. Show fast filters for asset type, provider, and linked status.
3. Allow quick capture by paste (`markdown`) and upload (`md`, `txt`, `json`, `png`, `csv`, `pdf`).
4. Collect source metadata (`provider`, `session`, `message URL`) during capture.
5. Support one-click operations for link/unlink to group, pin/unpin to next run, and preview.
6. Include selected assets automatically in `run.contextRefs`.

## Knowledge Flow for Advanced Model Insights

Capture flow:
1. User pastes a high-value insight from Claude Opus 4.6 or GPT-5 Pro into Knowledge Hub.
2. Backend stores as `knowledge_assets.asset_type='insight'`.
3. Optional attachments are uploaded to object storage and linked by `object_key`.
4. Insight is linked to one or more knowledge groups.
5. During run enqueue, selected insights are added to `contextRefs.insightAssetIds`.
6. Context pack builder renders `knowledge-pack.json` and `knowledge-pack.md`.
7. Agent modules receive pack paths via inputs and environment variables.

Context pack minimum shape:

```json
{
  "projectId": "proj_x",
  "runId": "run_x",
  "generatedAt": "2026-02-23T12:10:00.000Z",
  "groups": [{ "id": 12, "name": "retrieval-failures" }],
  "assets": [
    {
      "id": 301,
      "assetType": "insight",
      "title": "Opus insight on retrieval failure mode",
      "summary": "Retriever misses contradictory evidence due to tag bias",
      "sourceProvider": "claude_opus_4_6",
      "bodyMd": "..."
    }
  ]
}
```

## Module Runtime Details

Module interface:
1. `validate(step, context)`
2. `run(step, context)`
3. Return `ModuleResult`

Built-in module types for v2:
1. `agent.run`
2. `bash.run`
3. `checkpoint.hitl`
4. `report.render`
5. `artifact.publish`

### Shared-Filesystem Cross-Server Bash

When multiple servers mount the same project filesystem, `bash.run` may execute on a different configured SSH server:

1. Per-step: `workflow[i].inputs.execServerId`
2. Run default: `metadata.bashExecServerId`
3. Local default if unset.

Resolution rules:

1. `execServerId` can be SSH server `id` or `name`.
2. `local`, `local-default`, `self`, or empty means local execution.
3. If remote target is selected and missing, run fails with explicit error.

Runtime env variables and context-pack paths are exported on remote execution too.

Headless requirement:
1. `mode=headless` runs must emit `result_manifest.json`.
2. Run status may move to `SUCCEEDED` only after manifest validation passes.

## Human Deliverables and Logging

Deliverables generated per run:
1. `run_summary.md`
2. `result_manifest.json`
3. `tables/*.csv`
4. `figures/*.png`
5. `metrics/*.json`
6. Optional sink links (`wandb`, `tensorboard`)

Agent-readable outputs:
1. Step-wise JSON events.
2. Context pack JSON.
3. Machine artifact manifest.

Human-readable outputs:
1. Run report page in UI.
2. Rendered markdown summary.
3. Table preview and figure gallery.
4. Source trace links back to step and knowledge asset.

## Observability Integrations

Run-level metadata:
1. `observability.sinks = ["wandb", "tensorboard"]`
2. `observability.project = "vibe-research"`
3. `observability.runName = "proj_x_run_20260223_1210"`

Adapters:
1. W&B adapter writes scalar/table/media and stores run URL.
2. TensorBoard adapter writes event files under run artifact path.
3. Adapter failures should not fail the run unless `observability.strict=true`.

## Rollout Plan

Phase 0: contracts and migrations
1. Add schemas and migrations.
2. Add new store methods and APIs for knowledge assets.
3. Keep all old endpoints unchanged.
4. Acceptance: existing UI flows still work.

Phase 1: Knowledge Hub window
1. Implement quick capture UI.
2. Implement link/unlink/pin behaviors.
3. Implement provider/session metadata fields.
4. Acceptance: user can capture Opus/GPT insights and attach to project in less than 30 seconds.

Phase 2: v2 orchestrator and modules
1. Add orchestrator.
2. Add module registry and core modules.
3. Wire v2 enqueue path.
4. Acceptance: one v2 run executes multi-step workflow and writes `result_manifest.json`.

Phase 3: HITL + report page
1. Add checkpoint decision APIs.
2. Add run report UI with tables and figures.
3. Acceptance: run pauses for approval and resumes deterministically.

Phase 4: observability sinks
1. Add W&B and TensorBoard adapters.
2. Surface sink links in report page.
3. Acceptance: sink links open from UI and metrics match manifest.

## Risks and Mitigations

1. Cross-store consistency between sqlite knowledge assets and Mongo runs.
2. Mitigation: reference by numeric `assetId` only and rebuild context packs at execution time.
3. Existing knowledge-group APIs are document-only.
4. Mitigation: keep old APIs and add new group-assets APIs side by side.
5. Large pasted insights/files can bloat prompts.
6. Mitigation: context pack builder enforces size budget and truncation policy with explicit warnings.
7. Offload mismatch between DO and local executor versions.
8. Mitigation: keep DO lightweight and verify FRP health after each deploy.

## Immediate Next PR Scope

1. Add sqlite tables for `knowledge_assets` and `knowledge_group_assets`.
2. Add `knowledge-assets.service.js` with CRUD and group linking.
3. Add APIs under `/api/researchops/knowledge/*`.
4. Add `VibeKnowledgeHubModal` with quick markdown capture, file upload, provider/session metadata, and group link/unlink actions.
5. Add pin-to-next-run behavior in the Knowledge Hub.
6. Extend run enqueue payload to include `contextRefs`.
