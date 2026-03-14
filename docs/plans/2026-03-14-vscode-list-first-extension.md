# VS Code List-First Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the existing VS Code companion into a compact list-first Auto Researcher extension that supports tracked papers, explicit save to library, library paper actions, and the existing ARIS run controls.

**Architecture:** Keep the current `vscode-extension/` package and extend it incrementally. Add separate typed clients, stores, list providers, and detail renderers for tracker and library alongside the existing ARIS modules, while keeping backend mutations authoritative for save and reader actions.

**Tech Stack:** VS Code Extension API, TypeScript, existing Node/Express backend routes, lightweight webviews, node:test, existing extension package in `vscode-extension/`.

---

### Task 1: Define typed tracker and library domain models and API clients

**Files:**
- Create: `vscode-extension/src/tracker/types.ts`
- Create: `vscode-extension/src/tracker/client.ts`
- Create: `vscode-extension/src/library/types.ts`
- Create: `vscode-extension/src/library/client.ts`
- Test: `vscode-extension/src/test/suite/trackerClient.test.ts`
- Test: `vscode-extension/src/test/suite/libraryClient.test.ts`

**Step 1: Write the failing test**

```ts
test('TrackerClient normalizes tracker feed items and save status', async () => {
  const client = new TrackerClient({ baseUrl: 'http://localhost:3000/api', fetchImpl: mockFetch });
  const papers = await client.listTrackedPapers();
  assert.equal(papers[0].saved, false);
  assert.equal(papers[0].title, 'Test Paper');
});
```

```ts
test('LibraryClient normalizes library items and reader-related fields', async () => {
  const client = new LibraryClient({ baseUrl: 'http://localhost:3000/api', fetchImpl: mockFetch });
  const papers = await client.listLibraryPapers();
  assert.equal(papers[0].read, false);
  assert.equal(papers[0].processingStatus, 'idle');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because the tracker/library clients and types do not exist yet.

**Step 3: Write minimal implementation**

```ts
export type TrackedPaperSummary = {
  id: string;
  title: string;
  source: string;
  saved: boolean;
};

export class TrackerClient {
  async listTrackedPapers(): Promise<TrackedPaperSummary[]> {
    const payload = await this.request('/tracker/feed');
    return normalizeTrackedPapers(payload.items ?? []);
  }
}
```

```ts
export type LibraryPaperSummary = {
  id: string;
  title: string;
  read: boolean;
  processingStatus: string;
};
```

Normalize all payload shape drift in the client layer, not in stores or views.

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with stable tracker/library client normalization.

**Step 5: Commit**

```bash
git add vscode-extension/src/tracker/types.ts vscode-extension/src/tracker/client.ts vscode-extension/src/library/types.ts vscode-extension/src/library/client.ts vscode-extension/src/test/suite/trackerClient.test.ts vscode-extension/src/test/suite/libraryClient.test.ts
git commit -m "feat: add tracker and library extension clients"
```

### Task 2: Add tracker store, list view, and tracked-paper detail rendering

**Files:**
- Create: `vscode-extension/src/tracker/store.ts`
- Create: `vscode-extension/src/views/trackedPapersProvider.ts`
- Create: `vscode-extension/src/webview/templates/trackedPaperDetailHtml.ts`
- Test: `vscode-extension/src/test/suite/trackerStore.test.ts`
- Test: `vscode-extension/src/test/suite/trackedPaperDetail.test.ts`
- Modify: `vscode-extension/package.json`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('TrackedPapersProvider returns compact rows with saved state', async () => {
  const provider = new TrackedPapersProvider(storeWithTrackedPapers());
  const items = await provider.getChildren();
  assert.equal(items[0].label, 'Test Paper');
  assert.equal(items[0].description, 'arXiv');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because the tracker store, provider, and detail renderer do not exist yet.

**Step 3: Write minimal implementation**

```ts
export class TrackerStore {
  async refresh() {
    this.items = await this.client.listTrackedPapers();
  }
}
```

Render the tracked-paper detail pane with:

- title
- authors
- source
- date
- abstract/snippet
- `Save` action

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with compact tracker rows and detail rendering.

**Step 5: Commit**

```bash
git add vscode-extension/src/tracker/store.ts vscode-extension/src/views/trackedPapersProvider.ts vscode-extension/src/webview/templates/trackedPaperDetailHtml.ts vscode-extension/src/test/suite/trackerStore.test.ts vscode-extension/src/test/suite/trackedPaperDetail.test.ts vscode-extension/package.json vscode-extension/src/extension.ts
git commit -m "feat: add tracked papers view to VS Code extension"
```

### Task 3: Add explicit save action for tracker papers

**Files:**
- Create: `vscode-extension/src/commands/saveTrackedPaper.ts`
- Test: `vscode-extension/src/test/suite/saveTrackedPaper.test.ts`
- Modify: `vscode-extension/src/tracker/client.ts`
- Modify: `vscode-extension/src/tracker/store.ts`
- Modify: `vscode-extension/src/webview/runDetailPanel.ts` or add a shared detail controller
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('saveTrackedPaper calls the backend save route and updates saved state', async () => {
  await runSaveTrackedPaperCommand(deps);
  assert.equal(client.saveCalls.length, 1);
  assert.equal(store.items[0].saved, true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because save action plumbing does not exist.

**Step 3: Write minimal implementation**

```ts
export async function runSaveTrackedPaperCommand(deps: Deps) {
  if (!deps.store.selectedPaperId) return;
  await deps.client.saveTrackedPaper(deps.store.selectedPaperId);
  await deps.store.refresh();
}
```

The UI must remain explicit:

- tracked paper only gets `Save`
- save goes through backend
- no auto-save behavior

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with saved state update and explicit backend call.

**Step 5: Commit**

```bash
git add vscode-extension/src/commands/saveTrackedPaper.ts vscode-extension/src/test/suite/saveTrackedPaper.test.ts vscode-extension/src/tracker/client.ts vscode-extension/src/tracker/store.ts vscode-extension/src/extension.ts
git commit -m "feat: allow explicit save from tracked papers"
```

### Task 4: Add library store, list view, and library detail rendering

**Files:**
- Create: `vscode-extension/src/library/store.ts`
- Create: `vscode-extension/src/views/libraryProvider.ts`
- Create: `vscode-extension/src/webview/templates/libraryPaperDetailHtml.ts`
- Test: `vscode-extension/src/test/suite/libraryStore.test.ts`
- Test: `vscode-extension/src/test/suite/libraryPaperDetail.test.ts`
- Modify: `vscode-extension/package.json`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('LibraryProvider returns compact rows with read and processing state', async () => {
  const provider = new LibraryProvider(storeWithLibraryItems());
  const items = await provider.getChildren();
  assert.equal(items[0].label, 'Saved Paper');
  assert.equal(items[0].description, 'unread · idle');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because the library store, provider, and detail renderer do not exist.

**Step 3: Write minimal implementation**

```ts
export class LibraryStore {
  async refresh() {
    this.items = await this.client.listLibraryPapers();
  }
}
```

Library detail should show:

- title
- authors
- read/unread state
- reader processing status
- notes availability
- library-only actions

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with compact library rows and detail rendering.

**Step 5: Commit**

```bash
git add vscode-extension/src/library/store.ts vscode-extension/src/views/libraryProvider.ts vscode-extension/src/webview/templates/libraryPaperDetailHtml.ts vscode-extension/src/test/suite/libraryStore.test.ts vscode-extension/src/test/suite/libraryPaperDetail.test.ts vscode-extension/package.json vscode-extension/src/extension.ts
git commit -m "feat: add library view to VS Code extension"
```

### Task 5: Add library actions for read state and reader queueing

**Files:**
- Create: `vscode-extension/src/commands/markPaperRead.ts`
- Create: `vscode-extension/src/commands/markPaperUnread.ts`
- Create: `vscode-extension/src/commands/queueReader.ts`
- Test: `vscode-extension/src/test/suite/libraryActions.test.ts`
- Modify: `vscode-extension/src/library/client.ts`
- Modify: `vscode-extension/src/library/store.ts`
- Modify: `vscode-extension/src/extension.ts`

**Step 1: Write the failing test**

```ts
test('library actions call backend mutations and refresh library state', async () => {
  await runQueueReaderCommand(deps);
  await runMarkPaperReadCommand(deps);
  assert.equal(client.queueCalls[0], 'doc_1');
  assert.equal(client.markReadCalls[0].read, true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because the library mutation commands do not exist.

**Step 3: Write minimal implementation**

```ts
export async function runMarkPaperReadCommand(deps: Deps) {
  if (!deps.store.selectedPaperId) return;
  await deps.client.setReadState(deps.store.selectedPaperId, true);
  await deps.store.refresh();
}
```

Library-only actions must never appear on tracked-paper detail.

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with backend-driven library actions.

**Step 5: Commit**

```bash
git add vscode-extension/src/commands/markPaperRead.ts vscode-extension/src/commands/markPaperUnread.ts vscode-extension/src/commands/queueReader.ts vscode-extension/src/test/suite/libraryActions.test.ts vscode-extension/src/library/client.ts vscode-extension/src/library/store.ts vscode-extension/src/extension.ts
git commit -m "feat: add library actions to VS Code extension"
```

### Task 6: Unify selection handling and domain-specific detail panes

**Files:**
- Create: `vscode-extension/src/webview/detailController.ts`
- Modify: `vscode-extension/src/webview/runDetailPanel.ts`
- Modify: `vscode-extension/src/webview/templates/trackedPaperDetailHtml.ts`
- Modify: `vscode-extension/src/webview/templates/libraryPaperDetailHtml.ts`
- Modify: `vscode-extension/src/extension.ts`
- Test: `vscode-extension/src/test/suite/detailController.test.ts`

**Step 1: Write the failing test**

```ts
test('detail controller renders the correct pane for tracked papers, library papers, and ARIS runs', () => {
  const html = controller.render({ kind: 'tracked-paper', item });
  assert.match(html, /Save/);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because detail routing does not exist yet.

**Step 3: Write minimal implementation**

```ts
switch (selection.kind) {
  case 'tracked-paper':
    return renderTrackedPaperDetailHtml(selection.item);
  case 'library-paper':
    return renderLibraryPaperDetailHtml(selection.item);
  case 'aris-run':
    return renderRunDetailHtml(selection.item);
}
```

Do not over-genericize; just centralize selection-to-renderer routing cleanly.

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with correct detail routing by domain.

**Step 5: Commit**

```bash
git add vscode-extension/src/webview/detailController.ts vscode-extension/src/webview/runDetailPanel.ts vscode-extension/src/extension.ts vscode-extension/src/test/suite/detailController.test.ts
git commit -m "refactor: unify detail handling across extension views"
```

### Task 7: Expand extension manifest, commands, and refresh wiring for all four views

**Files:**
- Modify: `vscode-extension/package.json`
- Modify: `vscode-extension/src/core/commandRegistry.ts`
- Modify: `vscode-extension/src/extension.ts`
- Modify: `vscode-extension/src/polling.ts`
- Test: `vscode-extension/src/test/suite/commandRegistry.test.ts`
- Test: `vscode-extension/src/test/suite/polling.test.ts`

**Step 1: Write the failing test**

```ts
test('command registry includes tracker and library commands', async () => {
  assert.ok(registered.includes('autoResearcher.saveTrackedPaper'));
  assert.ok(registered.includes('autoResearcher.queueReader'));
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: FAIL because the expanded command set and views are not fully registered.

**Step 3: Write minimal implementation**

Register:

- tracked paper refresh/save commands
- library refresh/read/reader commands
- existing ARIS commands

Keep refresh domain-specific instead of one monolithic refresh if that keeps behavior simpler.

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS with expanded command registry and stable polling behavior.

**Step 5: Commit**

```bash
git add vscode-extension/package.json vscode-extension/src/core/commandRegistry.ts vscode-extension/src/extension.ts vscode-extension/src/polling.ts vscode-extension/src/test/suite/commandRegistry.test.ts vscode-extension/src/test/suite/polling.test.ts
git commit -m "feat: wire tracker and library domains into extension host"
```

### Task 8: Backfill backend API gaps for tracker save and compact library actions only if needed

**Files:**
- Modify: `backend/src/routes/tracker.js`
- Modify: `backend/src/routes/documents.js`
- Modify: `backend/src/routes/reader.js`
- Create: `backend/src/routes/__tests__/tracker-save.test.js`
- Create: `backend/src/routes/__tests__/library-actions.test.js`

**Step 1: Write the failing test**

```js
test('tracker feed item can be explicitly saved into the library without auto-save', async () => {
  const res = await request(app).post('/api/tracker/feed/items/item_1/save');
  assert.equal(res.statusCode, 201);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/czk/auto-researcher/backend && node --test src/routes/__tests__/tracker-save.test.js src/routes/__tests__/library-actions.test.js`
Expected: FAIL if the required compact routes do not exist or are not shaped cleanly.

**Step 3: Write minimal implementation**

Add only the smallest backend contract the extension needs:

- compact tracker list if current feed shape is unsuitable
- explicit save action
- library read-state mutation
- reader queue action

Do not move business logic into the extension to avoid this backend task.

**Step 4: Run test to verify it passes**

Run: `cd /Users/czk/auto-researcher/backend && node --test src/routes/__tests__/tracker-save.test.js src/routes/__tests__/library-actions.test.js`
Expected: PASS if backend gaps existed and were filled.

**Step 5: Commit**

```bash
git add backend/src/routes/tracker.js backend/src/routes/documents.js backend/src/routes/reader.js backend/src/routes/__tests__/tracker-save.test.js backend/src/routes/__tests__/library-actions.test.js
git commit -m "feat: add backend support for compact VS Code tracker and library actions"
```

### Task 9: Update docs, debug guidance, and manual verification workflow

**Files:**
- Modify: `vscode-extension/README.md`
- Modify: `README.md`
- Modify: `docs/INSTALLATION_MODES.md`
- Modify: `vscode-extension/.vscode/launch.json`
- Modify: `vscode-extension/.vscode/tasks.json`

**Step 1: Write the failing test**

```md
Manual verification checklist:
- tracked papers load
- save works explicitly
- library papers load
- mark read works
- queue reader works
- ARIS still refreshes and runs
```

**Step 2: Run verification to capture current failure**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: Any missing debug or usage guidance is caught before declaring the expansion complete.

**Step 3: Write minimal implementation**

Document:

- how to run the broader extension in an Extension Development Host
- how tracker/library/ARIS are split in the sidebar
- which actions belong only to tracked papers vs library papers
- which backend endpoints the extension depends on

**Step 4: Run verification to confirm completion**

Run: `cd /Users/czk/auto-researcher/vscode-extension && npm test`
Expected: PASS

Run: `cd /Users/czk/auto-researcher/backend && node --test src/services/__tests__/aris.service.test.js src/services/__tests__/ssh-transport.service.test.js src/services/__tests__/tracker-feed-snapshot.service.test.js`
Expected: PASS

If Task 8 was needed:

Run: `cd /Users/czk/auto-researcher/backend && node --test src/routes/__tests__/tracker-save.test.js src/routes/__tests__/library-actions.test.js`
Expected: PASS

Manual:

1. Launch the Extension Development Host
2. Refresh tracked papers
3. Save one tracked paper
4. Refresh library
5. Mark a library paper read
6. Queue reader for a library paper
7. Refresh ARIS and open a run detail pane

**Step 5: Commit**

```bash
git add vscode-extension/README.md README.md docs/INSTALLATION_MODES.md vscode-extension/.vscode/launch.json vscode-extension/.vscode/tasks.json
git commit -m "docs: capture expanded VS Code extension workflow"
```
