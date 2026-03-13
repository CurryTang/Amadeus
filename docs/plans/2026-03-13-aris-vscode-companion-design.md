# ARIS VS Code Companion Design
**Date:** 2026-03-13
**Approach:** Build a compact VS Code extension as a companion control surface for ARIS runs, reusing the existing backend and local-executor model instead of porting the full web frontend.

---

## Overview

The VS Code extension should be an ARIS operator console, not a replacement for the current browser app.

The current product already has the right backend split for this:

- Auto Researcher acts as the control plane
- the always-on local executor remains the heavy execution node
- ARIS run state and metadata stay on the backend

The extension should add a compact, list-first interface inside VS Code for launching and monitoring ARIS runs. It should not attempt to reproduce the browser UI's wider workbench layout, and it should not absorb Chrome-extension save flows.

This keeps the first version focused on the workflows that matter most:

- create ARIS runs
- inspect ARIS run status
- retry ARIS runs
- review ARIS run details, reports, and artifacts

---

## Goals

- Add a lightweight ARIS companion surface inside VS Code.
- Reuse the existing ARIS backend and remote execution model.
- Present basic ARIS functionality with a compact list-based UI.
- Keep the extension read/write for ARIS runs only.
- Avoid coupling the extension to browser-specific flows.

## Non-Goals

- Do not port the Chrome extension into VS Code.
- Do not recreate the browser tree canvas or broad research workbench layout.
- Do not add remote file browsing, workspace sync, or terminal orchestration in v1.
- Do not move ARIS execution into the extension host.

---

## Product Position

The extension is a companion control surface.

That means:

- the browser app can remain the richer control plane
- the backend remains the source of truth
- the extension optimizes for low-friction, in-editor operation

The extension is not a standalone ARIS client. It is a focused surface for operators who are already working inside VS Code and want to launch or inspect ARIS runs without switching back to the web app.

---

## Core User Flows

### 1. Launch a new ARIS run

The user chooses a project, selects a workflow, writes or edits a prompt, and submits a run from inside VS Code.

### 2. Monitor active and recent ARIS runs

The user sees a dense list of active and recent runs with status, workflow, and updated time.

### 3. Inspect a selected ARIS run

The user opens a detail pane showing summary metadata, prompt, timestamps, status progression, report summary, and artifact links.

### 4. Retry an ARIS run

The user reruns a selected job from the command palette or from the detail pane.

### 5. Refresh ARIS state

The user manually refreshes state, with light background polling to keep the run list current.

---

## UI Model

The extension should use native VS Code surfaces instead of recreating the web layout.

### Activity Bar Container

Create a dedicated `ARIS` container.

### Sidebar Views

Use compact list views:

- `Projects`
- `Runs`

`Projects` sets the current scope. `Runs` is the primary operational surface.

### Detail Surface

Open the selected run in a narrow detail webview or editor-style panel.

This surface should show:

- run title or identifier
- project
- workflow
- prompt
- status
- created/updated timestamps
- summary of report or latest phase
- links or buttons for artifacts
- retry and refresh actions

### Output Surface

Use a VS Code output channel for extension diagnostics and refresh activity only.

Do not turn v1 into a terminal-control extension.

---

## Information Architecture

The extension should be list-first and detail-second.

### Projects View

Each row should include:

- project name
- optional runner status hint

Selection in this view filters or scopes the runs list.

### Runs View

Each row should include:

- status badge or icon
- run title
- workflow
- relative update time

Optional second-line metadata can be added only if the list remains compact.

### Run Detail View

This view holds secondary information that should not crowd the sidebar:

- full prompt text
- longer status details
- report summary
- artifact actions
- retry action

---

## Interaction Model

The extension should feel like an operations sidebar, not a mini website.

### Commands

V1 commands:

- `ARIS: New Run`
- `ARIS: Refresh`
- `ARIS: Retry Run`
- `ARIS: Copy Run ID`

### Selection Rules

- Preserve selected project across refreshes.
- Preserve selected run across refreshes whenever possible.
- If a run falls out of the current filter, keep the detail pane open and show that it is outside the active list scope.

### Polling Rules

- Manual refresh is first-class.
- Background polling should be light.
- Polling should pause or slow down when the view is hidden.

---

## Architecture

Use three layers.

### 1. Extension Host Layer

Owns:

- activation
- commands
- tree/list providers
- settings
- secret storage
- polling lifecycle
- selected project/run state

### 2. ARIS Client Layer

A small shared TypeScript client wraps backend ARIS endpoints and normalizes payloads into stable local types.

This layer should be reusable inside the extension host and any future webview messaging adapters.

### 3. Detail Webview Layer

The detail pane should render selected-run content only.

In v1, it should not fetch backend data directly. The extension host should remain the source of truth and pass state into the webview.

---

## Backend Contract

The extension should rely on the existing ARIS backend rather than inventing a second orchestration path.

Minimum required endpoints:

- `GET /aris/context`
- `GET /aris/runs`
- `POST /aris/runs`

Likely follow-up endpoints:

- `GET /aris/runs/:id`
- `POST /aris/runs/:id/retry`

If the current backend does not expose detail or retry cleanly enough for the extension, those additions should be handled as targeted backend follow-up work rather than extension-side workarounds.

---

## Auth And Configuration

The extension should use VS Code-native configuration and secrets.

### Settings

- API base URL
- refresh interval
- default project
- default workflow

### Secret Storage

- auth token or session credential material

The extension should not depend on browser cookies, service workers, or Chrome-local storage conventions.

---

## Reuse Strategy

The main reuse should happen below the current web layout.

### Reuse

- backend ARIS routes and services
- ARIS domain concepts: project, run, workflow, status, report, artifact
- portions of current ARIS request/response handling

### Redesign

- tree canvas
- broad workbench layout
- browser-oriented auth and page state patterns
- card-heavy browser panels

The extension should borrow the ARIS feature set from the current frontend, especially the launch and recent-runs behavior, but not the layout.

---

## Risks

### API Shape Drift

If ARIS responses are loosely shaped today, the extension will become brittle unless a small typed client normalizes them.

### Overbuilding The UI

Trying to reproduce the browser workbench in VS Code would slow the project down and produce a worse result.

### Mixing Extension And Backend Responsibilities

The extension should not take on orchestration, remote workspace management, or browser-like state handling in v1.

---

## Recommended V1 Scope

Ship the narrow companion version first:

- compact ARIS views in VS Code
- run launch
- run refresh
- run detail
- retry
- stable auth/settings

This is enough to make ARIS usable in-editor while preserving the current backend and browser app as the richer system surfaces.

---

## Future Expansion

Possible later additions, intentionally out of scope for v1:

- richer status timelines
- inline artifact preview
- saved prompts
- notifications on run completion
- deeper backend-driven filters
- optional remote workspace jump links

These should only happen after the narrow companion flow is stable.
