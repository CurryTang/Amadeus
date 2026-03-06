# Activity Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the separate recent-run and observed-session strips with one shared activity panel that shows both item types in a single area.

**Architecture:** Add a small pure presentation helper that merges run cards and observed-session cards into one grouped feed model. Replace the two panel renders in `VibeResearcherPanel` with a single `Activity` component that renders the merged feed, shared header counts, and a shared empty state.

**Tech Stack:** React, plain JSX, node:test, existing Vibe workspace CSS

---

### Task 1: Add feed presentation helper

**Files:**
- Create: `frontend/src/components/vibe/activityFeedPresentation.js`
- Create: `frontend/src/components/vibe/activityFeedPresentation.test.mjs`

**Step 1: Write the failing test**

Cover:
- run-only feed
- session-only feed
- mixed feed with runs first then sessions
- shared count metadata

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs`

Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

Return:
- `items`
- `runCount`
- `sessionCount`

Use grouped ordering only.

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs`

Expected: PASS.

### Task 2: Build the shared activity strip

**Files:**
- Create: `frontend/src/components/vibe/VibeActivityFeedStrip.jsx`
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing render expectation**

Use the helper-level tests from Task 1 as the behavior lock for feed composition.

**Step 2: Implement the shared strip**

Render:
- header title `Activity`
- upper-right count chips
- one shared empty state
- one shared feed
- `Run` and `Session` type labels in the card upper-right corner

Keep run click, session refresh, and open-node actions intact.

**Step 3: Replace the two panel renders**

Swap:
- `VibeRecentRunsStrip`
- `VibeObservedSessionsStrip`

for the new shared component.

**Step 4: Run targeted tests**

Run: `node --test frontend/src/components/vibe/activityFeedPresentation.test.mjs frontend/src/components/vibe/runHistoryState.test.mjs frontend/src/components/vibe/projectEntryGate.test.mjs`

Expected: PASS.

### Task 3: Update styles

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Add shared activity strip styles**

Add styles for:
- header chips
- mixed feed layout
- top-right type label
- shared empty state spacing

**Step 2: Reuse existing card styling where possible**

Do not redesign the underlying card language.

**Step 3: Verify build**

Run: `cd frontend && npm run build`

Expected: PASS.
