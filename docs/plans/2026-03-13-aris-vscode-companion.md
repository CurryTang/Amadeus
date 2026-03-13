# ARIS VS Code Companion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a compact VS Code extension that can launch, list, inspect, refresh, and retry ARIS runs using the existing backend as the source of truth.

**Architecture:** Add a dedicated `vscode-extension/` package. Keep backend orchestration unchanged, expose only the ARIS API shape the extension needs, and centralize extension state in the VS Code extension host while using a small webview only for selected run details.

**Tech Stack:** VS Code Extension API, TypeScript, Node.js, existing ARIS backend routes, lightweight webview HTML/CSS/JS, Node test runner or Vitest where appropriate.

---

### Task 1: Scaffold the VS Code extension package

**Files:**
- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/.vscodeignore`
- Create: `vscode-extension/src/extension.ts`
- Create: `vscode-extension/src/test/suite/extension.test.ts`

**Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';

suite('extension activation', () => {
  test('registers the ARIS extension commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('aris.newRun'));
    assert.ok(commands.includes('aris.refresh'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test`
Expected: FAIL because the extension package and command registration do not exist yet.

**Step 3: Write minimal implementation**

```ts
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('aris.newRun', async () => {}),
    vscode.commands.registerCommand('aris.refresh', async () => {})
  );
}
```

Define the `ARIS` view container and base activation events in `vscode-extension/package.json`.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test`
Expected: PASS for activation and command registration.

**Step 5: Commit**

```bash
git add vscode-extension/package.json vscode-extension/tsconfig.json vscode-extension/.vscodeignore vscode-extension/src/extension.ts vscode-extension/src/test/suite/extension.test.ts
git commit -m "feat: scaffold ARIS VS Code extension"
```

### Task 2: Add a typed ARIS API client for the extension

**Files:**
- Create: `vscode-extension/src/aris/types.ts`
- Create: `vscode-extension/src/aris/client.ts`
- Create: `vscode-extension/src/test/suite/aris-client.test.ts`

**Step 1: Write the failing test**

```ts
test('normalizes ARIS run payloads from the backend', async () => {
  const client = new ArisClient({ baseUrl: 'http://localhost:3000/api', fetchImpl: mockFetch });
  const runs = await client.listRuns();
  assert.equal(runs[0].id, 'run_123');
  assert.equal(runs[0].status, 'running');
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- aris-client`
Expected: FAIL because the client and types do not exist.

**Step 3: Write minimal implementation**

```ts
export interface ArisRun {
  id: string;
  title: string;
  workflow: string;
  status: string;
  updatedAt: string | null;
}

export class ArisClient {
  async listRuns(): Promise<ArisRun[]> {
    const payload = await this.request('/aris/runs');
    return normalizeRuns(payload.runs ?? []);
  }
}
```

Normalize `context`, `run`, and `retry` responses in one place so the rest of the extension does not depend on backend shape drift.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- aris-client`
Expected: PASS with stable normalized run output.

**Step 5: Commit**

```bash
git add vscode-extension/src/aris/types.ts vscode-extension/src/aris/client.ts vscode-extension/src/test/suite/aris-client.test.ts
git commit -m "feat: add ARIS API client for VS Code extension"
```

### Task 3: Add settings and secret-backed authentication

**Files:**
- Create: `vscode-extension/src/config.ts`
- Create: `vscode-extension/src/auth.ts`
- Create: `vscode-extension/src/test/suite/auth.test.ts`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('reads API base URL from configuration and token from secret storage', async () => {
  const config = new ArisConfig(fakeContext);
  assert.equal(config.apiBaseUrl, 'https://example.com/api');
  assert.equal(await config.getAuthToken(), 'token-123');
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- auth`
Expected: FAIL because configuration and auth helpers are not implemented.

**Step 3: Write minimal implementation**

```ts
export async function getAuthToken(context: vscode.ExtensionContext) {
  return context.secrets.get('aris.authToken');
}

export function getApiBaseUrl() {
  return vscode.workspace.getConfiguration('aris').get<string>('apiBaseUrl', '');
}
```

Register commands for `ARIS: Sign In` and `ARIS: Sign Out` only if token management is required for initial usability.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- auth`
Expected: PASS with configuration and secret lookup working.

**Step 5: Commit**

```bash
git add vscode-extension/src/config.ts vscode-extension/src/auth.ts vscode-extension/src/test/suite/auth.test.ts vscode-extension/src/extension.ts
git commit -m "feat: add ARIS extension config and auth storage"
```

### Task 4: Implement the Projects and Runs sidebar views

**Files:**
- Create: `vscode-extension/src/views/projectsProvider.ts`
- Create: `vscode-extension/src/views/runsProvider.ts`
- Create: `vscode-extension/src/state/store.ts`
- Create: `vscode-extension/src/test/suite/views.test.ts`
- Modify: `vscode-extension/package.json`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('runs provider renders compact run items for the active project', async () => {
  const store = createStoreWithRuns();
  const provider = new RunsProvider(store);
  const items = await provider.getChildren();
  assert.equal(items[0].label, 'Literature Review');
  assert.equal(items[0].description, 'running');
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- views`
Expected: FAIL because the tree providers and state store do not exist.

**Step 3: Write minimal implementation**

```ts
export class RunsProvider implements vscode.TreeDataProvider<RunItem> {
  getChildren(): RunItem[] {
    return this.store.visibleRuns.map((run) => new RunItem(run));
  }
}
```

Add the `ARIS` container plus `Projects` and `Runs` views in the extension manifest. Keep rows compact: title, status, workflow, updated time.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- views`
Expected: PASS with filtered project/run lists.

**Step 5: Commit**

```bash
git add vscode-extension/src/views/projectsProvider.ts vscode-extension/src/views/runsProvider.ts vscode-extension/src/state/store.ts vscode-extension/src/test/suite/views.test.ts vscode-extension/package.json vscode-extension/src/extension.ts
git commit -m "feat: add ARIS project and run sidebar views"
```

### Task 5: Implement the New Run and Refresh commands

**Files:**
- Create: `vscode-extension/src/commands/newRun.ts`
- Create: `vscode-extension/src/commands/refresh.ts`
- Create: `vscode-extension/src/test/suite/new-run.test.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/state/store.ts`

**Step 1: Write the failing test**

```ts
test('new run command submits project, workflow, and prompt to the ARIS API client', async () => {
  const client = mockClient();
  await runNewRunCommand({ client, quickPick, inputBox });
  assert.equal(client.createRunCalls.length, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- new-run`
Expected: FAIL because command handlers do not exist.

**Step 3: Write minimal implementation**

```ts
export async function runNewRunCommand(deps: Deps) {
  const projectId = await deps.pickProject();
  const workflow = await deps.pickWorkflow();
  const prompt = await deps.promptForText();
  await deps.client.createRun({ projectId, workflowType: workflow, prompt });
  await deps.store.refresh();
}
```

Use VS Code quick picks and input boxes instead of opening a large form webview.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- new-run`
Expected: PASS with one API call and store refresh.

**Step 5: Commit**

```bash
git add vscode-extension/src/commands/newRun.ts vscode-extension/src/commands/refresh.ts vscode-extension/src/test/suite/new-run.test.ts vscode-extension/src/extension.ts vscode-extension/src/state/store.ts
git commit -m "feat: add ARIS new run and refresh commands"
```

### Task 6: Implement run selection and the detail webview

**Files:**
- Create: `vscode-extension/src/webview/runDetailPanel.ts`
- Create: `vscode-extension/src/webview/templates/runDetailHtml.ts`
- Create: `vscode-extension/src/test/suite/run-detail.test.ts`
- Modify: `vscode-extension/src/views/runsProvider.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/state/store.ts`

**Step 1: Write the failing test**

```ts
test('renders selected run details in the webview payload', () => {
  const html = renderRunDetailHtml(sampleRun);
  assert.match(html, /Literature Review/);
  assert.match(html, /retry/i);
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- run-detail`
Expected: FAIL because the detail renderer does not exist.

**Step 3: Write minimal implementation**

```ts
export function renderRunDetailHtml(run: ArisRunDetail): string {
  return `
    <html>
      <body>
        <h1>${escapeHtml(run.title)}</h1>
        <p>${escapeHtml(run.prompt)}</p>
        <button data-action="retry">Retry</button>
      </body>
    </html>
  `;
}
```

Wire selection from the runs provider to a singleton detail panel. Keep the webview passive: data comes from the extension host, and button clicks post messages back to the host.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- run-detail`
Expected: PASS with stable HTML output and selection wiring.

**Step 5: Commit**

```bash
git add vscode-extension/src/webview/runDetailPanel.ts vscode-extension/src/webview/templates/runDetailHtml.ts vscode-extension/src/test/suite/run-detail.test.ts vscode-extension/src/views/runsProvider.ts vscode-extension/src/extension.ts vscode-extension/src/state/store.ts
git commit -m "feat: add ARIS run detail webview"
```

### Task 7: Implement retry and copy-run-id actions

**Files:**
- Create: `vscode-extension/src/commands/retryRun.ts`
- Create: `vscode-extension/src/commands/copyRunId.ts`
- Create: `vscode-extension/src/test/suite/retry-run.test.ts`
- Modify: `vscode-extension/src/webview/runDetailPanel.ts`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('retry run command posts a retry request for the selected run', async () => {
  const client = mockClient();
  await retrySelectedRun({ client, selectedRunId: 'run_123' });
  assert.equal(client.retryRunCalls[0], 'run_123');
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- retry-run`
Expected: FAIL because retry and copy actions are not implemented.

**Step 3: Write minimal implementation**

```ts
export async function retrySelectedRun(deps: Deps) {
  if (!deps.selectedRunId) return;
  await deps.client.retryRun(deps.selectedRunId);
  await deps.store.refresh();
}
```

Expose retry from both the command palette and the webview action message handler. Copying the run ID should use `vscode.env.clipboard`.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- retry-run`
Expected: PASS with retry request and clipboard action covered.

**Step 5: Commit**

```bash
git add vscode-extension/src/commands/retryRun.ts vscode-extension/src/commands/copyRunId.ts vscode-extension/src/test/suite/retry-run.test.ts vscode-extension/src/webview/runDetailPanel.ts vscode-extension/src/extension.ts
git commit -m "feat: add ARIS retry and run ID commands"
```

### Task 8: Add polling, visibility-aware refresh, and output-channel diagnostics

**Files:**
- Create: `vscode-extension/src/polling.ts`
- Create: `vscode-extension/src/logging.ts`
- Create: `vscode-extension/src/test/suite/polling.test.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/state/store.ts`

**Step 1: Write the failing test**

```ts
test('polling pauses when the ARIS views are hidden', async () => {
  const controller = new PollingController(fakeWindowState, fakeStore);
  controller.start();
  fakeWindowState.visible = false;
  await controller.tick();
  assert.equal(fakeStore.refreshCalls, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `cd vscode-extension && npm test -- polling`
Expected: FAIL because polling and diagnostics helpers do not exist.

**Step 3: Write minimal implementation**

```ts
export class PollingController {
  async tick() {
    if (!this.visibility.isVisible()) return;
    await this.store.refresh();
  }
}
```

Write refresh and API error diagnostics to a dedicated `ARIS` output channel. Keep polling conservative and configuration-driven.

**Step 4: Run test to verify it passes**

Run: `cd vscode-extension && npm test -- polling`
Expected: PASS with hidden-view throttling behavior enforced.

**Step 5: Commit**

```bash
git add vscode-extension/src/polling.ts vscode-extension/src/logging.ts vscode-extension/src/test/suite/polling.test.ts vscode-extension/src/extension.ts vscode-extension/src/state/store.ts
git commit -m "feat: add ARIS polling and extension diagnostics"
```

### Task 9: Backfill backend support if ARIS detail or retry endpoints are missing

**Files:**
- Modify: `backend/src/routes/aris.js`
- Modify: `backend/src/services/aris.service.js`
- Create: `backend/src/services/__tests__/aris.service.test.js`

**Step 1: Write the failing test**

```js
test('returns normalized detail for a single ARIS run and supports retry', async () => {
  const detail = await getRunById('run_123');
  assert.equal(detail.id, 'run_123');
  const retried = await retryRun('run_123');
  assert.equal(retried.status, 'queued');
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/__tests__/aris.service.test.js`
Expected: FAIL if detail or retry behavior is incomplete.

**Step 3: Write minimal implementation**

```js
async function getRunById(id) {
  return normalizeRunDetail(await runStore.findById(id));
}

async function retryRun(id) {
  return enqueueRetry(await runStore.findById(id));
}
```

Only do this task if the existing ARIS backend contract is insufficient for the extension.

**Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/__tests__/aris.service.test.js`
Expected: PASS with extension-needed detail and retry behavior covered.

**Step 5: Commit**

```bash
git add backend/src/routes/aris.js backend/src/services/aris.service.js backend/src/services/__tests__/aris.service.test.js
git commit -m "feat: fill ARIS API gaps for VS Code companion"
```

### Task 10: Document usage and verify the extension end-to-end

**Files:**
- Create: `vscode-extension/README.md`
- Modify: `docs/README.md`
- Modify: `docs/INSTALLATION_MODES.md`

**Step 1: Write the failing test**

```md
Manual verification checklist:
- Can sign in or configure API access
- Can load projects
- Can load runs
- Can create a run
- Can open run detail
- Can retry a run
```

**Step 2: Run verification to capture current failure**

Run: `cd vscode-extension && npm run compile && npm test`
Expected: Any missing command, view, or API behavior is caught before documenting completion.

**Step 3: Write minimal implementation**

Document:

- how to run the extension in VS Code Extension Development Host
- required settings
- expected ARIS backend endpoints
- what is intentionally out of scope for v1

**Step 4: Run verification to confirm completion**

Run: `cd vscode-extension && npm run compile && npm test`
Expected: PASS

Run: `cd backend && node --test src/services/__tests__/aris.service.test.js`
Expected: PASS if Task 9 was needed

Manual:
- Launch Extension Development Host
- Run `ARIS: Refresh`
- Run `ARIS: New Run`
- Select a run from the `Runs` view
- Confirm detail pane content
- Run `ARIS: Retry Run`

**Step 5: Commit**

```bash
git add vscode-extension/README.md docs/README.md docs/INSTALLATION_MODES.md
git commit -m "docs: add ARIS VS Code companion usage guide"
```
