# Richer Deliverable and Environment Panels Design

## Context

The current research workspace is a tree-centered execution workbench. The most relevant review surfaces today are the project dashboard in [/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx](/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx) and the node workbench in [/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx](/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx).

Both surfaces already expose pieces of the right information, but they do it in a thin, fragmented way:

- deliverables are mostly a flat artifact list plus a small image grid
- environment state is split across run context, bridge/runtime rows, and run report metadata
- reviewers must mentally stitch together provenance and evidence before deciding whether a run is trustworthy

The user intent is not to turn these surfaces into an action cockpit. The goal is a richer browse-and-review experience for the execution environment and the resulting deliverables.

## Goals

- Make both surfaces expose a consistent review-first `Environment` panel and `Deliverables` panel.
- Make it easy to answer two review questions quickly:
  - what world produced this result?
  - what evidence came out of it?
- Reuse existing frontend data contracts where possible instead of requiring new backend APIs.
- Preserve the current tree-centered information architecture.

## Non-Goals

- No new action-oriented workflow such as refine, branch, or continue controls inside these panels.
- No change to the project dashboard's role as a run-scoped overview.
- No conversion to a bundle-first or review-queue-first UI.
- No backend schema redesign as part of this change.

## Approaches Considered

### 1. Twin Inspector Panels

Use the same two conceptual inspectors on both surfaces:

- `Environment`
- `Deliverables`

The project dashboard shows a broader run-level overview, while the node workbench shows the same concepts with more node-specific detail.

Pros:

- consistent mental model across both surfaces
- maps directly onto the current data already exposed in the frontend
- matches the intended sketch most closely

Cons:

- requires some presenter/component extraction to avoid duplicated JSX

### 2. Run Storyboard

Render each run as a reading flow with environment first and deliverables second.

Pros:

- strong narrative flow for a single run

Cons:

- weaker for repeated scanning
- less aligned with the existing panel-based layout

### 3. Evidence Matrix

Build a denser matrix-style review UI with environment facets in one area and deliverable categories in another.

Pros:

- efficient for expert reviewers

Cons:

- colder presentation
- less compatible with the current panel hierarchy and the sketched direction

## Recommended Approach

Use **Twin Inspector Panels**.

This preserves the current workbench architecture while making the review path clearer:

- `Outputs` remains the general artifact list
- `Environment` becomes the provenance sheet
- `Deliverables` becomes the evidence shelf

The result is denser and easier to scan without changing the current run-centered review model described in the research environment docs.

## Surface Design

### Project Dashboard

In [/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx](/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx):

- keep the dashboard run-scoped and tied to the currently selected run
- add a new `Environment` card alongside the existing review cards
- replace the current lightweight deliverables grid with a richer `Deliverables` inspector

The intended read order is:

1. `Outputs`
2. `Environment`
3. `Deliverables`
4. `Execution Pipeline`

### Node Workbench

In [/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx](/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx):

- keep the current tab model
- upgrade the `summary` tab so its environment information is grouped into a richer `Environment` inspector instead of separate `Run Context` and `Bridge / Runtime` boxes
- upgrade the `deliverables` tab from a flat list to a categorized artifact review surface

The dashboard is the broader scan surface. The workbench is the deeper inspection surface.

## Environment Panel

The `Environment` panel should behave like a provenance sheet rather than a settings form.

### Questions It Answers

- Where did this run execute?
- What runtime, transport, and isolation model did it use?
- Was it snapshot-backed?
- What context and knowledge inputs were routed into the run?
- Are there warnings or contract/readiness signals that affect trust?

### Dashboard Content

- top summary chips:
  - readiness
  - contract
  - execution
  - snapshot
- provenance rows:
  - workspace path
  - workspace source server
  - execution location
  - backend/runtime class
  - isolation tier
  - resolved transport / preferred transport
- context rows:
  - routed mode
  - goal title
  - selected item counts
  - knowledge counts
- review signals:
  - warnings
  - observability sinks
  - validation state

### Workbench Content

Use the same structure with more node-specific detail:

- bridge workflow readiness
- available transports
- snapshot kinds
- last run availability
- bridge report availability
- runtime warning text when present

## Deliverables Panel

The `Deliverables` panel should behave like an evidence shelf.

### Questions It Answers

- Did the run produce a usable summary?
- What figures, tables, and metrics were captured?
- Which outputs are previewable versus link-only?
- Are expected outputs missing?

### Content Model

- a summary block pinned first
  - summary presence
  - short summary excerpt when available
- grouped sections:
  - `Figures`
  - `Tables`
  - `Metrics`
- per-item metadata:
  - title
  - mime/type
  - path or artifact id
  - open link
- previews:
  - image thumbnails for image artifacts
  - compact text preview slabs for tables/metrics when inline preview text exists
  - metadata-only cards for everything else
- review framing:
  - category counts
  - contract-validation warning or missing-output messaging near the top when relevant

The key shift is that deliverables stop being a single flat list and become categorized evidence.

## Presentation

The two inspectors should feel denser and more intentional than the current lists.

### Environment Presentation

- compact status chips across the top
- grouped rows below in a two-column layout on desktop
- single-column fallback on mobile
- stronger primary labels with quieter secondary metadata

### Deliverables Presentation

- category headers with count chips
- responsive card grid
- summary block shown before artifact sections
- visual distinction between previewable and non-previewable artifacts

## Fallback Behavior

- If no run is selected or loaded, explain that environment and deliverables are run-scoped.
- If a category is empty, use specific language such as `No figures captured for this run`.
- If contract validation is failing, surface that near the top of the deliverables panel.
- If environment data is partial, still render the panel with available provenance instead of hiding it.

## Testing Strategy

This change is mostly presentation and grouping logic, so the implementation should separate pure data shaping from JSX.

Recommended coverage:

- pure presentation/helper tests for:
  - environment summary chip selection
  - grouped environment row construction
  - deliverable category grouping
  - summary excerpt selection
  - preview mode selection
  - empty-state wording
- component-level tests for:
  - mixed figure/table/metric runs
  - summary-only runs
  - partial environment metadata
  - contract-failure state

## Verification

- Dashboard shows `Environment` and richer `Deliverables` for the selected run.
- Node workbench `summary` tab surfaces a unified environment inspector.
- Node workbench `deliverables` tab shows grouped evidence rather than a flat list.
- Image deliverables render thumbnails where available.
- Table/metric deliverables show inline preview text when available.
- Empty and partial states remain readable and specific.
