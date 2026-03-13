# LLM Judge Loop Design

## Goal

Add a real post-step LLM judge loop to the research tree so executed node outputs can be judged, refined, retried in auto mode, or escalated to human review in manual mode.

## Context

The existing ResearchOps tree already supports:

- node execution through `run-step` and `run-all`
- manual approval gates via `manual_approve`
- run artifacts, checkpoints, review summaries, and control-surface UI

What is missing is a first-class judge loop that evaluates a node after execution, persists judge state on the node, and either:

- passes the node
- requests revision and auto-reruns in auto mode
- requests human review in manual mode

## Requirements

- Judge runs after a node run has produced a run record and deliverable/report artifacts.
- Judge verdicts are `pass`, `revise`, and `fail`.
- Auto mode retries up to 5 judge-driven revision rounds per node.
- Manual mode never auto-retries; it stops for human review on `revise` or `fail`.
- Judge feedback must be visible in the tree/dashboard review surfaces.
- Retry must reuse stored judge feedback as refinement input for the next run payload.

## Recommended Approach

Extend the existing tree execution path rather than introducing a separate workflow engine or a new top-level refinement subsystem.

Why this fits:

- tree state is already persisted as JSON and can absorb judge state without schema churn
- run artifacts and run metadata already carry deliverable previews and review signals
- frontend review surfaces already summarize node review state and need extension, not replacement

## Backend Flow

### 1. Step run

`POST /researchops/projects/:projectId/tree/nodes/:nodeId/run-step` continues to enqueue the node run.

The run request is extended with:

- `judgeMode: "auto" | "manual"`
- `judgeMaxIterations`, default `5`
- optional `judgeRefinementPrompt` carried forward from a prior judge pass

### 2. Judge pass

After the run report and deliverable artifacts exist, the backend invokes an LLM judge service.

Judge inputs:

- node id, title, kind, acceptance criteria, checks, commands
- run summary / report data
- contract status
- checkpoint status
- deliverable artifact preview and summary artifact preview
- prior judge history for the node

Judge output:

```json
{
  "verdict": "pass",
  "summary": "Short decision summary",
  "issues": ["Specific issue"],
  "refinementPrompt": "Concrete retry guidance for the next run",
  "confidence": 0.81
}
```

### 3. Loop behavior

Auto mode:

- `pass`: mark judge passed and leave node completed
- `revise`: if iteration < max, enqueue another node run using the returned `refinementPrompt`
- `revise` at max retries: mark `needs_review`
- `fail`: mark `needs_review`

Manual mode:

- `pass`: mark judge passed and leave node completed
- `revise`: mark `needs_review`
- `fail`: mark `needs_review`

Human remains the final gate in all cases.

## State Model

Each node gains a persisted `judge` object inside tree state:

```json
{
  "status": "idle|running|passed|revise|failed|needs_review",
  "mode": "auto|manual",
  "iteration": 0,
  "maxIterations": 5,
  "lastRunId": "run_x",
  "summary": "",
  "issues": [],
  "refinementPrompt": "",
  "history": []
}
```

History entries store:

- timestamp
- run id
- verdict
- summary
- issues
- refinement prompt
- mode
- iteration

## API Changes

Extend existing tree node flows instead of adding a parallel subsystem:

- extend `run-step` and `bridge-run` request bodies with judge options
- add `POST /projects/:projectId/tree/nodes/:nodeId/judge`
- add `POST /projects/:projectId/tree/nodes/:nodeId/judge/approve`
- add `POST /projects/:projectId/tree/nodes/:nodeId/judge/retry`

The first implementation may internally judge as part of `run-step` completion, while the explicit judge route allows manual re-evaluation from the UI.

## Run Artifacts

Store judge outputs as normal run artifacts:

- `judge_report` markdown artifact
- optional JSON metadata on the artifact for structured verdict data

When the judge stops for human review, emit or mirror checkpoint-like review signals so existing review summaries can surface them.

## Frontend Changes

Reuse the existing node review/control surface.

Show:

- judge status
- judge mode
- judge iteration progress (`2 / 5`)
- verdict summary
- issue count
- whether the node is auto-refining or awaiting human review

Primary actions:

- `Awaiting judge` while judge is running
- `Review judge` when manual action is needed
- `Retry with judge feedback` when a stopped node has a stored refinement prompt

## Failure Handling

- If judge execution fails technically, persist a judge error state and fall back to `needs_review` rather than silently passing.
- If judge JSON is malformed, treat it as a technical failure, capture raw output in the artifact, and require review.
- Auto retries must stop at 5 rounds even if the judge keeps returning `revise`.

## Verification

Minimum verification:

- auto mode: first run judged `revise`, second run judged `pass`
- manual mode: run judged `revise`, node stops in review state
- auto mode: five `revise` verdicts escalate to `needs_review`
- frontend review summary renders judge status and iteration information
