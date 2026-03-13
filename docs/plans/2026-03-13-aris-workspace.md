# ARIS Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a top-level ARIS workspace in the frontend and a WSL-first backend launch model so ARIS runs persist on the always-on host, use managed SSH servers, and expose action-first controls with fully freeform input.

**Architecture:** Add a dedicated ARIS workspace UI to the main frontend shell, add a focused backend ARIS module with launch/list/status payloads, and make the canonical runner the WSL host with persistent remote workspaces. Reuse existing SSH server records and document/library surfaces rather than inventing a second server system.

**Tech Stack:** React 18 frontend, existing app shell in `frontend/src/App.jsx`, Express backend routes/services, existing SSH transport service, Node `node:test` tests where practical, plain CSS in `frontend/src/index.css`.

---

### Task 1: Add the ARIS frontend view model tests

**Files:**
- Create: `frontend/src/components/aris/arisWorkspacePresentation.js`
- Create: `frontend/src/components/aris/arisWorkspacePresentation.test.mjs`

**Step 1: Write the failing test**

Add tests for:

- quick action presets map to the correct workflow ids and suggested prompt seeds
- run status shaping distinguishes `queued`, `running_on_wsl`, `running_remote_experiment`, `waiting_results`, `completed`, `failed`
- sparse backend payloads still produce usable UI cards

Example:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARIS_QUICK_ACTIONS,
  buildArisRunCard,
} from './arisWorkspacePresentation.js';

test('ARIS quick actions expose launcher presets without locking input', () => {
  assert.equal(ARIS_QUICK_ACTIONS[0].id, 'literature_review');
  assert.match(ARIS_QUICK_ACTIONS[0].prefillPrompt, /literature|related work/i);
});

test('buildArisRunCard marks WSL-hosted runs distinctly from remote experiment dispatch', () => {
  const card = buildArisRunCard({
    id: 'run_1',
    status: 'running',
    runnerHost: 'wsl-main',
    activePhase: 'dispatch_experiment',
    downstreamServerName: 'gpu-a100-1',
  });

  assert.equal(card.statusLabel, 'Dispatching experiment');
  assert.equal(card.runnerLabel, 'WSL: wsl-main');
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/aris/arisWorkspacePresentation.test.mjs
```

Expected: FAIL because the presentation module does not exist yet.

**Step 3: Write minimal implementation**

Create:

- `ARIS_QUICK_ACTIONS`
- `buildArisRunCard(...)`
- helper functions for status labels and context summaries

Keep it UI-only and deterministic.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/aris/arisWorkspacePresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/arisWorkspacePresentation.js frontend/src/components/aris/arisWorkspacePresentation.test.mjs
git commit -m "feat: add aris workspace presentation model"
```

### Task 2: Add backend ARIS route contract tests

**Files:**
- Create: `backend/src/routes/aris.js`
- Create: `backend/src/services/aris.service.js`
- Create: `backend/src/services/__tests__/aris.service.test.js`
- Modify: `backend/src/routes/index.js`

**Step 1: Write the failing test**

Add tests for:

- resolving a canonical WSL runner
- shaping quick action launch payloads into backend launch descriptors
- ensuring remote dataset roots are treated as references, not upload inputs

Example behaviors:

- a launch descriptor contains `projectId`, `workflowType`, `prompt`, `runnerServerId`, `remoteWorkspacePath`
- a run marked `datasetRoot` does not include local upload instructions

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: FAIL because the service does not exist yet.

**Step 3: Write minimal implementation**

Implement a small service that:

- lists ARIS quick actions
- resolves WSL runner + optional downstream server summary
- validates launch payloads
- returns placeholder run descriptors for the first UI integration

Do not build full process execution yet; first lock the backend contract.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/aris.js backend/src/services/aris.service.js backend/src/services/__tests__/aris.service.test.js backend/src/routes/index.js
git commit -m "feat: add aris backend contract"
```

### Task 3: Build the ARIS top-level workspace UI

**Files:**
- Create: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Extend `arisWorkspacePresentation.test.mjs` with expectations for:

- the existence of quick actions for literature review, idea discovery, run experiment, auto review, paper writing, paper improvement, full pipeline, and monitor experiment
- freeform input remaining editable after selecting a preset

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/aris/arisWorkspacePresentation.test.mjs
```

Expected: FAIL if quick actions are incomplete.

**Step 3: Write minimal implementation**

In `ArisWorkspace.jsx`, render:

- launch bar with project selector, runner summary, freeform input, and Run button
- quick action buttons that prefill but do not lock the input
- run context panel
- recent run feed placeholder tied to backend route output

In `App.jsx`:

- add top-level `ARIS` area selection
- mount `ArisWorkspace`

In `frontend/src/index.css`:

- add a distinctive but consistent visual treatment for the ARIS workspace
- ensure desktop and mobile layouts work
- keep the interface intentional and not a generic form stack

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/aris/arisWorkspacePresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/ArisWorkspace.jsx frontend/src/App.jsx frontend/src/index.css frontend/src/components/aris/arisWorkspacePresentation.js frontend/src/components/aris/arisWorkspacePresentation.test.mjs
git commit -m "feat: add top-level aris workspace"
```

### Task 4: Connect the frontend workspace to backend ARIS endpoints

**Files:**
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `backend/src/routes/aris.js`
- Modify: `backend/src/services/aris.service.js`

**Step 1: Write the failing test**

Add backend tests for:

- `GET /api/aris/context` style payload shaping
- `POST /api/aris/runs` validation
- `GET /api/aris/runs` list shaping

Because route tests are heavier in this repo, keep most coverage in service tests and manually verify route wiring after implementation.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: FAIL on missing list/context behaviors.

**Step 3: Write minimal implementation**

Add route/service support for:

- listing ARIS workspace context
- creating a launch request
- listing recent ARIS runs

The frontend should call these routes and render:

- runner summary
- quick action metadata
- recent runs

Launch submission can initially create a validated placeholder record if full remote process execution is not yet wired in this task batch.

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/aris/ArisWorkspace.jsx backend/src/routes/aris.js backend/src/services/aris.service.js backend/src/services/__tests__/aris.service.test.js
git commit -m "feat: connect aris workspace to backend"
```

### Task 5: Add WSL-runner-first configuration and remote workspace summary

**Files:**
- Modify: `backend/src/services/aris.service.js`
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `docs/INSTALLATION_MODES.md`
- Modify: `README.md`

**Step 1: Write the failing test**

Add tests for:

- canonical runner selection prefers WSL/local executor identity
- downstream SSH server is optional and shown separately from the runner
- dataset root is represented as remote-only context

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: FAIL on runner preference logic.

**Step 3: Write minimal implementation**

Implement:

- runner preference logic for the always-on WSL host
- UI copy stating runs continue when the client disconnects
- remote dataset/workspace indicators in the workspace context panel
- docs describing the WSL-first model

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/aris.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/aris.service.js frontend/src/components/aris/ArisWorkspace.jsx README.md docs/INSTALLATION_MODES.md
git commit -m "docs: document wsl-first aris runner model"
```

### Task 6: Verify the initial ARIS workspace integration

**Files:**
- Modify: `frontend/src/components/aris/ArisWorkspace.jsx`
- Modify: `backend/src/routes/aris.js`

**Step 1: Run focused verification**

Run:
```bash
node --test frontend/src/components/aris/arisWorkspacePresentation.test.mjs
node --test backend/src/services/__tests__/aris.service.test.js
npm --prefix frontend run build
node -e "require('./backend/src/routes/aris')"
```

Expected: tests pass, frontend builds, backend route loads.

**Step 2: Run final status check**

Run:
```bash
git status --short
```

Expected: only intended files for the ARIS workspace feature are touched, aside from any pre-existing unrelated workspace changes.

**Step 3: Commit**

```bash
git add frontend/src/components/aris/ backend/src/routes/aris.js backend/src/services/aris.service.js backend/src/services/__tests__/aris.service.test.js README.md docs/INSTALLATION_MODES.md
git commit -m "chore: verify aris workspace integration"
```
