# Fuller Tree Dashboard Design
**Date:** 2026-03-10
**Approach:** Research Story stack inside the existing node workbench

---

## Overview

Build a fuller tree-like dashboard by keeping the existing tree canvas as the main navigation surface and upgrading the selected-node info window into a richer, read-only "Research Story" panel.

The canvas does not become a new diagram editor. Instead, clicking a node reveals a structured summary that reflects the user's sketch:

- `KB`
- `Refinement`
- `Review`
- `Environment`
- `Deliverable`

Only sections with real data render. Empty sections are omitted.

---

## Goals

- Preserve the existing tree dashboard and workbench split.
- Make the selected node feel more like a research dashboard than a generic inspector.
- Keep the panel read-only.
- Avoid backend schema changes by reusing existing frontend payloads.
- Prevent the workbench from overfitting to content by using bounded sizing and internal scroll.

## Non-Goals

- No new dashboard mode.
- No changes to the canvas node model or tree topology.
- No new actions such as refine/review/generate in the summary cards.
- No backend API additions required for the first version.

---

## Existing Surface

The current tree dashboard already provides:

- A tree canvas with parent/evidence links.
- A selected-node workbench in `frontend/src/components/vibe/VibeNodeWorkbench.jsx`.
- Existing summary data from routed context, bridge/runtime, review/evidence, search results, outputs, and deliverables.

The redesign should stay inside this existing shell:

- `frontend/src/components/VibeResearcherPanel.jsx`
- `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- `frontend/src/index.css`

---

## Interaction Model

### Tree

The tree remains the navigation model. Users click a node in the canvas to inspect it.

### Workbench

The right-side workbench becomes a structured story panel:

1. Header
2. Optional lightweight tab strip for dense/raw views
3. Scrollable summary body
4. Existing run clarification/run controls when applicable

The default visible summary is the new research story stack.

---

## Summary Sections

### 1. KB

Purpose: show the node's knowledge grounding.

Data sources:

- `contextSummaryRows`
- Existing context pack summaries
- Knowledge counts and routed-context metadata already exposed by the workbench

Typical content:

- context mode
- goal
- selected items
- buckets
- knowledge/doc/asset counts
- hint/resource counts

Render rule: show only when at least one knowledge/context row exists.

### 2. Refinement

Purpose: show how the node was framed and what it is trying to refine.

Data sources:

- `node.assumption`
- `node.target`
- Search summaries and top search trials for search nodes

Typical content:

- assumptions
- targets
- search leaderboard summary
- top trials

Render rule: show only when assumptions, targets, or search-derived content exists.

### 3. Review

Purpose: show human-review or judge-style evidence state.

Data sources:

- `buildNodeReviewSummary(...)`
- `buildNodeControlSurfaceRows(...)`
- manual gate state
- checkpoint state
- readiness
- warnings
- contract state
- summary/final-output presence
- evidence/deliverable counts

Typical content:

- gate state
- checkpoints
- contract
- evidence
- summary present
- final output present
- readiness
- warnings

Render rule: show only when review/evidence rows exist.

### 4. Environment

Purpose: show where and how the node executes.

Data sources:

- `bridgeSummaryRows`
- execution/runtime/workspace data already present in run report and bridge context

Typical content:

- runtime target
- transport
- server
- snapshot state
- execution location
- runtime class
- available transports

Render rule: show only when bridge/runtime/workspace rows exist.

### 5. Deliverable

Purpose: show whether the node produced consumable output.

Data sources:

- existing `deliverables` summary extracted from the run manifest
- highlighted deliverable/final-output information already exposed through review helpers
- artifact metadata when relevant

Typical content:

- deliverable count
- top deliverable items
- output presence

Render rule: show only when deliverables or final-output evidence exists.

---

## Layout And Visual Design

### Panel sizing

The workbench should feel like a stable dashboard column rather than a content-sized panel.

- Keep a bounded width on desktop.
- Keep the canvas flexible beside it.
- Use `min-height: 0` and explicit internal scroll containers.
- Do not let long lists expand the full page height.

### Scroll behavior

- The workbench body scrolls vertically.
- Long lists inside a section can have capped height with nested scroll when needed.
- The outer dashboard should not grow just because a node has many artifacts or search trials.

### Card language

The summary should use intentional visual grouping rather than flat lists.

- Section cards with distinct headers
- Compact metadata rows
- Light hierarchy between label and value
- Consistent padding, radius, and spacing
- Subtle visual differentiation between section types without introducing a new theme system

### Responsive behavior

The existing mobile stack remains, but:

- the workbench still has internal scroll
- section cards collapse naturally in one column
- long content remains bounded

---

## Tab Strategy

The existing tabs should be simplified, not expanded.

- `Summary` becomes the new Research Story stack.
- `Commands`, `Diff`, `Outputs`, and `Notes` remain for dense/raw inspection.
- `Deliverables` can be removed or collapsed into `Summary` if the summary card covers the key information well enough.

This keeps a clean default view while preserving the lower-level tools.

---

## Data Shaping Strategy

To avoid bloating `VibeNodeWorkbench.jsx`, the new summary should be prepared by small presentation helpers that map raw workbench inputs into section objects.

Suggested shape:

```js
[
  {
    id: 'kb',
    title: 'KB',
    tone: 'knowledge',
    items: [{ label: 'Mode', value: 'routed' }],
  },
]
```

Benefits:

- easier testing with existing `node:test` pattern
- keeps conditional rendering logic out of the JSX body
- makes it straightforward to omit empty sections

---

## Testing Strategy

Automated coverage should focus on the section-building helpers:

- omits empty sections
- maps context rows into `KB`
- maps assumptions/targets/search into `Refinement`
- maps review/control-surface rows into `Review`
- maps runtime rows into `Environment`
- maps deliverable data into `Deliverable`

Manual browser verification should cover:

1. sparse node with minimal data
2. populated execution node with runtime/review/deliverables
3. search node with trial summaries
4. overflow case with many items to confirm scroll containment

---

## Risks And Mitigations

### Risk: workbench component gets more complex

Mitigation: move section assembly into dedicated presentation helpers and keep JSX focused on rendering.

### Risk: summary duplicates too much from tabs

Mitigation: keep the summary high signal and short. Leave dense raw details in remaining tabs.

### Risk: panel height expands unpredictably

Mitigation: explicit layout constraints in CSS and capped internal scrolling regions.

---

## Acceptance Criteria

- Clicking a tree node opens a richer read-only summary in the existing workbench.
- Only sections with data render.
- The visible section set can differ from node to node.
- The workbench keeps a stable footprint and scrolls internally instead of growing with content.
- Dense/raw views remain accessible through the remaining tabs.
- No backend changes are required for the first version.
