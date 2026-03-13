# SSH Document Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new SSH-backed document-plan flow that lets the frontend request `docs/exp.md` generation from a remote agent, stores the resulting document/spec as run artifacts, materializes the generated work into the existing tree dashboard, and keeps later document-step execution synchronized through backend-owned run events.

**Architecture:** Extend the existing `researchops` route, runner, run store, and tree state stack instead of building a second executor. A new document-plan service will build/parse the remote planner contract, route handlers will enqueue and materialize plans, and runner/event parsing will translate structured SSH agent output into run events and tree-node state updates.

**Tech Stack:** Node.js, Express, existing `researchops` run runner/store/tree services, `node --test`

---

### Task 1: Add failing tests for document-plan parsing and tree materialization

**Files:**
- Create: `backend/src/services/researchops/__tests__/document-plan.service.test.js`
- Create: `backend/src/services/researchops/__tests__/document-plan-events.service.test.js`
- Reference: `backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`

**Step 1: Write the failing test**

Cover:

- parsing a valid planner trailer into normalized document-plan metadata
- rejecting missing or malformed planner trailers
- converting normalized generated steps into valid tree nodes/edges
- parsing structured step progress lines into normalized run events

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/document-plan.service.test.js backend/src/services/researchops/__tests__/document-plan-events.service.test.js`

Expected: FAIL because the new services do not exist yet.

**Step 3: Write minimal implementation**

Create:

- `backend/src/services/researchops/document-plan.service.js`
- `backend/src/services/researchops/document-plan-events.service.js`

Implement only the helpers required by the tests:

- planner trailer extraction/parsing
- normalization/validation of generated document-plan output
- tree node/edge materialization from generated steps
- structured progress line parsing

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/document-plan.service.test.js backend/src/services/researchops/__tests__/document-plan-events.service.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/document-plan.service.js backend/src/services/researchops/document-plan-events.service.js backend/src/services/researchops/__tests__/document-plan.service.test.js backend/src/services/researchops/__tests__/document-plan-events.service.test.js
git commit -m "feat: add document plan parsing services"
```

### Task 2: Add failing tests for project document-plan route helpers

**Files:**
- Create: `backend/src/routes/researchops/__tests__/projects.document-plan.test.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Reference: `backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`

**Step 1: Write the failing test**

Cover:

- building a document-plan generation prompt payload from project/instruction input
- materializing generated document-plan output into a tree plan mutation
- refusing to materialize invalid planner output

Prefer exported pure helpers from `projects.js` for testability.

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan.test.js`

Expected: FAIL because the helper exports do not exist yet.

**Step 3: Write minimal implementation**

Modify `backend/src/routes/researchops/projects.js` to add/export pure helpers for:

- document-plan prompt metadata construction
- generated-plan-to-tree materialization
- planner artifact metadata construction

Keep the helpers side-effect free so later route handlers can call them.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/__tests__/projects.document-plan.test.js
git commit -m "feat: add document plan route helpers"
```

### Task 3: Add failing route tests for document-plan generation

**Files:**
- Create: `backend/src/routes/researchops/__tests__/projects.document-plan-route.test.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Reference: `backend/src/routes/researchops/__tests__/projects.node-blocking.test.js`

**Step 1: Write the failing test**

Cover:

- `POST /projects/:projectId/document-plan/generate` rejects missing project/instruction
- successful generation enqueues or executes a planning run using SSH-backed project context
- successful planner result stores planning artifacts and writes updated tree plan/state
- malformed planner result fails without activating tree changes

Mock the planner parsing/materialization layer instead of invoking real SSH.

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan-route.test.js`

Expected: FAIL because the route does not exist yet.

**Step 3: Write minimal implementation**

Modify `backend/src/routes/researchops/projects.js` to:

- add the new generation endpoint
- resolve SSH-backed project context
- create a planning run with document-plan metadata
- parse and validate the generated planner result
- persist plan/spec/document artifacts
- write updated tree plan/state only after validation succeeds

Reuse existing helpers:

- `resolveProjectContext(...)`
- `researchOpsStore.enqueueRun(...)`
- `researchOpsRunner.executeRun(...)`
- `treePlanService.writeProjectPlan(...)`
- `treeStateService.writeProjectState(...)`

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan-route.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/__tests__/projects.document-plan-route.test.js
git commit -m "feat: add document plan generation route"
```

### Task 4: Add failing tests for runner-side document progress event parsing

**Files:**
- Create: `backend/src/services/researchops/__tests__/runner.document-plan-events.test.js`
- Modify: `backend/src/services/researchops/runner.js`
- Modify: `backend/src/services/researchops/store.js`

**Step 1: Write the failing test**

Cover:

- planner/step progress markers in agent stdout become normalized run events
- parsed terminal step results update event streams without breaking existing log publishing
- new event types are accepted by the store

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/runner.document-plan-events.test.js`

Expected: FAIL because the runner/store do not understand the new document-step events yet.

**Step 3: Write minimal implementation**

Modify:

- `backend/src/services/researchops/runner.js`
- `backend/src/services/researchops/store.js`

Implement:

- stdout line inspection for structured document-step markers
- event fan-out into `publishRunEvents(...)`
- additional accepted event types if needed, such as `STEP_PROGRESS`

Do not change the fallback behavior for ordinary runs/log lines.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/runner.document-plan-events.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/runner.js backend/src/services/researchops/store.js backend/src/services/researchops/__tests__/runner.document-plan-events.test.js
git commit -m "feat: parse document plan progress events"
```

### Task 5: Add failing tests for tree-state synchronization from document-step runs

**Files:**
- Create: `backend/src/routes/researchops/__tests__/projects.document-plan-execution.test.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/services/researchops/tree-state.service.js`

**Step 1: Write the failing test**

Cover:

- running a generated document-plan node marks the node queued/running
- structured step-result events map to terminal node status
- missing structured events fall back to existing run-status mapping

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan-execution.test.js`

Expected: FAIL because document-plan execution wiring does not exist yet.

**Step 3: Write minimal implementation**

Modify `backend/src/routes/researchops/projects.js` and, only if required, `backend/src/services/researchops/tree-state.service.js` to:

- add a document-plan node execution endpoint or execution branch
- scope prompts to a single document step/TODO marker
- update node state from backend-owned document-step events
- preserve fallback mapping from existing terminal run status

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.document-plan-execution.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/services/researchops/tree-state.service.js backend/src/routes/researchops/__tests__/projects.document-plan-execution.test.js
git commit -m "feat: sync document plan execution into tree state"
```

### Task 6: Add frontend tests and minimal UI wiring for document-plan generation

**Files:**
- Create: `frontend/src/components/vibe/documentPlanApiResponse.test.mjs`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Create: `frontend/src/components/vibe/documentPlanApiResponse.js`

**Step 1: Write the failing test**

Cover:

- frontend normalizes the new document-plan generation payload
- updated tree payload from the backend is applied to local UI state
- planning artifacts are surfaced in the run/review flow without breaking existing payload readers

**Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- documentPlanApiResponse.test.mjs`

Expected: FAIL because the payload adapter does not exist yet.

**Step 3: Write minimal implementation**

Modify:

- `frontend/src/components/VibeResearcherPanel.jsx`
- `frontend/src/components/vibe/documentPlanApiResponse.js`

Implement:

- new API call handler for document-plan generation
- normalization of returned plan/tree/artifact payload
- application of updated tree state into existing UI state

Keep existing tree/dashboard views and reuse their current presentation.

**Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- documentPlanApiResponse.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/vibe/documentPlanApiResponse.js frontend/src/components/vibe/documentPlanApiResponse.test.mjs
git commit -m "feat: wire document plan generation into vibe panel"
```

### Task 7: Verify route/module load and targeted end-to-end behavior

**Files:**
- Reference only

**Step 1: Run route and service load checks**

Run:

- `node -e "require('./backend/src/routes/researchops')"`
- `node -e "require('./backend/src/routes/researchops/projects')"`
- `node -e "require('./backend/src/services/researchops/document-plan.service')"`

Expected: all commands exit 0.

**Step 2: Run targeted backend tests**

Run:

- `node --test backend/src/services/researchops/__tests__/document-plan.service.test.js`
- `node --test backend/src/services/researchops/__tests__/document-plan-events.service.test.js`
- `node --test backend/src/routes/researchops/__tests__/projects.document-plan.test.js`
- `node --test backend/src/routes/researchops/__tests__/projects.document-plan-route.test.js`
- `node --test backend/src/services/researchops/__tests__/runner.document-plan-events.test.js`
- `node --test backend/src/routes/researchops/__tests__/projects.document-plan-execution.test.js`
- `node --test backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`
- `node --test backend/src/services/researchops/__tests__/runner.direct-execute.test.js`

Expected: PASS

**Step 3: Run targeted frontend test**

Run:

- `npm --prefix frontend test -- documentPlanApiResponse.test.mjs`

Expected: PASS

**Step 4: Run requirement check**

Verify manually against the approved design:

- frontend can request SSH-backed plan generation
- planning run produces document/spec artifacts
- generated plan appears in tree view
- later document-step execution updates tree state from backend run events

**Step 5: Commit**

```bash
git add docs/plans/2026-03-10-ssh-document-plan-design.md docs/plans/2026-03-10-ssh-document-plan.md
git commit -m "docs: add ssh document plan design and implementation plan"
```
