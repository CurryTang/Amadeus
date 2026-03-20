# Dispatch Project Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing ARIS module into a Dispatch-style project-management control plane with first-class work items, mandatory wake-ups, review flows, and a Control Tower home view while preserving existing ARIS projects and runs.

**Architecture:** Keep ARIS as the module boundary. Reuse `aris_projects`, `aris_runs`, and the current React/Express/libsql stack. Add new ARIS persistence tables for milestones, work items, wake-ups, reviews, and decisions; then build control-tower and work-item UI inside the existing ARIS workspace shell.

**Tech Stack:** React frontend in `frontend/src`, Express backend in `backend/src`, Turso/libsql schema initialization in `backend/src/db/index.js`, Node `node:test`/`assert` tests, plain CSS and existing ARIS presentation/state helper pattern.

---

### Task 1: Add database coverage for Dispatch entities

**Files:**
- Modify: `backend/src/db/index.js`
- Create: `backend/src/db/__tests__/dispatch-schema.test.js`

**Step 1: Write the failing test**

Add a schema-oriented test that initializes the DB and verifies these tables exist:

- `aris_milestones`
- `aris_work_items`
- `aris_wakeups`
- `aris_reviews`
- `aris_decisions`

Also verify `aris_runs` exposes the new columns:

- `work_item_id`
- `completed_at`

Use `PRAGMA table_info(...)` and direct metadata queries instead of route tests.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/db/__tests__/dispatch-schema.test.js
```

Expected: FAIL because the new tables/columns do not exist yet.

**Step 3: Write minimal implementation**

Update `backend/src/db/index.js` to:

- create the new `aris_*` tables
- add migration-safe `ALTER TABLE` logic for `aris_runs.work_item_id` and `aris_runs.completed_at`
- add useful indexes for project/status/date lookups used by Control Tower

Keep the schema additive. Do not remove or rename any existing ARIS tables.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/db/__tests__/dispatch-schema.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/db/index.js backend/src/db/__tests__/dispatch-schema.test.js
git commit -m "feat: add dispatch schema for aris"
```

### Task 2: Add backend state helpers and service tests for work items and wake-ups

**Files:**
- Modify: `backend/src/services/aris.service.js`
- Create: `backend/src/services/__tests__/aris.dispatch.service.test.js`

**Step 1: Write the failing test**

Add service tests for:

- creating a work item under an existing ARIS project
- creating a human-only work item without a run
- refusing to start a run without a wake-up
- mapping legacy run status into Dispatch semantics
- computing work-item state transitions when linked runs are waiting or review-ready

Example expectations:

- a newly created work item returns the structured packet fields
- a run created with no wake-up throws a validation error
- a stored run with `status = completed` appears as `review_ready` until reviewed

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/aris.dispatch.service.test.js
```

Expected: FAIL because the Dispatch service methods do not exist yet.

**Step 3: Write minimal implementation**

Extend `backend/src/services/aris.service.js` with focused methods for:

- `listProjectWorkItems(projectId)`
- `getWorkItem(workItemId)`
- `createWorkItem(projectId, payload)`
- `updateWorkItem(workItemId, payload)`
- `createWorkItemRun(workItemId, payload, userCtx)`
- `createRunWakeup(runId, payload, userCtx)`
- helper mapping from legacy ARIS run state to Dispatch run state

Keep this service in the existing file first to match the repo's current module style.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/aris.dispatch.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/aris.service.js backend/src/services/__tests__/aris.dispatch.service.test.js
git commit -m "feat: add dispatch work item service"
```

### Task 3: Add ARIS route coverage for Dispatch endpoints

**Files:**
- Modify: `backend/src/routes/aris.js`
- Create: `backend/src/routes/__tests__/aris-dispatch-routes.test.js`

**Step 1: Write the failing test**

Add route-contract tests for:

- `GET /api/aris/control-tower`
- `GET /api/aris/projects/:projectId/work-items`
- `POST /api/aris/projects/:projectId/work-items`
- `PATCH /api/aris/work-items/:workItemId`
- `POST /api/aris/work-items/:workItemId/runs`
- `POST /api/aris/runs/:runId/wakeups`
- `GET /api/aris/review-inbox`
- `POST /api/aris/runs/:runId/reviews`

Mock auth and the ARIS service where practical so the tests stay fast.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/routes/__tests__/aris-dispatch-routes.test.js
```

Expected: FAIL because the routes are not wired yet.

**Step 3: Write minimal implementation**

Extend `backend/src/routes/aris.js` to expose the new endpoints and return JSON payloads consistent with the existing ARIS route style:

- top-level envelope objects such as `{ workItems }`, `{ workItem }`, `{ wakeup }`, `{ review }`
- 400 for validation failures
- 404 for missing projects/work items/runs

Do not create a second `/api/dispatch/*` namespace.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/routes/__tests__/aris-dispatch-routes.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/aris.js backend/src/routes/__tests__/aris-dispatch-routes.test.js
git commit -m "feat: add aris dispatch routes"
```

### Task 4: Add deterministic frontend presentation helpers for Dispatch views

**Files:**
- Modify: `frontend/src/components/aris/arisWorkspacePresentation.js`
- Create: `frontend/src/components/aris/arisDispatchPresentation.test.mjs`

**Step 1: Write the failing test**

Add tests for pure presentation helpers that shape:

- control-tower cards
- work-item rows
- wake-up badges
- review-inbox rows
- project summary rows with WIP counts

Example expectations:

- overdue wake-ups are marked urgent
- review-ready runs render distinct labels from active runs
- human-only work items do not invent run data

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: FAIL because the new helpers do not exist yet.

**Step 3: Write minimal implementation**

Extend `frontend/src/components/aris/arisWorkspacePresentation.js` with deterministic builders such as:

- `buildArisControlTowerCard(...)`
- `buildArisWorkItemRow(...)`
- `buildArisWakeupRow(...)`
- `buildArisReviewRow(...)`
- `buildArisProjectSummaryRow(...)`

Keep all formatting logic out of `ArisWorkspace.jsx`.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/arisWorkspacePresentation.js frontend/src/components/aris/arisDispatchPresentation.test.mjs
git commit -m "feat: add dispatch presentation helpers"
```

### Task 5: Add ARIS sub-navigation and Control Tower as the default home

**Files:**
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Extend frontend presentation tests with expectations for:

- ARIS defaulting to a `control_tower` subview
- internal navigation tabs for `Control Tower`, `Projects`, `Work Items`, `Review Inbox`, `Runs`, and `Launcher`

Keep the assertions focused on state helpers and visible labels rather than full DOM-heavy rendering if this repo lacks a React test harness for ARIS screens.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: FAIL if the view-state assumptions are not yet implemented.

**Step 3: Write minimal implementation**

Refactor `frontend/src/components/aris/ArisWorkspace.jsx` to:

- maintain an internal ARIS subview state
- default to `Control Tower`
- keep the existing launcher available under `Launcher`
- fetch control-tower data and render it before the run launcher

Update `frontend/src/App.jsx` only as needed to support the evolved ARIS workspace, not to create a new top-level product area.

Update `frontend/src/index.css` to style the new sub-navigation and control-tower panels consistently with existing ARIS visuals.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/ArisWorkspace.jsx frontend/src/App.jsx frontend/src/index.css frontend/src/components/aris/arisWorkspacePresentation.js frontend/src/components/aris/arisDispatchPresentation.test.mjs
git commit -m "feat: add aris control tower home"
```

### Task 6: Build work-item CRUD and run-launch UI inside ARIS

**Files:**
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `frontend/src/components/aris/arisProjectManagerState.js`

**Step 1: Write the failing test**

Add pure-state tests for:

- initializing a blank work-item draft
- validating required work-item fields
- converting a work-item draft to API payload
- requiring wake-up scheduling when creating a run from a work item

Prefer adding the test cases to `frontend/src/components/aris/arisProjectManagerState.test.mjs` if the helper file remains the shared ARIS state module.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/aris/arisProjectManagerState.test.mjs
```

Expected: FAIL because work-item draft helpers do not exist yet.

**Step 3: Write minimal implementation**

Extend `frontend/src/components/aris/arisProjectManagerState.js` with helpers for:

- creating/editing work-item drafts
- validation of required packet fields
- transforming drafts into `POST/PATCH` payloads
- validating run launch requests with mandatory wake-up data

Then update `ArisWorkspace.jsx` to render:

- work-item list for the selected project
- work-item detail/editor panel
- create/edit form for the structured packet
- launch-run action from a work item

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/aris/arisProjectManagerState.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/ArisWorkspace.jsx frontend/src/components/aris/arisProjectManagerState.js frontend/src/components/aris/arisProjectManagerState.test.mjs
git commit -m "feat: add aris work item editor"
```

### Task 7: Add review inbox and run-detail integration

**Files:**
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `backend/src/services/aris.service.js`
- Modify: `backend/src/routes/aris.js`

**Step 1: Write the failing test**

Add service/presentation tests for:

- listing review-ready runs in age/urgency order
- submitting a review decision
- updating parent work-item status after `accept`, `revise`, `park`, or `reject`

Examples:

- `accept` can move a linked work item toward `done`
- `revise` leaves the work item active and ready for a follow-up run
- `park` updates the work item state without deleting review history

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/aris.dispatch.service.test.js
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: FAIL on missing review behaviors.

**Step 3: Write minimal implementation**

Implement:

- review-inbox service aggregation
- review submission route/service logic
- run-detail rendering of parent work item, unresolved wake-ups, and review controls

Keep the first review UI simple and decision-oriented. Do not build comment threads or full artifact systems here.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/aris.dispatch.service.test.js
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/ArisWorkspace.jsx backend/src/services/aris.service.js backend/src/routes/aris.js frontend/src/components/aris/arisWorkspacePresentation.js frontend/src/components/aris/arisDispatchPresentation.test.mjs backend/src/services/__tests__/aris.dispatch.service.test.js
git commit -m "feat: add aris review inbox flow"
```

### Task 8: Add seed/demo data and final verification

**Files:**
- Modify: `backend/src/db/index.js`
- Create or Modify: existing seed/demo helpers if present after implementation
- Modify: `README.md`
- Modify: `AGENTS.md` only if new Dispatch-specific behavior needs documentation

**Step 1: Write the failing test**

Add a small verification test or script assertion that a demo dataset can produce:

- multiple projects
- human-only work items
- work items with linked ARIS runs
- overdue wake-ups
- review-ready runs

If no seed harness exists, write a deterministic helper function test instead of a full integration bootstrap.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/db/__tests__/dispatch-schema.test.js
```

Expected: FAIL until demo-data wiring exists or the helper expectations are added.

**Step 3: Write minimal implementation**

Add a deterministic seed/demo path that makes the Control Tower legible under parallel load.

Update docs so contributors understand:

- Dispatch lives inside ARIS
- work items are the planning object
- runs are execution attempts
- wake-ups are mandatory for in-flight runs

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/db/__tests__/dispatch-schema.test.js
node --test backend/src/services/__tests__/aris.dispatch.service.test.js
node --test backend/src/routes/__tests__/aris-dispatch-routes.test.js
node --test frontend/src/components/aris/arisProjectManagerState.test.mjs
node --test frontend/src/components/aris/arisDispatchPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/db/index.js backend/src/db/__tests__/dispatch-schema.test.js backend/src/services/__tests__/aris.dispatch.service.test.js backend/src/routes/__tests__/aris-dispatch-routes.test.js frontend/src/components/aris/arisProjectManagerState.test.mjs frontend/src/components/aris/arisDispatchPresentation.test.mjs README.md AGENTS.md
git commit -m "docs: add dispatch contributor guidance"
```
