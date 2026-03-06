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
  backend/src/services/researchops/__tests__/observed-session.materialization.test.js
```

### Frontend

```bash
node frontend/src/components/vibe/runPresentation.test.mjs
node frontend/src/components/vibe/runDetailView.test.mjs
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
node frontend/src/components/vibe/treeExecutionSummary.test.mjs
```

## Results

- Status: passed
- Notes:
  - Backend verification passed: 26 tests, 0 failures
  - Frontend verification passed: 13 tests, 0 failures
  - `Recent Runs` now defaults to node scope when matching runs exist and falls back to project scope otherwise
  - `RunReport` now exposes attempt-shaped read data plus deliverable artifact highlights
  - Observed sessions now surface detached node titles without adding hard attach semantics
