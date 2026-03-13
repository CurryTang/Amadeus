# General Agent Runner Roadmap

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the current experiment-oriented Codex runner into a reusable backend platform that executes structured tasks, validates completion, stores artifacts, provisions task workspace assets such as `docs/exp.md`, generates thin local runner wrappers such as `scripts/run_exp_agents.py`, and serves pull-based frontend snapshots.

**Architecture:** Keep the current subprocess-per-step execution model, but replace document-specific assumptions with structured task specs, typed step outputs, artifact registration, managed workspace assets, generated task wrapper scripts, and a frontend-agnostic pull API. Build the platform in phases so the runner stays usable while the backend contract expands.

**Tech Stack:** Python, subprocess, JSON manifests, file-backed artifact store, validation pipeline, REST-style pull API, frontend-agnostic chart/table/markdown contracts

---

## Phase 0: Freeze the current runner as the seed

### Objective

Identify what from the current experiment runner is worth preserving and what is intentionally temporary.

### Deliverables

- inventory of reusable runner pieces
- list of experiment-specific assumptions to remove
- baseline docs for current state and known limitations

### Keep

- one fresh Codex subprocess per step
- sequential dependency-driven execution
- timeout and idle-timeout handling
- structured completion trailer concept
- recovery-agent pattern for incomplete outputs
- task-local usability through a script like `scripts/run_exp_agents.py`
- task-local document workspace patterns like `docs/exp.md`

### Remove or generalize

- `docs/exp.md` as the primary system of record
- hardcoded experiment step inventory
- markdown-marker-specific validation as the main success criterion
- experiment-only output semantics

### Preserve as first-class workspace assets

- generated managed documents such as `docs/exp.md`
- generated wrapper scripts such as `scripts/run_exp_agents.py`

### Exit criteria

- the team agrees on which current behaviors become stable platform guarantees

## Phase 1: Introduce generic task and step specs

### Objective

Replace the experiment-specific step list with a reusable task manifest model.

### Deliverables

- task spec schema
- step spec schema
- dependency model
- recovery policy schema
- typed completion envelope schema
- workspace asset schema
- wrapper script generation model

### Requirements

- tasks are defined by structured manifests, not inferred from markdown
- steps declare expected artifact types and validators
- step prompts are generated from manifest fields plus runtime context
- a task can declare managed documents to generate, such as `docs/exp.md`
- a task can declare a generated local entrypoint script, such as `scripts/run_<task>.py`

### Risks

- overdesigning the schema before enough real tasks exist
- allowing the spec to become too flexible and hard to validate

### Exit criteria

- the runner can execute at least two different task families from the same spec model
- at least one task family can materialize both a managed document and a thin wrapper script

## Phase 2: Add typed artifact registration

### Objective

Make artifacts first-class outputs so the frontend can consume normalized data instead of agent transcripts.

### Deliverables

- artifact registry
- artifact metadata schema
- file layout for artifact storage
- artifact checksum and size tracking
- document workspace artifact model

### Required artifact types

- `workspace_document`
- `metric`
- `table`
- `chart_spec`
- `markdown`
- `image`
- `file`
- `log`
- `json`

### Requirements

- each artifact has stable metadata and provenance
- artifacts are linked to both step and attempt
- chart outputs are represented as declarative specs rather than HTML blobs
- managed documents are published both as workspace files and frontend-consumable artifacts

### Risks

- mixing raw files and normalized metadata inconsistently
- allowing artifacts without enough metadata for frontend rendering

### Exit criteria

- a completed step can publish at least one markdown artifact, one metric artifact, and one table or chart artifact
- a task can publish a managed document artifact representing a workspace file such as `docs/exp.md`

## Phase 3: Build the layered validation pipeline

### Objective

Enforce real completion instead of superficial completion.

### Deliverables

- process validators
- completion-envelope validators
- artifact validators
- semantic validators
- validation record persistence
- managed document validators

### Validator layers

1. process validation
2. structural validation
3. artifact validation
4. semantic validation

### Requirements

- validator failures are machine-readable
- failure reasons can drive recovery-agent prompts
- steps cannot be marked complete until all required layers pass
- document-targeted steps can validate section-level changes in managed files

### Risks

- validators that are too weak and allow false success
- validators that are too brittle and block useful progress

### Exit criteria

- the system reliably distinguishes success, incomplete success, and blocked failure on representative tasks

## Phase 4: Formalize recovery and blocker handling

### Objective

Turn retries into informed recovery attempts.

### Deliverables

- recovery-attempt state model
- blocker taxonomy
- recovery prompt builder
- max-attempt and escalation policy
- recovery support for document-targeted steps and generated wrapper scripts

### Requirements

- recovery agents read prior logs and validator failures
- blockers are typed and visible to the frontend
- recovery attempts preserve full history

### Suggested blocker types

- `missing_input`
- `tool_failure`
- `validation_failure`
- `dependency_failure`
- `human_decision_required`

### Risks

- repeated blind retries with no new context
- loss of diagnostic history across attempts

### Exit criteria

- failed steps produce either a repaired completion or a typed blocker with evidence

## Phase 5: Add persistent task storage

### Objective

Persist task, step, attempt, validation, and artifact state so polling clients can read consistent snapshots.

### Deliverables

- task store schema
- persistence implementation
- snapshot assembly logic
- migration path from file-only state
- workspace asset metadata persistence

### Requirements

- immutable attempt history
- stable IDs for tasks, steps, attempts, and artifacts
- efficient snapshot retrieval for the frontend

### Risks

- letting storage shape the API instead of the product needs
- storing too little context to support recovery or auditing

### Exit criteria

- backend state survives process restarts and supports resume

## Phase 6: Expose the pull API

### Objective

Provide frontend-agnostic polling endpoints for task state and artifacts.

### Deliverables

- task-run creation endpoint
- task snapshot endpoint
- step detail endpoint
- artifact listing endpoint
- artifact content endpoint
- markdown summary endpoint
- workspace document endpoints
- resume and cancel endpoints

### Requirements

- the frontend can render status and outputs without reading logs
- payloads are compact enough for polling
- artifact content retrieval works for both small JSON payloads and large files
- the frontend can retrieve a normalized document view for managed workspace files

### Risks

- leaking backend implementation details through the API
- making the polling snapshot too heavy

### Exit criteria

- an external frontend can poll task status and render metrics, markdown, and charts from the API alone

## Phase 7: Add frontend presentation hints

### Objective

Make the backend easier to consume without coupling it to a specific UI framework.

### Deliverables

- optional artifact display metadata
- grouping and ordering hints
- summary and highlight fields

### Examples

- preferred chart title
- suggested metric card label
- table display order
- markdown section kind such as `summary`, `report`, or `conclusion`
- preferred document tab name for managed workspace files

### Requirements

- hints stay optional
- artifact meaning still comes from type and metadata, not UI-only fields

### Exit criteria

- different frontends can render the same task snapshot with only presentation-level customization

## Phase 8: Hardening and operations

### Objective

Make the platform production-tolerant.

### Deliverables

- resumable tasks
- cancellation support
- improved timeout policies
- artifact integrity verification
- prompt versioning
- audit logs
- deterministic workspace asset provisioning
- reproducible wrapper-script generation

### Requirements

- safe resume after restart
- visible distinction between blocked, cancelled, and failed-final states
- audit trail for prompts, outputs, and validations

### Risks

- ambiguous state after restart
- stale artifacts shown as current outputs

### Exit criteria

- operators can debug, resume, or cancel tasks without inspecting internal source code

## Suggested first vertical slice

Build one end-to-end path that proves the platform model before broadening scope.

### Slice

- one generic task spec
- one generated managed document such as `docs/exp.md`
- one generated wrapper script such as `scripts/run_exp_agents.py`
- one task with 3 to 5 steps
- one markdown artifact
- one metric artifact
- one table or chart artifact
- one recovery scenario
- one frontend polling client using the API

### Why

This forces all key abstractions to work together:

- step execution
- validation
- artifact registration
- workspace provisioning
- wrapper generation
- pull snapshot generation
- frontend consumption

## Success criteria for the platform

The generalized runner is successful when:

- tasks no longer depend on a single markdown document for core state
- tasks can still generate and maintain managed documents such as `docs/exp.md`
- tasks can still expose thin local runner scripts such as `scripts/run_exp_agents.py`
- agents can fail semantically without fooling the system into marking steps complete
- outputs are consumable by the frontend as typed artifacts
- recovery attempts are informed and auditable
- the same backend can support multiple task families without redesign

## Summary

The recommended path is incremental. Start from the current working runner, preserve the parts that already enforce discipline, then add generic task specs, artifact registration, validation, storage, and the pull API in that order. This keeps the system useful while it grows into a frontend-agnostic platform.
