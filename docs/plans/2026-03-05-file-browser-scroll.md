# File Browser Scroll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace paged Knowledge Base and Project Files lists in the Vibe Researcher UI with fixed-height scroll containers that show about five items at a time.

**Architecture:** The change stays entirely in the frontend `VibeResearcherPanel` view and shared stylesheet. Existing tree data, click handlers, and preview panes remain intact while list rendering switches from sliced arrays plus `Load More` to full-array rendering inside a scroll container.

**Tech Stack:** React, Next.js, CSS

---

### Task 1: Remove file-list paging state

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing test**

Document the expected regression checks before editing:
- No `MODULE_LIST_PAGE_SIZE` constant in the panel.
- No `projectFilesDisplayLimit` or `kbFilesDisplayLimit` state in the panel.
- No `Load More` button for KB or Project Files lists.

**Step 2: Run test to verify it fails**

Run:

```bash
rg -n "MODULE_LIST_PAGE_SIZE|projectFilesDisplayLimit|kbFilesDisplayLimit|Load More" frontend/src/components/VibeResearcherPanel.jsx
```

Expected: Matches are present.

**Step 3: Write minimal implementation**

- Delete the paging constant and display-limit state.
- Remove state reset calls tied to those display limits.

**Step 4: Run test to verify it passes**

Run:

```bash
rg -n "MODULE_LIST_PAGE_SIZE|projectFilesDisplayLimit|kbFilesDisplayLimit|Load More" frontend/src/components/VibeResearcherPanel.jsx
```

Expected: No matches related to KB/Project Files paging remain.

### Task 2: Render full file lists in every browser

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing test**

Document the expected behavior:
- KB and Project Files browsers iterate over the full entry arrays.
- No `slice(0, ...)` limits remain for the file browsers in this component.

**Step 2: Run test to verify it fails**

Run:

```bash
rg -n "kbTreeEntries\\.slice|projectTreeEntries\\.slice" frontend/src/components/VibeResearcherPanel.jsx
```

Expected: Matches are present.

**Step 3: Write minimal implementation**

- Replace sliced renders with direct `map(...)` calls over the full arrays in every file browser section.

**Step 4: Run test to verify it passes**

Run:

```bash
rg -n "kbTreeEntries\\.slice|projectTreeEntries\\.slice" frontend/src/components/VibeResearcherPanel.jsx
```

Expected: No matches remain.

### Task 3: Tune shared scroll styling for five visible rows

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Write the failing test**

Document the expected style outcome:
- `.vibe-git-file-list` is a scrollable container with a height tuned to about five rows.
- Tree-layout overrides keep the same scroll behavior.

**Step 2: Run test to verify it fails**

Inspect current styles:

```bash
sed -n '5348,5372p' frontend/src/index.css
sed -n '9184,9204p' frontend/src/index.css
```

Expected: Current heights are not explicitly aligned to the five-row scroll requirement.

**Step 3: Write minimal implementation**

- Add a shared min/max height tuned for five file cards.
- Keep `overflow-y: auto`.
- Adjust the tree-browser override as needed for consistency.

**Step 4: Run test to verify it passes**

Run:

```bash
sed -n '5348,5372p' frontend/src/index.css
sed -n '9184,9204p' frontend/src/index.css
```

Expected: The list container uses the new fixed-height scroll behavior.

### Task 4: Verify the frontend build

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Run verification**

Run:

```bash
npm run build
```

From: `frontend/`

Expected: Build succeeds.

**Step 2: Capture final diff**

Run:

```bash
git diff -- frontend/src/components/VibeResearcherPanel.jsx frontend/src/index.css docs/plans/2026-03-05-file-browser-scroll-design.md docs/plans/2026-03-05-file-browser-scroll.md
```

Expected: Diff shows paging removal, full-list rendering, scroll styling, and the new docs.
