# Vibe Alpha Simplified Mode Design

## Context

The Vibe Researcher workspace currently exposes advanced agent-skill selection and tree-based planning UI by default. For an early alpha release, the user wants a runtime toggle that simplifies the frontend design by hiding the skill menu in the Vibe workspace and hiding tree-based research planning.

The toggle must be global for the app, not per project and not build-time only.

## Goals

- Add a runtime-configurable global toggle for an early alpha simplified mode.
- Hide skill-selection UI inside the Vibe workspace when the toggle is enabled.
- Hide tree-based research planning UI when the toggle is enabled.
- Preserve the rest of the Vibe workspace so the app remains usable in alpha mode.
- Keep the change reversible without removing the underlying advanced workflows.

## Non-Goals

- No deletion of existing tree-planning logic, APIs, or data.
- No per-project settings for this release mode.
- No build-time feature flag or redeploy-only switch.
- No redesign of unrelated areas outside the Vibe workspace.

## Recommended Approach

Implement a backend-backed global product-mode setting, expose it through an existing settings or admin surface, fetch it at app runtime, and pass a single boolean flag into the Vibe workspace.

This keeps the behavior truly global across browsers and devices while minimizing regression risk by only suppressing UI rendering for the advanced alpha-incompatible surfaces.

### Configuration Model

- Add a global app setting field such as `simplifiedAlphaMode`.
- Store the setting in backend-managed app settings rather than local browser storage.
- Default to `false` if the setting is absent or the settings fetch fails.

### Frontend Data Flow

- Load the global setting near the top of `frontend/src/App.jsx`.
- Pass the resolved boolean into `frontend/src/components/VibeResearcherPanel.jsx`.
- Derive a single `isSimplifiedAlpha` guard inside the panel and use it consistently for conditional rendering.

### UI Behavior When Enabled

Hide the following advanced surfaces in the Vibe workspace:

- Workspace skill entry points such as `Skills (...)`.
- Skill-selection chips in the launcher (`Implement`, `Experiment`, `TODO Manager`, `Resource KB`, `Code Chat`, `Custom`).
- Skills modal entry points.
- Tree planning surfaces: `VibePlanEditor`, `VibeTreeCanvas`, `VibeNodeWorkbench`.
- Tree-oriented actions such as TODO-to-node generation, root-node bootstrap, jump-start, and tree-oriented autopilot entry points.

Keep the following available:

- Project selection and workspace metadata.
- Core launcher flow in a simplified default path.
- TODO list management that does not depend on tree-node generation.
- Knowledge base and project files browsers.
- Run history and other non-tree project status views.

### State Handling

- Prefer leaving existing state and handlers intact unless they directly cause broken behavior while hidden.
- If simplified mode activates while a tree panel or skills modal is open, close or stop rendering those surfaces cleanly.
- Avoid adding parallel state models for alpha mode.

## Alternatives Considered

### Browser-local toggle

Storing the toggle in localStorage would be fast but would only affect one browser profile, which does not satisfy the global release-control requirement.

### Temporary in-memory toggle

A non-persistent UI toggle would be fastest to wire, but it would be fragile and unsuitable for release control.

## Risks

- Hiding only part of the tree workflow could leave confusing empty layout gaps or stale selected-node state.
- Tree-oriented actions are spread across `VibeResearcherPanel`, so missing one would make the simplified mode inconsistent.
- If the setting fetch fails and the UI partially initializes hidden state, the panel could end up in a mismatched view unless the fallback path is explicit.

## Verification

- Add frontend rendering tests for simplified mode to confirm skill UI and tree-planning UI are hidden.
- Add a control test to confirm the existing advanced UI still renders when simplified mode is off.
- Manually verify both toggle states in the browser, focusing on Vibe workspace layout continuity and absence of orphaned controls.
