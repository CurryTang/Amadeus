# Vibe Alpha Simplified Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a backend-backed global runtime toggle that enables an early alpha simplified Vibe mode, hiding skill-selection UI and tree-based research planning while keeping the rest of the Vibe workspace usable.

**Architecture:** Store a single global UI config document in `researchops/store.js`, expose it through `researchops/admin.js`, fetch and update it from `App.jsx` and `LibrarySettingsModal.jsx`, and centralize the Vibe-mode gating rules in a small frontend helper consumed by `VibeResearcherPanel.jsx`. Prefer hiding advanced UI without deleting existing handlers or backend flows.

**Tech Stack:** Node.js 20 + Express 4, MongoDB-backed `researchops` store with memory fallback, React 18 + Next.js 14, Node built-in `node:test`.

---

## Pre-flight check

Before starting, run:

```bash
cd /Users/czk/auto-researcher/backend
node -e "require('./src/routes/researchops/admin'); console.log('OK')"
```

Expected: `OK`

Then run:

```bash
cd /Users/czk/auto-researcher/frontend
node -e "import('./src/App.jsx').then(() => console.log('OK'))"
```

Expected: `OK` or a JSX/module import failure that confirms the frontend must be verified via build instead of direct Node import.

## Task 1: Add backend UI-config persistence

**Files:**
- Modify: `backend/src/services/researchops/store.js`
- Test: `backend/src/services/researchops/__tests__/store.ui-config.test.js`

**Step 1: Write the failing store test**

Create `backend/src/services/researchops/__tests__/store.ui-config.test.js` with coverage for:
- default UI config is returned when nothing is stored
- updating `simplifiedAlphaMode` persists and round-trips
- unrelated users do not leak settings across user ids

Example:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');

test('returns default ui config when none exists', async () => {
  const config = await store.getUiConfig('ui_config_default_test');
  assert.equal(config.simplifiedAlphaMode, false);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/czk/auto-researcher/backend
node --test src/services/researchops/__tests__/store.ui-config.test.js
```

Expected: FAIL because `getUiConfig` / `updateUiConfig` do not exist yet.

**Step 3: Write minimal store implementation**

In `backend/src/services/researchops/store.js`:
- add an in-memory bucket for UI config documents
- create a Mongo collection such as `researchops_ui_config` with indexes on `key`
- implement `getUiConfig(userId)` returning `{ simplifiedAlphaMode: false, updatedAt }` shape
- implement `updateUiConfig(userId, patch)` that validates booleans and upserts the single global config document for that user namespace

Keep the stored shape intentionally narrow:

```javascript
{
  id: 'global',
  userId: uid,
  simplifiedAlphaMode: Boolean(patch.simplifiedAlphaMode),
  updatedAt: nowIso(),
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/czk/auto-researcher/backend
node --test src/services/researchops/__tests__/store.ui-config.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/researchops/store.js backend/src/services/researchops/__tests__/store.ui-config.test.js
git commit -m "feat(researchops): persist global vibe ui config"
```

## Task 2: Expose the runtime toggle through admin routes

**Files:**
- Modify: `backend/src/routes/researchops/admin.js`
- Test: `backend/src/routes/researchops/__tests__/admin.ui-config.test.js`

**Step 1: Write the failing route test**

Create `backend/src/routes/researchops/__tests__/admin.ui-config.test.js` around small exported route helpers, not full HTTP harness. If needed, export helper functions from `admin.js` for:
- shaping the response payload
- validating update input

Minimum coverage:
- GET-style helper returns default `simplifiedAlphaMode: false`
- PATCH-style helper rejects non-boolean input
- PATCH-style helper returns updated config on valid input

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/czk/auto-researcher/backend
node --test src/routes/researchops/__tests__/admin.ui-config.test.js
```

Expected: FAIL because the helper or route surface does not exist yet.

**Step 3: Add admin endpoints**

In `backend/src/routes/researchops/admin.js`:
- add `GET /ui-config`
- add `PATCH /ui-config`
- call the new store methods
- validate that `simplifiedAlphaMode`, when present, is a boolean

Return shape:

```json
{
  "uiConfig": {
    "simplifiedAlphaMode": false,
    "updatedAt": "2026-03-05T12:00:00.000Z"
  }
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/czk/auto-researcher/backend
node --test src/routes/researchops/__tests__/admin.ui-config.test.js src/services/researchops/__tests__/store.ui-config.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/admin.js backend/src/routes/researchops/__tests__/admin.ui-config.test.js
git commit -m "feat(researchops): add ui config admin endpoints"
```

## Task 3: Load and edit the global toggle in frontend settings

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/LibrarySettingsModal.jsx`
- Create: `frontend/src/lib/uiConfig.js`
- Test: `frontend/src/lib/uiConfig.test.mjs`

**Step 1: Write the failing frontend helper test**

Create `frontend/src/lib/uiConfig.test.mjs` using `node:test` for a small ESM helper that:
- normalizes missing backend config to `simplifiedAlphaMode: false`
- validates update payload construction
- preserves known keys only

Example:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUiConfig } from './uiConfig.js';

test('normalizeUiConfig defaults simplifiedAlphaMode to false', () => {
  assert.deepEqual(normalizeUiConfig(null), { simplifiedAlphaMode: false });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/czk/auto-researcher/frontend
node --test src/lib/uiConfig.test.mjs
```

Expected: FAIL because `uiConfig.js` does not exist yet.

**Step 3: Implement the helper and wire settings flow**

Create `frontend/src/lib/uiConfig.js` with:
- `normalizeUiConfig(raw)`
- `buildUiConfigPatch(raw)`

Update `frontend/src/App.jsx` to:
- fetch `GET /api/researchops/ui-config` after auth is ready
- store `uiConfig` plus loading/saving state
- pass `uiConfig`, `saveUiConfig`, and fetch status into `LibrarySettingsModal`
- pass `isSimplifiedAlpha={uiConfig.simplifiedAlphaMode}` into `VibeResearcherPanel`

Update `frontend/src/components/LibrarySettingsModal.jsx` to:
- add a `Release` or `Product Mode` section
- render a single checkbox/toggle for “Simplified Vibe alpha mode”
- save via the new `saveUiConfig` prop
- show lightweight loading/saving/error feedback

Keep the rest of the modal behavior unchanged.

**Step 4: Run helper test and frontend build**

Run:

```bash
cd /Users/czk/auto-researcher/frontend
node --test src/lib/uiConfig.test.mjs
npm run build
```

Expected: helper test PASS, frontend build succeeds

**Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/LibrarySettingsModal.jsx frontend/src/lib/uiConfig.js frontend/src/lib/uiConfig.test.mjs
git commit -m "feat(frontend): add global simplified vibe mode setting"
```

## Task 4: Hide Vibe advanced UI in simplified mode

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Create: `frontend/src/components/vibe/vibeUiMode.js`
- Test: `frontend/src/components/vibe/vibeUiMode.test.mjs`

**Step 1: Write the failing Vibe gating test**

Create `frontend/src/components/vibe/vibeUiMode.test.mjs` to lock the gating rules for:
- default mode: advanced skills and tree planning enabled
- simplified mode: advanced skills hidden, tree planning hidden

Example:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { getVibeUiMode } from './vibeUiMode.js';

test('simplified mode hides advanced vibe surfaces', () => {
  const mode = getVibeUiMode({ simplifiedAlphaMode: true });
  assert.equal(mode.showSkillMenu, false);
  assert.equal(mode.showTreePlanning, false);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/czk/auto-researcher/frontend
node --test src/components/vibe/vibeUiMode.test.mjs
```

Expected: FAIL because the helper does not exist yet.

**Step 3: Implement minimal gating**

Create `frontend/src/components/vibe/vibeUiMode.js` exporting a pure helper:

```javascript
export function getVibeUiMode(uiConfig = {}) {
  const simplified = uiConfig?.simplifiedAlphaMode === true;
  return {
    simplifiedAlphaMode: simplified,
    showSkillMenu: !simplified,
    showTreePlanning: !simplified,
  };
}
```

Update `frontend/src/components/VibeResearcherPanel.jsx` to:
- accept `isSimplifiedAlpha` prop
- derive `const vibeUiMode = getVibeUiMode({ simplifiedAlphaMode: isSimplifiedAlpha });`
- conditionally hide:
  - `Skills (...)` chip
  - launcher skill chips and related descriptive copy
  - skills modal entry points
  - `VibePlanEditor`
  - `VibeTreeCanvas`
  - `VibeNodeWorkbench`
  - tree-only buttons such as `⚡ Node`, `Summarize Codebase -> Root`, `Jump-start`, and tree-oriented autopilot buttons
- keep TODO management, KB, files, and run history visible
- close stale advanced overlays when simplified mode turns on

Prefer one guard per section instead of sprinkling many unrelated boolean expressions.

**Step 4: Run tests and frontend build**

Run:

```bash
cd /Users/czk/auto-researcher/frontend
node --test src/components/vibe/vibeUiMode.test.mjs src/lib/uiConfig.test.mjs
npm run build
```

Expected: PASS and successful build

**Step 5: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/vibe/vibeUiMode.js frontend/src/components/vibe/vibeUiMode.test.mjs
git commit -m "feat(vibe): hide advanced planning ui in simplified alpha mode"
```

## Task 5: End-to-end verification

**Files:**
- None required unless fixes are needed

**Step 1: Run backend tests**

```bash
cd /Users/czk/auto-researcher/backend
node --test src/services/researchops/__tests__/store.ui-config.test.js src/routes/researchops/__tests__/admin.ui-config.test.js
```

Expected: PASS

**Step 2: Run frontend checks**

```bash
cd /Users/czk/auto-researcher/frontend
node --test src/lib/uiConfig.test.mjs src/components/vibe/vibeUiMode.test.mjs
npm run build
```

Expected: PASS and successful production build

**Step 3: Manual verification**

1. Start backend and frontend locally.
2. Open the settings modal and enable simplified alpha mode.
3. Open a Vibe project and confirm:
   - no skill chip row is visible
   - no `Skills (...)` chip is visible
   - no tree canvas/editor/workbench is visible
   - KB, files, TODOs, and run history still work
4. Disable simplified alpha mode and confirm the advanced Vibe UI returns.

**Step 4: Commit verification or follow-up fixes if needed**

```bash
git status --short
```

Expected: no unexpected files beyond intended implementation changes.
