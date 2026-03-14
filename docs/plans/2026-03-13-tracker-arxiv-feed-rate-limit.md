# Tracker ArXiv Feed Rate Limit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce tracker page-load arXiv pressure by limiting feed-time metadata enrichment to weak Twitter titles with caching and sequential throttling.

**Architecture:** Move feed-time arXiv enrichment policy into a dedicated backend helper so the selection, cache, and throttle behavior can be tested without loading the full tracker router. Keep save-time arXiv fallback unchanged. Wire the tracker route to call the helper after source merge and before pagination/caching.

**Tech Stack:** Node.js, `node:test`, Express route helpers, in-memory cache/rate limiter

---

### Task 1: Add regression tests for feed-time enrichment policy

**Files:**
- Create: `backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
- Create: `backend/src/services/tracker-arxiv-feed.service.js`

**Step 1: Write the failing test**

Add tests that verify:
- only weak-title Twitter items are selected for enrichment
- non-Twitter items are skipped
- the feed-time cap is small
- cached metadata avoids repeat fetches
- sequential throttling waits before the next network fetch

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Create a helper module that exports:
- candidate selection logic for weak Twitter-title items
- feed enrichment function with injected `fetchMetadata`, `wait`, and `now`
- in-memory metadata cache and in-flight dedupe
- sequential minimum interval enforcement

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
Expected: PASS

### Task 2: Integrate helper into tracker feed route

**Files:**
- Modify: `backend/src/routes/tracker.js`

**Step 1: Write the failing test**

Reuse the helper tests as the regression boundary; integration should be a thin call-site change only.

**Step 2: Run test to verify it still passes before route edits**

Run: `node --test backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
Expected: PASS

**Step 3: Write minimal implementation**

Update the tracker route to:
- use the new helper
- default feed-time enrichment cap to `3`
- keep only weak Twitter-title enrichment
- preserve existing save-time behavior

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
Expected: PASS

### Task 3: Verify related arXiv save-path regression coverage still holds

**Files:**
- Existing test: `backend/src/routes/__tests__/upload-arxiv.test.js`

**Step 1: Run existing regression tests**

Run: `node --test backend/src/routes/__tests__/upload-arxiv.test.js backend/src/services/__tests__/tracker-arxiv-feed.service.test.js`
Expected: PASS
