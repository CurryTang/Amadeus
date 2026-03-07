# Research Agent Environment Implementation Checklist

## Smoke Flow

1. Select a tree node.
2. Launch `run-step`.
3. Inspect the resulting run report.
4. Inspect observed-session linkage and detached node labels.
5. Promote a search trial if available.

## Verification Batch

### Backend

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/routes/researchops/__tests__/projects.jumpstart.test.js \
  backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js \
  backend/src/services/researchops/__tests__/attempt-view.service.test.js \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js \
  backend/src/services/researchops/__tests__/observed-session.materialization.test.js \
  backend/src/services/researchops/__tests__/enqueue-run-payload.service.test.js \
  backend/src/services/researchops/__tests__/daemon-payload.service.test.js \
  backend/src/services/researchops/__tests__/client-daemon.service.test.js
```

### Frontend

```bash
node frontend/src/components/vibe/agentSessionApiResponse.test.mjs
node frontend/src/components/vibe/agentSessionMessageApiResponse.test.mjs
node frontend/src/components/vibe/agentSessionPresentation.test.mjs
node frontend/src/components/vibe/agentSessionContextPresentation.test.mjs
node frontend/src/components/vibe/contextPackApiResponse.test.mjs
node frontend/src/components/vibe/contextPackPresentation.test.mjs
node frontend/src/components/vibe/runDetailView.test.mjs
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
```

## Results

- Status: passed
- Notes:
  - Backend verification passed: 37 tests, 0 failures
  - Frontend verification passed: 20 tests, 0 failures
  - `Recent Runs` now defaults to node scope when matching runs exist and falls back to project scope otherwise
  - `RunReport` now exposes attempt-shaped read data plus deliverable artifact highlights
  - `RunReport` now also exposes thin `workspaceSnapshot`, `envSnapshot`, and `followUp` views for current review/detail flows
  - Observed sessions now surface detached node titles without adding hard attach semantics
  - Interactive agent sessions now use normalized session/detail/message payloads and show active run context
  - Run detail now exposes normalized execution contract data (`location`, `mode`, `backend`, `runtimeClass`, `resources`)
  - Run detail and run-tree payloads now surface continuation / related-run semantics without introducing a new bundle or review workflow
  - Tree node bridge context now has a thin current-architecture payload for local bridge clients (`node`, `nodeState`, `blocking`, `lastRun`, optional `contextPack`)
  - Bridge clients can now read a compact `bridge-report` view and submit thin `workspaceSnapshot` / `localSnapshot` hints through existing enqueue APIs
  - Bridge clients can now submit markdown run notes through existing artifact storage via `bridge-note`
  - Tree `run-step` now accepts bridge snapshot hints too, so snapshot-backed runs can stay on the normal tree execution path
  - Public run enqueue APIs now accept thin execution hints and normalize them into `metadata.jobSpec`
  - Daemon bridge and cluster resource pool now expose normalized execution-facing payloads while keeping legacy top-level compatibility
