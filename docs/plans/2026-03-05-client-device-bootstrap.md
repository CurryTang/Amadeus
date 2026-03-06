# Client Device Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an inline `Connect this device` setup flow in the create-project modal so first-time client-device projects can bootstrap a local processing runtime, register a client daemon, and immediately continue with client-backed project creation.

**Architecture:** Reuse the existing `processing-server.js` runtime as the long-lived local client service. Add short-lived bootstrap tokens on the backend, let the daemon redeem those tokens during first registration, and surface the enrollment flow inline in the modal with polling and auto-selection.

**Tech Stack:** Express, React, Axios, in-memory/Mongo ResearchOps store, Node `node:test`, existing ResearchOps daemon routes, shell bootstrap scripts.

---

### Task 1: Add bootstrap token store support

**Files:**
- Modify: `backend/src/services/researchops/store.js`
- Create: `backend/src/services/researchops/__tests__/daemon-bootstrap.store.test.js`

**Step 1: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');

test('creates and redeems a daemon bootstrap token once', async () => {
  const created = await store.createDaemonBootstrapToken('u1', {
    requestedHostname: 'alice-mbp',
    ttlMs: 60_000,
  });

  assert.equal(typeof created.bootstrapId, 'string');
  assert.equal(typeof created.secret, 'string');

  const redeemed = await store.redeemDaemonBootstrapToken('u1', {
    bootstrapId: created.bootstrapId,
    secret: created.secret,
    serverId: 'srv_client_1',
  });

  assert.equal(redeemed.status, 'REDEEMED');

  await assert.rejects(() => store.redeemDaemonBootstrapToken('u1', {
    bootstrapId: created.bootstrapId,
    secret: created.secret,
    serverId: 'srv_client_2',
  }), /already redeemed/i);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/researchops/__tests__/daemon-bootstrap.store.test.js`

Expected: FAIL because bootstrap token helpers do not exist.

**Step 3: Write minimal implementation**

- Add bootstrap-token persistence to the in-memory and Mongo-backed ResearchOps store.
- Store only a hash of the secret.
- Return the raw secret only from creation.
- Implement:
  - `createDaemonBootstrapToken`
  - `getDaemonBootstrapToken`
  - `redeemDaemonBootstrapToken`
  - `expireDaemonBootstrapTokenIfNeeded`

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/researchops/__tests__/daemon-bootstrap.store.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/store.js backend/src/services/researchops/__tests__/daemon-bootstrap.store.test.js
git commit -m "feat: add daemon bootstrap token store"
```

### Task 2: Add bootstrap API routes and registration redemption

**Files:**
- Modify: `backend/src/routes/researchops/admin.js`
- Modify: `backend/src/services/researchops/client-daemon.service.js`
- Create: `backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js`

**Step 1: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('bootstrap create route returns token metadata and install payload', async () => {
  const response = await createBootstrap({
    requestedHostname: 'alice-mbp',
  });

  assert.equal(typeof response.bootstrapId, 'string');
  assert.equal(typeof response.secret, 'string');
  assert.match(response.installCommand, /RESEARCHOPS_BOOTSTRAP_TOKEN/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js`

Expected: FAIL because the routes and helpers do not exist.

**Step 3: Write minimal implementation**

- Add:
  - `POST /researchops/daemons/bootstrap`
  - `GET /researchops/daemons/bootstrap/:id`
- Extend daemon registration to accept bootstrap enrollment data:
  - `bootstrapId`
  - `bootstrapSecret`
- On successful registration:
  - redeem the bootstrap token
  - bind it to the returned `serverId`
- Generate install metadata for the frontend:
  - API base URL
  - shell command
  - bootstrap file payload

**Step 4: Extend the client daemon runtime**

- Allow `startClientDaemon(...)` to register using bootstrap credentials when bearer auth is absent.
- Keep the existing bearer-token path unchanged.

**Step 5: Run test to verify it passes**

Run: `node --test backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/routes/researchops/admin.js backend/src/services/researchops/client-daemon.service.js backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
git commit -m "feat: add daemon bootstrap enrollment routes"
```

### Task 3: Add a local bootstrap launcher

**Files:**
- Create: `backend/scripts/researchops-bootstrap-client.sh`
- Modify: `backend/scripts/researchops-client-daemon.js`
- Modify: `backend/processing-server.js`

**Step 1: Write the failing smoke expectation**

Document the command shape in a script-oriented test or fixture:

```sh
RESEARCHOPS_API_BASE_URL="https://example.com/api" \
RESEARCHOPS_BOOTSTRAP_ID="db_123" \
RESEARCHOPS_BOOTSTRAP_SECRET="secret" \
RESEARCHOPS_DAEMON_HOSTNAME="alice-mbp" \
sh backend/scripts/researchops-bootstrap-client.sh
```

Expected behavior:

- writes local env/config
- starts or restarts `processing-server.js`
- the runtime auto-registers via bootstrap token

**Step 2: Run the smoke check to verify it fails**

Run: `node --check backend/scripts/researchops-client-daemon.js`

Expected: existing runtime lacks bootstrap env handling.

**Step 3: Write minimal implementation**

- Add a shell bootstrap script that:
  - validates required env vars
  - writes a small env file or exports vars for the current session
  - starts the processing server in the supported local environment
- Extend `processing-server.js` and the client daemon script to read:
  - `RESEARCHOPS_BOOTSTRAP_ID`
  - `RESEARCHOPS_BOOTSTRAP_SECRET`
- Clear bootstrap-only env after successful redemption if practical for the runtime model.

**Step 4: Run smoke verification**

Run:
- `node --check backend/processing-server.js`
- `node --check backend/scripts/researchops-client-daemon.js`
- `sh -n backend/scripts/researchops-bootstrap-client.sh`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/scripts/researchops-bootstrap-client.sh backend/scripts/researchops-client-daemon.js backend/processing-server.js
git commit -m "feat: add client bootstrap launcher"
```

### Task 4: Add inline bootstrap UI to the create-project modal

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Create: `frontend/src/components/__tests__/VibeResearcherPanel.client-bootstrap.test.jsx`

**Step 1: Write the failing test**

```jsx
it('shows connect-this-device bootstrap panel when no client devices are online', async () => {
  render(<VibeResearcherPanel />);

  openCreateProjectModal();
  await user.selectOptions(screen.getByDisplayValue('Local backend host'), 'client');
  await user.selectOptions(screen.getByDisplayValue('Desktop agent'), 'agent');

  expect(screen.getByRole('button', { name: /connect this device/i })).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- VibeResearcherPanel.client-bootstrap.test.jsx`

Expected: FAIL because the inline bootstrap panel does not exist.

**Step 3: Write minimal implementation**

- Add modal state for:
  - bootstrap panel visibility
  - bootstrap token payload
  - waiting/polling state
  - requested device name
- Add inline actions:
  - `Connect this device`
  - `Copy install command`
  - `Download bootstrap file`
  - `Refresh device status`
- If no devices are online, open the bootstrap panel automatically.

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- VibeResearcherPanel.client-bootstrap.test.jsx`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/__tests__/VibeResearcherPanel.client-bootstrap.test.jsx
git commit -m "feat: add inline client bootstrap flow"
```

### Task 5: Poll bootstrap state and auto-select the connected device

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `backend/src/routes/researchops/admin.js`
- Extend: `frontend/src/components/__tests__/VibeResearcherPanel.client-bootstrap.test.jsx`

**Step 1: Write the failing test**

```jsx
it('auto-selects the newly connected client device after bootstrap redemption', async () => {
  mockBootstrapCreated();
  mockBootstrapStatusRedeemed({ redeemedServerId: 'srv_client_1' });
  mockClientDevices([{ id: 'srv_client_1', hostname: 'alice-mbp', status: 'ONLINE' }]);

  render(<VibeResearcherPanel />);
  openBootstrapPanel();

  await waitFor(() => {
    expect(screen.getByDisplayValue('srv_client_1')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- VibeResearcherPanel.client-bootstrap.test.jsx`

Expected: FAIL because there is no bootstrap polling/auto-selection logic.

**Step 3: Write minimal implementation**

- Poll bootstrap status while the modal is in `waiting-for-device`.
- Refresh daemon list on the same interval.
- When the token is redeemed and the server appears online:
  - select that device
  - close the bootstrap panel
  - preserve project draft fields
- Handle expiry and retry cleanly.

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- VibeResearcherPanel.client-bootstrap.test.jsx`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/__tests__/VibeResearcherPanel.client-bootstrap.test.jsx backend/src/routes/researchops/admin.js
git commit -m "feat: auto-select connected client device after bootstrap"
```

### Task 6: Run full verification and update plan docs if needed

**Files:**
- Modify: `docs/plans/2026-03-05-client-device-bootstrap-design.md`
- Modify: `docs/plans/2026-03-05-client-device-bootstrap.md`

**Step 1: Run backend verification**

Run:

```bash
node --test \
  backend/src/services/researchops/__tests__/project-location.service.test.js \
  backend/src/routes/researchops/__tests__/projects.client-location.test.js \
  backend/src/services/researchops/__tests__/project-capabilities.execution.test.js \
  backend/src/services/researchops/__tests__/daemon-rpc.service.test.js \
  backend/src/services/researchops/__tests__/client-daemon.service.test.js \
  backend/src/services/researchops/__tests__/daemon-bootstrap.store.test.js \
  backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
```

Expected: PASS

**Step 2: Run backend syntax and load checks**

Run:

```bash
node --check backend/processing-server.js
node --check backend/scripts/researchops-client-daemon.js
sh -n backend/scripts/researchops-bootstrap-client.sh
node -e "require('./backend/src/routes/researchops/admin'); require('./backend/src/routes/researchops/projects'); require('./backend/src/services/researchops/client-daemon.service'); console.log('ok')"
```

Expected: PASS

**Step 3: Run frontend verification**

Run:

```bash
cd frontend && npm test -- VibeResearcherPanel.client-bootstrap.test.jsx
cd frontend && npm run build
```

Expected: PASS, allowing existing unrelated warnings only if the build still completes.

**Step 4: Update docs only if implementation diverged**

- Adjust the design doc and plan if final implementation required a materially different route or runtime shape.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-05-client-device-bootstrap-design.md docs/plans/2026-03-05-client-device-bootstrap.md
git commit -m "docs: finalize client bootstrap implementation plan"
```
