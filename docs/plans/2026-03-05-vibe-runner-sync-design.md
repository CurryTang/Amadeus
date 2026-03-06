# Vibe Runner Sync Design

## Context

The current Vibe workspace has three partially overlapping execution surfaces:

- the single launcher at the top of the project workspace
- the tree canvas and node workbench for plan execution
- the lower-right run history and run report surfaces

This creates two problems:

- runs are present, but they are not a first-class reusable context object in the main workspace
- tree status, todo execution, and ad hoc launcher runs do not read as one coherent execution model

The desired behavior is:

- show recent runs in a horizontal runner region directly under the launcher
- keep the runner region secondary rather than replacing the tree
- allow users to click a run, inspect context/prompt/output in a popup, and continue from it
- make tree-triggered runs appear in the same runner region
- improve the run environment model for experiment and implementation runs
- simplify the tree so status and next action are easier to read

## Goals

- Add a horizontal recent-run strip beneath the launcher.
- Keep the tree as the primary planning surface.
- Make all execution entry points share one run record model.
- Ensure tree node runs appear in the runner strip with synchronized status.
- Add a run detail modal with context, prompt, and output sections.
- Add a continue flow that reuses a prior run as explicit launcher context.
- Standardize remote per-run workspace folders for experiment and implementation runs.
- Make generated files discoverable during a run and visible afterward.
- Simplify the tree status model and reduce execution ambiguity.

## Non-Goals

- No replacement of the tree with a run-only activity feed.
- No removal of the existing lower-right run history/report surfaces in this iteration.
- No full redesign of the planner DSL or node authoring model.
- No attempt to make custom runs mandatory tree nodes.

## Recommended Approach

Keep the runner strip secondary, but make `run` the shared execution primitive across launcher, tree, todo, and custom execution paths.

This means:

- the tree remains the main place for planning and structured research execution
- the new runner strip becomes the fast-access recent activity surface
- every execution path emits enough metadata to identify its origin and linked entities
- tree status derives from the latest linked run rather than looking like an independent execution system

This approach aligns with the current architecture in `frontend/src/components/VibeResearcherPanel.jsx`, `frontend/src/components/vibe/VibeRunHistory.jsx`, and `frontend/src/components/vibe/VibeTreeCanvas.jsx` without introducing a second planner.

## Product Model

The product model should be explicit:

- TODO is the intake layer
- Tree is the planning layer
- Run is the execution layer
- Artifacts and summaries are the evidence layer

Consistency rules:

- a tree node run always creates a normal run record
- a tree node run always appears in the runner strip
- a todo may generate a tree node, but execution still resolves to a run
- a launcher or custom run may remain ad hoc, but can still link to a tree node, todo, or parent run

## Runner Region Design

### Placement and Layout

Place the runner region directly below the launcher and above project management and tree content.

The region should render as a horizontally scrollable card strip:

- newest run at the left
- fixed-height compact cards
- horizontal overflow with scroll
- no pagination in the first view
- keep the existing lower-right run history as the secondary archive/report surface

### Card Content

Each runner card should show:

- source badge: `Tree`, `TODO`, `Launcher`, or `Custom`
- run type badge: `Implement` or `Experiment`
- status
- prompt title or command title
- linked node title if present
- result snippet if available
- timestamp

Cards should be compact enough to scan quickly but still expose the source and linked plan entity.

### Selection Behavior

Clicking a runner card opens a modal instead of replacing the tree view.

The selected run in the strip should stay synchronized with the existing selected run/report state so the lower-right run report reflects the same run where possible.

## Run Detail Modal

The modal should have three fixed sections.

### Context

Show execution provenance:

- source type
- linked tree node
- linked todo
- parent run
- server
- remote run workspace folder
- referenced KB groups, files, and other context refs

### Prompt

Show the exact user-facing prompt or experiment command plus routing metadata:

- launcher prompt
- selected provider/model
- agent skill or auto-route decision
- experiment command when applicable

### Output

Show the resolved execution output:

- summary text
- final JSON or implementation summary JSON
- artifact list
- inline images for figures where possible
- changed files for implementation runs
- error details when failed

## Continue Flow

The continue action should not paste prior output inline into the textarea body.

Instead:

- clicking `Continue` closes the modal
- the launcher receives a visible context chip such as `Using run: <title>`
- the launcher input is focused
- the next launch includes the prior run id as a context reference

This keeps the input readable and lets the backend build a proper continuation context pack from stored run artifacts, summaries, and metadata.

## Run Metadata Model

Add explicit run-origin metadata so all run cards can render consistently.

Recommended metadata fields:

- `sourceType`: `launcher`, `tree`, `todo`, `custom`
- `sourceLabel`: short display label
- `treeNodeId`: optional
- `treeNodeTitle`: optional
- `todoId`: optional
- `todoTitle`: optional
- `parentRunId`: optional
- `continuationOfRunId`: optional
- `runWorkspacePath`: optional
- `finalOutputArtifactId`: optional
- `summaryArtifactId`: optional

These fields should live in run metadata so the frontend can render recent-run cards and the modal without repeatedly reconstructing relationships from multiple APIs.

## Remote Run Workspace Design

### Shared Structure

Every run should get a stable workspace folder on the execution target, especially for SSH-backed projects.

Recommended remote layout:

`.researchops/runs/<runId>/`

Contents:

- `prompt.txt`
- `context.json`
- `context.md`
- `run-spec.json`
- `agent.log`
- `report.md`
- `artifacts/`

For experiment runs:

- `final.json`
- generated plots, tables, metrics, and other result files in `artifacts/`

For implementation runs:

- `implementation_summary.md`
- `implementation_summary.json`
- changed-file summaries and patch artifacts where available

### File Monitoring

The run manager should monitor the run workspace during execution and publish new files as artifacts incrementally.

This is important for experiment runs where plots and result files may appear before the run ends. The modal and run report should be able to show generated evidence while the run is still active.

### Artifact Policy

Generated files should remain in the run workspace and also be published into the existing artifact model. The artifact layer is what the frontend consumes; the remote workspace is the durable execution context.

## Tree and Runner Synchronization

The tree must not feel like a separate execution engine.

Synchronization rules:

- if a tree node is executed, the linked run id is stored in tree state
- the node status reflects the latest linked run status plus manual gate state
- the run card for that node shows the linked node title and source `Tree`
- selecting a node can still open the node workbench, but selecting a run card should not desynchronize the node-run relationship

The tree should continue to show planning relationships, but execution truth should come from the linked run record.

## Tree Simplification

The current tree is doing too many jobs at once: plan editing, canvas navigation, execution control, and status reporting.

### Simplification Principles

- make status readable without opening the workbench
- make the next action obvious
- reduce abstract labels
- keep canvas as a visualization, not the only readable mode

### Recommended Changes

Default the tree experience to a more execution-readable mode:

- add an outline/status view as the default tree view
- keep canvas as a secondary visualization tab
- replace abstract toolbar labels like `Agents`, `Documents`, and `Risks` with execution-oriented summaries such as `Running`, `Needs Review`, `Done`, and `Failed`
- show one primary node action based on state: `Start`, `Resume`, `Approve`, or `View Run`
- add a top-level “next runnable node” summary above the tree

This keeps planning power while making status legible for users who are checking whether work started, what is blocked, and what should happen next.

## TODO and Tree Consistency

TODO management and tree management are related but should not collapse into one object.

Consistency rules:

- todos remain lightweight planning inputs
- generating a node from a todo preserves the link in metadata
- when that node is run, the resulting run card can show both the tree node and todo lineage

This preserves the distinction between structured tree planning and more manual runner customization while still making the lineage visible.

## Frontend Changes

Primary frontend surfaces:

- `frontend/src/components/VibeResearcherPanel.jsx`
- `frontend/src/components/vibe/VibeRunHistory.jsx`
- new run-strip and run-detail-modal components
- `frontend/src/components/vibe/VibeTreeCanvas.jsx`
- `frontend/src/components/vibe/VibePlanEditor.jsx`
- `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- `frontend/src/index.css`

The main panel should own:

- recent-run strip data
- selected run detail modal state
- continuation chip state for the launcher
- synchronization between selected run and run report

## Backend Changes

Primary backend surfaces:

- `backend/src/routes/researchops/runs.js`
- `backend/src/routes/researchops/projects.js`
- `backend/src/services/researchops/store.js`
- `backend/src/services/researchops/orchestrator.js`
- existing artifact publication path

Backend work should focus on:

- richer run metadata
- remote run workspace path persistence
- final output and summary artifact conventions
- exposing enough report data for the modal and runner strip
- preserving tree-to-run linkage

## Risks

- If tree state and run metadata are not normalized around the same linked run id, the UI will still drift.
- If continuation uses raw pasted output instead of context refs, prompt bodies will become noisy and fragile.
- If remote run workspaces are not standardized, experiment and implementation runs will keep surfacing inconsistent output shapes.
- If the tree simplification only changes labels without changing the default view and primary actions, users will still experience it as too complex.

## Verification

- Add frontend helper tests for runner card ordering, source labeling, continuation context chips, and tree status summaries.
- Add backend tests for run metadata persistence and run-report workspace fields.
- Manually verify:
  - newest run appears left-most
  - tree-triggered runs appear in the strip
  - modal shows context, prompt, and output sections
  - continue adds a run context chip and re-focuses launcher input
  - experiment runs surface generated plot artifacts
  - implementation runs surface summary artifacts
  - tree status remains in sync with the linked latest run
