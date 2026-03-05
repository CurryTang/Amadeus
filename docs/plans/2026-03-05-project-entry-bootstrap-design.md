# Project Entry Bootstrap Design

## Context

The Vibe Researcher project workspace currently handles empty plans with a manual jump-start banner and a modal that lets the user choose between an existing codebase or a hardcoded new-project environment setup. The backend also auto-inserts an existing-codebase baseline root when the default `init` node is present.

The desired experience is different for newly created projects:

- Entering a project should open a popup automatically.
- The popup should let the user choose a saved project template, describe the project in free text, or skip both and start with an empty environment.
- Saved templates should be configurable from the Vibe Research settings area beneath the skills section.
- For new projects, the root node should be the environment node rather than the existing-codebase baseline node.
- The environment bootstrap should run automatically and stop gating only when the environment root node reaches `PASSED`.
- While the environment root node is `RUNNING` or `QUEUED`, the popup should stay hidden.
- Bootstrap should include automatic testing such as Python import verification so the environment is only considered done when dependency validation succeeds.

## Goals

- Replace the current manual empty-tree jump-start flow with an automatic project-entry gate for new projects.
- Add reusable project templates to the Vibe Research settings model and UI.
- Support three new-project bootstrap inputs:
  - saved template
  - free-text project description
  - empty environment
- Ensure new-project trees use the environment setup node as the first real root node.
- Auto-run the environment bootstrap after the jump-start choice is submitted.
- Keep the gate active until the environment root node reaches `PASSED`, but suppress it while the node is already `RUNNING` or `QUEUED`.
- Encode automatic environment validation into the environment root node so `PASSED` means usable, not merely created.

## Non-Goals

- No removal of the existing codebase baseline-root flow for repository-based projects.
- No migration of template storage to a separate feature-specific database table for this iteration.
- No redesign of unrelated Vibe Researcher panels outside project entry, settings, and tree bootstrap behavior.
- No replacement of the current tree planning model with a separate onboarding workflow.

## Recommended Approach

Extend the existing jump-start workflow rather than creating a parallel onboarding system. Use the tree as the source of truth for bootstrap progress, add reusable templates to the existing Vibe UI config/settings payload, and introduce a new-project-specific environment root path that bypasses the existing codebase baseline root generation.

This approach preserves the current plan/state architecture, keeps bootstrap progress visible in the canvas, and ties popup visibility directly to root-node execution state.

## Product Behavior

### Project Entry Gate

When a user opens a project, the frontend evaluates whether the workspace should still be gated by environment setup.

For new projects:

- Open the popup automatically if no environment root node exists.
- Open the popup automatically if the environment root exists but is neither `PASSED`, `RUNNING`, nor `QUEUED`.
- Keep the popup hidden while the environment root node is `RUNNING` or `QUEUED`.
- Stop reopening the popup only when the environment root node reaches `PASSED`.

For existing-codebase projects:

- Preserve the current baseline-root flow.
- Preserve the existing codebase summary/root generation behavior.
- Do not substitute the environment root for the codebase baseline root.

### Popup Content

The project-entry popup should support three explicit paths:

1. Select a saved template.
2. Describe the intended project in a free-text input area.
3. Start with an empty environment.

Saved templates are the preferred structured path, but the free-text path remains available when the user has a novel design in mind. If neither is used, the system should still create an empty environment root node and bootstrap a minimal environment.

### Automatic Execution

After the user submits one of the bootstrap choices, the system should:

1. Create or replace the initial new-project environment root node.
2. Persist the updated tree plan.
3. Enqueue execution for the environment root node automatically.
4. Close the popup if node creation and enqueue succeed.
5. Let the user inspect progress and results from the tree node in the canvas/workbench.

If plan creation succeeds but enqueue fails, the root node should remain in the tree and the UI should present a retry path instead of silently discarding the bootstrap state.

## Data Model

### UI Config Extension

Extend the current ResearchOps UI config to store reusable project templates in addition to `simplifiedAlphaMode`.

Each template should include:

- `id`
- `name`
- `description`
- `sourceType` with allowed values `pixi`, `requirements`, `docker`
- `fileName`
- `fileContent`
- `testSpec`
- `updatedAt`

`testSpec` should support:

- Python import checks for package validation
- Optional shell verification commands
- Future-safe extension without changing the top-level template shape

The config should continue to be stored per user through the existing ResearchOps store rather than a separate template table for this iteration.

### Jump-Start Request Model

Replace the current hardcoded request shape with a more expressive payload:

- `projectMode`: `existing_codebase` or `new_project`
- `bootstrapMode`: `template`, `intent`, or `empty`
- `templateId`: optional
- `freeformIntent`: optional

This keeps backend plan generation explicit and avoids overloading the old `type` and `projectType` fields with multiple meanings.

## Tree and Plan Behavior

### Existing Codebase Projects

Existing codebase projects should continue to use the baseline root generation path implemented by the current root-node logic. The root node remains the codebase achievements node, with environment setup appearing later if the user adds it.

### New Projects

New projects should not receive the existing-codebase baseline root. Instead:

- the first real root node becomes the environment setup node
- the default placeholder `init` node must not trigger automatic codebase-root creation
- jump-start should replace the placeholder bootstrap path with a concrete environment root path

The environment node should be marked in a way the frontend can reliably recognize as the effective project-entry gate, such as dedicated tags or stable node metadata.

## Environment Generation

### Template Bootstrap

If the user selects a saved template, bootstrap should:

- write the configured template file into the project
- execute the corresponding setup/install path
- execute automatic tests defined by `testSpec`

Examples:

- `pixi`: write `pixi.toml`, ensure `pixi` exists, resolve/install environment, run configured imports or commands
- `requirements`: write `requirements.txt`, create/install environment using the selected Python workflow, run configured imports or commands
- `docker`: write `Dockerfile`, build the image, execute a smoke command in the container

### Free-Text Bootstrap

If the user provides a free-text project description, the backend should synthesize a conservative environment bootstrap from that intent. The generated node should still emit explicit commands, checks, and a verification path so execution remains inspectable and reproducible from the tree.

### Empty Bootstrap

If the user skips both template and free-text input, bootstrap should create a minimal environment node with:

- base environment initialization
- minimal runnable validation
- a result that can still be expanded later by the user

For Python-oriented projects this can default to a minimal interpreter smoke test. The exact fallback can remain conservative as long as it is deterministic and visible in the node commands/checks.

## Validation Semantics

The environment root should only reach `PASSED` when validation succeeds. Creating the node or writing files is not enough.

Validation should include at least:

- bootstrap file existence checks
- dependency installation success
- smoke tests or import tests from the selected/generated configuration

If validation fails:

- the node status should end in `FAILED`
- the popup should reopen the next time the user enters the project
- the user should be able to inspect failure details from the node rather than from a separate onboarding state

## Frontend Changes

### Project Workspace Entry

`VibeResearcherPanel` should move from the current banner-driven empty-tree behavior to an automatic gate evaluation on project load. The panel should inspect:

- whether the project is new or existing
- the current plan
- the effective root node for environment bootstrap
- the current root-node status from tree state

This derived state should decide whether the popup opens automatically.

### Popup Redesign

The current `JumpstartModal` should be redesigned from a category wizard into a project-entry bootstrap modal with:

- saved templates list
- free-text design input
- explicit empty-environment action

It should still support existing-codebase projects if the product keeps a shared modal, but the new-project path becomes the primary focus.

### Settings UI

The Vibe Research settings surface should gain a project-template manager beneath the skills area. Users should be able to create, edit, and remove named templates with:

- type
- description
- file name
- file content
- automatic validation checks

## Error Handling

- Invalid template definitions should fail before plan mutation.
- Missing template ids should return a validation error rather than silently falling back.
- Free-text generation failures should produce a visible modal error and should not create a partial node unless the generated node is complete enough to inspect.
- If node creation succeeds but auto-run enqueue fails, keep the node and expose retry behavior.
- If the bootstrap run fails, preserve the failed node state so the popup can reopen on re-entry.

## Testing

### Backend

- Store tests for UI config persistence and validation of project templates.
- Route tests for UI config read/write behavior with templates included.
- Jump-start plan-generation tests for:
  - saved template bootstrap
  - free-text bootstrap
  - empty bootstrap
- Tree-plan loading tests to confirm new projects do not auto-insert the existing-codebase baseline root.

### Frontend

- UI config normalization tests for template arrays.
- Workspace tests for automatic popup visibility based on environment root status.
- Modal submission tests for template selection, free-text submission, and empty bootstrap.
- Regression coverage to ensure existing-codebase projects still get the current baseline-root experience.

### Manual Verification

- Create a new project and enter it: popup opens automatically.
- Choose a saved template: environment root node is created and auto-run.
- Re-enter while node is `RUNNING`: popup does not reopen.
- Re-enter after node `FAILED`: popup reopens.
- Re-enter after node `PASSED`: popup stays hidden.
- Create an existing-codebase project and confirm the codebase baseline root still appears instead of the environment root.
