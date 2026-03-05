# Project Entry Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent project-entry bootstrap gating for new projects, reusable project templates in Vibe settings, and environment-root auto-bootstrap that completes only after validation passes.

**Architecture:** Extend the existing ResearchOps UI config to store project templates, redesign the jump-start flow around an environment root node for new projects, and make `VibeResearcherPanel` auto-open the bootstrap modal until the environment root reaches `PASSED`. Keep existing-codebase root generation intact for repository-based projects.

**Tech Stack:** React, Axios, Express, node:test, existing ResearchOps tree plan/state services

---

### Task 1: Extend UI config normalization and persistence for project templates

**Files:**
- Modify: `backend/src/services/researchops/store.js`
- Modify: `backend/src/routes/researchops/admin.js`
- Modify: `frontend/src/lib/uiConfig.js`
- Test: `backend/src/services/researchops/__tests__/store.ui-config.test.js`
- Test: `backend/src/routes/researchops/__tests__/admin.ui-config.test.js`
- Test: `frontend/src/lib/uiConfig.test.mjs`

**Step 1: Write the failing backend store tests**

Add tests covering:
- default config includes an empty `projectTemplates` array
- valid template arrays persist and reload
- invalid template records are rejected or normalized safely

**Step 2: Run backend store tests to verify they fail**

Run: `node --test src/services/researchops/__tests__/store.ui-config.test.js`
Expected: FAIL because `projectTemplates` is not yet part of the persisted UI config contract.

**Step 3: Write the failing admin route tests**

Add tests covering:
- `GET /ui-config` includes `projectTemplates`
- `PATCH /ui-config` accepts valid templates
- invalid template shapes produce validation errors

**Step 4: Run admin route tests to verify they fail**

Run: `node --test src/routes/researchops/__tests__/admin.ui-config.test.js`
Expected: FAIL because route normalization only understands `simplifiedAlphaMode`.

**Step 5: Write the failing frontend normalization tests**

Add cases for:
- default `projectTemplates` normalization
- filtering or coercing malformed template entries
- patch building that preserves template payloads

**Step 6: Run frontend normalization tests to verify they fail**

Run: `npm test -- --run src/lib/uiConfig.test.mjs`
Expected: FAIL because frontend normalization does not include templates.

**Step 7: Implement backend store support**

Update `store.js` to normalize, persist, and return:
- `simplifiedAlphaMode`
- `projectTemplates`
- `updatedAt`

Normalize each template to a stable shape with:
- `id`
- `name`
- `description`
- `sourceType`
- `fileName`
- `fileContent`
- `testSpec`
- `updatedAt`

**Step 8: Implement admin route validation and response shaping**

Update `admin.js` helper functions so `GET /ui-config` and `PATCH /ui-config` fully support template arrays with validation errors for invalid shapes.

**Step 9: Implement frontend normalization helpers**

Update `frontend/src/lib/uiConfig.js` to normalize `projectTemplates` and build patch payloads that preserve valid template objects.

**Step 10: Run all config-related tests**

Run: `node --test src/services/researchops/__tests__/store.ui-config.test.js src/routes/researchops/__tests__/admin.ui-config.test.js`
Run: `npm test -- --run src/lib/uiConfig.test.mjs`
Expected: PASS

**Step 11: Commit**

```bash
git add backend/src/services/researchops/store.js backend/src/routes/researchops/admin.js backend/src/services/researchops/__tests__/store.ui-config.test.js backend/src/routes/researchops/__tests__/admin.ui-config.test.js frontend/src/lib/uiConfig.js frontend/src/lib/uiConfig.test.mjs
git commit -m "feat(researchops): persist project bootstrap templates"
```

### Task 2: Add project template management to the Vibe settings UI

**Files:**
- Modify: `frontend/src/components/LibrarySettingsModal.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Step 1: Write the failing UI test or testable helper coverage if present**

If there is no component-test harness in this repo, extract template normalization/event helpers into testable functions and cover:
- add template
- edit template
- remove template from in-memory draft
- save templates through the existing UI-config flow

**Step 2: Run the chosen frontend tests to verify failure**

Run the smallest existing frontend test command used in this repo for the touched helper/module.
Expected: FAIL because template settings UI does not exist yet.

**Step 3: Implement the settings section**

In `LibrarySettingsModal.jsx`, add a `Project Templates` section beneath the current skills/release-related area with fields for:
- template name
- description
- source type
- file name
- file content
- validation/import test spec

Use the existing UI-config fetch/save flow in `App.jsx` rather than introducing a parallel API path.

**Step 4: Add compact styling**

Update `frontend/src/index.css` for:
- template card layout
- editor controls
- mobile-safe stacking

**Step 5: Run frontend verification**

Run the relevant frontend test command for the extracted helper/module if present.
Expected: PASS

**Step 6: Manual smoke check**

Run the frontend app, open settings, add/edit/save templates, reload, and confirm persistence.

**Step 7: Commit**

```bash
git add frontend/src/components/LibrarySettingsModal.jsx frontend/src/App.jsx frontend/src/index.css
git commit -m "feat(frontend): add vibe project template settings"
```

### Task 3: Redesign jump-start plan generation for template, intent, and empty bootstrap

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/services/researchops/tree-plan.service.js`
- Test: `backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`

**Step 1: Write the failing backend tests**

Add tests for:
- new-project template bootstrap creates an environment root node
- free-text bootstrap creates an environment root node
- empty bootstrap creates a minimal environment root node
- existing-codebase bootstrap still creates the baseline analysis path
- new-project bootstrap does not leave the default `init` placeholder as the effective root

**Step 2: Run the jump-start tests to verify they fail**

Run: `node --test src/routes/researchops/__tests__/projects.jumpstart.test.js`
Expected: FAIL because jump-start still uses the old category/project-type payload and hardcoded node builder.

**Step 3: Refactor request parsing**

Update `projects.js` jump-start handling to accept:
- `projectMode`
- `bootstrapMode`
- `templateId`
- `freeformIntent`

Validate payload combinations strictly.

**Step 4: Implement reusable environment-node builders**

Add helpers that generate environment root nodes for:
- template bootstrap
- free-text bootstrap
- empty bootstrap

Ensure each node has stable metadata/tags so the frontend can identify it as the gating environment root.

**Step 5: Replace placeholder bootstrap behavior**

Update `tree-plan.service.js` or the jump-start write path so the default `init` placeholder is replaced or bypassed for new-project bootstrap, instead of appending a sibling/child that leaves the old placeholder in charge.

**Step 6: Preserve existing-codebase behavior**

Keep the current existing-codebase root/analysis flow intact and ensure the new logic only changes new-project bootstrap.

**Step 7: Run backend jump-start tests**

Run: `node --test src/routes/researchops/__tests__/projects.jumpstart.test.js`
Expected: PASS

**Step 8: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/services/researchops/tree-plan.service.js backend/src/routes/researchops/__tests__/projects.jumpstart.test.js
git commit -m "feat(researchops): add environment-root bootstrap planning"
```

### Task 4: Prevent codebase root auto-generation for new projects

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Test: `backend/src/routes/researchops/__tests__/projects.new-project-root.test.js`

**Step 1: Write the failing backend tests**

Cover:
- existing-codebase project loads still auto-generate the baseline root when appropriate
- new-project tree loads do not auto-generate `baseline_root`
- new-project environment root remains the first root shown by plan loading

**Step 2: Run the tests to verify they fail**

Run: `node --test src/routes/researchops/__tests__/projects.new-project-root.test.js`
Expected: FAIL because tree loading still treats the placeholder bootstrap node as a signal to generate the codebase root.

**Step 3: Implement project-mode-aware root logic**

Update tree-plan load handling in `projects.js` so auto-root generation only applies to existing-codebase projects, not new projects.

**Step 4: Run the root-behavior tests**

Run: `node --test src/routes/researchops/__tests__/projects.new-project-root.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/routes/researchops/__tests__/projects.new-project-root.test.js
git commit -m "fix(researchops): keep new project env node as root"
```

### Task 5: Auto-run the environment root and encode validation semantics

**Files:**
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/services/researchops/tree-state.service.js`
- Modify: `backend/src/services/researchops/orchestrator.js` if needed for execution metadata
- Test: `backend/src/routes/researchops/__tests__/projects.bootstrap-run.test.js`

**Step 1: Write the failing tests**

Cover:
- jump-start success enqueues the environment root automatically
- queued/running state is written for the environment root
- failed enqueue leaves the node in place with retryable state
- validation commands/checks are included for template, free-text, and empty bootstrap

**Step 2: Run the tests to verify they fail**

Run: `node --test src/routes/researchops/__tests__/projects.bootstrap-run.test.js`
Expected: FAIL because jump-start currently only mutates the plan and does not auto-run the created node.

**Step 3: Implement auto-run after plan creation**

After creating the environment root node, immediately invoke the existing tree-node execution path so the node moves into `QUEUED` or `RUNNING`.

**Step 4: Encode validation gates**

Ensure generated environment nodes contain:
- file existence checks
- dependency install verification
- Python import or shell smoke checks driven by template `testSpec` or sensible fallback behavior

Only successful verification should allow the node to reach `PASSED`.

**Step 5: Run bootstrap execution tests**

Run: `node --test src/routes/researchops/__tests__/projects.bootstrap-run.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/routes/researchops/projects.js backend/src/services/researchops/tree-state.service.js backend/src/services/researchops/orchestrator.js backend/src/routes/researchops/__tests__/projects.bootstrap-run.test.js
git commit -m "feat(researchops): auto-run bootstrap environment root"
```

### Task 6: Redesign the project-entry modal and gate visibility in the workspace

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `frontend/src/components/vibe/JumpstartModal.jsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/src/components/vibe/JumpstartModal.test.mjs`
- Test: `frontend/src/components/VibeResearcherPanel.test.mjs`

**Step 1: Write the failing modal tests**

Cover:
- template selection submit
- free-text submit
- empty environment submit
- busy/error rendering

**Step 2: Write the failing panel tests**

Cover:
- popup auto-opens for a new project with no environment root
- popup stays hidden while root is `QUEUED` or `RUNNING`
- popup reopens when root is `FAILED`
- popup stays hidden when root is `PASSED`

**Step 3: Run the frontend tests to verify failure**

Run the smallest available frontend test command that covers these files.
Expected: FAIL because the current UI is a manual category wizard triggered by a button.

**Step 4: Implement panel gate derivation**

Update `VibeResearcherPanel.jsx` to derive:
- project mode
- effective root node
- root-node execution state

Use that state to auto-open or suppress the modal on project entry.

**Step 5: Redesign the modal**

Update `JumpstartModal.jsx` to show:
- saved templates
- free-text design input
- explicit empty bootstrap action

The modal should submit the new backend payload and close once plan creation and enqueue succeed.

**Step 6: Update styling**

Add styles for:
- template list
- free-text entry area
- empty bootstrap action
- status-safe responsive layout

**Step 7: Run frontend tests**

Run the relevant frontend test command for the two files/helpers.
Expected: PASS

**Step 8: Manual smoke test**

Start the frontend, create a new project, enter it, and verify the popup gating behavior across `PLANNED`, `QUEUED`, `RUNNING`, `FAILED`, and `PASSED`.

**Step 9: Commit**

```bash
git add frontend/src/components/VibeResearcherPanel.jsx frontend/src/components/vibe/JumpstartModal.jsx frontend/src/index.css frontend/src/components/vibe/JumpstartModal.test.mjs frontend/src/components/VibeResearcherPanel.test.mjs
git commit -m "feat(frontend): gate new projects on environment bootstrap"
```

### Task 7: Run final verification across backend and frontend

**Files:**
- Modify: `docs/plans/2026-03-05-project-entry-bootstrap-design.md`
- Modify: `docs/plans/2026-03-05-project-entry-bootstrap.md`

**Step 1: Run backend verification**

Run:
- `node --test src/services/researchops/__tests__/store.ui-config.test.js src/routes/researchops/__tests__/admin.ui-config.test.js src/routes/researchops/__tests__/projects.jumpstart.test.js src/routes/researchops/__tests__/projects.new-project-root.test.js src/routes/researchops/__tests__/projects.bootstrap-run.test.js`

Expected: PASS

**Step 2: Run frontend verification**

Run the relevant frontend test command covering:
- `src/lib/uiConfig.test.mjs`
- `src/components/vibe/JumpstartModal.test.mjs`
- `src/components/VibeResearcherPanel.test.mjs`

Expected: PASS

**Step 3: Run manual end-to-end smoke check**

Verify:
- templates save and reload in settings
- new project opens into the bootstrap modal
- modal hides while environment root is running
- modal returns after failure
- modal stops returning after success
- existing-codebase projects still use the baseline root flow

**Step 4: Update docs if verification reveals drift**

Tighten these two plan docs if the implementation differs in a material way from the approved design.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-05-project-entry-bootstrap-design.md docs/plans/2026-03-05-project-entry-bootstrap.md
git commit -m "docs: finalize project entry bootstrap plan"
```
