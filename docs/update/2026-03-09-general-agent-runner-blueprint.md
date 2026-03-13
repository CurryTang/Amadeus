# General Agent Runner Blueprint

## Goal

Define a frontend-agnostic agent runner platform that can robustly finish multi-step tasks, validate true completion, recover from incomplete agent outputs, and deliver normalized artifacts such as visualizations, numerics, and markdown to any frontend through a pull model.

## Scope

This blueprint generalizes the current experiment-oriented Codex runner into a reusable task execution platform. It is not tied to one UI, one task family, or one document format. The frontend is assumed to exist already and will consume normalized task snapshots and artifact endpoints from the backend.

## Design principles

- Treat success as validated goal completion, not subprocess exit success.
- Keep task execution and frontend rendering decoupled through typed artifacts.
- Spawn one fresh agent per step attempt.
- Preserve full attempt history for auditability and recovery.
- Make the API pull-friendly so any frontend can poll for current state.
- Use markdown as one output type, not as the only system of record.
- Support task workspace assets such as managed documents and generated local runner wrappers.

## System layers

### 1. Task Spec Layer

Each task run starts from a structured spec that defines:

- goal
- step graph
- dependencies
- expected outputs
- validator rules
- recovery policy
- workspace assets to provision
- optional frontend presentation hints

The step graph should be explicit. The runner must not infer control flow from free-form documents.

### Workspace assets

The task spec should be able to provision a task-specific working environment, not just execution metadata.

Workspace assets should include:

- managed documents such as `docs/exp.md`
- generated runner wrapper scripts such as `scripts/run_exp_agents.py`
- optional templates, anchor maps, and starter artifacts

This preserves the usability of the current experiment workflow while moving orchestration logic into a generic core.

### 2. Runner Core

The runner core is responsible for:

- resolving runnable steps
- spawning one fresh Codex subprocess per step
- tracking attempts, logs, timings, and status
- handling timeout and idle timeout
- launching recovery attempts for incomplete steps
- supporting thin task-specific wrapper scripts that delegate into the shared core

The runner should remain deterministic and sequential by default. Parallel execution can be added later only when output isolation and dependency handling are strong enough.

### Runner wrapper scripts

The generalized framework should support task-local entrypoints such as `scripts/run_exp_agents.py`.

These wrapper scripts should:

- load a task spec or template
- initialize workspace assets
- invoke the shared runner core
- expose task-local CLI defaults that are convenient for humans and automation

The wrapper script should stay thin. Scheduling, validation, recovery, storage, and artifact publication belong in the shared platform layer.

### 3. Validation and Artifact Layer

This layer turns agent outputs into trustworthy state:

- parse structured step completion envelopes
- validate process health
- validate required artifacts
- validate semantic task completion
- register normalized artifacts for downstream consumption

This layer is the main defense against the common failure case where an agent returns but does not actually finish the step.

### 4. Task Store

Persistent state should include:

- task runs
- step runs
- agent attempts
- validator records
- artifact metadata
- summaries and conclusions

The system should preserve immutable attempt history rather than overwriting old results during retries or recovery.

### 5. Pull API Layer

The backend exposes stable read APIs for:

- task status snapshots
- step details
- artifact listings
- artifact content
- markdown summaries
- recent validation failures and blockers

The frontend should render from this API and should not inspect raw Codex transcripts.

## Core data model

### TaskRun

Represents one user-visible job.

Suggested fields:

- `task_run_id`
- `title`
- `goal`
- `status`
- `summary`
- `created_at`
- `updated_at`
- `current_step_id`
- `progress`
- `task_spec_version`

### StepRun

Represents one executable unit in the task.

Suggested fields:

- `step_id`
- `title`
- `step_type`
- `status`
- `depends_on`
- `attempt_count`
- `current_attempt_id`
- `validator_status`
- `validator_reason`
- `started_at`
- `finished_at`

### AgentAttempt

Represents one subprocess execution for one step.

Suggested fields:

- `attempt_id`
- `step_id`
- `attempt_index`
- `mode` (`normal` or `recovery`)
- `prompt_version`
- `started_at`
- `finished_at`
- `exit_code`
- `stdout_log_path`
- `stderr_log_path`
- `idle_timeout_hit`
- `hard_timeout_hit`

### Artifact

Represents one normalized output from a step.

Suggested fields:

- `artifact_id`
- `step_id`
- `attempt_id`
- `type`
- `name`
- `path`
- `size_bytes`
- `mime_type`
- `checksum`
- `created_at`
- `metadata`

### ValidationRecord

Represents the reason a step is accepted, rejected, blocked, or sent to recovery.

Suggested fields:

- `validation_id`
- `step_id`
- `attempt_id`
- `status`
- `reason_code`
- `summary`
- `details`
- `created_at`

## Status model

Recommended task and step statuses:

- `pending`
- `running`
- `validating`
- `succeeded`
- `needs_recovery`
- `blocked`
- `failed_final`
- `cancelled`

Recommended validator reason codes:

- `process_exit_nonzero`
- `hard_timeout`
- `idle_timeout`
- `missing_completion_envelope`
- `missing_required_artifact`
- `artifact_empty`
- `artifact_schema_invalid`
- `semantic_completion_failed`
- `wrong_output_target`
- `dependency_failed`
- `human_decision_required`

## Step execution lifecycle

Each step should follow this lifecycle:

1. Prepare
   Load the task spec, resolve dependencies, create the step working context, and define required outputs.
2. Spawn
   Start a fresh Codex subprocess for exactly one step.
3. Collect
   Capture logs, completion envelope, changed files, and generated artifacts.
4. Validate
   Run layered validators.
5. Publish
   Register artifacts and update the task snapshot if validation passes.
6. Recover
   If validation fails, spawn a fresh recovery agent for the same step.

The runner must not advance to the next step until the current step is validated as complete or is explicitly blocked.

## Completion contract

Each agent attempt should end with a structured completion envelope. The exact transport can evolve, but the contract should contain:

- `step_id`
- `outcome`
- `summary`
- `artifacts`
- `evidence`
- `blockers`

Example:

```json
{
  "step_id": "train_baseline",
  "outcome": "succeeded",
  "summary": "Baseline run completed and summary artifacts were published.",
  "artifacts": [
    {"type": "metric", "name": "val_auc", "value": 0.812},
    {"type": "chart_spec", "name": "loss_curve", "path": "artifacts/task123/loss_curve.json"},
    {"type": "markdown", "name": "step_summary", "path": "artifacts/task123/summary.md"}
  ],
  "evidence": [
    "metrics.json written",
    "summary.md written"
  ],
  "blockers": []
}
```

The runner should not trust free-form prose alone. A step without a valid completion envelope is incomplete.

## Artifact model

The platform should standardize these artifact types:

- `workspace_document`
- `metric`
- `table`
- `chart_spec`
- `markdown`
- `image`
- `file`
- `log`
- `json`

### Metric artifacts

Use for scalar outputs such as accuracy, AUC, runtime, memory, and counts.

Suggested metadata:

- metric name
- numeric value
- unit
- split
- comparator baseline

### Table artifacts

Use for structured result sets and comparisons.

Suggested representation:

- schema in metadata
- row payload in JSON or CSV

### Chart artifacts

Use declarative chart specs instead of backend-rendered HTML. The recommended default is Vega-Lite JSON because it is frontend-agnostic and easy to validate.

### Workspace document artifacts

Use `workspace_document` for managed working files such as `docs/exp.md`.

These artifacts should capture:

- the canonical workspace path
- a frontend-readable rendering path if different
- section anchors or marker metadata when applicable
- version and provenance information

The key rule is:

- documents may be editable working surfaces for agents
- but task state and validation outcomes still live in structured records

### Markdown artifacts

Use for summaries, conclusions, reports, and analyst-friendly narratives.

Markdown should be first-class, but not the only source of system state.

## Validation architecture

Validation should operate in layers.

### 1. Process validation

Checks:

- exit code
- hard timeout
- idle timeout
- truncated log detection

### 2. Structural validation

Checks:

- completion envelope exists
- envelope is parseable
- required top-level fields are present

### 3. Artifact validation

Checks:

- required artifacts exist
- files are non-empty
- JSON is valid when required
- image or chart files are readable
- table schemas match expected columns
- metric values are numeric

### 4. Semantic validation

Checks:

- step-specific goals are actually completed
- expected sections in markdown are filled
- expected managed document sections are updated when the step targets a workspace document
- expected metric names are present
- the step did not update the wrong target

This layer addresses the hardest class of failures: an agent that returns with plausible text but no useful output.

## Recovery strategy

Blind retries are not enough. The platform should use explicit recovery agents.

If a step fails validation:

- mark the step as `needs_recovery`
- record validator reasons
- spawn a new agent for the same step
- pass in the previous logs, missing artifacts, and failure reasons

The recovery agent must either:

- repair the missing output and complete the step
- or emit a typed blocker

Recovery should be bounded by a per-step maximum attempt policy. If recovery cannot resolve the problem, the step should become `blocked` or `failed_final`.

## Pull API blueprint

The frontend will poll stable endpoints. The API should expose normalized state rather than raw agent text.

Recommended endpoints:

- `POST /task-runs`
- `GET /task-runs`
- `GET /task-runs/{id}`
- `GET /task-runs/{id}/steps`
- `GET /task-runs/{id}/steps/{step_id}`
- `GET /task-runs/{id}/artifacts`
- `GET /task-runs/{id}/artifacts/{artifact_id}`
- `GET /task-runs/{id}/artifacts/{artifact_id}/content`
- `GET /task-runs/{id}/summary.md`
- `GET /task-runs/{id}/workspace`
- `GET /task-runs/{id}/workspace/documents/{document_id}`
- `POST /task-runs/{id}/resume`
- `POST /task-runs/{id}/cancel`

### Task snapshot contract

The main snapshot endpoint should be polling-friendly and compact.

Example:

```json
{
  "task_run_id": "tr_123",
  "title": "ICL architecture study",
  "status": "running",
  "progress": {
    "completed_steps": 6,
    "total_steps": 18,
    "percent": 33.3
  },
  "current_step": {
    "step_id": "s1_c_driver_dnf",
    "title": "Run S1-C transfer on driver-dnf",
    "status": "running",
    "attempt": 1
  },
  "summary": "Step 1 experiments in progress.",
  "artifacts": {
    "metric": 12,
    "table": 3,
    "chart_spec": 2,
    "markdown": 4,
    "log": 7
  },
  "updated_at": "2026-03-09T20:00:00Z"
}
```

## Frontend rendering contract

To stay adaptable to any frontend, rendering should be driven by artifact type rather than task-specific backend logic.

- `metric` -> KPI cards or badges
- `table` -> table/grid components
- `chart_spec` -> chart renderer
- `markdown` -> report or narrative panels
- `image` -> media viewer
- `log` -> debug console or collapsible transcript
- `json` -> custom advanced widgets

The frontend should never need to know what Codex prompt produced the output.

If a frontend wants to render a live task document such as `docs/exp.md`, it should do so through the normalized workspace-document contract rather than by directly reading repository files.

## Robustness requirements

The platform should be built with the following guarantees:

- one fresh agent per step attempt
- immutable attempt history
- artifact checksums and metadata
- typed blockers
- resumable tasks
- explicit cancellation support
- prompt/version lineage for auditability
- reproducible provisioning of managed documents and generated wrapper scripts

## Non-goals

- no requirement for live push streaming
- no dependence on a single markdown file as the system of record
- no need for a heavyweight workflow engine at the first stage
- no frontend coupling to Codex logs or prompt text

## Recommended rollout

### Phase 1

Generalize the current experiment runner into a reusable task and step abstraction with structured completion envelopes and workspace asset provisioning.

### Phase 2

Add a persistent artifact registry and typed validators, including support for managed workspace documents.

### Phase 3

Add the pull API for task snapshots, step details, and artifacts.

### Phase 4

Integrate the existing frontend using the pull API and artifact rendering model.

### Phase 5

Harden the system with resumability, cancellation, artifact integrity, and richer recovery policies.

## Summary

The central design choice is to move from document-driven success detection to artifact- and validation-driven success detection while still supporting generated task workspaces such as `docs/exp.md` and thin wrapper scripts such as `scripts/run_exp_agents.py`. That change is what makes the runner robust enough for generalized use and portable across different frontends.
