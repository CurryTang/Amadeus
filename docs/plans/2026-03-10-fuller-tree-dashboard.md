# Fuller Tree Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing selected-node workbench into a fuller read-only Research Story dashboard with conditional `KB`, `Refinement`, `Review`, `Environment`, and `Deliverable` sections while keeping the tree canvas and bounded layout intact.

**Architecture:** Add a small presentation helper that converts existing workbench inputs into section descriptors, then render those descriptors in `VibeNodeWorkbench` as the new `Summary` view. Keep raw-detail tabs for commands/diff/outputs/notes, and enforce a fixed-feeling dashboard layout with internal scrolling in the workbench CSS.

**Tech Stack:** React 18, Next.js frontend, plain CSS in `frontend/src/index.css`, Node `node:test` test files (`*.test.mjs`)

---

### Task 1: Add the failing tests for section assembly

**Files:**
- Create: `frontend/src/components/vibe/nodeStoryPresentation.test.mjs`
- Create: `frontend/src/components/vibe/nodeStoryPresentation.js`

**Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNodeStorySections } from './nodeStoryPresentation.js';

test('buildNodeStorySections omits empty sections and preserves section order', () => {
  const sections = buildNodeStorySections({
    node: {
      assumption: ['Need benchmark parity'],
      target: ['Compare baseline'],
    },
    contextRows: [{ label: 'Knowledge', value: '2 groups · 5 docs' }],
    reviewRows: [{ label: 'Gate', value: 'Awaiting manual approval' }],
    bridgeRows: [],
    deliverables: [],
    searchSummaryRows: [],
    searchTrialRows: [],
  });

  assert.deepEqual(
    sections.map((section) => section.id),
    ['kb', 'refinement', 'review']
  );
});

test('buildNodeStorySections maps search, environment, and deliverables into separate cards', () => {
  const sections = buildNodeStorySections({
    node: { assumption: [], target: [] },
    contextRows: [],
    reviewRows: [{ label: 'Evidence', value: '1 deliverable artifact' }],
    bridgeRows: [{ label: 'Runtime', value: 'remote/container' }],
    deliverables: [{ title: 'report.md', kind: 'artifact' }],
    searchSummaryRows: [{ label: 'Trials', value: '4 total' }],
    searchTrialRows: [{ id: 'trial_1', title: 'trial_1', meta: 'PASSED · reward 0.910', code: 'run_1' }],
  });

  assert.deepEqual(
    sections.map((section) => section.id),
    ['refinement', 'review', 'environment', 'deliverable']
  );
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: FAIL because `buildNodeStorySections` does not exist yet.

**Step 3: Write minimal implementation**

Create `frontend/src/components/vibe/nodeStoryPresentation.js` with:

- a `buildNodeStorySections(...)` export
- ordered section assembly for `kb`, `refinement`, `review`, `environment`, `deliverable`
- filtering of empty sections
- compact item normalization helpers for label/value rows and short lists

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/vibe/nodeStoryPresentation.js frontend/src/components/vibe/nodeStoryPresentation.test.mjs
git commit -m "feat: add node story presentation model"
```

### Task 2: Expand test coverage for section content shaping

**Files:**
- Modify: `frontend/src/components/vibe/nodeStoryPresentation.test.mjs`
- Modify: `frontend/src/components/vibe/nodeStoryPresentation.js`

**Step 1: Write the failing test**

Add tests that verify:

- `KB` section includes context rows as-is
- `Refinement` includes assumptions and targets even without search data
- search nodes append summary/trial items into `Refinement`
- `Deliverable` caps or summarizes long item lists for concise rendering

Use explicit assertions on returned section titles and item labels.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: FAIL on missing or incorrect section item shaping.

**Step 3: Write minimal implementation**

Update `buildNodeStorySections(...)` to:

- label section titles exactly (`KB`, `Refinement`, `Review`, `Environment`, `Deliverable`)
- normalize assumptions/targets into lightweight list items
- merge search summary and top trials into refinement content
- summarize deliverables into compact rows/cards without dumping every artifact field

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/vibe/nodeStoryPresentation.js frontend/src/components/vibe/nodeStoryPresentation.test.mjs
git commit -m "test: cover node story section shaping"
```

### Task 3: Convert the workbench summary tab to the new story layout

**Files:**
- Modify: `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Modify: `frontend/src/components/vibe/nodeStoryPresentation.js`

**Step 1: Write the failing test**

Add one more presentation test that reflects the exact data needed by `VibeNodeWorkbench`:

```js
test('buildNodeStorySections returns only populated cards for a sparse node', () => {
  const sections = buildNodeStorySections({
    node: { assumption: [], target: [] },
    contextRows: [],
    reviewRows: [],
    bridgeRows: [],
    deliverables: [],
    searchSummaryRows: [],
    searchTrialRows: [],
  });

  assert.deepEqual(sections, []);
});
```

This locks in the omission behavior before wiring JSX around it.

**Step 2: Run test to verify it fails**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: FAIL if the helper still emits empty sections.

**Step 3: Write minimal implementation**

In `frontend/src/components/vibe/VibeNodeWorkbench.jsx`:

- import `buildNodeStorySections`
- compute `storySections` from:
  - `node`
  - `contextSummaryRows`
  - merged review rows
  - `bridgeSummaryRows`
  - `deliverables`
  - `searchSummaryRows`
  - `searchTrialRows`
- replace the current summary grid with:
  - an empty-state message when `storySections.length === 0`
  - a single-column card stack when sections exist
- keep the existing workbench header and runnable node controls
- keep `Commands`, `Diff`, `Outputs`, and `Notes`
- remove `Deliverables` from the tab strip if the summary card now covers it adequately

**Step 4: Run test to verify it passes**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/vibe/VibeNodeWorkbench.jsx frontend/src/components/vibe/nodeStoryPresentation.js frontend/src/components/vibe/nodeStoryPresentation.test.mjs
git commit -m "feat: render research story node summary"
```

### Task 4: Add bounded dashboard styling and internal scroll behavior

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing test**

There is no CSS test harness in this repo, so use an explicit manual failure definition before editing:

- current workbench grows visually dense and grid-like
- summary content does not reflect the requested section model
- long content can overfit the panel instead of feeling intentionally bounded

Record the target classes before editing:

- `.vibe-tree-canvas-workbench-split`
- `.vibe-tree-layout-workbench-panel`
- `.vibe-node-workbench`
- `.vibe-node-tab-body`

**Step 2: Run test to verify it fails**

Run:
```bash
npm --prefix frontend run build
```

Expected: current build succeeds, but the UI still lacks the approved layout in browser inspection. This is the pre-change verification point.

**Step 3: Write minimal implementation**

In `frontend/src/index.css`:

- give the workbench column a stable bounded width on desktop
- ensure all relevant wrappers use `min-height: 0`
- make the summary body scroll internally
- add section-card styling for the new story stack
- cap long sublists with nested scroll where needed
- preserve responsive stacking under the existing breakpoints

In `frontend/src/components/VibeResearcherPanel.jsx`:

- only adjust surrounding container classes if needed to support the new bounded workbench sizing
- avoid broader layout churn outside the tree/workbench split

**Step 4: Run test to verify it passes**

Run:
```bash
npm --prefix frontend run build
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/VibeResearcherPanel.jsx
git commit -m "feat: constrain node workbench layout"
```

### Task 5: Final verification

**Files:**
- Verify only

**Step 1: Run targeted frontend tests**

Run:
```bash
node --test frontend/src/components/vibe/nodeStoryPresentation.test.mjs frontend/src/components/vibe/contextPackPresentation.test.mjs frontend/src/components/vibe/nodeBridgePresentation.test.mjs frontend/src/components/vibe/reviewPresentation.test.mjs frontend/src/components/vibe/searchPresentation.test.mjs
```

Expected: PASS

**Step 2: Run production build**

Run:
```bash
npm --prefix frontend run build
```

Expected: PASS

**Step 3: Manual browser verification**

Verify all of the following in the running app:

1. Sparse node shows only the populated story cards.
2. Search node shows `Refinement` content with search summaries/trials.
3. Runtime-rich node shows `Environment` and `Review`.
4. Deliverable-rich node shows `Deliverable`.
5. The workbench stays bounded and scrolls internally.
6. Mobile-width layout still stacks cleanly without overfitting.

**Step 4: Commit**

```bash
git add frontend/src/components/vibe/VibeNodeWorkbench.jsx frontend/src/components/vibe/nodeStoryPresentation.js frontend/src/components/vibe/nodeStoryPresentation.test.mjs frontend/src/index.css frontend/src/components/VibeResearcherPanel.jsx
git commit -m "feat: ship fuller tree dashboard summary"
```
