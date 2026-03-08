# Tracker Feed Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make tracker `Load More` faster and ensure the expanded tracker feed never collapses back to page 1 until the user clicks manual refresh.

**Architecture:** Split the fix across backend and frontend. The backend will page from a stable cached tracker snapshot and reuse per-snapshot annotation results instead of redoing whole-feed work on every page request. The frontend will treat the loaded tracker list as a persisted expanded session whose reset boundary is only the manual refresh button.

**Tech Stack:** Node.js, Express, React, localStorage, sqlite/Turso-backed tracker cache, node:test

---

### Task 1: Extract frontend tracker feed session helpers

**Files:**
- Create: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js`
- Create: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx`

**Step 1: Write the failing test**

Cover:
- restoring an expanded cached feed session
- preserving `papers`, `hasMore`, `total`, `fetchedAt`, and snapshot identity
- rejecting expired or malformed cache payloads

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
```

Expected: missing module or assertion failure

**Step 3: Implement the minimal session helpers**

- Move tracker client cache read/write logic out of `LatestPapers.jsx` into `latestPapersSession.js`
- Extend the cache shape from first-page-only to expanded-session state
- Keep TTL handling explicit and testable

**Step 4: Run the test to verify it passes**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs /Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx
git commit -m "test: extract tracker feed session helpers"
```

### Task 2: Preserve expanded tracker state until manual refresh

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs`

**Step 1: Write the failing test**

Cover:
- background first-page refresh does not shrink an expanded list
- append requests extend the persisted visible session
- manual refresh clears the expanded session and adopts page 1 from the new snapshot

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
```

Expected: assertion failure covering background refresh shrink/reset behavior

**Step 3: Implement the minimal frontend behavior**

- Add explicit snapshot/session state to `LatestPapers.jsx`
- Block background refresh from calling the reset path when an expanded session already exists
- Persist the full visible list after each successful append
- Add a small `new feed available` indicator state without mutating the visible list

**Step 4: Run the verification**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
git commit -m "feat: preserve expanded tracker feed until manual refresh"
```

### Task 3: Extract backend stable snapshot pagination helpers

**Files:**
- Create: `/Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/tracker.js`

**Step 1: Write the failing backend test**

Cover:
- stable snapshot identity generation
- page slicing from a cached snapshot without mutating source order
- per-snapshot cache invalidation when snapshot metadata changes

**Step 2: Run the test to verify it fails**

Run:

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
```

Expected: missing module or assertion failure

**Step 3: Implement the minimal backend helper**

- Extract stable snapshot identity and slice logic from `tracker.js`
- Keep it independent from HTTP request objects
- Expose helpers for route-level reuse and test coverage

**Step 4: Run the test to verify it passes**

Run:

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js /Users/czk/auto-researcher/backend/src/routes/tracker.js
git commit -m "test: extract tracker feed snapshot helpers"
```

### Task 4: Cache page annotation and speed up `Load More`

**Files:**
- Modify: `/Users/czk/auto-researcher/backend/src/routes/tracker.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js`

**Step 1: Write the failing backend test**

Cover:
- later page requests for the same snapshot reuse cached annotation results
- page requests only annotate the requested page when full annotation is unavailable
- route payload includes stable snapshot metadata for the client

**Step 2: Run the test to verify it fails**

Run:

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
```

Expected: assertion failure around repeated page work or missing snapshot metadata

**Step 3: Implement the minimal backend performance fix**

- Add per-snapshot annotation caching keyed safely for user-specific saved/read state
- Serve later pages from the stable cached snapshot instead of rebuilding full-feed work each time
- Return snapshot identity metadata in `GET /api/tracker/feed`

**Step 4: Run the verification**

Run:

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node -e "require('./backend/src/routes/tracker')"
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/routes/tracker.js /Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
git commit -m "feat: stabilize and cache tracker feed pagination"
```

### Task 5: Wire frontend to backend snapshot identity and verify end-to-end behavior

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/tracker.js`

**Step 1: Write the failing test**

Cover:
- append requests stay pinned to one snapshot identity
- newer backend snapshots mark `new feed available` without shrinking the current list
- manual refresh adopts the newer snapshot and clears the old expanded session

**Step 2: Run the test to verify it fails**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
```

Expected: FAIL in at least one assertion covering snapshot handoff

**Step 3: Implement the minimal integration wiring**

- Have the frontend send/read snapshot identity with feed requests
- Keep the old visible list when a newer snapshot is observed in the background
- Only replace state during manual refresh or initial empty-session load

**Step 4: Run the verification**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node -e "require('./backend/src/routes/tracker')"
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs /Users/czk/auto-researcher/backend/src/routes/tracker.js
git commit -m "feat: pin tracker feed state to manual refresh"
```

### Task 6: Final verification

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/tracker.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js`

**Step 1: Run frontend verification**

Run:

```bash
node /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs
```

Expected: PASS

**Step 2: Run backend verification**

Run:

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node -e "require('./backend/src/routes/tracker')"
```

Expected: PASS

**Step 3: Capture the final tracker diff**

Run:

```bash
git diff -- /Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.js /Users/czk/auto-researcher/frontend/src/components/latestPapersSession.test.mjs /Users/czk/auto-researcher/backend/src/routes/tracker.js /Users/czk/auto-researcher/backend/src/services/tracker-feed-snapshot.service.js /Users/czk/auto-researcher/backend/src/services/__tests__/tracker-feed-snapshot.service.test.js /Users/czk/auto-researcher/docs/plans/2026-03-08-tracker-feed-stability-design.md /Users/czk/auto-researcher/docs/plans/2026-03-08-tracker-feed-stability.md
```

Expected: Diff shows stable snapshot pagination, expanded frontend session caching, and the new docs.
