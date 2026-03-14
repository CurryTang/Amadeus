# VS Code List-First Extension Design
**Date:** 2026-03-14
**Approach:** Expand the current ARIS VS Code companion into a compact, list-first Auto Researcher extension that covers tracked papers, library papers, and ARIS runs without browser capture flows.

---

## Overview

The current VS Code companion is too narrow.

It already gives ARIS a usable in-editor control surface, but the desired product is broader:

- tracked papers should be visible in VS Code
- tracked papers should be explicitly saveable into the library
- library papers should expose reading-related actions
- ARIS should remain available as an operational run surface

The key product rule is unchanged:

**tracker-discovered papers must not be auto-saved.**

The extension should therefore stay thin and call backend APIs for all save and reader actions. It should not invent local side effects or browser-style capture behavior.

This is still a companion surface, not a replacement for the browser app. The main difference is information architecture:

- compact lists in the VS Code sidebar
- focused detail panes to the right
- minimal action sets per item type

---

## Goals

- Expand the VS Code extension beyond ARIS into a compact Auto Researcher surface.
- Show tracked papers in a dense feed with explicit `Save`.
- Show saved library papers separately with library-only actions.
- Preserve the current ARIS run launch and inspection flow.
- Reuse backend logic rather than duplicating save/reader behavior in the extension.

## Non-Goals

- Do not support browser-style page capture or PDF capture in VS Code.
- Do not auto-save tracker papers.
- Do not recreate the web app’s full layout in a webview.
- Do not add remote file browsing or terminal orchestration in this phase.
- Do not collapse all domains into one giant store or one giant view.

---

## Product Position

The extension is a list-first operator shell for the existing Auto Researcher backend.

It should make common in-editor workflows fast:

- inspect tracker results
- explicitly save papers into the library
- inspect the library and trigger reader-related actions
- launch and monitor ARIS runs

The browser app remains the richer surface for larger workflows, broader forms, and browser-specific actions.

---

## Core Information Architecture

The extension should use compact sidebar views and a focused detail pane.

### Sidebar Views

V1 expanded views:

- `Tracked Papers`
- `Library`
- `ARIS Projects`
- `ARIS Runs`

### Detail Pane

The detail pane should adapt to the selected item type.

Tracked paper detail:

- title
- authors
- source
- date
- abstract/snippet when available
- `Save`

Library paper detail:

- title
- authors
- read/unread state
- reader processing status
- notes/summary metadata when available
- library-only actions

ARIS run detail:

- existing run summary, prompt, status, and retry/copy actions

---

## Domain Split

The extension should keep the three domains distinct.

### 1. Tracker Domain

Purpose:

- show tracker-derived candidate papers
- expose explicit `Save`

Rules:

- no `Mark Read`
- no reader actions
- no implicit insertion into the library

### 2. Library Domain

Purpose:

- show saved papers only
- expose reading-related actions

Rules:

- `Save` is not shown here
- actions only apply to existing library papers

### 3. ARIS Domain

Purpose:

- keep the current ARIS run control surface

Rules:

- selection and polling remain separate from tracker/library refresh behavior

---

## Selection Behavior

Selection should be preserved independently per view where possible.

### Tracked Papers

- selecting a tracked paper opens tracked-paper detail
- saving should update that row immediately to show saved state
- after save, the item should be eligible to appear in `Library` on refresh

### Library

- selecting a library paper opens library detail
- marking read or queueing reader should update the selected item’s state without disturbing tracker selection

### ARIS

- project selection scopes the run list
- run selection opens the run detail pane

### Cross-View Rule

Refreshing one domain should not clear unrelated selections in the others.

---

## Compact List Rules

The list views must stay dense.

Tracked papers row:

- title
- short source label
- relative or short absolute date
- saved state

Library row:

- title
- read/unread state
- reader processing status

ARIS run row:

- title or prompt snippet
- workflow
- status
- updated time

Longer metadata belongs in the detail pane, not the row itself.

---

## Action Model

Each domain should expose the smallest useful action set.

### Tracked Papers

- `Save`

### Library

- `Mark Read`
- `Mark Unread`
- `Queue Reader`
- optional `Open Notes` only if the existing backend/data model supports it cleanly

### ARIS

- `New Run`
- `Refresh`
- `Retry Run`
- `Copy Run ID`

This keeps action semantics obvious and avoids importing web-app complexity into VS Code.

---

## Backend Contract

The extension should remain thin and backend-driven.

### ARIS

- `GET /api/aris/context`
- `GET /api/aris/runs`
- `GET /api/aris/runs/:runId`
- `POST /api/aris/runs`
- `POST /api/aris/runs/:runId/retry`

### Tracker

Need one compact feed/list endpoint and one explicit save action.

Required semantics:

- tracker items return enough metadata to render rows and details
- tracker items expose whether they are already saved
- explicit `Save` routes the item through the backend’s canonical library insertion behavior

### Library

Need:

- list endpoint
- detail endpoint
- mark read/unread action
- queue reader action

The extension should not recreate library mutation logic client-side.

---

## Client Architecture

Do not refactor the entire extension into one global model immediately.

Recommended split:

- `src/aris/*`
- `src/tracker/*`
- `src/library/*`
- shared `src/core/*`, `src/state/*`, `src/webview/*`

Use one small store per domain.

This keeps expansion low-risk and avoids destabilizing the existing ARIS companion while tracker/library are added.

---

## Detail Pane Strategy

Two viable options exist:

1. One polymorphic detail webview
2. Separate detail renderers/panels per domain

Recommendation:

Start with separate renderers behind one controller or with clearly separated detail modules.

Why:

- tracker, library, and ARIS have different action sets
- forcing them into one generic renderer too early will create weak abstractions

---

## Polling And Refresh

Refresh behavior should stay domain-aware.

- tracker can refresh independently
- library can refresh independently
- ARIS keeps its own refresh/polling rhythm

Background polling should remain conservative.

Manual refresh commands should remain first-class.

---

## Naming

The current package is ARIS-branded, but the expanded scope is broader.

Two options:

1. Keep the current package structure and naming while expanding functionality
2. Rename it now to a broader `Auto Researcher` extension

Recommendation:

Keep the current package and structure for the next implementation phase, then rename once tracker and library are actually present.

This reduces churn while requirements are still moving.

---

## Risks

### Scope Creep

The fastest way to ruin this extension is to keep adding browser-only capabilities.

### API Shape Drift

Tracker and library payloads need typed normalization just like ARIS.

### Over-Coupled State

One global store for all domains will become fragile quickly.

### Broken Product Rule

Any shortcut that auto-saves tracker papers would violate an explicit repo rule and create behavior drift against the main product.

---

## Recommended Implementation Order

1. Add tracker list + detail + `Save`
2. Add library list + detail + read/reader actions
3. Keep ARIS as-is and integrate the broader shell around it
4. Unify detail-pane handling only where duplication is real
5. Revisit naming and packaging once the broader extension is stable

---

## Result

The target extension is:

- compact
- list-first
- backend-driven
- explicit in its save semantics
- broader than ARIS, but still intentionally narrower than the browser app

That is the right shape for VS Code.
