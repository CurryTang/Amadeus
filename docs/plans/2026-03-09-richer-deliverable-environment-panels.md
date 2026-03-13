# Richer Deliverable and Environment Panels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add richer browse-and-review `Environment` and `Deliverables` panels to both the project dashboard and the node workbench.

**Architecture:** Extract pure presentation helpers for environment and deliverable data shaping, then render shared inspector components on both surfaces. The project dashboard will use run-scoped summaries, while the node workbench will render the same concepts with deeper node-specific detail from its existing run context, bridge, and review data.

**Tech Stack:** React, JSX, CSS, Node.js `node:test`, existing researchops run-report presenters

---

### Task 1: Add deliverable presentation helpers

**Files:**
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js`
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs`

**Step 1: Write the failing test**

Cover:
- grouping manifest items into `figures`, `tables`, and `metrics`
- selecting a summary excerpt from `runReport.summary`
- preferring image preview cards for image mime types
- using inline preview text for table/metric cards when available
- generating specific empty-state messages by category

Example test shape:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverableInspectorModel } from './deliverableInspectorPresentation.js';

test('groups manifest deliverables and exposes summary excerpt', () => {
  const model = buildDeliverableInspectorModel({
    runReport: {
      summary: 'Line 1\\nLine 2\\nLine 3\\nLine 4',
      manifest: {
        figures: [{ id: 'fig1', title: 'ROC', mimeType: 'image/png' }],
        tables: [{ id: 'tbl1', title: 'Scores', inlinePreview: 'acc 0.92' }],
        metrics: [{ id: 'met1', title: 'Latency', inlinePreview: 'p95 120ms' }],
      },
      artifacts: [{ id: 'fig1', objectUrl: 'https://example.test/fig.png' }],
    },
  });

  assert.equal(model.summary.excerpt, 'Line 1\\nLine 2\\nLine 3');
  assert.equal(model.sections[0].key, 'figures');
  assert.equal(model.sections[1].key, 'tables');
  assert.equal(model.sections[2].key, 'metrics');
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
```

Expected: module not found or assertion failure

**Step 3: Write the minimal implementation**

- Build a pure helper that accepts `runReport`, optional contract state, and optional artifact lookup input.
- Return a stable model with:
  - summary block
  - count chips
  - category sections
  - per-item preview mode (`image`, `text`, `meta`)
  - empty-state messaging

**Step 4: Run the test to verify it passes**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
git commit -m "test: add deliverable inspector presenter"
```

### Task 2: Add environment presentation helpers

**Files:**
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js`
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs`

**Step 1: Write the failing test**

Cover:
- building top status chips for readiness, contract, execution, and snapshot
- combining run snapshot, observability, context pack, and bridge runtime data into grouped rows
- preserving partial environment data instead of returning an empty model
- surfacing warnings and sinks when available

Example test shape:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvironmentInspectorModel } from './environmentInspectorPresentation.js';

test('builds chips and provenance rows from partial run data', () => {
  const model = buildEnvironmentInspectorModel({
    runReport: {
      execution: { location: 'remote', backend: 'docker', runtimeClass: 'python' },
      workspaceSnapshot: { path: '/tmp/run', sourceServerId: 'srv-a', localSnapshot: { kind: 'workspace' } },
      observability: { statuses: { readiness: 'ready' }, sinkProviders: ['s3'] },
      contract: { ok: true },
    },
    contextView: { mode: 'routed', goalTitle: 'Benchmark', selectedItemCount: 4 },
    bridgeContext: { bridgeRuntime: { preferredTransport: 'ssh' } },
  });

  assert.equal(model.chips[0].label, 'Readiness');
  assert.equal(model.groups.some((group) => group.title === 'Provenance'), true);
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: module not found or assertion failure

**Step 3: Write the minimal implementation**

- Build a pure helper that accepts run report, context view, bridge context, and optional mode hints.
- Return:
  - top chips
  - grouped rows for provenance, context, and review signals
  - partial-data-friendly empty handling

**Step 4: Run the test to verify it passes**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
git commit -m "test: add environment inspector presenter"
```

### Task 3: Build shared inspector components

**Files:**
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/EnvironmentInspector.jsx`
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/DeliverableInspector.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/index.css`

**Step 1: Write the failing test**

Add focused rendering coverage for:
- summary excerpt rendering first in deliverables
- category count chips and category headers
- two-column environment layout on desktop markup
- category-specific empty-state wording

If existing component test harness is not practical, add a small node-level render contract test around the presenter output shape and keep component verification manual in Task 6.

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: a rendering-related assertion is still missing, or manual verification remains pending

**Step 3: Write the minimal implementation**

- Add a reusable `EnvironmentInspector` component that renders:
  - top chips
  - grouped row sections
  - partial-state messaging
- Add a reusable `DeliverableInspector` component that renders:
  - summary block
  - contract/missing-output banner when relevant
  - categorized card grid
  - image/text/meta preview variants
- Add matching CSS classes in `frontend/src/index.css`

**Step 4: Run the verification**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/vibe/EnvironmentInspector.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/DeliverableInspector.jsx /Users/czk/auto-researcher/frontend/src/index.css
git commit -m "feat: add shared review inspector components"
```

### Task 4: Wire the project dashboard inspectors

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js`

**Step 1: Write the failing test**

Cover:
- selected run with summary, figures, tables, and metrics renders a richer deliverables panel
- dashboard environment panel shows readiness, contract, execution, and snapshot chips
- no selected run yields run-scoped explanatory empty states

If no component harness exists, write a pure-model test that proves dashboard inputs create the expected sections and complete manual browser verification in Task 6.

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: missing dashboard-specific grouping or empty-state coverage

**Step 3: Write the minimal implementation**

- Compute environment model from:
  - `activeRunReport`
  - `runReportView.contractValidation`
  - `runReportView.sinks`
  - `runReportView.warnings`
- Render the new `EnvironmentInspector` card between `Outputs` and `Deliverables`
- Replace the existing deliverables card body with `DeliverableInspector`

**Step 4: Run the verification**

Run:

```bash
npm --prefix /Users/czk/auto-researcher/frontend test -- --runInBand
```

Expected: relevant frontend tests pass, or report if this command is unavailable in the repo

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js
git commit -m "feat: add dashboard environment and deliverable inspectors"
```

### Task 5: Wire the node workbench inspectors

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/reviewPresentation.js`

**Step 1: Write the failing test**

Cover:
- summary tab shows a unified environment inspector instead of separate thin context/runtime lists
- deliverables tab groups evidence into figures/tables/metrics
- contract-failure state appears near the top of the deliverables tab
- partial node bridge context still renders environment provenance

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: missing workbench-specific row grouping or contract-state coverage

**Step 3: Write the minimal implementation**

- Replace the current `Run Context` and `Bridge / Runtime` articles in the summary tab with one `EnvironmentInspector`
- Keep `Review / Evidence` as a separate article, but let the environment inspector own provenance/context/runtime state
- Replace the flat `deliverables` tab list with `DeliverableInspector`
- Continue to use existing run-report and bridge-context data already loaded by the workbench

**Step 4: Run the verification**

Run:

```bash
npm --prefix /Users/czk/auto-researcher/frontend test -- --runInBand
```

Expected: relevant frontend tests pass, or capture the exact blocker

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/reviewPresentation.js
git commit -m "feat: upgrade workbench review inspectors"
```

### Task 6: Final verification

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/index.css`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js`

**Step 1: Run targeted automated verification**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs
```

Expected: PASS

**Step 2: Run broader frontend verification**

Run:

```bash
npm --prefix /Users/czk/auto-researcher/frontend test -- --runInBand
```

Expected: PASS, or document the exact failing pre-existing tests

**Step 3: Run a production build**

Run:

```bash
npm --prefix /Users/czk/auto-researcher/frontend run build
```

Expected: successful build output

**Step 4: Manual review checklist**

Verify in the browser:

- dashboard shows `Environment` between `Outputs` and `Deliverables`
- dashboard deliverables show grouped figures/tables/metrics
- workbench summary tab shows one environment inspector with chips and grouped rows
- workbench deliverables tab shows summary first, then categorized evidence cards
- empty runs explain that environment/deliverables are run-scoped
- mobile width collapses grouped layouts cleanly to one column

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/EnvironmentInspector.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/DeliverableInspector.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/environmentInspectorPresentation.test.mjs /Users/czk/auto-researcher/frontend/src/components/vibe/deliverableInspectorPresentation.test.mjs /Users/czk/auto-researcher/frontend/src/index.css
git commit -m "feat: enrich environment and deliverable review panels"
```
