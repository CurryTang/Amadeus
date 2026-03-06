# Client Device Project Location Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `Local client device` as a third project location in the create-project flow, with `Desktop agent` and `Browser file access` modes, and enforce the correct execution capabilities across backend and frontend.

**Architecture:** Reuse the existing ResearchOps daemon model for `client + agent`, and introduce a browser-local workspace registry for `client + browser`. Centralize project-location validation and capability derivation in backend helpers so the route layer, orchestrator, and frontend all consume the same semantics.

**Tech Stack:** Express, React/Next.js, Axios, MongoDB/in-memory ResearchOps store, Node `node:test`, Vitest + React Testing Library for new frontend coverage, IndexedDB/File System Access API.

---

### Task 1: Add backend project-location normalization and tests

**Files:**
- Create: `backend/src/services/researchops/project-location.service.js`
- Create: `backend/src/services/researchops/__tests__/project-location.service.test.js`
- Modify: `backend/src/services/researchops/store.js`

**Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeProjectLocationPayload,
  deriveProjectCapabilities,
} = require('../project-location.service');

test('normalizes client agent projects with clientDeviceId and path', () => {
  const result = normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  });

  assert.equal(result.locationType, 'client');
  assert.equal(result.clientMode, 'agent');
  assert.equal(result.clientDeviceId, 'srv_client_1');
  assert.equal(result.serverId, 'srv_client_1');
  assert.equal(result.projectPath, '/Users/alice/my-project');
});

test('rejects browser client projects that include serverId', () => {
  assert.throws(() => normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
    serverId: 'local-default',
  }), /serverId must not be set/i);
});

test('derives browser client capabilities as non-executable', () => {
  const caps = deriveProjectCapabilities({
    locationType: 'client',
    clientMode: 'browser',
  });

  assert.equal(caps.canExecute, false);
  assert.equal(caps.canGitInit, false);
  assert.equal(caps.requiresBrowserWorkspaceLink, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/project-location.service.test.js`

Expected: FAIL because `project-location.service.js` does not exist yet.

**Step 3: Write minimal implementation**

```js
function normalizeProjectLocationPayload(payload = {}) {
  const locationType = cleanString(payload.locationType).toLowerCase() || 'local';
  if (locationType === 'client') {
    const clientMode = cleanString(payload.clientMode).toLowerCase();
    if (clientMode === 'agent') {
      const clientDeviceId = cleanString(payload.clientDeviceId);
      const projectPath = cleanString(payload.projectPath);
      if (!clientDeviceId || !projectPath) throw new Error('clientDeviceId and projectPath are required');
      return {
        locationType: 'client',
        clientMode: 'agent',
        clientDeviceId,
        serverId: clientDeviceId,
        projectPath,
        clientWorkspaceId: null,
      };
    }
    if (clientMode === 'browser') {
      if (cleanString(payload.serverId)) throw new Error('serverId must not be set for browser client projects');
      const clientWorkspaceId = cleanString(payload.clientWorkspaceId);
      if (!clientWorkspaceId) throw new Error('clientWorkspaceId is required');
      return {
        locationType: 'client',
        clientMode: 'browser',
        clientDeviceId: null,
        serverId: null,
        projectPath: null,
        clientWorkspaceId,
      };
    }
    throw new Error('clientMode must be agent or browser');
  }
  // preserve current local/ssh semantics
}
```

**Step 4: Wire store.js through the helper**

Replace inline `locationType/serverId/projectPath` validation in `createProject` with `normalizeProjectLocationPayload(...)`, and include `clientMode`, `clientDeviceId`, `clientWorkspaceId`, and derived `capabilities` in project shaping.

**Step 5: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/project-location.service.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/services/researchops/project-location.service.js backend/src/services/researchops/__tests__/project-location.service.test.js backend/src/services/researchops/store.js
git commit -m "feat: add client project location model"
```

### Task 2: Extend backend create-project and path-check routes for client modes

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Create: `backend/src/routes/researchops/__tests__/projects.client-location.test.js`
- Modify: `backend/src/routes/researchops.js` if the monolith path remains active in parallel

**Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectPathCheckResponse } = require('../projects.js');

test('builds client agent path-check response via daemon target', async () => {
  const result = await buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  }, {
    checkClientPath: async () => ({
      normalizedPath: '/Users/alice/my-project',
      exists: false,
      isDirectory: false,
    }),
  });

  assert.equal(result.locationType, 'client');
  assert.equal(result.clientMode, 'agent');
  assert.equal(result.clientDeviceId, 'srv_client_1');
  assert.equal(result.canCreate, true);
});

test('rejects server-side path check for browser client projects', async () => {
  await assert.rejects(() => buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
  }, {}), /validated in the browser/i);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/projects.client-location.test.js`

Expected: FAIL because helper extraction does not exist yet.

**Step 3: Write minimal implementation**

Extract route-local logic into testable helpers:

```js
async function buildProjectPathCheckResponse(input, deps) {
  const normalized = normalizeProjectLocationPayload(input);
  if (normalized.locationType === 'client' && normalized.clientMode === 'browser') {
    throw new Error('Browser-backed client workspaces are validated in the browser');
  }
  if (normalized.locationType === 'client' && normalized.clientMode === 'agent') {
    const result = await deps.checkClientPath({
      clientDeviceId: normalized.clientDeviceId,
      projectPath: normalized.projectPath,
    });
    return {
      locationType: 'client',
      clientMode: 'agent',
      clientDeviceId: normalized.clientDeviceId,
      projectPath: result.normalizedPath,
      exists: result.exists,
      isDirectory: result.isDirectory,
      canCreate: !result.exists || result.isDirectory,
      message: result.exists
        ? 'Path exists on client device and is a directory.'
        : 'Path does not exist on client device. It will be created on project creation.',
    };
  }
  // preserve local and ssh branches
}
```

Route behavior to add:

- `POST /projects`
  - accept `client + agent` and `client + browser`
- `POST /projects/path-check`
  - handle `client + agent`
  - reject `client + browser` with a specific capability/validation message

Use existing daemon records from `researchOpsStore.listDaemons` or `getRawDaemonById` to validate that a client agent exists and is online before project creation.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/projects.client-location.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/__tests__/projects.client-location.test.js backend/src/routes/researchops.js
git commit -m "feat: accept client project locations in researchops routes"
```

### Task 3: Enforce execution capabilities in runs and orchestrator

**Files:**
- Modify: `backend/src/routes/researchops/runs.js`
- Modify: `backend/src/services/researchops/orchestrator.js`
- Create: `backend/src/services/researchops/__tests__/project-capabilities.execution.test.js`

**Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertProjectExecutionAllowed } = require('../project-location.service');

test('rejects browser client projects for git-managed execution', () => {
  assert.throws(() => assertProjectExecutionAllowed({
    locationType: 'client',
    clientMode: 'browser',
  }, 'git-workspace'), /Browser-backed client projects do not support git-managed execution/i);
});

test('allows agent client projects for execution', () => {
  assert.doesNotThrow(() => assertProjectExecutionAllowed({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  }, 'run'));
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/project-capabilities.execution.test.js`

Expected: FAIL because `assertProjectExecutionAllowed` does not exist yet.

**Step 3: Write minimal implementation**

In `project-location.service.js`, add:

```js
function assertProjectExecutionAllowed(project, action = 'run') {
  const caps = deriveProjectCapabilities(project);
  if (!caps.canExecute) {
    throw new Error(`Browser-backed client projects do not support ${action}`);
  }
}
```

Then wire it into:

- `runs.js` before enqueue/dispatch paths that assume a routable execution target
- `orchestrator.js` inside `prepareGitWorkspace`

`prepareGitWorkspace` should treat:

- `ssh` as remote SSH
- `local` as backend/local executor
- `client + agent` as daemon-backed local execution using `project.serverId === project.clientDeviceId`
- `client + browser` as unsupported for git-managed execution

Do not silently coerce `client + agent` to `local-default`.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/project-capabilities.execution.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/runs.js backend/src/services/researchops/orchestrator.js backend/src/services/researchops/__tests__/project-capabilities.execution.test.js backend/src/services/researchops/project-location.service.js
git commit -m "feat: enforce execution capabilities for client projects"
```

### Task 4: Add frontend test harness and browser workspace registry

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.js`
- Create: `frontend/test/setup.js`
- Create: `frontend/src/hooks/useClientWorkspaceRegistry.js`
- Create: `frontend/src/hooks/__tests__/useClientWorkspaceRegistry.test.jsx`
- Reference: `frontend/src/hooks/useAiNotesSettings.js`

**Step 1: Write the failing test**

```jsx
import { describe, expect, it } from 'vitest';
import { saveWorkspaceLink, getWorkspaceLink } from '../useClientWorkspaceRegistry';

describe('client workspace registry', () => {
  it('stores browser workspace handles by workspace id', async () => {
    const fakeHandle = { kind: 'directory', name: 'demo-project' };
    await saveWorkspaceLink('cw_123', fakeHandle, { displayName: 'demo-project' });

    const linked = await getWorkspaceLink('cw_123');
    expect(linked.meta.displayName).toBe('demo-project');
    expect(linked.handle).toEqual(fakeHandle);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useClientWorkspaceRegistry.test.jsx`

Expected: FAIL because Vitest and the registry hook do not exist yet.

**Step 3: Write minimal implementation**

- add `test` script and dev dependencies for `vitest`, `jsdom`, `@testing-library/react`
- create a small IndexedDB helper modeled after `useAiNotesSettings`
- store records keyed by `clientWorkspaceId`

Minimal registry API:

```js
export async function saveWorkspaceLink(workspaceId, handle, meta = {}) { /* idbSet */ }
export async function getWorkspaceLink(workspaceId) { /* idbGet */ }
export async function removeWorkspaceLink(workspaceId) { /* idbDel */ }
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useClientWorkspaceRegistry.test.jsx`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/package.json frontend/vitest.config.js frontend/test/setup.js frontend/src/hooks/useClientWorkspaceRegistry.js frontend/src/hooks/__tests__/useClientWorkspaceRegistry.test.jsx
git commit -m "test: add browser workspace registry coverage"
```

### Task 5: Update the create-project modal for client device flows

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Create: `frontend/src/components/__tests__/VibeResearcherPanel.create-project.test.jsx`
- Modify: `frontend/src/index.css` if new controls need styling

**Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VibeResearcherPanel from '../VibeResearcherPanel';

it('shows client device mode controls when Local client device is selected', async () => {
  render(<VibeResearcherPanel />);

  await userEvent.selectOptions(screen.getByDisplayValue('Local backend host'), 'client');

  expect(screen.getByText('Connection mode')).toBeInTheDocument();
  expect(screen.getByText('Desktop agent')).toBeInTheDocument();
  expect(screen.getByText('Browser file access')).toBeInTheDocument();
});

it('sends browser workspace metadata instead of projectPath for browser-backed projects', async () => {
  // mock axios.post and verify payload:
  // { locationType: 'client', clientMode: 'browser', clientWorkspaceId: 'cw_123' }
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/VibeResearcherPanel.create-project.test.jsx`

Expected: FAIL because the UI does not expose the new controls yet.

**Step 3: Write minimal implementation**

Update component state:

```jsx
const [projectLocationType, setProjectLocationType] = useState('local');
const [projectClientMode, setProjectClientMode] = useState('agent');
const [projectClientDeviceId, setProjectClientDeviceId] = useState('');
const [projectClientWorkspaceId, setProjectClientWorkspaceId] = useState('');
```

Behavior:

- load daemon list and present agent-capable devices when `locationType === 'client'`
- use `Check Path` only for `client + agent`
- replace raw path entry with folder-link action for `client + browser`
- submit the correct payload for each mode
- show helper copy explaining browser limitations

Also update `resetProjectDraft`, `checkProjectPath`, and `handleCreateProject` so they do not force `projectPath` for browser-backed projects.

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/VibeResearcherPanel.create-project.test.jsx`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/__tests__/VibeResearcherPanel.create-project.test.jsx frontend/src/index.css
git commit -m "feat: add client device project creation flow"
```

### Task 6: Surface capability limits in run/deploy entry points and verify manually

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/routes/researchops/runs.js`
- Modify: `docs/README.md` or `README.md` if product copy needs updating

**Step 1: Write the failing test**

```js
test('projects API returns capability flags for browser-backed projects', async () => {
  const project = projectShape({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
  });

  assert.equal(project.capabilities.canExecute, false);
  assert.equal(project.capabilities.canDeployLocal, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/project-location.service.test.js`

Expected: FAIL until project shaping returns the capability block.

**Step 3: Write minimal implementation**

- ensure project list/detail responses include capabilities
- disable or annotate run/deploy actions when `canExecute === false`
- add helper text:
  - `Desktop agent supports full local execution`
  - `Browser file access supports local files only`

**Step 4: Verify**

Run:

```bash
node --test backend/src/services/researchops/__tests__/project-location.service.test.js
node --test backend/src/routes/researchops/__tests__/projects.client-location.test.js
node --test backend/src/services/researchops/__tests__/project-capabilities.execution.test.js
cd frontend && npx vitest run src/hooks/__tests__/useClientWorkspaceRegistry.test.jsx src/components/__tests__/VibeResearcherPanel.create-project.test.jsx
```

Expected: all PASS

Manual verification:

1. Open the create-project modal.
2. Select `Local client device`.
3. Confirm `Desktop agent` shows device picker + path + `Check Path`.
4. Confirm `Browser file access` shows folder link UI instead of path input.
5. Create one project of each client mode.
6. Confirm browser-backed projects show capability warnings and blocked execution actions.

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx backend/src/routes/researchops/projects.js backend/src/routes/researchops/runs.js README.md
git commit -m "feat: expose client project capabilities in UI"
```
