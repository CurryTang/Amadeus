# Research Agent Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the current `researchops` implementation with the confirmed environment spec by shipping the first compatible vertical slices without breaking existing tree/run/session workflows.

**Architecture:** Build on the existing `TreeNode + TreeState + Run + AgentSession + ObservedSession + RunReport` system. Introduce only thin semantic adapters and response normalizers where needed, keep current `/projects/:projectId/tree/*` and `/runs/*` routes stable, and validate each slice with targeted tests instead of a speculative full rewrite.

**Tech Stack:** Node.js, Express, frontend React/Next components, filesystem-backed tree plan/state, Mongo-backed run/session stores, Node test runner.

---

### Task 1: Freeze the first implementation slice and add targeted backend contract tests

**Files:**
- Modify: `backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`
- Modify: `backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js`
- Modify: `backend/src/services/researchops/__tests__/run-report-view.test.js`
- Create: `backend/src/services/researchops/__tests__/run-report-payload.service.test.js`

**Step 1: Write failing tests for the current-vs-target rules**

Cover:
- `run-step` responses continue to link runs back to tree nodes
- `RunReport` remains the primary evidence surface
- no route starts returning bundle-first review structures

**Step 2: Run the targeted backend tests to verify failure**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/routes/researchops/__tests__/projects.jumpstart.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js
```

Expected: at least one failing assertion for the new contract test.

**Step 3: Implement minimal backend response fixes needed to satisfy the tests**

Likely touch:
- `backend/src/routes/researchops/projects.js`
- `backend/src/routes/researchops/runs.js`
- `backend/src/services/researchops/run-report-view.js`

**Step 4: Re-run the same targeted tests**

Expected: all pass.

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/__tests__/projects.jumpstart.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js \
  backend/src/routes/researchops/projects.js \
  backend/src/routes/researchops/runs.js \
  backend/src/services/researchops/run-report-view.js
git commit -m "feat: lock run-centered researchops contracts"
```

### Task 2: Add a thin semantic adapter for `Attempt ≈ Run`

**Files:**
- Create: `backend/src/services/researchops/attempt-view.service.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/routes/researchops/runs.js`
- Test: `backend/src/services/researchops/__tests__/attempt-view.service.test.js`

**Step 1: Write the failing test**

Cover:
- semantic adapter maps `Run` to an `Attempt`-like read model
- adapter preserves existing `runId`, `treeNodeId`, status, provider, timestamps
- adapter does not invent bundle or session-attach requirements

**Step 2: Run the test to verify failure**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test backend/src/services/researchops/__tests__/attempt-view.service.test.js
```

Expected: fail because adapter does not exist yet.

**Step 3: Implement minimal adapter**

Export helpers such as:
- `buildAttemptViewFromRun`
- `buildNodeAttemptSummary`

Use the adapter only for response shaping and UI-facing summaries.

**Step 4: Wire the adapter into one backend entry point at a time**

Start with:
- run detail payload
- tree node run summaries if present

**Step 5: Re-run tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test backend/src/services/researchops/__tests__/attempt-view.service.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js
```

Expected: pass.

### Task 3: Normalize `RunReport + deliverable artifacts` as the review/evidence path

**Files:**
- Modify: `backend/src/services/researchops/run-report-view.js`
- Create: `backend/src/services/researchops/run-report-payload.service.js`
- Modify: `backend/src/routes/researchops/runs.js`
- Modify: `frontend/src/components/vibe/runDetailView.js`
- Test: `backend/src/services/researchops/__tests__/run-report-view.test.js`
- Test: `backend/src/services/researchops/__tests__/run-report-payload.service.test.js`
- Test: `frontend/src/components/vibe/runDetailView.test.mjs`

**Step 1: Write failing tests around report highlights and artifact classification**

Cover:
- report highlights identify summary and deliverable artifacts
- frontend state can render report-first evidence without bundle metadata

**Step 2: Run targeted tests to verify failure**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js
node frontend/src/components/vibe/runDetailView.test.mjs
```

**Step 3: Implement minimal report normalization**

Make the returned shape clearly expose:
- report summary
- highlight artifacts
- deliverable artifact ids or cards
- contract warnings

**Step 4: Update the frontend consumption path**

Use the normalized report shape in the run detail consumption path first.

**Step 5: Re-run tests**

Expected: pass.

### Task 4: Stabilize `AgentSession` / `ObservedSession` linkage without introducing attach semantics

**Files:**
- Modify: `backend/src/services/researchops/observed-session.service.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `frontend/src/components/vibe/observedSessionPresentation.js`
- Test: `backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
- Test: `backend/src/services/researchops/__tests__/observed-session.materialization.test.js`
- Test: `frontend/src/components/vibe/observedSessionPresentation.test.mjs`

**Step 1: Write failing tests for current linkage rules**

Cover:
- observed sessions remain project-scoped
- materialized observed-agent nodes expose stable node/session linkage
- frontend labels detached vs linked sessions correctly

**Step 2: Run targeted tests to verify failure**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js \
  backend/src/services/researchops/__tests__/observed-session.materialization.test.js
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
```

**Step 3: Implement minimal fixes**

Keep linkage weak:
- no hard attach protocol
- preserve project scoping
- expose enough metadata for workbench and strips

**Step 4: Re-run tests**

Expected: pass.

### Task 5: Tighten the tree-centered frontend workbench around the current flows

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Modify: `frontend/src/components/vibe/VibeRecentRunsStrip.jsx`
- Modify: `frontend/src/components/vibe/VibeObservedSessionsStrip.jsx`
- Test: `frontend/src/components/vibe/runDetailView.test.mjs`
- Test: `frontend/src/components/vibe/observedSessionPresentation.test.mjs`

**Step 1: Write failing UI-state tests**

Cover:
- selected node remains the center of workbench actions
- recent runs and observed sessions are presented as node-adjacent evidence strips
- run detail reads normalized report data

**Step 2: Run targeted frontend tests to verify failure**

Run:
```bash
node frontend/src/components/vibe/runDetailView.test.mjs
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
```

**Step 3: Implement minimal frontend wiring**

Do not redesign the whole panel.  
Only tighten:
- selected node context
- run report rendering
- observed session rendering
- strip/workbench coordination

**Step 4: Re-run targeted tests**

Expected: pass.

### Task 6: End-to-end slice verification

**Files:**
- Modify: `docs/research_agent_env_spec/08-parallel-implementation-plan.md`
- Create: `docs/plans/2026-03-06-research-agent-env-implementation-checklist.md`

**Step 1: Add a verification checklist**

Document the exact smoke flow:
- select node
- launch run-step
- inspect run report
- inspect observed session
- promote search trial

**Step 2: Run the full targeted verification batch**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/routes/researchops/__tests__/projects.jumpstart.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js \
  backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js \
  backend/src/services/researchops/__tests__/attempt-view.service.test.js \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/observed-session.materialization.test.js
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
node frontend/src/components/vibe/runDetailView.test.mjs
```

**Step 3: Record results in the checklist file**

Include:
- pass/fail
- known gaps
- follow-up slices

**Step 4: Commit**

```bash
git add docs/research_agent_env_spec/08-parallel-implementation-plan.md \
  docs/plans/2026-03-06-research-agent-env-implementation-checklist.md
git commit -m "docs: capture researchops implementation verification"
```

## Parallel Execution Lanes

These lanes are independent enough to investigate in parallel, then integrate centrally:

1. Backend run/report contracts
2. Attempt-view adapter
3. Observed session linkage
4. Frontend workbench consumption

Integration order:

1. Lane 1
2. Lanes 2 and 3 in parallel
3. Lane 4 after the backend shapes stabilize

## Known Constraints

- Do not rewrite current `/projects/:projectId/tree/*` or `/runs/*` into future APIs.
- Do not introduce `DeliverableBundle` as a required runtime object.
- Do not add a hard session attach protocol in v1.
- Preserve existing observed-session materialization behavior unless tests prove it is wrong.
- Prefer targeted Node test runs over speculative full-suite runs.

## Verification Notes

- This repository currently lacks a clean root-level test command.
- Use targeted `node --test` commands for backend tests.
- In the isolated worktree, backend tests can reuse the already-installed dependencies with `NODE_PATH=/Users/czk/auto-researcher/backend/node_modules`.
- Use direct `node <test-file>` execution for existing frontend `.test.mjs` files where applicable.

## Execution Choice

Plan complete and saved to `docs/plans/2026-03-06-research-agent-env-implementation.md`.

Two execution options:

1. Subagent-Driven (this session) - dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - open new session with executing-plans, batch execution with checkpoints
