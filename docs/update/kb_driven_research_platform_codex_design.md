# KB-Driven Research DAG Platform with Codex CLI
## Implementation-ready design for a client frontend, host backend, and remote SSH execution server

## 0. Purpose

This document turns the current idea into an implementation-ready architecture.

It combines four source threads into one concrete system:

1. the retrieval design and PageIndex-style local navigation idea
2. the sketch in which **academic superpowers + KB -> refinement -> step -> document environment -> deliverable**, with human review and a tree-like dashboard above the execution line
3. the generalized runner blueprint and roadmap
4. the current experiment runbook (`docs/exp.md`) and the current Codex runner (`run_exp_agents.py`)

The result is a design that can be implemented directly with **Codex CLI** as the only LLM backbone, while keeping the system robust, inspectable, and frontend-agnostic.

---

## 1. What we are locking in

### 1.1 Core architectural decision

We will use a **three-plane architecture**:

- **Client plane**: the frontend on the user device
- **Control plane**: the backend service on the host device
- **Execution plane**: a remote SSH server where the KB, the code repositories, the document environment, Codex CLI, and the experiments live

This is the cleanest fit for the sketch:

- the **top half** is the planning, refinement, review, and dashboard loop
- the **bottom half** is the actual agent loop operating inside a managed document environment

### 1.2 Backbone decision

We use **Codex CLI as the only backbone** for:

- intent parsing
- DAG / step proposal generation
- plan refinement
- node-level implementation planning
- recovery reasoning
- optional judge pass

We do **not** introduce a second always-on LLM service for retrieval, reranking, or validation.

### 1.3 Retrieval decision

The KB lives on the remote execution server and is queried locally there.

V1 retrieval is:

- asset resolution via `kb_manifest.yaml`
- BM25 / FTS search
- metadata filtering
- PaperTree / RepoGraph expansion
- project working set cache
- optional Codex-assisted rerank only on a tiny candidate set when necessary

Dense retrieval is optional V2.

### 1.4 Runner decision

The current `run_exp_agents.py` already has the right skeleton and should be generalized, not replaced:

- one fresh Codex subprocess per step attempt
- sequential dependency-driven execution
- hard timeout and idle timeout
- validation after each attempt
- recovery agent on validation failure
- thin task-local wrapper scripts
- managed workspace document(s)

The document stops being the only source of truth, but it remains a first-class workspace artifact.

---

## 2. Source-driven constraints we must preserve

From the general runner blueprint, the platform should define success as **validated completion**, not just subprocess exit, keep execution decoupled from rendering through typed artifacts, spawn one fresh agent per step attempt, preserve immutable attempt history, and expose a pull-friendly API for any frontend. It should also support managed documents such as `docs/exp.md` and thin runner wrappers such as `scripts/run_exp_agents.py`. From the roadmap, the platform should evolve in phases from task specs to artifact registration, layered validation, recovery, persistent storage, and a pull API. From the runbook, the agent must respect TODO ids and section markers in a managed document. From the existing runner, the current system already has step specs, sequential dependency resolution, document-targeted validation, timeouts, recovery, and state persistence. These are not accidents; they are the stable spine of the system. [Sources: blueprint, roadmap, runbook, runner]

---

## 3. System topology

## 3.1 Machines and responsibilities

### A. Client device

Runs the frontend only.

Responsibilities:

- chat-style intent input
- tree-like research dashboard
- step and run inspection
- document viewer
- artifact viewer
- human review / approval / edit actions
- polling the backend API

The client never talks directly to the remote SSH server.

### B. Host backend server

This is the **control plane**.

Responsibilities:

- authentication and project ownership
- project/task metadata store
- plan refinement orchestration
- DAG lifecycle and human review state
- SSH dispatch to the remote execution server
- snapshot assembly and pull API
- artifact metadata registry
- remote state sync / mirroring
- audit log and policy enforcement

The host backend does not need the full KB locally.

### C. Remote SSH execution server

This is the **execution plane**.

Responsibilities:

- local clone / worktree of research codebases
- local KB indices
- `kbctl` retrieval tools
- Codex CLI installation and authentication
- managed document environment
- task workspaces
- step execution and recovery
- experiment job launch and monitoring
- local logs and artifacts

This server should be treated as the place where agents actually work.

---

## 3.2 Why the KB must live on the remote server

The KB should be colocated with the code and experiments because:

- paper-to-code linking needs direct access to repo paths, config files, and generated outputs
- Codex works best when it can read and edit local files in the selected directory
- copying papers, repos, configs, run outputs, and indices back and forth between host and worker is pointless pain
- the retrieval cache and working set should stay next to the document environment that the agent is operating on

So the host backend becomes the controller and mirror, not the main knowledge workbench.

---

## 4. High-level end-to-end flow

1. The user submits a research intent from the frontend.
2. The host backend creates a `Project` and a `PlanDraft`.
3. The host backend asks the remote server to run a **planning Codex call** in a read-only planning workspace.
4. The remote server uses `kbctl` to resolve assets and returns a structured DAG proposal plus a planning summary.
5. The host backend validates the proposal and optionally runs a second judge pass.
6. The frontend shows the proposal in the tree-like research dashboard.
7. The human accepts, edits, or requests refinement.
8. Once approved, the backend materializes a `TaskRun` and provisions a task workspace on the remote server.
9. The remote runner executes one step at a time with one fresh Codex subprocess per attempt.
10. Each step updates the document environment, emits typed artifacts, and passes layered validation.
11. If validation fails, a recovery attempt is launched for the same step.
12. The backend polls or pulls the remote state and serves normalized snapshots to the frontend.
13. The dashboard shows current state, history, blockers, outputs, and document evolution.

---

## 5. Top-level concepts

## 5.1 Project

A long-lived research container.

Suggested fields:

- `project_id`
- `title`
- `goal`
- `created_by`
- `kb_root_remote`
- `repo_root_remote`
- `default_worker_id`
- `status`
- `created_at`
- `updated_at`

## 5.2 PlanDraft

A reviewable proposal produced during refinement before execution starts.

Suggested fields:

- `plan_draft_id`
- `project_id`
- `title`
- `goal`
- `dag_json`
- `planning_markdown_artifact_id`
- `judge_status`
- `kb_coverage_summary`
- `human_status`
- `created_at`
- `updated_at`

## 5.3 TaskRun

A concrete executable research plan derived from an approved draft.

Suggested fields:

- `task_run_id`
- `project_id`
- `plan_draft_id`
- `title`
- `goal`
- `status`
- `summary`
- `remote_workspace_root`
- `remote_worker_id`
- `task_spec_version`
- `created_at`
- `updated_at`
- `current_step_id`

## 5.4 StepRun

A single executable node.

Suggested fields:

- `step_id`
- `task_run_id`
- `title`
- `step_type`
- `status`
- `depends_on`
- `attempt_count`
- `current_attempt_id`
- `validator_status`
- `validator_reason`
- `review_required`
- `kb_refs`
- `doc_targets`
- `started_at`
- `finished_at`

## 5.5 AgentAttempt

One Codex subprocess for one step.

Suggested fields:

- `attempt_id`
- `task_run_id`
- `step_id`
- `attempt_index`
- `mode` (`normal` or `recovery`)
- `codex_session_id` (if available from exec JSON)
- `prompt_version`
- `sandbox_mode`
- `started_at`
- `finished_at`
- `exit_code`
- `idle_timeout_hit`
- `hard_timeout_hit`
- `stdout_log_path`
- `completion_json_path`

## 5.6 Artifact

A normalized output.

Required types:

- `workspace_document`
- `metric`
- `table`
- `chart_spec`
- `markdown`
- `image`
- `file`
- `log`
- `json`
- `job_request`
- `job_result`

## 5.7 ValidationRecord

A machine-readable record explaining why a step passed, failed, or was blocked.

## 5.8 ReviewDecision

A human or optional judge decision on a plan or step.

---

## 6. Remote filesystem layout

The remote server should use a deterministic layout.

```text
/srv/research-platform/
  projects/
    <project_id>/
      repo/                       # git clone or worktree
      kb/
        kb_manifest.yaml
        .kb_index/
      task_runs/
        <task_run_id>/
          spec.json
          state/
            task_run.json
            steps.json
            attempts.jsonl
            validations.jsonl
            artifacts.jsonl
            snapshot.json
          workspace/
            docs/
              exp.md
              plan.md
              notes/
            scripts/
              run_task_agents.py
              launch_job.sh
            prompts/
            outputs/
            artifacts/
            logs/
            tmp/
```

Important rule:

- The **workspace** is where Codex operates.
- The **state** directory is the runner’s system of record on the remote side.
- The document files live in the workspace and are also published as `workspace_document` artifacts.

---

## 7. The managed document environment

The sketch’s lower half is the most important idea: a step should not just be “some shell command.” It should run inside a **document environment**.

A Document Environment is a managed workspace containing:

- one or more editable documents such as `docs/exp.md`
- code repositories and configs
- a stable anchor map that says which step may edit which document blocks
- local task scripts
- generated artifacts and logs
- step-local context files

### 7.1 Document targets

Each step declares exactly which document regions it is allowed to update.

V1 anchor format should stay compatible with the current runbook:

- TODO markers, for example `<!-- todo:s1_a_driver_dnf -->`
- step markers, for example `<!-- step:s1_a_driver_dnf -->`
- optional extra anchors, for example `<!-- anchor:step-summary -->`

### 7.2 Why keep the document environment

The blueprint is correct that markdown cannot be the sole system of record. But the current runbook is also correct that a managed document is a superb working surface for scientific agents.

So the rule is:

- documents are **editable working surfaces**
- validation, status, attempts, artifacts, and blockers live in structured records
- the frontend renders both the structured state and the current document view

### 7.3 Document artifact contract

Every managed document should be published as a `workspace_document` artifact with:

- canonical workspace path
- content path
- mime type
- version hash
- anchor metadata
- provenance: which step and attempt last modified it

---

## 8. KB and retrieval subsystem on the remote server

## 8.1 Design principle

The KB is not a vector bucket. It is a **local navigable research environment**.

The agent does not ask for “top 10 chunks.” It asks for:

- which paper or repo is relevant
- which section or appendix is relevant
- which code path, config, or symbol matches that section
- what evidence pack should be handed back to the planner or step executor

## 8.2 Representations

### A. Asset Cards

Coarse-grained cards for papers and repos.

Paper card fields:

- `paper_id`
- `title`
- `aliases`
- `summary`
- `methods`
- `datasets`
- `key_sections`
- `related_repos`

Repo card fields:

- `repo_id`
- `path`
- `readme_summary`
- `entrypoints`
- `main_configs`
- `related_papers`

### B. PaperTree

A local tree index over each paper.

Node types:

- `section`
- `paragraph_group`
- `figure`
- `table`
- `caption`
- `equation`
- `appendix_section`
- `page_anchor`
- `cross_ref`

### C. RepoGraph

A local graph over each repository.

Entity types:

- `file`
- `symbol`
- `config`

Edge types:

- `imports`
- `calls`
- `uses_config`
- `writes_metric`
- `tests`

### D. Relation Map

High-value explicit edges:

- `paper -> repo`
- `paper section -> script`
- `paper section -> config`
- `experiment -> dataset`
- `experiment -> metric`
- `method alias -> canonical method`
- `paper A -> compares / extends / cites -> paper B`

## 8.3 Canonical manifest

`kb_manifest.yaml` is the canonical relation layer.

It should contain at least:

- paper ids and aliases
- repo ids and paths
- paper-to-repo mappings
- key sections
- entrypoints
- metrics and datasets where known
- related papers

## 8.4 V1 indexing

V1 should use:

- SQLite / FTS5 or Tantivy-style BM25 index
- JSONL node stores
- lightweight metadata DB
- project-level working set cache

No mandatory embedding index.

## 8.5 `kbctl` CLI

The KB interface is a local CLI so Codex can use it through shell commands.

Required commands:

```bash
kbctl search-docs --query "PluRel training setup" --scope project --json
kbctl search-sections --doc plurel --query "training setup" --json
kbctl read-node --doc plurel --node sec_4_2 --neighbors 1 --json
kbctl follow-ref --doc plurel --ref "Appendix B" --json
kbctl search-symbols --repo plurel_repo --query "trainer" --json
kbctl read-symbol --repo plurel_repo --symbol main --path train.py --json
kbctl expand-deps --repo plurel_repo --symbol Trainer --hops 1 --json
kbctl map-paper-code --paper plurel --node sec_4_2 --json
kbctl build-pack --project proj_123 --query "PluRel training setup" --context planning --json
```

### Evidence Pack

Canonical output of `kbctl build-pack`:

```json
{
  "query": "PluRel training setup",
  "context": "planning",
  "resolved_assets": ["plurel", "plurel_repo"],
  "evidence": [
    {
      "kind": "paper_node",
      "doc_id": "plurel",
      "node_id": "sec_4_2",
      "title": "4.2 Training Setup",
      "page_span": [8, 9],
      "score": 0.94
    },
    {
      "kind": "config",
      "repo_id": "plurel_repo",
      "path": "configs/train.yaml",
      "score": 0.90
    }
  ],
  "coverage": {
    "paper": true,
    "code": true,
    "config": true
  },
  "gaps": ["seed setting not confirmed"],
  "next_actions": ["follow Appendix B", "inspect Trainer defaults"]
}
```

## 8.6 Retrieval cache

The retrieval cache lives on the remote server and is scoped per project.

Required layers:

- alias / canonical cache
- query-to-evidence-pack cache
- retrieval-state cache
- project working set

Suggested remote path:

```text
.kb_index/cache/<project_id>/
  alias_cache.json
  query_cache.jsonl
  state_cache.jsonl
  working_set.json
```

---

## 9. Refinement loop and DAG generation

The sketch shows a refinement node above the execution line. That should become a first-class backend mechanism.

## 9.1 Refinement service responsibilities

The refinement service should:

- turn a user goal into a structured research plan
- detect known vs unknown KB entities
- propose a DAG / tree of steps
- attach KB evidence and coverage to every proposed node
- insert decision nodes where multiple legal options exist
- insert placeholder nodes where the KB is missing or intent is ambiguous
- allow human review and iterative refinement

## 9.2 Planning pass execution

The host backend should launch a **planning attempt** on the remote server using Codex in read-only mode.

Inputs:

- project goal
- project context
- KB root
- existing plan draft, if any
- planning output schema

Outputs:

- `dag.json`
- `plan_summary.md`
- optional `judge_report.md`

## 9.3 Planning output schema

Each proposed node should contain:

- `step_id`
- `title`
- `step_type`
- `depends_on`
- `requires_review`
- `doc_targets`
- `kb_refs`
- `coverage`
- `expected_artifacts`
- `acceptance_tests`
- `notes`

## 9.4 Human review and optional judge pass

The backend may optionally run a second Codex planning pass as a judge, but the human remains the final gate.

Judge pass responsibilities:

- check acyclicity
- check missing KB coverage
- check obviously illegal dependency ordering
- point out unclear decision nodes

The frontend should show:

- DAG / research tree
- coverage colors
- judge comments
- unresolved gaps

---

## 10. Step taxonomy

V1 should use these step types:

- `plan_refinement`
- `freeze_protocol`
- `code_edit`
- `config_prepare`
- `job_prepare`
- `job_launch`
- `job_monitor`
- `result_collect`
- `write_conclusion`
- `analysis`
- `decision`
- `placeholder`

This is important because a long-running experiment is not the same as a short document edit.

---

## 11. Codex CLI usage model

Codex CLI should be used in **non-interactive exec mode** for backend automation. Official Codex docs describe `codex exec` as the mode for scripted or CI-style runs, and document support for machine-readable JSON events, output files for the final message, JSON output schemas, AGENTS.md, skills, and MCP. The docs also warn that `--yolo` bypasses approvals and sandboxing and should only be used in an externally hardened environment. [Official Codex docs]

### 11.1 Default invocation pattern

For planning:

```bash
codex exec \
  --cd /srv/research-platform/projects/<project_id>/repo \
  --sandbox read-only \
  --ask-for-approval never \
  --json \
  --output-last-message /tmp/plan_result.json \
  --output-schema schemas/plan_output.schema.json \
  - < prompts/plan_prompt.txt
```

For step execution:

```bash
codex exec \
  --cd /srv/research-platform/projects/<project_id>/task_runs/<task_run_id>/workspace \
  --sandbox workspace-write \
  --ask-for-approval never \
  --json \
  --output-last-message state/completion.json \
  --output-schema schemas/step_result.schema.json \
  - < prompts/step_prompt.txt
```

### 11.2 When to use `--yolo`

Only when the remote execution environment is already isolated enough that bypassing approvals and sandboxing is acceptable.

Default recommendation:

- use `--sandbox workspace-write`
- use `--ask-for-approval never`
- do **not** use `--yolo` by default

### 11.3 AGENTS.md

Every remote workspace should include a project-local `AGENTS.md` to force discipline.

Minimum content:

- always use `kbctl build-pack` before answering from memory
- only modify declared doc targets
- emit valid completion JSON
- do not start later steps
- write blockers explicitly
- prefer mapped paper/code/config evidence

### 11.4 Skills

At minimum, define:

- `kb-research`
- `document-target-update`
- `job-launcher`
- `result-summarizer`
- `recovery-debugger`

Skills are especially useful because the same CLI can be used across planning, execution, and recovery without building a second orchestration brain.

### 11.5 MCP

MCP is optional in V1.

V1 should keep `kbctl` as a plain CLI.

V2 can expose:

- a local stdio MCP server for KB access
- a remote HTTP MCP server for selected tools if needed

---

## 12. The generalized task spec

The roadmap is right: tasks must be defined by structured manifests, not inferred from markdown.

## 12.1 Task spec

```json
{
  "task_run_id": "tr_123",
  "title": "ICL architecture study",
  "goal": "Find an ICL architecture that transfers after rel-hm pretraining",
  "workspace_assets": [
    {
      "type": "managed_document",
      "path": "docs/exp.md",
      "template": "templates/icl_runbook.md"
    },
    {
      "type": "generated_script",
      "path": "scripts/run_task_agents.py",
      "template": "templates/run_task_agents.py.j2"
    }
  ],
  "steps": [...],
  "recovery_policy": {
    "default_max_attempts": 3
  }
}
```

## 12.2 Step spec

```json
{
  "step_id": "s1_a_driver_dnf",
  "title": "Run S1-A transfer on driver-dnf",
  "step_type": "job_prepare",
  "depends_on": ["s1_freeze_protocol"],
  "todo_id": "todo:s1_a_driver_dnf",
  "doc_targets": [
    {"document_id": "exp", "markers": ["todo:s1_a_driver_dnf", "step:s1_a_driver_dnf"]}
  ],
  "kb_refs": ["plurel", "orig_rt"],
  "expected_artifacts": ["workspace_document", "job_request", "markdown"],
  "validators": ["process", "completion_envelope", "document_targets"],
  "max_recovery_attempts": 2
}
```

---

## 13. Completion contract

The current `STEP_RESULT` trailer should be replaced as the canonical path by a JSON completion envelope validated with `--output-schema`. Keep the trailer only as backward-compatible fallback.

## 13.1 Step result schema

```json
{
  "step_id": "s1_a_driver_dnf",
  "outcome": "succeeded",
  "summary": "Prepared config, launched transfer run, and updated exp.md.",
  "artifacts": [
    {"type": "workspace_document", "path": "docs/exp.md"},
    {"type": "job_request", "path": "artifacts/job_request.json"},
    {"type": "markdown", "path": "artifacts/step_summary.md"}
  ],
  "evidence": [
    "Updated TODO marker todo:s1_a_driver_dnf",
    "Wrote step marker step:s1_a_driver_dnf",
    "Created job_request.json"
  ],
  "blockers": []
}
```

## 13.2 Why this matters

This avoids trusting free-form prose and gives the validator a stable machine-readable contract.

---

## 14. Long-running experiment job model

This is the biggest improvement needed over the current runner.

A training run that lasts hours should not depend on the Codex subprocess staying alive and continuously printing output.

### 14.1 Split job steps from monitoring steps

For long experiments:

1. **job_prepare**
   - Codex updates configs/docs and writes `job_request.json`
2. **job_launch**
   - the runner launches the actual experiment from `job_request.json`
3. **job_monitor**
   - the runner monitors the remote process, scheduler job, or tmux session
4. **result_collect**
   - Codex summarizes outputs and updates the document

This prevents a fragile all-in-one step from becoming a spaghetti monster.

### 14.2 `job_request.json`

```json
{
  "command": ["python", "train.py", "--config", "configs/s1_a_driver_dnf.yaml"],
  "cwd": "/srv/research-platform/projects/proj_123/repo",
  "env": {
    "CUDA_VISIBLE_DEVICES": "0"
  },
  "expected_outputs": [
    "outputs/s1_a_driver_dnf/metrics.json",
    "outputs/s1_a_driver_dnf/checkpoint.pt"
  ],
  "timeout_secs": 28800,
  "heartbeat_regex": "epoch|step|loss|val"
}
```

### 14.3 Launchers

V1 launcher backends:

- direct subprocess
- `nohup`
- `tmux`
- optional Slurm backend if available

The runner should normalize them into the same `job_result` artifact format.

---

## 15. Validation pipeline

Use four required layers plus two research-specific layers.

### 15.1 Process validation

Checks:

- exit code
- hard timeout
- idle timeout
- truncated log detection

### 15.2 Structural validation

Checks:

- completion envelope exists
- completion envelope parses
- required top-level fields exist

### 15.3 Document-target validation

Checks:

- only allowed TODO / step markers changed where required
- required TODO line is checked
- required step marker line changed
- placeholders such as `TBD` / `TODO` are gone where the step promises completion
- the wrong document target was not updated instead

This generalizes the current `validate_step_completion()` logic.

### 15.4 Artifact validation

Checks:

- required artifact types exist
- files are non-empty
- JSON artifacts are valid
- metric values are numeric
- chart specs are parseable
- workspace document artifact has valid anchors

### 15.5 Job validation

For launched experiments:

- job actually started
- job exited successfully or produced a typed blocker
- expected outputs exist
- metrics file contains required metric names

### 15.6 Semantic validation

Checks:

- the step’s acceptance tests are satisfied
- the document summary matches produced outputs
- the step did not claim success while only writing narrative text

### 15.7 Reason codes

Use and extend the blueprint reason codes:

- `process_exit_nonzero`
- `hard_timeout`
- `idle_timeout`
- `missing_completion_envelope`
- `artifact_schema_invalid`
- `missing_required_artifact`
- `document_target_unchanged`
- `placeholder_still_present`
- `wrong_output_target`
- `job_not_started`
- `job_failed`
- `semantic_completion_failed`
- `dependency_failed`
- `human_decision_required`

---

## 16. Recovery model

Recovery must remain step-scoped and fresh-process based.

If validation fails:

1. mark the step `needs_recovery`
2. persist validator reasons
3. launch a fresh Codex subprocess for the same step
4. provide:
   - previous completion JSON
   - validator failure reasons
   - missing artifacts
   - relevant log excerpts
   - current document diff

The recovery attempt must either:

- repair the step and emit a new valid completion envelope
- or emit a typed blocker

Blocker types:

- `missing_input`
- `tool_failure`
- `validation_failure`
- `dependency_failure`
- `human_decision_required`
- `kb_gap`

---

## 17. Generalizing the current `run_exp_agents.py`

The existing file should be treated as the seed implementation, not thrown away.

## 17.1 Keep

Keep these ideas almost unchanged:

- `StepSpec`
- `ValidationResult`
- `state.json` / durable state
- dependency-aware `next_runnable_step()`
- one subprocess per step attempt
- hard timeout and idle timeout
- structured validation after each attempt
- automatic recovery mode with bounded attempts

## 17.2 Replace

### Replace single fixed document paths

Current:

- `EXP_DOC = REPO_ROOT / "docs" / "exp.md"`

New:

- `document_targets` loaded from task spec
- each step can target one or more documents

### Replace hardcoded step list

Current:

- `build_default_steps()` is hardcoded for one experiment family

New:

- load steps from `spec.json`
- thin wrapper scripts may still generate those specs for convenience

### Replace trailer parsing as the only structured output

Current:

- looks for `STEP_RESULT` in stdout

New:

- canonical completion JSON via `--output-schema` + `--output-last-message`
- optional trailer fallback only for compatibility

### Replace `--yolo`

Current:

- `codex exec --yolo ...`

New:

- `codex exec --sandbox workspace-write --ask-for-approval never ...`
- reserve `--yolo` for disposable isolated workers only

### Replace one-step-does-everything experiment mode

Current:

- a run step may implicitly both edit and execute

New:

- separate `job_prepare`, `job_launch`, `job_monitor`, `result_collect`

## 17.3 Add

Add these modules:

- `runner_core/spec_loader.py`
- `runner_core/document_targets.py`
- `runner_core/validators.py`
- `runner_core/artifacts.py`
- `runner_core/job_launcher.py`
- `runner_core/snapshot.py`
- `kb/index_builder.py`
- `kb/kbctl.py`
- `scripts/run_task_agents.py`

---

## 18. Host backend responsibilities in detail

## 18.1 Task orchestration service

Responsibilities:

- create projects and plan drafts
- submit planning attempts to remote workers
- approve or reject drafts
- materialize task runs
- dispatch resume / cancel / review actions

## 18.2 SSH transport service

Responsibilities:

- SSH command execution
- SCP / rsync for workspace asset provisioning
- state pull and artifact pull
- heartbeat and connectivity checks

The remote server should not need to expose an inbound HTTP API in V1.

## 18.3 Snapshot assembler

Responsibilities:

- read remote `snapshot.json`, `steps.json`, `artifacts.jsonl`
- normalize them into frontend-friendly payloads
- cache compact task snapshots for polling

## 18.4 Persistent store

Host backend should persist:

- project metadata
- plan drafts
- task snapshots
- review decisions
- remote worker registry
- artifact metadata mirror

Recommended V1:

- PostgreSQL or SQLite on host backend
- file mirror for artifact content and remote snapshots

---

## 19. Remote snapshot and sync model

V1 should use **host pull over SSH**, not remote push.

### 19.1 Remote outputs to write after every state change

The remote runner should always write:

- `state/task_run.json`
- `state/steps.json`
- `state/attempts.jsonl`
- `state/validations.jsonl`
- `state/artifacts.jsonl`
- `state/snapshot.json`

### 19.2 Host polling loop

Every few seconds, or on demand:

1. SSH / rsync the state files
2. update the host DB mirror
3. expose the latest task snapshot to the frontend

### 19.3 Artifact content fetching

Two modes:

- eager mirror for small JSON, markdown, and chart specs
- lazy fetch for large logs, images, checkpoints

This keeps polling cheap.

---

## 20. Frontend contract

The frontend should render from normalized task state, not raw Codex transcripts.

## 20.1 Main views

### A. Tree-like research dashboard

This should be the main project view.

Hierarchy:

- Project
  - Plan draft(s)
  - Task run(s)
    - Step group / phase
      - Step
        - Attempt(s)
        - Artifacts
        - Document targets
        - Blockers / review decisions

This tree view is more faithful to research work than a flat job list.

### B. Step detail panel

Show:

- step metadata
- dependencies
- coverage
- KB references
- validation status and reasons
- current document excerpt
- attempt history
- artifacts
- logs

### C. Document viewer

Render `workspace_document` artifacts and highlight anchors.

### D. Artifact viewer

Render by artifact type:

- `metric` -> KPI card
- `table` -> grid
- `chart_spec` -> chart renderer
- `markdown` -> report pane
- `image` -> media viewer
- `log` -> collapsible console
- `json` -> advanced viewer

## 20.2 Required endpoints

At minimum, expose:

- `POST /projects`
- `GET /projects/{id}`
- `POST /projects/{id}/plan-drafts`
- `GET /plan-drafts/{id}`
- `POST /plan-drafts/{id}/approve`
- `POST /plan-drafts/{id}/refine`
- `POST /task-runs`
- `GET /task-runs/{id}`
- `GET /task-runs/{id}/steps`
- `GET /task-runs/{id}/steps/{step_id}`
- `GET /task-runs/{id}/artifacts`
- `GET /task-runs/{id}/artifacts/{artifact_id}`
- `GET /task-runs/{id}/artifacts/{artifact_id}/content`
- `GET /task-runs/{id}/workspace/documents/{document_id}`
- `POST /task-runs/{id}/resume`
- `POST /task-runs/{id}/cancel`
- `POST /task-runs/{id}/steps/{step_id}/review`

---

## 21. Minimal vertical slice

Do not boil the ocean first.

Build one full path that proves the model.

### Slice scope

- one project
- one planning pass
- one approved task run with 3 to 5 steps
- one managed `docs/exp.md`
- one generated `scripts/run_task_agents.py`
- one `kbctl` implementation over a tiny KB
- one long-running job step with separate launch and monitor
- one recovery scenario
- one frontend polling page

### Mandatory outcomes

- the frontend never reads raw transcripts directly
- the backend never infers success from prose only
- the remote runner never marks a step complete without validation
- the document updates are visible in the frontend
- recovery history is preserved

---

## 22. Immediate implementation plan

## Phase 0 — freeze the seed

- copy the current runner into `legacy/run_exp_agents.py`
- write a short migration note identifying reusable pieces
- preserve current runbook marker conventions

## Phase 1 — generic task runner core

Implement:

- task spec loader
- step spec loader
- status model
- remote state writer
- generalized document target model
- Codex exec wrapper using JSON output schema

Deliverable:

- `runner_core/`

## Phase 2 — document environment and artifacts

Implement:

- workspace provisioning
- document artifact publication
- artifact registry
- validation records

Deliverable:

- `workspace/`, `artifacts/`, `validators/`

## Phase 3 — KB subsystem

Implement:

- `kb_manifest.yaml`
- asset cards
- PaperTree
- RepoGraph
- `kbctl`
- working set cache

Deliverable:

- `kb/`

## Phase 4 — planning and refinement

Implement:

- planning prompt templates
- plan output schema
- judge prompt template
- plan draft storage
- frontend DAG/tree rendering

## Phase 5 — host backend and SSH control plane

Implement:

- project/task DB models
- SSH dispatch
- snapshot puller
- pull API

## Phase 6 — long-running job execution

Implement:

- `job_request` artifact
- launcher backends
- monitor logic
- job result artifacts

## Phase 7 — hardening

Implement:

- resume
- cancel
- worker health checks
- artifact integrity checks
- prompt version lineage
- audit logs

---

## 23. Concrete repository layout

```text
repo-root/
  backend/
    app/
      api/
      models/
      services/
        orchestrator.py
        ssh_transport.py
        snapshot_sync.py
        plan_service.py
      db/
  remote_runner/
    runner_core/
      spec_loader.py
      codex_exec.py
      state_store.py
      validators.py
      document_targets.py
      artifacts.py
      job_launcher.py
      recovery.py
      snapshot.py
    kb/
      index_builder.py
      manifest.py
      asset_cards.py
      paper_tree.py
      repo_graph.py
      cache.py
      kbctl.py
    schemas/
      plan_output.schema.json
      step_result.schema.json
      artifact.schema.json
    templates/
      exp.md.j2
      run_task_agents.py.j2
      AGENTS.md.j2
    skills/
      kb-research/
        SKILL.md
      document-target-update/
        SKILL.md
      recovery-debugger/
        SKILL.md
    scripts/
      run_task_agents.py
      sync_snapshot.py
  frontend/
    src/
      pages/
      components/
      api/
      viewers/
```

---

## 24. Exact Codex prompt responsibilities

## 24.1 Planning prompt

Must instruct Codex to:

- resolve entities against the KB first
- label KB-known vs KB-unknown items
- propose a DAG/tree as JSON matching schema
- include coverage and acceptance tests
- avoid starting execution

## 24.2 Step prompt

Must instruct Codex to:

- read the document environment first
- call `kbctl build-pack`
- only edit declared targets
- produce required artifacts
- emit valid JSON completion output
- write blockers explicitly instead of bluffing

## 24.3 Recovery prompt

Must instruct Codex to:

- read validator failures and previous logs
- inspect missing or invalid artifacts
- repair only the current step
- avoid touching later steps
- either succeed or emit a typed blocker

---

## 25. What success looks like

The design is successful when all of these are true:

- the user can submit a research idea from the client and see a reviewable tree-like plan
- the backend can dispatch planning and step execution to a remote SSH worker
- the remote worker can use local KB navigation and local code access with Codex CLI
- every step runs in a managed document environment
- every step emits structured completion data and typed artifacts
- validation, not prose, determines success
- long experiments are launched and monitored as jobs, not fragile monolithic Codex sessions
- recovery attempts are fresh, bounded, and auditable
- the frontend can render status, documents, metrics, tables, charts, and blockers from the backend API alone

---

## 26. Final recommendation

Do not build this as “a nicer `run_exp_agents.py` plus a web UI.”

Build it as:

- a **control plane** on the host backend
- a **research execution plane** on the remote SSH server
- a **tree-like review and monitoring UI** on the client
- a **document environment + typed artifact** execution model
- a **local KB navigation layer** next to the repos and experiments
- a **Codex-only backbone** that plans, executes, judges, and recovers

That gives you the shape implied by all the sources without introducing unnecessary extra brains, extra APIs, or extra fragility.

