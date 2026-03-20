# Dispatch Project Management Design

**Date:** 2026-03-20
**Goal:** Adapt the Dispatch project-management concept to Auto Researcher's existing ARIS architecture so it can manage human work, agent work, and slow-feedback execution in one control plane.

---

## Overview

The original Dispatch design assumes a new standalone product with a modern Next.js/Postgres module stack.

That is not the current shape of this repository.

This repo already has:

- a single React app shell rooted in `frontend/src/App.jsx`
- a large ARIS workspace component in `frontend/src/components/aris/ArisWorkspace.jsx`
- an Express backend with `/api/aris/*` routes in `backend/src/routes/aris.js`
- libsql/Turso-backed persistence initialized in `backend/src/db/index.js`
- existing durable ARIS entities for `projects`, `targets`, `runs`, and `plan nodes`

The right adaptation is therefore not "add a second project-management app beside ARIS."

The right adaptation is:

- keep `ARIS` as the module boundary
- turn `ARIS` into a broader async-work control plane
- add Dispatch concepts on top of the current ARIS data model
- keep existing projects and runs valid
- make human-only work first-class instead of forcing every task to start as a run

In this adapted design, ARIS becomes the umbrella workspace for project operations, and Dispatch becomes the operating model inside it.

---

## Goals

- Reuse existing `ARIS projects` directly as Dispatch projects.
- Support manual human work items even when no ARIS run exists yet.
- Keep current ARIS run launching and monitoring intact while making it subordinate to work-item management.
- Add a control-tower home view that prioritizes review and wake-ups over raw activity.
- Stay compatible with the current frontend, backend, and database stack.

## Non-Goals

- Do not introduce a separate workspace/membership system in v1.
- Do not transplant the design doc's full Next.js/Drizzle/Postgres architecture into this repo.
- Do not replace existing ARIS runs or targets with a new incompatible model.
- Do not build deep GitHub sync or full artifact ingestion in the first cut.

---

## Section 1 - Product Positioning Inside This Repo

### Decision

Dispatch should be embedded inside the existing `ARIS` tab, not built as a separate top-level module.

### Why

- The repo already has project, run, and target concepts under ARIS.
- Existing ARIS users should keep seeing their projects and runs without migration to a second namespace.
- The new product value is not a second launcher. It is better control over what is already in flight.

### Result

The current ARIS launcher remains available, but it becomes one screen inside a larger ARIS workspace rather than the default home screen.

---

## Section 2 - Core Domain Adaptation

### Decision

`Work Item` becomes the new durable parent object. Existing `ARIS runs` become execution attempts attached to a work item.

### Why

The current ARIS model is run-centric:

- project
- target
- run
- plan nodes

That is not enough for project management because:

- human work often starts before a run exists
- some work never creates a run
- review and wake-up state need to survive across multiple runs of the same effort
- the control-plane object must preserve intent, context, and next action even while execution changes

### Resulting hierarchy

`Project -> Milestone (optional) -> Work Item -> Run(s) -> Review / Decision / Wake-up`

This keeps ARIS execution intact while making planning and async coordination first-class.

---

## Section 3 - Project Reuse Strategy

### Decision

Existing `ARIS projects` are reused directly as Dispatch projects.

### Why

- avoids parallel project systems
- preserves current project-target-run relationships
- minimizes migration work
- keeps local workspace linking, project file materialization, and target management usable without rework

### Result

No separate Dispatch project table is needed. `aris_projects` stays the source of truth for project identity.

---

## Section 4 - Adapted Data Model

### Decision

Add new Dispatch tables beside the existing ARIS tables instead of replacing them.

### Keep as-is

- `aris_projects`
- `aris_project_targets`
- `aris_runs`
- `aris_run_actions`
- `aris_plan_nodes`

### Add in MVP

- `aris_milestones`
- `aris_work_items`
- `aris_wakeups`
- `aris_reviews`
- `aris_decisions`

### Defer

- standalone workspace and membership tables
- artifact table unless the first UI needs explicit durable artifact rows
- full notifications table if Control Tower can compute urgency from wake-ups and run status first

### Required run-table extensions

`aris_runs` should gain:

- `work_item_id` nullable
- `completed_at` nullable
- optional helper columns only if service-layer derivation becomes too expensive

This keeps historical runs valid while allowing new runs to attach to work items.

---

## Section 5 - Work Item Shape

### Decision

The work item should use the design doc's structured packet idea, trimmed to what this codebase can support immediately.

### Fields

- identity: `id`, `project_id`, `milestone_id`, `parent_work_item_id`
- summary: `title`, `summary`, `type`, `status`, `priority`
- responsibility: `actor_type`
- packet: `goal`, `why_it_matters`, `context_md`, `constraints_md`, `deliverable_md`, `verification_md`, `blocked_behavior_md`, `output_format_md`
- flow: `next_best_action`, `next_check_at`, `blocked_reason`, `due_at`
- timestamps: `created_at`, `updated_at`, `archived_at`

### Why this trimmed shape

- it preserves the design doc's central product insight: a work item is not just a title
- it maps cleanly onto markdown textareas in the existing ARIS frontend style
- it avoids premature multi-user ownership and workspace complexity

---

## Section 6 - Adapted State Model

### Work Item states

- `backlog`
- `ready`
- `in_progress`
- `waiting`
- `review`
- `blocked`
- `parked`
- `done`
- `canceled`

### Run states

The current database stores coarse run status values such as `queued`, `running`, `completed`, and `failed`.

Dispatch should keep storage compatibility while exposing richer semantics in the service/UI layer:

- `draft`
- `queued`
- `in_flight`
- `review_ready`
- `blocked`
- `accepted`
- `rejected`
- `superseded`
- `canceled`

### Mapping strategy

- stored `running` maps to Dispatch `in_flight`
- stored `completed` maps to Dispatch `review_ready` until reviewed
- stored `failed` maps to `blocked` when follow-up action is required

### Why

This avoids rewriting old rows while making Control Tower logic meaningful immediately.

---

## Section 7 - Wake-ups As A Hard Product Rule

### Decision

Wake-ups are first-class and mandatory for active runs.

### Product rule

Any run entering `in_flight` must have at least one unresolved wake-up.

### Why

This is the key behavior that differentiates Dispatch from a normal task list. Without wake-ups, active work still gets dropped.

### Adaptation for this repo

The backend should enforce the rule at the ARIS service layer:

- new run creation from a work item should require a wake-up payload
- legacy run creation paths should either accept a wake-up inline or remain available only as compatibility paths until the new UI is wired

---

## Section 8 - Frontend Information Architecture

### Decision

The `ARIS` tab should become an internal workspace with Dispatch-oriented subviews.

### Default ARIS view

`Control Tower`

### Main views

- `Control Tower`
- `Projects`
- `Work Items`
- `Review Inbox`
- `Runs`
- `Launcher`

### Why

The current launcher-first ARIS page optimizes for starting work, not managing parallel work. Dispatch requires the opposite priority:

- what is overdue
- what needs review
- what is blocked
- what is active by project

### Implementation fit

This should remain inside `frontend/src/components/aris/ArisWorkspace.jsx` at first, but the component should be split into smaller panels and helper modules rather than growing further as one monolith.

---

## Section 9 - Control Tower Behavior

### Decision

Control Tower becomes the ARIS home screen and the primary operating surface.

### Widgets

- `Needs Attention`
  - overdue wake-ups
  - review-ready runs
  - blocked high-priority work items
- `Active Projects`
  - active work-item count
  - in-flight run count
  - review load
- `Review Queue`
- `Upcoming Checks`
- `Stale Runs`

### Sorting heuristic

V1 should use a transparent heuristic score based on:

- overdue wake-up state
- review readiness
- project priority
- waiting age
- blocked/high-priority status

This should stay explicit and simple in the service layer rather than becoming opaque ranking logic.

---

## Section 10 - Backend API Adaptation

### Decision

Keep the ARIS namespace and extend `/api/aris/*`.

### New endpoints

- `GET /api/aris/control-tower`
- `GET /api/aris/projects/:projectId/work-items`
- `POST /api/aris/projects/:projectId/work-items`
- `GET /api/aris/work-items/:workItemId`
- `PATCH /api/aris/work-items/:workItemId`
- `POST /api/aris/work-items/:workItemId/runs`
- `POST /api/aris/runs/:runId/wakeups`
- `GET /api/aris/review-inbox`
- `POST /api/aris/runs/:runId/reviews`
- `GET /api/aris/projects/:projectId/now`

### Why

- consistent with current route organization
- keeps ARIS as the user-visible module boundary
- avoids creating a second API surface that duplicates ARIS concepts

---

## Section 11 - Rollout Strategy

### Phase 1

- add milestone, work-item, wake-up, review, and decision persistence
- attach runs to work items
- add service-level control-tower aggregation

### Phase 2

- add ARIS sub-navigation
- make Control Tower the default view
- add work-item CRUD UI

### Phase 3

- add review inbox and project `Now`
- adapt run detail to show parent work item, wake-ups, and review state

### Phase 4

- improve seed/demo data
- add soft WIP limits and stale-item surfacing
- add notifications/reminders if needed beyond the control-tower surface

### Why this order

The schema and service layer have to exist before the UI can become meaningful, but the UI should arrive before any deep integration or notification expansion.

---

## Final Recommendation

Build Dispatch as the operating model inside ARIS:

- reuse `aris_projects`
- introduce first-class `work items`
- keep `aris_runs` as execution attempts
- require wake-ups for in-flight work
- make `Control Tower` the default ARIS home
- support both human-only and ARIS-backed work from the first usable version

That is the smallest change that still delivers the actual product insight from the design doc: async project management is about dispatching, waking up, reviewing, and deciding across many slow-feedback threads.
