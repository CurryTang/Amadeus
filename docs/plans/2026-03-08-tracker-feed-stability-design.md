# Tracker Feed Stability Design

## Context

The tracker feed currently shows five items at a time in [LatestPapers.jsx](/Users/czk/auto-researcher/frontend/src/components/LatestPapers.jsx) and loads later pages through `GET /api/tracker/feed?offset=&limit=` in [tracker.js](/Users/czk/auto-researcher/backend/src/routes/tracker.js).

Two user-visible problems exist today:

- `Load More` is slower than it should be.
- After loading multiple pages, the feed can later collapse back to the initial first page.

The current code already has two caches:

- a persisted backend snapshot in `tracker_feed_cache`
- a frontend `localStorage` cache keyed by `latest_papers_cache_v6`

The issue is not “no cache.” The issue is that caching happens at the wrong boundary:

- the backend still performs whole-feed reorder and saved/read annotation work for every page request before slicing the page
- the frontend only persists page 1 and still lets background first-page refreshes overwrite an expanded list

## Goals

- Make `Load More` materially faster for pages after the first one.
- Preserve the expanded visible tracker list until the user clicks manual refresh.
- Keep tracker feed ordering stable across pagination for a single feed snapshot.
- Restore the expanded visible list after a component remount or page reload.
- Preserve current filter/search/sort behavior within the currently loaded client-side list.

## Non-Goals

- No tracker source fetch redesign.
- No infinite scroll conversion.
- No changes to personalization strategy beyond making pagination stable for one snapshot.
- No automatic merging of fresh items into the current expanded list.

## Root Cause

### Slow `Load More`

`GET /api/tracker/feed` currently loads the full snapshot, reranks it, and tries to annotate saved/read status for the full feed before slicing `offset..offset+limit`. That means page 2, page 3, and page 4 still pay much of the page-1 cost.

### Expanded state loss

`LatestPapers.jsx` treats background first-page fetches as a normal non-append refresh. When that request completes, it calls `setPapers(nextPage)` and replaces an expanded list with only the first page. The client cache also persists only the initial page, so remounts/reloads naturally fall back to the first page.

## Recommended Approach

Use a split fix across backend and frontend.

### Backend: Stable snapshot pagination

- Keep using the existing persisted tracker feed snapshot as the canonical ordered dataset for one feed generation.
- Add a small feed-page helper/service that paginates against that stable snapshot instead of recomputing the whole request path on every later page fetch.
- Add per-snapshot saved/read annotation caching so later pages reuse saved/read lookup results rather than redoing full-feed annotation work.
- Return snapshot identity metadata alongside `fetchedAt` so the client can detect whether it is still reading the same feed generation.

### Frontend: Manual refresh is the only reset boundary

- Treat the loaded list as a session-scoped expanded view that background refreshes may not shrink.
- Persist the expanded visible list, `hasMore`, `total`, `fetchedAt`, and snapshot identity in local storage.
- Allow background refreshes to update only freshness metadata and “new feed available” state while the currently visible list remains unchanged.
- Reset pagination and visible items only when the user clicks `Refresh`.

## Data Flow

### Initial load

1. Read the expanded feed cache from local storage.
2. If present and valid, render it immediately.
3. Optionally check the backend for a newer snapshot in the background.
4. If the backend reports the same snapshot, keep the current expanded list.
5. If the backend reports a newer snapshot, mark `new feed available` but do not replace the list.

### Load more

1. Request the next page using the current snapshot identity.
2. Backend serves the next slice from the same cached snapshot.
3. Frontend appends the new items and rewrites the expanded local cache.

### Manual refresh

1. Clear the expanded local cache.
2. Force a backend refresh.
3. Replace the feed with page 1 of the new snapshot.
4. Resume paging from the new snapshot.

## Cache Strategy

### Backend

- Keep the existing persisted snapshot table for canonical feed data.
- Add a lightweight in-memory per-snapshot page/annotation cache keyed by snapshot identity plus auth state inputs needed for saved/read annotation.
- Invalidate the per-snapshot cache whenever the persisted snapshot changes.

### Frontend

- Replace the current first-page-only cache with an expanded-session cache that stores:
  - visible items
  - visible count
  - `hasMore`
  - `total`
  - `fetchedAt`
  - snapshot identity
  - whether a newer snapshot is available
- Preserve the existing fallback/offline behavior, but against the expanded-session cache.

## UX Behavior

- `Load More` appends from the current snapshot and never shrinks the list.
- Background refresh never changes the visible list.
- Manual refresh is the only operation that resets the list to page 1.
- If a newer snapshot exists, show a small non-blocking status such as `New items available`.

## Risks

- Saved/read status is user-specific, while the base snapshot is shared. The annotation cache must avoid leaking user-specific state across users.
- Snapshot identity must remain stable enough to prevent accidental cross-snapshot pagination.
- If the feed generation changes on the backend while the user is paging, the frontend must continue using the old visible session until manual refresh.

## Verification

- Load three pages, wait for background refresh, verify the list length does not shrink.
- Reload/remount after loading multiple pages, verify the expanded list restores from cache.
- Repeated `Load More` requests for the same snapshot avoid full-feed recomputation.
- Manual refresh resets to page 1 and adopts the newest snapshot.
