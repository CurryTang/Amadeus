# Vibe Runner Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a secondary horizontal recent-run strip, run detail modal, continuation context flow, synchronized tree/run metadata, and a simpler execution-readable tree surface.

**Architecture:** Keep the existing launcher, run history, tree plan, and run report architecture, but introduce a shared run-presentation layer keyed by richer run metadata. Frontend behavior should be driven by pure helper modules where possible, while backend changes standardize run-origin metadata and remote run-workspace/report fields.

**Tech Stack:** React, Next.js, Axios, node:test, Express, existing ResearchOps run/tree services

---

### Task 1: Add pure helpers for runner cards, continuation chips, and tree status summaries

**Files:**
- Create: `frontend/src/components/vibe/runPresentation.js`
- Create: `frontend/src/components/vibe/runPresentation.test.mjs`

**Step 1: Write the failing test**

Add tests for:

- recent runs sort newest-first
- source labels resolve from metadata (`tree`, `todo`, `launcher`, `custom`)
- continuation chip text resolves from a run title/prompt
- tree execution summary derives `running`, `needsReview`, `done`, and `failed`

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/runPresentation.test.mjs`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Implement pure exports:

- `buildRecentRunCards(runs)`
- `buildContinuationChip(run)`
- `buildTreeExecutionSummary(plan, treeState)`
- `getRunSourceLabel(run)`

Keep logic data-only and free of React dependencies.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/runPresentation.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 2: Add pure helpers for run detail modal sections

**Files:**
- Create: `frontend/src/components/vibe/runDetailView.js`
- Create: `frontend/src/components/vibe/runDetailView.test.mjs`

**Step 1: Write the failing test**

Add tests that assert:

- modal context section includes source, linked node, linked todo, parent run, server, and workspace path
- prompt section prefers prompt text, then experiment command
- output section surfaces summary text, final output artifact, figures/tables, and error state

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/runDetailView.test.mjs`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Add pure helpers:

- `buildRunDetailContext(run, runReport)`
- `buildRunDetailPrompt(run)`
- `buildRunDetailOutput(run, runReport)`

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/runDetailView.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 3: Add backend tests for run-origin metadata and run-workspace report fields

**Files:**
- Create: `backend/src/services/researchops/__tests__/store.run-metadata.test.js`
- Create: `backend/src/routes/researchops/__tests__/runs.report-workspace.test.js`
- Modify: `backend/src/services/researchops/store.js`
- Modify: `backend/src/routes/researchops/runs.js`

**Step 1: Write the failing tests**

Add store tests that assert:

- enqueue persists `metadata.sourceType`, `treeNodeId`, `todoId`, `parentRunId`, and `runWorkspacePath`
- metadata patching preserves those fields

Add route tests that assert:

- run report includes `runWorkspacePath`
- run report surfaces summary/final-output artifact ids when present

**Step 2: Run tests to verify they fail**

Run: `node --test backend/src/services/researchops/__tests__/store.run-metadata.test.js backend/src/routes/researchops/__tests__/runs.report-workspace.test.js`
Expected: FAIL because the tests reference fields not yet normalized or exposed.

**Step 3: Write minimal implementation**

Update store and route shaping so:

- run metadata fields are preserved without ad hoc stripping
- run reports include explicit workspace/output references needed by the frontend modal

**Step 4: Run tests to verify they pass**

Run: `node --test backend/src/services/researchops/__tests__/store.run-metadata.test.js backend/src/routes/researchops/__tests__/runs.report-workspace.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 4: Standardize orchestrator run workspace output and artifact naming

**Files:**
- Create: `backend/src/services/researchops/__tests__/orchestrator.run-workspace.test.js`
- Modify: `backend/src/services/researchops/orchestrator.js`

**Step 1: Write the failing test**

Add tests that assert:

- a run workspace path is created and attached to run metadata
- core files are written for every run: `context.json`, `context.md`, `run-spec.json`
- implementation and experiment runs expose stable summary/final-output artifact references

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/orchestrator.run-workspace.test.js`
Expected: FAIL because the current orchestrator does not expose the richer output contract yet.

**Step 3: Write minimal implementation**

Update the orchestrator to:

- persist `runWorkspacePath`
- standardize artifact naming for summary and final output
- keep current behavior for existing artifact publication while adding the new explicit references

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/orchestrator.run-workspace.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 5: Add the horizontal runner strip and run detail modal

**Files:**
- Create: `frontend/src/components/vibe/VibeRecentRunsStrip.jsx`
- Create: `frontend/src/components/vibe/VibeRunDetailModal.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/components/vibe/VibeRunHistory.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Extend the pure helper tests from Tasks 1 and 2 to lock the intended card ordering and modal view-model shape before wiring the React components.

**Step 2: Run tests to verify they fail or stay red for missing integration assumptions**

Run: `node --test frontend/src/components/vibe/runPresentation.test.mjs frontend/src/components/vibe/runDetailView.test.mjs`
Expected: PASS on helpers after prior tasks; use them as guardrails before wiring UI.

**Step 3: Write minimal implementation**

Update the panel to:

- render a horizontal recent-run strip below the launcher
- open a run detail modal when a card is clicked
- keep modal selection synchronized with `selectedRunId`
- preserve the existing lower-right run history/report surfaces

Keep `VibeRunHistory` as the archive-style list and do not duplicate modal logic there.

**Step 4: Run targeted verification**

Run: `node --test frontend/src/components/vibe/runPresentation.test.mjs frontend/src/components/vibe/runDetailView.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 6: Add the continue-from-run launcher context flow

**Files:**
- Create: `frontend/src/components/vibe/launcherContinuation.js`
- Create: `frontend/src/components/vibe/launcherContinuation.test.mjs`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `backend/src/routes/researchops/runs.js`

**Step 1: Write the failing test**

Add tests that assert:

- clicking continue creates one visible continuation chip
- launch payload includes the prior run id as a context ref
- the launcher prompt body is not polluted with copied output text

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/launcherContinuation.test.mjs`
Expected: FAIL because continuation helpers and payload shaping do not exist yet.

**Step 3: Write minimal implementation**

Add frontend state/helpers for continuation chips and update launcher submission so the selected prior run id is included in `contextRefs`. If the backend needs explicit report/context-pack support for continuation display, add the minimal shaping in `runs.js`.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/launcherContinuation.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 7: Synchronize tree execution status with linked runs and simplify the default tree summary

**Files:**
- Create: `frontend/src/components/vibe/treeExecutionSummary.test.mjs`
- Modify: `frontend/src/components/vibe/VibeTreeCanvas.jsx`
- Modify: `frontend/src/components/vibe/VibePlanEditor.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Add tests that assert:

- tree summary buckets expose execution-readable counts
- primary node action labels map from node/run state to `Start`, `Resume`, `Approve`, or `View Run`

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: FAIL because the helper/module does not exist yet.

**Step 3: Write minimal implementation**

Update the tree surfaces so:

- toolbar summaries use execution-readable labels
- node cards surface a primary action based on state
- selected node execution remains compatible with existing handlers

Do not replace the canvas entirely in this iteration; improve status readability first.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 8: Wire tree/todo/custom run origins into shared metadata and strip presentation

**Files:**
- Create: `backend/src/routes/researchops/__tests__/projects.run-origin.test.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing test**

Add route tests that assert:

- tree node execution stamps `sourceType: "tree"` and node linkage fields
- todo-triggered execution stamps `sourceType: "todo"` when applicable
- launcher/custom execution paths stamp `sourceType: "launcher"` or `sourceType: "custom"`

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.run-origin.test.js`
Expected: FAIL because origin metadata is not consistently assigned today.

**Step 3: Write minimal implementation**

Update the relevant enqueue paths so all execution entry points stamp consistent run-origin metadata. Then ensure the strip and modal consume those fields instead of inferring origin from fragile heuristics.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.run-origin.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 9: Run focused verification across frontend and backend

**Files:**
- No new files required

**Step 1: Run focused frontend tests**

Run: `node --test frontend/src/components/vibe/runPresentation.test.mjs frontend/src/components/vibe/runDetailView.test.mjs frontend/src/components/vibe/launcherContinuation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs frontend/src/components/vibe/launcherRouting.test.mjs frontend/src/components/vibe/vibeUiMode.test.mjs`
Expected: PASS

**Step 2: Run focused backend tests**

Run: `node --test backend/src/services/researchops/__tests__/store.run-metadata.test.js backend/src/services/researchops/__tests__/orchestrator.run-workspace.test.js backend/src/routes/researchops/__tests__/runs.report-workspace.test.js backend/src/routes/researchops/__tests__/projects.run-origin.test.js`
Expected: PASS

**Step 3: Run one manual smoke verification**

Verify in the browser that:

- newest run appears left-most in the recent-run strip
- clicking a run opens the modal
- continue adds a launcher context chip
- a tree-triggered run appears in the strip and stays status-synchronized

**Step 4: Commit**

Do not commit unless explicitly requested by the user.
