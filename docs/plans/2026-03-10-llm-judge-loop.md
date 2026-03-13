# LLM Judge Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real post-step LLM judge loop for tree node execution, with auto retry in auto mode and human review escalation in manual mode.

**Architecture:** Extend the existing tree run path in `projects.js` and tree state JSON to persist judge state, run a judge pass after node execution, and reuse existing review/control-surface payloads in the frontend. Store judge output as run metadata/artifacts and feed judge refinement prompts back into reruns.

**Tech Stack:** Node.js, Express, ResearchOps store/services, frontend React presentation helpers, Node test runner

---

### Task 1: Add failing tests for judge state normalization

**Files:**
- Modify: `backend/src/services/researchops/__tests__/tree-state.service.test.js`
- Modify: `backend/src/services/researchops/tree-state.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- `setNodeState(..., { judge: { status: 'revise', mode: 'auto', iteration: 2, maxIterations: 5 } })` preserves normalized judge state
- malformed judge patches normalize to safe defaults

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/tree-state.service.test.js`
Expected: FAIL because `tree-state.service.js` does not normalize `judge`

**Step 3: Write minimal implementation**

Update `normalizeNodeStatePatch` and related helpers in `tree-state.service.js` to normalize judge fields.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/tree-state.service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/tree-state.service.js backend/src/services/researchops/__tests__/tree-state.service.test.js
git commit -m "test: normalize judge state in tree state service"
```

### Task 2: Add failing tests for judge service verdict parsing

**Files:**
- Create: `backend/src/services/researchops/__tests__/tree-node-judge.service.test.js`
- Create: `backend/src/services/researchops/tree-node-judge.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- structured JSON verdicts parse into `pass|revise|fail`
- malformed output becomes a technical failure payload
- retry-cap helper escalates to `needs_review`

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/tree-node-judge.service.test.js`
Expected: FAIL because service file does not exist

**Step 3: Write minimal implementation**

Create a judge service with:

- prompt builder
- structured verdict parser
- fallback error verdict shaping
- helper to decide next action from verdict + mode + iteration

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/tree-node-judge.service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/tree-node-judge.service.js backend/src/services/researchops/__tests__/tree-node-judge.service.test.js
git commit -m "test: add tree node judge service"
```

### Task 3: Add failing route tests for auto/manual judge loop behavior

**Files:**
- Modify: `backend/src/routes/researchops/__tests__/projects.node-blocking.test.js`
- Modify: `backend/src/routes/researchops/projects.js`

**Step 1: Write the failing test**

Add route-level tests that cover:

- auto mode `revise` stores judge state and schedules retry metadata
- manual mode `revise` stores `needs_review`
- auto mode on retry cap stores `needs_review`

Use stubs for:

- `researchOpsStore.enqueueRun`
- `researchOpsRunner.executeRun`
- judge service calls
- tree state read/write

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.node-blocking.test.js`
Expected: FAIL because run-step route does not manage judge loop state

**Step 3: Write minimal implementation**

Update `projects.js` to:

- accept judge options from request body
- persist `judge.running`
- invoke judge service after run submission context is created
- update node state based on verdict and mode
- enqueue retry metadata when auto mode returns `revise`

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.node-blocking.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/__tests__/projects.node-blocking.test.js
git commit -m "feat: add backend judge loop for tree nodes"
```

### Task 4: Add failing tests for judge actions payload and routes

**Files:**
- Modify: `backend/src/services/researchops/tree-node-action-payload.service.js`
- Create: `backend/src/services/researchops/__tests__/tree-node-action-payload.service.test.js`
- Modify: `backend/src/routes/researchops/projects.js`

**Step 1: Write the failing test**

Add tests that assert node action payloads include:

- `judge`
- `judgeApprove`
- `judgeRetry`

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/tree-node-action-payload.service.test.js`
Expected: FAIL because judge actions are absent

**Step 3: Write minimal implementation**

Extend the action payload service and add the new judge routes in `projects.js`.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/tree-node-action-payload.service.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/tree-node-action-payload.service.js backend/src/services/researchops/__tests__/tree-node-action-payload.service.test.js backend/src/routes/researchops/projects.js
git commit -m "feat: add tree judge action endpoints"
```

### Task 5: Add failing frontend presentation tests for judge review state

**Files:**
- Modify: `frontend/src/components/vibe/reviewPresentation.test.mjs`
- Modify: `frontend/src/components/vibe/treeExecutionSummary.test.mjs`
- Modify: `frontend/src/components/vibe/reviewPresentation.js`
- Modify: `frontend/src/components/vibe/treeExecutionSummary.js`

**Step 1: Write the failing test**

Add tests that assert:

- judge status/iteration rows appear in node review summary
- primary action becomes `Review judge` when judge needs human review
- primary action becomes `Awaiting judge` while judge is running

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/reviewPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: FAIL because judge state is not surfaced

**Step 3: Write minimal implementation**

Update the presentation helpers to render judge rows and action labels from `nodeState.judge`.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/reviewPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/vibe/reviewPresentation.js frontend/src/components/vibe/reviewPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.js frontend/src/components/vibe/treeExecutionSummary.test.mjs
git commit -m "feat: surface judge loop state in vibe review UI"
```

### Task 6: Run integrated verification

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/services/researchops/tree-state.service.js`
- Modify: `backend/src/services/researchops/tree-node-judge.service.js`
- Modify: `frontend/src/components/vibe/reviewPresentation.js`
- Modify: `frontend/src/components/vibe/treeExecutionSummary.js`

**Step 1: Run focused backend tests**

Run: `node --test backend/src/services/researchops/__tests__/tree-state.service.test.js backend/src/services/researchops/__tests__/tree-node-judge.service.test.js backend/src/routes/researchops/__tests__/projects.node-blocking.test.js backend/src/services/researchops/__tests__/tree-node-action-payload.service.test.js`
Expected: PASS

**Step 2: Run focused frontend tests**

Run: `node --test frontend/src/components/vibe/reviewPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS

**Step 3: Run a route module load check**

Run: `node -e "require('./backend/src/routes/researchops/projects') ; console.log('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/services/researchops/tree-state.service.js backend/src/services/researchops/tree-node-judge.service.js backend/src/services/researchops/tree-node-action-payload.service.js frontend/src/components/vibe/reviewPresentation.js frontend/src/components/vibe/treeExecutionSummary.js
git commit -m "feat: implement llm judge loop for tree execution"
```
