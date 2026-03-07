# Managed Runtime Container Backend Design

## Objective

Turn the current Rust daemon from a bridge/runtime probe prototype into a managed local execution agent that can host real run execution through pluggable executors, starting with `host` and `container` backends.

## Scope

This design covers three closely related gaps:

1. A deeper managed runtime/container backend
2. A fuller long-running Rust daemon / session-bridge management plane
3. Final convergence of review/runtime signals into a unified control surface

It intentionally does **not** attempt to finish all future target-state infrastructure in one shot. `k8s`, `slurm`, and `microvm` remain catalog/runtime-policy concepts in v1, not fully implemented execution backends.

## Current Constraints

- The Node backend is already the control plane for projects, trees, runs, reports, artifacts, sessions, and dashboard aggregation.
- The Rust daemon already supports:
  - HTTP / Unix socket serving
  - task catalog
  - bridge request proxying
  - typed daemon task execution
  - managed supervisor state
- The codebase already exposes normalized runtime catalog, runtime overview, bridge runtime summaries, and review/runtime signals throughout the workbench.
- The repo is not yet organized around a separate low-level executor service; introducing a second orchestration brain would create churn and duplicate logic.

## Recommended Architecture

### 1. Control Plane Stays in Node

The Node backend remains responsible for:

- project/tree/run/session/review APIs
- persistence for runs, artifacts, reports, daemon state
- policy selection and runtime recommendation
- aggregation and presentation payloads

It should **not** take back heavy execution.

### 2. Rust Daemon Becomes the Local Runtime Agent

The Rust daemon is promoted from a probe/bridge component into a durable local runtime agent with two major roles:

- session bridge endpoint for local coding tools
- managed execution host for local runtime backends

The daemon remains reachable via:

- localhost HTTP
- Unix domain socket

The daemon remains supervised by the existing managed runtime plane, but that plane is expanded to reason about runtime readiness, capability drift, and executor health rather than only process liveness.

### 3. Executor Plane Lives Inside the Rust Daemon

The daemon gets an internal executor abstraction:

- `HostExecutor`
- `ContainerExecutor`
- `NoopExecutor` or mock executor for tests

Runtime policy resolves a run onto one executor implementation. The executor plane is execution-focused only; it does not own business entities like `Project`, `TreeNode`, or `RunReport`.

### 4. Snapshot / Artifact Adapters Form the Boundary

Execution always runs from structured input:

- `WorkspaceSnapshot`
- optional local snapshot hints
- `EnvSnapshot`
- normalized `JobSpec`
- normalized `OutputContract`

Execution produces structured output:

- phase transitions
- stdout/stderr chunks
- metrics/artifact discoveries
- execution result metadata
- final artifact manifest / log digest / failure summary

Node continues to assemble `RunReport`.

## Core Contract

### ExecutionRequest

The Rust daemon should accept a thin request object, not the entire business object graph:

- `runId`
- `projectId`
- `attempt`
- `workspaceSnapshot`
- `envSnapshot`
- `jobSpec`
- `outputContract`
- `contextRefs`

### ExecutionHandle

Returned immediately after the daemon accepts the job:

- `executionId`
- `executorType`
- `status`
- `startedAt`
- `resolvedRuntime`

### ExecutionResult

Returned when the execution completes or is terminated:

- `status`
- `exitCode`
- `artifacts`
- `metrics`
- `logDigest`
- `finalSnapshot`
- `failureSummary`

## Execution State Machine

The execution layer should stabilize around:

- `queued`
- `preparing`
- `running`
- `collecting`
- `succeeded`
- `failed`
- `cancelled`

This state machine belongs to the execution plane, not the entire run lifecycle. Node may still project it into higher-level run/report state.

## Container Backend v1

### Supported in v1

- single-container single-job execution
- Docker-compatible CLI runtime first
- staged or mounted workspace snapshot
- stdout/stderr streaming
- artifact directory collection
- timeout handling
- cancellation
- basic resource limits:
  - CPU
  - memory
  - optional GPU passthrough hint

### Not Supported in v1

- multi-container orchestration
- distributed training orchestration
- service/sidecar meshes
- image build pipelines
- full network sandbox policy system
- microVM runtime implementation

### Runtime Mapping

- `container-fast`
  - standard mounted or staged execution
  - network enabled by default
  - baseline resource/time enforcement

- `container-guarded`
  - more restrictive mount set
  - optional no-network or limited-network policy hooks
  - explicit degraded capability signaling if the host cannot honor stronger isolation

## Managed Runtime / Session-Bridge Management Plane

The managed Rust daemon plane should expose more than “process alive / dead”.

### Required State

- desired state
  - `running`
  - `stopped`
- actual process state
  - running / not running
- health state
  - `healthy`
  - `degraded`
  - `reconciling`
- executor readiness
  - `hostReady`
  - `containerReady`
- bridge readiness
- last reconcile result
- last failure reason

### Required Actions

Current:

- `start`
- `stop`
- `restart`
- `enable-managed`
- `disable-managed`
- `reconcile`

Expanded meaning:

- `reconcile` must check:
  - process liveness
  - daemon runtime endpoint
  - bridge/task catalog compatibility
  - host executor readiness
  - container executor readiness

Managed mode is only truly ready when desired state, actual process state, and capability state agree.

## Unified Control Surface

The final UI/control-plane convergence should be based on explicit aggregate read models instead of more scattered badges.

### ProjectControlSurface

Aggregates:

- review
  - attention runs
  - contract failures
  - missing outputs
  - warnings
- runtime
  - online clients
  - bridge-ready clients
  - snapshot-ready clients
  - rust managed state
  - runtime drift
- execution
  - remote runs
  - snapshot-backed runs
  - transport mix
  - runtime mix
- observability
  - instrumented runs
  - sink providers
- recommendation
  - backend
  - runtime class
  - reason

### NodeControlSurface

Aggregates:

- latest run state
- compare summary
- contract state
- output presence
- execution/runtime/transport
- snapshot state
- readiness/warnings
- sink providers
- bridge readiness
- recommended next action

### Recommended Next Actions

Keep v1 narrow:

- `rerun`
- `review-output`
- `fix-runtime`
- `sync-snapshot`

## Recommended Implementation Approach

### Approach A: Extend Existing Rust Daemon (Recommended)

Add executor backends and managed runtime health to the current Rust daemon and Node control plane.

Pros:

- reuses current bridge/runtime work
- least churn
- keeps one local agent
- matches current architecture

Cons:

- Rust daemon becomes broader in responsibility

### Approach B: New Dedicated Rust Executor Service

Separate daemon/bridge from local execution service.

Pros:

- cleaner long-term separation

Cons:

- introduces another orchestration layer
- much higher migration risk
- duplicates existing managed/runtime status work

### Approach C: Node-Side Container Backend First

Implement container execution in Node first and keep Rust daemon mostly as bridge.

Pros:

- may ship a quick proof-of-concept

Cons:

- likely temporary
- splits execution responsibilities across runtimes
- increases future migration cost

## Recommendation

Use **Approach A**:

- keep Node as control plane
- extend the Rust daemon into a managed local runtime agent
- add a pluggable executor plane inside the Rust daemon
- implement `host` and `container` executors first
- converge project/node review/runtime summaries around explicit control-surface aggregates

## Acceptance Criteria

This design is complete when all of the following are true:

1. Rust daemon can stably run as a managed local runtime agent, not just a prototype.
2. The daemon can execute real jobs through `host` and `container` backends.
3. Container execution is wired into the current run/report/artifact pipeline without replacing Node control-plane responsibilities.
4. Runtime policy chooses and reports recommended backend/runtime pairs consistently.
5. Project/node control surfaces unify review/runtime/execution/observability signals into one coherent read model.

