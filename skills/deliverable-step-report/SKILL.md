---
name: deliverable-step-report
description: Generate a deliverable report for each research step using template.md and reference/x_guideline.md, then persist it to .researchops/deliverables and upload to SSH target when the project location is remote.
---

# Deliverable Step Report

This skill defines a deterministic report format for each step/node run.

## Required Structure

- `reference/x_guideline.md`
- `template.md`

## Behavior

1. Render report content from `template.md`.
2. Follow quality gates in `reference/x_guideline.md`.
3. Persist report path: `.researchops/deliverables/<node_id>/<run_id>.md`.
4. If project location is SSH, upload report to remote project path automatically.
5. Attach report as a run artifact (`kind=deliverable_report`).

## Runtime Inputs

- project metadata (id/name/path/location/server)
- node metadata (id/title/kind/assumptions/targets/checks)
- run metadata (run_id/status/base_commit/commands)
- run intent + context pack summary

## Output Contract

- A markdown report generated for every run-step invocation.
- Path recorded in run metadata: `deliverableReportPath`.
- Artifact recorded in run artifacts with optional object storage key.
