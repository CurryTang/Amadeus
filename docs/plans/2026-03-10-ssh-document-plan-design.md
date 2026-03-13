# SSH Document Plan Design

## Goal

Add a new SSH-backed document planning flow that lets the frontend request experiment/runbook generation, delegates plan creation to an agent running on the SSH host, stores the generated document and structured plan as backend artifacts, materializes the generated work into the existing tree dashboard, and keeps later step execution synchronized back into tree state through backend-owned run events.

## Constraints

- This is a new flow, not a replacement for the existing generic tree plan generator.
- The SSH-side agent should generate the plan directly; the first implementation should not depend on a dedicated repo script such as `scripts/generate_exp_plan.py`.
- Tree state should reflect step progress from backend-owned structured run events, not by re-parsing `docs/exp.md` after the fact.
- The solution should reuse the existing `researchops` queue, run store, artifacts, SSH transport, and tree state machinery.
- Generated plan documents are primarily for the SSH-side agent runtime, but must still be reviewable in the tree dashboard.

## Recommended Approach

Build a dedicated document-plan flow on top of the existing `researchops` backend and runner stack.

1. Frontend submits a document-plan generation request for an SSH-backed project.
2. Backend creates a planning run using the current SSH-aware run execution path.
3. The remote agent inspects repo context, writes `docs/exp.md`, emits a structured trailer/spec, and exits.
4. Backend parses the structured result, stores artifacts, converts the generated steps into tree nodes, writes the project tree plan/state, and returns the updated tree payload.
5. Later tree-node executions reuse the current `executeTreeNodeRun(...)` path, but their prompts are scoped to one document step/TODO and emit structured progress events that the backend maps into run events and tree node state updates.

This keeps one source of truth for run lifecycle, artifacts, queueing, and tree review.

## Alternatives Considered

### 1. Standalone planner/executor service

Pros:

- strong isolation from existing tree/run code

Cons:

- duplicates queueing, run tracking, SSH execution, artifact storage, and state mapping
- creates avoidable drift between document execution and tree execution

Rejected because the repo already has the primitives needed to support this flow.

### 2. SSH-observed session as source of truth

Pros:

- minimal backend work at first

Cons:

- backend loses authoritative step lifecycle control
- tree review and status mapping become derived and fragile

Rejected because the user explicitly wants tree reflection driven by the first-class backend path.

## Architecture

### Backend route layer

Add a dedicated route family for document planning under `researchops`, either as new endpoints in `backend/src/routes/researchops/projects.js` or a new mounted route file.

Suggested endpoints:

- `POST /api/researchops/projects/:projectId/document-plan/generate`
- `POST /api/researchops/projects/:projectId/document-plan/nodes/:nodeId/run`
- `GET /api/researchops/projects/:projectId/document-plan`

Responsibilities:

- validate project and SSH context
- enqueue or execute the planning run
- return normalized payloads containing planning artifacts and updated tree state
- expose document-plan metadata for frontend refresh/review

### Backend service layer

Add a focused service such as `backend/src/services/researchops/document-plan.service.js`.

Responsibilities:

- build planner prompts for the SSH-side agent
- parse structured planner output and normalize it into a typed document-plan result
- validate required sections and fields before tree materialization
- convert generated document steps into tree nodes/edges compatible with current tree state
- publish artifact metadata for the generated document and spec

Add a small companion parser such as `backend/src/services/researchops/document-plan-events.service.js`.

Responsibilities:

- parse structured step progress lines from agent stdout
- translate them into backend run events
- extract stable node/document-step identifiers used for tree updates

### Runner integration

Reuse the current `researchOpsRunner`, `agent-run.module.js`, SSH transport helpers, and `executeTreeNodeRun(...)`.

Needed changes:

- allow document-plan runs to carry planner metadata and parsing rules
- parse structured progress/result markers from agent stdout
- publish normalized run events such as `LOG_LINE`, `STEP_PROGRESS`, `STEP_RESULT`, and artifact creation notifications
- map terminal results back into existing run status transitions

### Tree integration

The generated document plan should be materialized into the existing project tree model, not a parallel one.

Needed behavior:

- convert the generated plan into normal tree nodes and edges
- write those nodes through the existing plan/state services
- patch node state from backend run events during execution
- make generated artifacts visible from current run detail / dashboard surfaces

## Data Flow

### Plan generation flow

1. Frontend sends `projectId` plus planning instruction.
2. Backend validates the project, ensures it is SSH-backed, and builds a planner prompt from repo context and project metadata.
3. Backend creates a planning run and executes it through the existing SSH-aware agent runner.
4. The remote agent inspects the repo, writes `docs/exp.md`, and emits a structured trailer containing the typed plan/spec summary.
5. Backend parses and validates that trailer.
6. Backend stores artifacts for:
   - generated `docs/exp.md`
   - generated structured spec payload
   - optional summary/report artifact
7. Backend converts the generated steps into tree nodes and writes updated plan/state.
8. Backend returns planning result plus tree payload for frontend rendering.

### Step execution flow

1. User runs a generated node from tree view.
2. Backend routes execution through `executeTreeNodeRun(...)`.
3. The run prompt is constrained to the selected document step/TODO and its allowed markers.
4. The SSH-side agent emits structured progress lines while it works.
5. Backend parses those lines into run events and patches tree node state incrementally.
6. On completion, backend maps the result to terminal node state and persists artifacts/logs for review.

## Data Contracts

### Planner request

The frontend request should include:

- `projectId`
- `instruction`
- optional planning mode flags
- optional output path override, defaulting to `docs/exp.md`

### Planner response

The backend response should include:

- planning run summary
- generated document-plan metadata
- artifact references for `docs/exp.md` and the structured plan/spec
- updated tree plan/tree state payloads

### Structured planner trailer

The SSH-side agent must end with a machine-readable trailer that includes:

- plan identity
- generated document path
- normalized step list
- uncertainty markers / review flags
- optional edge list / dependencies

The first implementation should treat this trailer as required before materializing tree state.

### Structured execution progress

Per-node execution prompts must emit stable progress markers containing:

- document step id / node id
- event kind
- progress or terminal outcome
- short summary

These markers are consumed by the backend parser and written into the existing run event store.

## Error Handling

### Generation failures

- SSH connectivity/auth/path errors return the existing SSH error payloads and do not mutate active tree plan/state.
- If the remote run exits without a valid structured trailer, the planning run is marked failed and the backend stores logs for review only.
- If trailer parsing succeeds but validation fails, the generated document/spec can remain as artifacts, but tree materialization must not be activated.

### Execution failures

- Missing structured progress markers should not break execution; raw logs still persist and terminal node state falls back to the existing run-status mapping.
- Node state should only advance to passed/failed/blocked from backend-observed run outcomes, never from frontend assumptions.

## Verification Strategy

Add targeted tests around the new integration seams:

- planning route creates an SSH-backed agent run for document generation
- successful planner trailer parsing produces normalized artifacts and tree nodes
- malformed planner trailer fails without mutating active tree state
- structured step-progress parsing updates run events and node state incrementally
- terminal execution results map to tree node status correctly

Run verification with:

- route/module load checks
- new document-plan tests
- affected existing `researchops` runner/tree tests

## Implementation Notes

- Keep the first slice narrow: one generated plan document, one typed planner trailer, one tree materialization path, and one structured step-event format.
- Prefer extending existing payload builders and stores over introducing new storage tables or a second execution engine.
- Keep planner parsing deterministic and validation-first so that untrusted agent output cannot directly rewrite tree state.
