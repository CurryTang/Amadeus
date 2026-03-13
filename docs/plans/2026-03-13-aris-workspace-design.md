# ARIS Workspace Design
**Date:** 2026-03-13
**Approach:** Add a dedicated top-level ARIS workspace that launches and monitors WSL-hosted ARIS runs while reusing Auto Researcher's managed SSH servers and paper library.

---

## Overview

ARIS should not remain a thin wrapper around Claude Code.

The product should expose ARIS as a first-class workspace with:

- a top-level `ARIS` area in the frontend
- action-first controls for ARIS's main workflows
- a freeform input box so the user can still phrase tasks however they want
- a WSL-first execution model where the always-on WSL/server host is the canonical ARIS runner

This solves the two major product problems:

1. stock ARIS assumes local orchestration, so runs stop when the client laptop sleeps or closes
2. stock ARIS has no real server manager or persistent remote workspace model

In the integrated system:

- Auto Researcher remains the control plane and paper-library backend
- the always-on WSL host becomes the ARIS execution plane
- managed SSH servers remain downstream experiment targets

---

## Goals

- Make ARIS a top-level workspace, not a hidden shell wrapper.
- Keep user input flexible while adding one-click entry points for major ARIS workflows.
- Ensure ARIS loops continue when the client device disconnects.
- Reuse existing SSH server management instead of `CLAUDE.md`-only server text.
- Keep large datasets on the WSL host or downstream compute servers, not on the client laptop.

## Non-Goals

- Do not build a full browser-based replacement for every Claude Code terminal interaction.
- Do not introduce a second independent SSH/server database for ARIS.
- Do not require datasets to sync through the browser.

---

## Section 1 — Execution Model

### Decision

The always-on WSL/server host is the canonical ARIS runner for each project.

### Why

- If ARIS runs only on the client device, orchestration stops when the client sleeps or closes.
- ARIS loops are long-running and stateful; they belong on a persistent machine.
- The WSL host is already aligned with the system architecture: heavy processing and tool orchestration should run on the always-on executor.

### Resulting topology

- Client:
  - opens the ARIS workspace
  - chooses a project and input
  - launches runs
  - monitors progress and artifacts
- WSL host:
  - owns the canonical ARIS workspace for the project
  - runs Claude/Codex/ARIS commands
  - stores loop state and logs
  - dispatches experiment work to downstream SSH servers when needed
- Remote compute servers:
  - run experiments
  - store datasets/checkpoints/results as configured

### Behavioral rule

Closing the client UI must not stop a run that has already been launched on the WSL host.

---

## Section 2 — Persistent Remote Workspace

### Decision

Each ARIS-enabled project should have a persistent remote workspace path on the WSL host.

### Why

- ARIS loop state files and logs need a stable location.
- Incremental code sync only works cleanly when the target workspace persists.
- Datasets and checkpoints should live remotely and stay attached to that workspace or its downstream servers.

### Workspace contents

The remote workspace should hold:

- the checked-out project code
- ARIS skill/install state
- loop logs such as `AUTO_REVIEW.md`
- loop state files such as `REVIEW_STATE.json`
- paper-writing outputs
- lightweight config pointing to managed SSH targets and dataset roots

### Dataset policy

Datasets should not be pushed from the client by default.

Instead:

- large datasets live on the WSL host or downstream compute servers
- ARIS runs reference those remote dataset roots
- code sync is incremental and excludes large data/checkpoint trees

---

## Section 3 — SSH Integration Model

### Decision

ARIS should use Auto Researcher's managed SSH server records instead of relying only on handwritten `CLAUDE.md` server instructions.

### Why

- The app already has explicit SSH server CRUD, connectivity tests, shared filesystem verification, and managed key distribution.
- Reusing that system avoids duplicating server configuration and reduces user error.

### V1 behavior

The ARIS runner should resolve:

- canonical WSL runner host
- default downstream experiment server
- optional dataset root
- optional remote code root

from managed server configuration and ARIS project settings.

`CLAUDE.md` can still exist as generated context for the ARIS workspace, but it should be derived from the managed system instead of being the source of truth.

---

## Section 4 — Frontend Workspace

### Decision

Add a new top-level `ARIS` workspace in the frontend.

### Why

- ARIS has distinct workflows and status concepts that do not fit cleanly inside the Library page.
- A dedicated surface can show launcher controls, run state, remote workspace context, and recent outputs together.

### Main zones

#### 1. Launch Bar

Primary freeform input and launcher area.

Contents:

- project selector
- runner status pill
- freeform prompt box
- optional server/workspace summary
- primary `Run` button

The input must remain freely editable at all times.

#### 2. Quick Actions

Preset ARIS actions that only prefill intent, not constrain it.

Buttons:

- Literature Review
- Idea Discovery
- Run Experiment
- Auto Review Loop
- Paper Writing
- Paper Improvement
- Full Pipeline
- Monitor Experiment

Clicking a button preloads the launch form with:

- a suggested command/workflow
- optional defaults for inputs and context

The user can still edit all text before launching.

#### 3. Run Context

Show the execution environment clearly:

- canonical WSL runner
- selected downstream SSH server
- remote workspace path
- dataset root or “remote dataset only” indicator
- linked library selection / research pack inputs where relevant

This area should answer: “Where will this actually run?”

#### 4. Run Feed

A live panel for current and recent runs:

- status
- start time / duration
- current ARIS phase
- review round and score progression
- latest artifacts
- links to logs and outputs

---

## Section 5 — Workflow Model in the UI

### Decision

The workspace should expose ARIS workflows as structured launch intents, not hardcoded scripts.

### Reasoning

Users need shortcuts, but research input remains highly variable.

So the UI should support:

- preset workflow buttons
- fully custom freeform prompts
- optional attachments/context such as linked papers or workspace docs

### Launch model

Each run request should capture:

- project id
- workflow type
- freeform user input
- runner host / server selection
- remote workspace path
- optional paper/document context

The backend then materializes the concrete ARIS execution command on the WSL host.

---

## Section 6 — User Experience Rules

### Clear run ownership

The UI must clearly distinguish:

- launched from browser
- running on WSL host
- dispatching experiments to downstream SSH server
- waiting on remote jobs
- completed / failed / waiting for user input

### Always-on expectation

The ARIS workspace should explicitly tell the user:

- client closure does not stop WSL-hosted runs
- client-hosted runs are not the recommended mode for long ARIS loops

### Input flexibility

Quick actions are accelerators only.

The user should always be able to:

- rewrite the prompt
- select a different workflow
- choose different context inputs

---

## Section 7 — Backend Contract Direction

### Needed backend additions

The frontend requires ARIS-oriented endpoints or payloads for:

- listing ARIS-enabled projects/workspaces
- launching a run on the WSL host
- listing recent ARIS runs
- reading run status and progress
- resolving latest outputs/artifacts/logs
- resolving managed SSH targets for a project

### Recommended implementation boundary

Keep ARIS-specific orchestration in a focused backend module rather than spreading logic through generic document or SSH routes.

The backend should translate frontend launch requests into:

- persistent remote workspace selection
- generated ARIS context/config
- remote command execution on the WSL host

---

## Final Decision

We will:

- make ARIS a top-level frontend workspace
- run ARIS canonically on the always-on WSL/server host
- use persistent remote workspaces
- reuse managed SSH server records for downstream experiment dispatch
- expose preset ARIS actions while preserving fully freeform input

This gives the product a real ARIS control plane instead of a terminal wrapper, while preserving the flexibility that makes ARIS useful.
