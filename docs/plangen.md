# Auto Experiment Plan Generation Solution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a generalized auto-research planning subsystem that can generate a review-ready experiment document such as `docs/exp.md` with low human intervention, explicit uncertainty marking, managed document workspace support, and a thin task-local runner script interface.

**Architecture:** The system should use a structured planning pipeline instead of a single free-form prompt. A planner stage produces a typed experiment spec from repo context and high-level research intent. A writer stage turns that spec into a managed document such as `docs/exp.md`. The generated document then becomes a workspace artifact and can be executed by a thin wrapper such as `scripts/run_exp_agents.py`, which delegates to the shared runner core.

**Tech Stack:** Python, subprocess-based Codex execution, repo-grounded retrieval, JSON/YAML task specs, markdown templates, artifact registry, validation pipeline, pull-friendly backend contracts

---

## 1. Problem statement

The current experiment planning flow works when a human explicitly writes or edits `docs/exp.md`, but a generalized auto-research system needs to generate that document with much less manual intervention.

The system must:

- inspect the repo and infer likely datasets, tasks, baselines, and execution entrypoints
- generate a structured experiment plan into a managed document such as `docs/exp.md`
- mark uncertain or weakly supported choices clearly for later human review
- preserve the generated document as a workspace artifact
- support a task-local runner wrapper such as `scripts/run_exp_agents.py`

The system must not:

- pretend uncertain scientific decisions are fully confirmed
- depend on free-form markdown alone as the only system of record
- require heavy human intervention before any draft can be produced

## 2. Recommended architecture

Use a three-stage design.

### Stage A: Context retrieval and evidence assembly

This stage inspects the repository and assembles structured evidence for planning.

Inputs:

- user objective
- repo state
- local docs
- configs
- task metadata
- known benchmark notes

Outputs:

- candidate datasets
- candidate target tasks
- candidate model families
- known exclusions
- available runner entrypoints
- evidence quality labels

This stage should explicitly label findings as:

- `confirmed`
- `inferred`
- `needs_review`

### Stage B: Typed experiment spec generation

This stage converts evidence into a structured experiment spec.

The experiment spec should define:

- research goal
- phase breakdown
- fixed protocol
- comparison axes
- dataset/task choices
- metrics
- logging requirements
- uncertainty annotations
- desired workspace assets

This stage should not write markdown directly. It should produce structured data first.

### Stage C: Document workspace generation

This stage takes the experiment spec and renders a managed document such as `docs/exp.md`.

The generated document should:

- be readable by humans
- be executable by the agent runner
- contain conclusion placeholders
- contain uncertainty marks
- retain stable anchors or markers if later automation needs them

## 3. Why this architecture

Asking one agent to "look around and write `docs/exp.md`" is too fragile. It mixes retrieval, scientific planning, uncertainty handling, and document authoring into one step.

The recommended split is:

1. retrieve and ground
2. generate structured plan
3. render workspace document

This gives a coding agent concrete boundaries to implement and test.

## 4. Core system components

### 4.1 Planning input contract

Define a minimal planning request schema. Suggested fields:

```json
{
  "plan_id": "exp_icl_architecture_001",
  "goal": "Find which ICL architecture works best after rel-hm pretraining.",
  "constraints": {
    "backbone_scope_step1": ["orig_rt"],
    "exclude": ["TabPFN in Step 1"]
  },
  "dataset_policy": {
    "mode": "repo_discovery_with_review_marks"
  },
  "output": {
    "workspace_document": "docs/exp.md",
    "runner_wrapper": "scripts/run_exp_agents.py"
  }
}
```

This schema should be explicit enough that the planner is not forced to infer everything from one sentence.

### 4.2 Evidence model

The retrieval stage should emit evidence records like:

```json
{
  "type": "dataset_choice",
  "value": "rel-hm",
  "confidence": "confirmed",
  "source": "AGENTS.md",
  "notes": "Explicitly mentioned as pretraining dataset in prior planning."
}
```

Suggested evidence fields:

- `type`
- `value`
- `confidence`
- `source`
- `notes`

### 4.3 Experiment spec schema

This is the central machine-readable plan.

Suggested top-level fields:

- `title`
- `goal`
- `fixed_protocol`
- `phases`
- `datasets`
- `tasks`
- `metrics`
- `constraints`
- `uncertainties`
- `workspace_assets`

Suggested phase shape:

```json
{
  "phase_id": "step1",
  "title": "Find an ICL strategy that works",
  "question": "Which ICL architecture is viable after rel-hm pretraining?",
  "variants": [
    {"id": "S1-A", "label": "Backbone + ICL head, joint"},
    {"id": "S1-B", "label": "Backbone + ICL head, sequential"},
    {"id": "S1-C", "label": "DART-like"}
  ],
  "logs": ["run_table", "notes", "conclusion"]
}
```

### 4.4 Document template renderer

The writer stage should use templates rather than improvising full markdown structure every time.

Required capabilities:

- render fixed protocol section
- render phased experiment sections
- render log tables
- render conclusion placeholders
- insert uncertainty markers inline
- optionally inject stable markers for automation

The template should support both:

- human-readable mode
- runner-compatible mode with markers

### 4.5 Managed workspace asset support

The planning system must treat the generated experiment document as a managed workspace asset, not just a file written once.

The task spec should be able to declare:

- `docs/exp.md` as a workspace document
- `scripts/run_exp_agents.py` as a generated or task-local wrapper

The generated document should also be published as a `workspace_document` and `markdown` artifact.

### 4.6 Thin runner wrapper integration

The planning subsystem should interoperate with thin task-local wrappers such as `scripts/run_exp_agents.py`.

The wrapper should:

- load the generated experiment spec or rendered document
- initialize the task workspace
- invoke the shared step runner
- preserve a local CLI that is convenient for users

The wrapper must stay thin. It should not own scientific planning logic.

## 5. Prompt design for autonomous `exp.md` generation

### 5.1 Prompt strategy

Do not use a single giant prompt. Use at least two generated prompts:

1. `planner prompt`
2. `writer prompt`

The planner prompt creates a typed experiment spec.
The writer prompt renders `docs/exp.md` from that spec.

### 5.2 Planner prompt requirements

The planner prompt must explicitly instruct the agent to:

- inspect repo docs, configs, scripts, and metadata first
- infer defaults from repo evidence
- distinguish `confirmed`, `inferred`, and `needs_review`
- choose a concrete default when evidence is decent
- mark high-impact uncertainty clearly

Suggested planner prompt skeleton:

```text
Read the local repository context relevant to datasets, tasks, model families, prior experiment docs, and runnable entrypoints.

Produce a structured experiment spec for a review-ready experiment plan.

Rules:
- Use repo evidence whenever possible.
- Mark each key assumption as confirmed, inferred, or needs_review.
- Prefer concrete defaults over vague prose.
- Do not write markdown yet.
- Output a machine-readable experiment spec.
```

### 5.3 Writer prompt requirements

The writer prompt must explicitly instruct the agent to:

- read the typed experiment spec
- render `docs/exp.md`
- preserve required sections
- insert uncertainty annotations
- avoid inventing unsupported details

Suggested writer prompt skeleton:

```text
Render docs/exp.md from the provided experiment spec.

Requirements:
- Write a review-ready experiment runbook.
- Preserve fixed protocol, phased plan, run logs, and conclusion blocks.
- Inline uncertainty markers where the spec says needs_review.
- Keep the document readable by humans and usable by the agent runner.
```

## 6. Uncertainty handling policy

This is the key requirement for low-intervention planning.

The system should support three confidence levels:

- `confirmed`
- `inferred`
- `needs_review`

Suggested rendering rules:

- `confirmed`: write normally
- `inferred`: optionally tag with `[inferred]`
- `needs_review`: always tag inline with `[NEEDS_REVIEW]`

Example:

```md
- Pretraining dataset: `rel-hm`
- Transfer task: `driver-dnf`
- Metric for `driver-position`: AUC [NEEDS_REVIEW]
```

The coding agent should implement uncertainty as data in the spec, not as ad hoc string tricks during markdown rendering.

## 7. File and module layout

Recommended implementation layout:

- `autoplan/`
- `autoplan/context/`
- `autoplan/specs/`
- `autoplan/renderers/`
- `autoplan/validators/`
- `autoplan/templates/`
- `scripts/generate_exp_plan.py`
- `scripts/run_exp_agents.py`

Suggested module responsibilities:

- `autoplan/context/repo_scan.py`
  gather repo evidence
- `autoplan/context/evidence.py`
  define evidence records and confidence labels
- `autoplan/specs/experiment_plan.py`
  define experiment spec schema
- `autoplan/renderers/exp_md.py`
  render `docs/exp.md`
- `autoplan/validators/plan_quality.py`
  validate completeness of the spec before rendering
- `scripts/generate_exp_plan.py`
  CLI entrypoint for plan generation

## 8. CLI design

Recommended command shape:

```bash
python scripts/generate_exp_plan.py \
  --goal "find which ICL architecture can work" \
  --output-doc docs/exp.md \
  --runner-wrapper scripts/run_exp_agents.py
```

Optional flags:

- `--config <yaml/json>`
- `--template exp_runbook`
- `--allow-repo-discovery`
- `--emit-spec outputs/plans/exp_spec.json`
- `--strict-review-marks`
- `--dry-run`

The output of this command should be:

- a structured experiment spec
- a rendered `docs/exp.md`
- optional metadata for later execution

## 9. Validation requirements

The coding agent should implement validators before trusting generated plans.

### 9.1 Spec validator

Checks:

- required top-level fields present
- every phase has variants or a clear execution rule
- every downstream task has a metric
- uncertainty markers exist for unresolved critical fields

### 9.2 Document validator

Checks:

- required sections exist
- log tables exist
- conclusion blocks exist
- uncertainty tags were rendered when required
- output path is correct

### 9.3 Reviewability validator

Checks:

- too many critical fields are not left blank
- unsupported certainty is not claimed
- the document is usable as a human review draft

## 10. Implementation phases

### Phase 1: Structured experiment spec

Build:

- planning input schema
- evidence schema
- experiment spec schema

Exit condition:

- a coding agent can generate a valid experiment spec from a structured request

### Phase 2: Repo-grounded retrieval

Build:

- repo scanning for docs, tasks, configs, scripts, metadata
- evidence confidence labeling

Exit condition:

- the planner can populate dataset/task/model choices from repo context with confidence marks

### Phase 3: `docs/exp.md` renderer

Build:

- experiment runbook template
- uncertainty-aware markdown renderer
- document validator

Exit condition:

- the system can generate a review-ready `docs/exp.md`

### Phase 4: Workspace asset integration

Build:

- managed document registration
- wrapper-script linkage
- artifact publication for the generated document

Exit condition:

- `docs/exp.md` is treated as a workspace asset and can be used by the runner

### Phase 5: Runner integration

Build:

- connect the generated plan into `scripts/run_exp_agents.py` or a generalized wrapper
- preserve task-local CLI usability

Exit condition:

- a user can generate `docs/exp.md` and then immediately run the corresponding wrapper

## 11. Minimal first vertical slice

The first implementation should not attempt universal planning.

Start with one vertical slice:

- input goal: ICL architecture selection
- repo discovery: current docs/configs/AGENTS notes
- generated output: `docs/exp.md`
- execution wrapper: `scripts/run_exp_agents.py`

This proves:

- retrieval
- spec generation
- uncertainty marking
- markdown rendering
- workspace asset support
- runner compatibility

## 12. Success criteria

This solution is successful when:

- the system can generate `docs/exp.md` without heavy manual editing
- uncertain decisions are clearly marked for review
- the generated plan is specific enough for a coding or execution agent to use
- the document remains human-readable
- the system still preserves structured state behind the document
- the same architecture can later support other planning documents beyond `docs/exp.md`

## 13. Recommended next implementation step

The first build target should be:

1. implement the experiment spec schema
2. implement repo evidence extraction with confidence labels
3. implement a renderer for `docs/exp.md`
4. validate the generated document against a required-section checklist

Only after that should the system be coupled more tightly to the generalized runner platform.
