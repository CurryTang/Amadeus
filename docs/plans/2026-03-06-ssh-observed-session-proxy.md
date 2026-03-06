# SSH Observed Session Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an efficient SSH-host observer worker so arbitrary Claude/Codex CLI sessions on SSH target hosts appear as project-scoped observed sessions in the workspace.

**Architecture:** Install a lightweight observer worker on each SSH host to index changed session files into a local SQLite cache keyed by exact `git_root`, then proxy project-scoped session queries from the backend to that worker over SSH. Reuse the existing observed-session classification, caching, and detached-node materialization logic on the backend wherever possible.

**Tech Stack:** Node.js, SQLite, SSH command transport, Express, node:test, existing ResearchOps observed-session services

---

### Task 1: Add a host-local observer data model and CLI contract

**Files:**
- Create: `backend/src/services/agent-session-observer/observer-store.js`
- Create: `backend/src/services/agent-session-observer/observer-cli.js`
- Create: `backend/src/services/agent-session-observer/__tests__/observer-store.test.js`

**Step 1: Write the failing test**

Cover:
- insert/update compact session records
- exact `git_root` filtering
- fetching a session by id

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/agent-session-observer/__tests__/observer-store.test.js`

Expected: FAIL because the observer store and CLI contract do not exist.

**Step 3: Write minimal implementation**

Implement:
- local SQLite-backed compact record storage
- list-by-git-root
- get-by-session-id

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/agent-session-observer/__tests__/observer-store.test.js`

Expected: PASS.

### Task 2: Add incremental SSH-host session indexing

**Files:**
- Create: `backend/src/services/agent-session-observer/indexer.js`
- Create: `backend/src/services/agent-session-observer/__tests__/indexer.test.js`
- Reuse: `backend/src/services/agent-session-watcher.service.js`

**Step 1: Write the failing test**

Cover:
- only changed files are reparsed
- `git_root` is memoized
- compact digests update when file content changes

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/agent-session-observer/__tests__/indexer.test.js`

Expected: FAIL because the indexer does not exist.

**Step 3: Write minimal implementation**

Implement:
- change detection by `mtime/size`
- compact record extraction for Claude/Codex session files
- local observer DB writes

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/agent-session-observer/__tests__/indexer.test.js`

Expected: PASS.

### Task 3: Add installable SSH-host worker packaging

**Files:**
- Create: `backend/scripts/install-agent-session-observer.sh`
- Create: `backend/scripts/researchops-agent-observer.js`
- Create: `backend/src/services/agent-session-observer/__tests__/observer-cli.test.js`

**Step 1: Write the failing test**

Cover:
- CLI supports `list`
- CLI supports `get`
- CLI supports `excerpt`

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/agent-session-observer/__tests__/observer-cli.test.js`

Expected: FAIL because the executable contract does not exist.

**Step 3: Write minimal implementation**

Implement:
- node entrypoint
- JSON output modes
- install script for user-level runtime setup

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/agent-session-observer/__tests__/observer-cli.test.js`

Expected: PASS.

### Task 4: Add backend SSH proxy adapter for observer worker

**Files:**
- Create: `backend/src/services/researchops/ssh-observed-session-proxy.service.js`
- Create: `backend/src/services/researchops/__tests__/ssh-observed-session-proxy.service.test.js`
- Modify: `backend/src/routes/researchops/projects.js`

**Step 1: Write the failing test**

Cover:
- backend issues SSH `list --git-root`
- backend issues SSH `get --session-id`
- backend parses compact worker JSON

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/ssh-observed-session-proxy.service.test.js`

Expected: FAIL because the proxy adapter does not exist.

**Step 3: Write minimal implementation**

Implement:
- SSH command wrapper for observer CLI
- JSON parsing and normalization
- bounded excerpt fetch for refresh paths

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/ssh-observed-session-proxy.service.test.js`

Expected: PASS.

### Task 5: Route SSH projects through the remote observer path

**Files:**
- Modify: `backend/src/services/researchops/observed-session.service.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`

**Step 1: Write the failing test**

Cover:
- SSH projects list observed sessions from the remote observer path
- local projects still use the existing local watcher path
- refresh reuses remote compact data and existing materialization flow

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`

Expected: FAIL because SSH projects still use the local watcher path.

**Step 3: Write minimal implementation**

Implement:
- location-aware observed-session source selection
- reuse of existing classification/materialization logic on remote records

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`

Expected: PASS.

### Task 6: Surface source hints and keep frontend behavior stable

**Files:**
- Modify: `frontend/src/components/vibe/observedSessionPresentation.js`
- Modify: `frontend/src/components/vibe/VibeActivityFeedStrip.jsx`
- Modify: `frontend/src/components/vibe/runDetailView.test.mjs` or add a focused observed-session presentation test if needed

**Step 1: Write the failing test**

Cover:
- SSH-observed sessions can expose a small source hint without changing existing card semantics

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs`

Expected: FAIL only if a new presentation helper/test is added for this hint.

**Step 3: Write minimal implementation**

Add a subtle source hint only if returned by backend metadata. Do not redesign the activity panel.

**Step 4: Run frontend tests**

Run: `node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs frontend/src/components/vibe/runHistoryState.test.mjs frontend/src/components/vibe/projectEntryGate.test.mjs`

Expected: PASS.

### Task 7: Verify end-to-end and document deployment

**Files:**
- Modify: `docs/plans/2026-03-06-ssh-observed-session-proxy-design.md`
- Modify: `docs/plans/2026-03-06-ssh-observed-session-proxy.md`
- Optionally add: `resource/` deployment note if this becomes operator runbook material

**Step 1: Run backend verification**

Run:
`node --test backend/src/services/agent-session-observer/__tests__/observer-store.test.js backend/src/services/agent-session-observer/__tests__/indexer.test.js backend/src/services/agent-session-observer/__tests__/observer-cli.test.js backend/src/services/researchops/__tests__/ssh-observed-session-proxy.service.test.js backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js`

Expected: PASS.

**Step 2: Run frontend verification**

Run:
`node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs frontend/src/components/vibe/runHistoryState.test.mjs frontend/src/components/vibe/projectEntryGate.test.mjs`

Expected: PASS.

**Step 3: Run build verification**

Run:
`cd frontend && npm run build`

Expected: PASS.

**Step 4: Manual verification**

- install observer worker on one SSH host
- start or reuse an arbitrary Claude/Codex CLI session inside the target project root
- open the matching SSH project in the workspace
- confirm the session appears in the activity panel
- refresh the session and confirm detached-node materialization still works
