# Observed Agent Session Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface direct Claude/Codex server sessions as passive observed sessions in the runner area, classify concrete coding/research tasks, and auto-materialize qualifying sessions into detached tree nodes with refresh-on-demand.

**Architecture:** Keep the existing watcher as the low-level session discovery source, add a ResearchOps observed-session service for project scoping, digest caching, classification, and node materialization, then extend the current Vibe runner and tree surfaces to render observed sessions and detached observed nodes without turning them into managed runs.

**Tech Stack:** Node.js, Express, existing ResearchOps tree services, React, Axios, node:test

---

### Task 1: Add a project-scoped observed-session service over the existing watcher

**Files:**
- Create: `backend/src/services/researchops/observed-session.service.js`
- Create: `backend/src/services/researchops/__tests__/observed-session.service.test.js`
- Modify: `backend/src/services/agent-session-watcher.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- watcher sessions can be filtered by exact project git root
- normalized observed-session ids are stable across rescans
- observed-session records preserve provider, session file path, title, prompt, and timestamps

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.service.test.js`
Expected: FAIL because the observed-session service does not exist yet.

**Step 3: Write minimal implementation**

Implement a project-scoped service that:

- reads sessions from `agent-session-watcher`
- filters by project path / git root
- shapes a stable `observedSession` object for downstream cache, API, and UI use

Export pure helpers where practical so the test can cover normalization without starting the whole server.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.service.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 2: Add digest hashing and cache persistence for observed sessions

**Files:**
- Modify: `backend/src/services/researchops/observed-session.service.js`
- Create: `backend/src/services/researchops/__tests__/observed-session.cache.test.js`
- Check: `backend/src/services/researchops/tree-plan.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- cache records are written under the project ResearchOps cache root
- a content hash is stored per observed session
- unchanged content returns cached digest data without reparsing expensive fields

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.cache.test.js`
Expected: FAIL because cache persistence and hash-based reuse do not exist yet.

**Step 3: Write minimal implementation**

Add cache helpers that:

- derive the observed-session cache path from the project cache root
- persist one JSON record per observed session
- compare `contentHash` during refresh/list operations
- rebuild digest data only when the source file changed

Keep the cache format explicit and versionable.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.cache.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 3: Add lightweight classification and `can_be_node` gating

**Files:**
- Modify: `backend/src/services/researchops/observed-session.service.js`
- Create: `backend/src/services/researchops/__tests__/observed-session.classification.test.js`
- Check: `backend/src/services/researchops/interactive-agent.service.js`
- Check: `backend/src/services/researchops/context-pack.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- concrete coding tasks classify as `can_be_node`
- concrete research tasks classify as `can_be_node`
- vague/meta conversations classify as `ignore` or `candidate`
- classification output includes `decision`, `goalSummary`, `confidence`, and `reason`

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.classification.test.js`
Expected: FAIL because no classifier path exists yet.

**Step 3: Write minimal implementation**

Add a bounded classifier path that:

- reads only compact digest text plus a capped excerpt from the session file
- decides whether the session has a concrete coding/research task
- stores the classifier result on the cache record

Prefer deterministic shaping around the LLM result so the stored payload is stable.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.classification.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 4: Materialize qualifying observed sessions into detached tree nodes

**Files:**
- Modify: `backend/src/services/researchops/observed-session.service.js`
- Create: `backend/src/services/researchops/__tests__/observed-session.materialization.test.js`
- Check: `backend/src/services/researchops/plan-patch.service.js`
- Check: `backend/src/services/researchops/tree-state.service.js`

**Step 1: Write the failing test**

Add tests that assert:

- a `can_be_node` observed session creates exactly one detached plan node
- the node uses `kind: observed_agent`
- the node stores origin metadata in `resources.observedSession`
- repeated refreshes do not create duplicate nodes

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.materialization.test.js`
Expected: FAIL because node materialization does not exist yet.

**Step 3: Write minimal implementation**

Implement node materialization through existing plan patch/write flows:

- create a detached node only for `can_be_node`
- preserve user edits if the node already exists
- update only safe summary and origin fields on refresh

Keep node creation separate from managed run creation.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.materialization.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 5: Expose observed-session list/detail/refresh APIs

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Create: `backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
- Modify: `backend/src/services/researchops/observed-session.service.js`

**Step 1: Write the failing test**

Add route tests that assert:

- `GET /researchops/projects/:projectId/observed-sessions` returns project-scoped sessions
- `GET /researchops/projects/:projectId/observed-sessions/:sessionId` returns one session
- `POST /researchops/projects/:projectId/observed-sessions/:sessionId/refresh` returns hash-change, classification, and node materialization info

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
Expected: FAIL because the routes do not exist yet.

**Step 3: Write minimal implementation**

Add project routes that:

- resolve project context
- list observed sessions from the new service
- refresh one observed session on demand
- return detached node metadata when applicable

Do not add write controls such as cancel/retry because these sessions are passive.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 6: Add pure frontend presentation helpers for observed sessions

**Files:**
- Create: `frontend/src/components/vibe/observedSessionPresentation.js`
- Create: `frontend/src/components/vibe/observedSessionPresentation.test.mjs`
- Check: `frontend/src/components/vibe/runPresentation.js`

**Step 1: Write the failing test**

Add tests that assert:

- observed-session cards render provider, observed label, status, title, digest, and timestamp
- list helpers sort most recently updated sessions first
- detached-node badges and refresh affordance labels are derived correctly

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Implement pure helpers for:

- card shaping
- timestamp formatting
- detached-node status labels
- refresh-state labeling

Keep the logic data-only so the React components stay thin.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 7: Render observed sessions in the runner area

**Files:**
- Create: `frontend/src/components/vibe/VibeObservedSessionsStrip.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/vibe/VibeRecentRunsStrip.jsx`

**Step 1: Write the failing test**

Extend the pure helper tests to lock the intended card ordering and display shape before wiring UI.

**Step 2: Run tests to verify baseline expectations**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs`
Expected: PASS after Task 6 and used as a guardrail while wiring UI.

**Step 3: Write minimal implementation**

Update the Vibe workspace so it:

- fetches observed sessions for the selected project
- renders them in the runner region with clear `Observed` labeling
- keeps them distinct from managed recent runs
- never shows managed-run controls on observed cards

Reuse existing runner styling where sensible, but preserve visual separation.

**Step 4: Run targeted verification**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 8: Render detached observed nodes and node refresh affordances

**Files:**
- Modify: `frontend/src/components/vibe/VibeTreeCanvas.jsx`
- Modify: `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Add or extend tests that assert:

- observed nodes get distinct kind/tag presentation
- refresh is available for observed nodes
- observed-node refresh updates digest text when the backend reports a changed hash

Use:

- `frontend/src/components/vibe/observedSessionPresentation.test.mjs`
- any existing tree helper tests that cover status summaries

**Step 2: Run tests to verify expectations**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS on helpers before wiring UI integration.

**Step 3: Write minimal implementation**

Update the tree and node workbench so:

- detached observed nodes render with distinct styling
- the workbench shows provider, source path, summary digest, and last refresh
- a refresh action calls the observed-session refresh API and updates local tree/workbench state

Do not add live log streaming or managed-run actions for observed nodes.

**Step 4: Run targeted verification**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS

**Step 5: Commit**

Do not commit unless explicitly requested by the user.

### Task 9: Run end-to-end verification for unchanged-hash and changed-hash refresh flows

**Files:**
- Modify: `backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
- Modify: `backend/src/services/researchops/__tests__/observed-session.cache.test.js`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Add final verification coverage**

Extend tests to cover:

- refresh with unchanged hash returns cached digest and no tree mutation
- refresh with changed hash updates digest and detached node metadata
- sessions that fail classification remain visible in the runner but do not materialize into nodes

**Step 2: Run backend tests**

Run: `node --test backend/src/services/researchops/__tests__/observed-session.service.test.js backend/src/services/researchops/__tests__/observed-session.cache.test.js backend/src/services/researchops/__tests__/observed-session.classification.test.js backend/src/services/researchops/__tests__/observed-session.materialization.test.js backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`
Expected: PASS

**Step 3: Run frontend tests**

Run: `node --test frontend/src/components/vibe/observedSessionPresentation.test.mjs frontend/src/components/vibe/treeExecutionSummary.test.mjs`
Expected: PASS

**Step 4: Perform manual verification**

Manual checks:

- start or reuse a Claude/Codex session on the shared project filesystem
- confirm it appears in the observed runner area
- confirm a concrete task session auto-materializes into a detached node
- trigger refresh once with unchanged content and once after a file change
- confirm detached nodes remain unconnected and no managed-run controls appear

**Step 5: Commit**

Do not commit unless explicitly requested by the user.
