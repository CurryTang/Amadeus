# OpenRFM Feasible Proposal v2 (KB + Run-History Grounded)

Date: 2026-03-02  
Project: `openrfm` (`proj_dfe58b98fd8b4eeda61e`)

## 0) Why This Rewrite

This rewrite replaces speculative architecture-heavy content with a plan that is executable on the current codebase and infrastructure.

It explicitly removes paths that were already tried and failed, or that are currently unsupported by code/data/runtime.

## 1) Evidence Used

### 1.1 KB resources (validated via `kb/resource-locate` + `files/content?scope=kb`)

- `resource/paper_assets_index.md`
- `resource/notes.md`
- `resource/research_questions.md`
- `resource/RFMBench/RFMBench.pdf`
- `resource/RelBench_A_Benchmark_for_Deep_Learning_on_Relational_Databas/paper.pdf`
- `resource/RelBench_v2_A_Large_Scale_Benchmark_and_Repository_for_Relat/paper.pdf`
- `resource/RelBench_A_Benchmark_for_Deep_Learning_on_Relational_Databas/code/snap-stanford__relbench/README.md`

Key verified KB facts:
- RelBench v1/v2 resources and code README are available.
- `RFMBench` is currently present as PDF asset, but no verified in-repo executable benchmark harness path was extracted from current KB text pipeline.
- `notes.md` emphasizes: baseline reproducibility first, then architecture exploration.

### 1.2 Run history evidence (latest failures)

Repeated/important failed runs:
- `run_2a786d1ffb3241e3920b`: “Implement Architecture 3 (Pure GatedDeltaNet / Linear RFM) ...”
- `run_ea3e9ad676404034b4c8`: “Probe token count ablation K=2/K=8 ... 12 experiments”
- `run_3011d2d095074ca2afb9`: “RelBench 6-task full sweep ...”
- multiple repeated `resource_kb` compare runs failed intermittently before retry success (indicates tooling fragility, not research signal).

Interpretation:
- The stack is not yet ready for “big-bang” model rewrite + large matrix + full benchmark sweep in one shot.
- Proposal must sequence work into reliable, small, gated milestones.

## 2) Remove / Defer (Non-Reasonable for Current Stage)

The following are removed from baseline scope:

1. Immediate pure GatedDeltaNet full replacement of RT backbone.
2. Immediate 12-cell probe-token ablation expansion (`K=[1,2,4,8]` across all attention families) before stability gates.
3. Immediate full RelBench 6-task sweep with DDP/multi-GPU as first milestone.
4. Claims requiring custom kernel engineering (flash-linear custom kernels) before baseline reproducibility.
5. Architecture-parallel program (DART + KumorFM + pure GDN + hybrid + RT+RelGT) in same phase.

These are not rejected forever; they are Phase-2+ branch items after baseline gates pass.

## 3) Feasible Objective (Now)

Build a reliable, auditable baseline pipeline that can:

1. run end-to-end smoke on current environment,
2. run a small RelBench matrix with valid artifacts,
3. cleanly separate synthetic and real metrics,
4. produce reproducible deliverables for each step.

## 4) Execution Plan (Gated)

## Step 1 — Baseline Capability Audit

Goal:
- Confirm current runnable boundaries from code/scripts, not assumptions.

Inputs:
- `README.md`
- `models/nn/orig_rt_pl.py`
- `scripts/run_openrfm_ddp_smoke.sh`
- `scripts/run_openrfm_ablations.sh`

Checks:
- smoke launcher runs in current env,
- ablation mode tagging (`synthetic` vs `real`) is explicit,
- artifact output paths are deterministic.

Deliverable:
- `deliverables/step1_capability_audit.md`

## Step 2 — Smoke Reproducibility Gate

Goal:
- Obtain two consecutive successful smoke runs with consistent key metrics shape.

Checks:
- exit code == 0,
- metrics artifact exists,
- log artifact exists,
- report manifest exists,
- no SSH/path credential error.

Deliverable:
- `deliverables/step2_smoke_repro_report.md`

## Step 3 — Minimal RelBench Matrix (2–3 tasks)

Goal:
- Start from small, high-signal task set instead of 6-task sweep.

Candidate source:
- existing RelBench configs in repository (`configs/...relbench...yaml`)

Checks:
- each task has valid config + data path,
- train/eval command is executable,
- output summary JSON/CSV generated.

Deliverable:
- `deliverables/step3_relbench_minimal_matrix.md`

## Step 4 — Ablation Under Current Script Reality

Goal:
- Run only currently supported ablations and publish clean mode-separated report.

Checks:
- synthetic metrics never mixed with real benchmark claims,
- each row has command, config fingerprint, artifact pointers.

Deliverable:
- `deliverables/step4_ablation_report.md`

## Step 5 — RFMBench Alignment Note (Evidence Only)

Goal:
- Extract what can be mapped today from `RFMBench/RFMBench.pdf` to current codebase.

Checks:
- explicitly mark “implemented now” vs “not yet implemented”,
- no unsupported claims.

Deliverable:
- `deliverables/step5_rfbench_alignment.md`

## Step 6 — Promotion Gate to Architecture Branches

Promotion conditions:
1. Step 1–5 deliverables complete.
2. At least one minimal RelBench path is stable.
3. Smoke reproducibility gate passes.
4. No unresolved SSH/path/auth blocker.

Only after this, open branches:
- `branch/arch-gdn-explore`
- `branch/probe-k-expansion`
- `branch/rt-relgt-hybrid`

## 5) Structured DSL Draft (for TODO generator / orchestrator)

```yaml
proposal_version: 2
project_id: proj_dfe58b98fd8b4eeda61e
strategy: baseline_first

assumptions:
  - current code path is RT-centric
  - relbench resources are available in KB
  - infrastructure has intermittent SSH/tooling fragility

blocked_or_deferred:
  - pure_gated_deltanet_full_rewrite
  - large_probe_token_grid_12_experiments
  - full_relbench_6_task_sweep_initial_phase
  - custom_linear_attention_kernel_engineering

steps:
  - id: step1_capability_audit
    kind: audit
    target: "confirm executable boundaries"
    checks:
      - file_exists: scripts/run_openrfm_ddp_smoke.sh
      - file_exists: models/nn/orig_rt_pl.py
      - mode_tagging_present: scripts/run_openrfm_ablations.sh
    deliverable: deliverables/step1_capability_audit.md

  - id: step2_smoke_repro
    kind: experiment
    depends_on: [step1_capability_audit]
    target: "2 consecutive successful smoke runs"
    checks:
      - run_exit_zero
      - artifact_exists: report/result_manifest.json
      - artifact_exists: logs/train.log
    deliverable: deliverables/step2_smoke_repro_report.md

  - id: step3_relbench_minimal
    kind: experiment
    depends_on: [step2_smoke_repro]
    target: "2-3 relbench tasks runnable"
    checks:
      - config_resolves
      - metrics_summary_exists
    deliverable: deliverables/step3_relbench_minimal_matrix.md

  - id: step4_ablation_current_mode
    kind: experiment
    depends_on: [step3_relbench_minimal]
    target: "mode-separated ablation report"
    checks:
      - synthetic_real_separated
      - summary_json_exists
    deliverable: deliverables/step4_ablation_report.md

  - id: step5_rfbench_alignment
    kind: analysis
    depends_on: [step4_ablation_current_mode]
    target: "rfmbench claim-to-code mapping"
    checks:
      - implemented_vs_missing_marked
    deliverable: deliverables/step5_rfbench_alignment.md

  - id: step6_branch_promotion
    kind: milestone
    depends_on:
      - step1_capability_audit
      - step2_smoke_repro
      - step3_relbench_minimal
      - step4_ablation_current_mode
      - step5_rfbench_alignment
    target: "approve architecture exploration branches"
    checks:
      - manual_approve
    deliverable: deliverables/step6_branch_promotion_decision.md
```

## 6) Immediate Next Actions

1. Execute Step 1 + Step 2 only.
2. Do not start architecture rewrite before Step 2 passes.
3. Keep all reports path-cited and artifact-linked.
4. For any failed run, record failure signature and retry policy before next run.

## 7) Summary

This version is intentionally conservative and execution-oriented.

It uses current KB and run-history evidence, removes already-proven low-yield paths from baseline scope, and creates a gated path to future architecture innovation with lower bias and higher reproducibility.
