# Managed Runtime Container Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current Rust daemon into a managed local runtime agent with real host/container execution backends and converge project/node review-runtime signals into explicit control-surface summaries.

**Architecture:** Keep Node as the control plane and extend the existing Rust daemon instead of creating a second orchestrator. Add an executor plane inside the daemon, wire it to normalized execution requests/results, then converge the UI and payloads around explicit runtime/review control surfaces.

**Tech Stack:** Node.js/Express, existing ResearchOps services, Rust local daemon crate, HTTP/Unix socket transport, current run/report/artifact pipeline, esbuild, node:test.

---

### Task 1: Land the Design Document

**Files:**
- Create: `/Users/czk/auto-researcher/docs/plans/2026-03-07-managed-runtime-container-backend-design.md`

**Step 1: Verify the design doc exists**

Run: `test -f /Users/czk/auto-researcher/docs/plans/2026-03-07-managed-runtime-container-backend-design.md`
Expected: exit code `0`

**Step 2: Commit the design doc**

Run:
```bash
git add /Users/czk/auto-researcher/docs/plans/2026-03-07-managed-runtime-container-backend-design.md
git commit -m "docs: add managed runtime container backend design"
```

Expected: one docs-only commit

### Task 2: Define Executor Contracts in Rust and Node

**Files:**
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/execution-request-payload.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/execution-result-payload.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/execution-view.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-request-payload.service.test.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-result-payload.service.test.js`

**Step 1: Write the failing request payload test**

Cover:
- `runId/projectId`
- `workspaceSnapshot`
- `envSnapshot`
- normalized `jobSpec`
- normalized `outputContract`

**Step 2: Run the test to verify it fails**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-request-payload.service.test.js
```

Expected: missing module or assertion failure

**Step 3: Implement the request payload builder**

Write the minimal serializer to build a daemon-facing `ExecutionRequest`.

**Step 4: Write the failing result payload test**

Cover:
- `executionId`
- `status`
- `exitCode`
- artifacts
- metrics
- log digest
- failure summary

**Step 5: Run the test to verify it fails**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-result-payload.service.test.js
```

Expected: missing module or assertion failure

**Step 6: Implement the result payload builder**

**Step 7: Run both tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-request-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-result-payload.service.test.js
```

Expected: PASS

**Step 8: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/services/researchops/execution-request-payload.service.js /Users/czk/auto-researcher/backend/src/services/researchops/execution-result-payload.service.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-request-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/execution-result-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/execution-view.service.js
git commit -m "feat: add execution request and result payloads"
```

### Task 3: Add Rust Executor Traits and Noop/Host Executors

**Files:**
- Modify: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/lib.rs`
- Modify: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/main.rs`
- Create: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/executor.rs`
- Create: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/tests/executor_host.rs`

**Step 1: Write the failing Rust tests**

Cover:
- executor dispatch by backend/runtime
- host executor lifecycle
- noop/mock executor for tests

**Step 2: Run Rust tests to confirm failure**

Run:
```bash
cd /Users/czk/auto-researcher/backend/rust/researchops-local-daemon && cargo test executor_host -- --nocapture
```

Expected: missing module or trait failures

**Step 3: Implement executor trait + host executor**

**Step 4: Re-run Rust tests**

Run:
```bash
cd /Users/czk/auto-researcher/backend/rust/researchops-local-daemon && cargo test executor_host -- --nocapture
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/lib.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/main.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/executor.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/tests/executor_host.rs
git commit -m "feat: add rust host executor plane"
```

### Task 4: Add Container Executor v1

**Files:**
- Create: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/container_runtime.rs`
- Create: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/container_executor.rs`
- Create: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/tests/executor_container.rs`
- Update: `/Users/czk/auto-researcher/backend/rust/researchops-local-daemon/README.md`

**Step 1: Write failing container executor tests**

Cover:
- Docker-compatible CLI command construction
- mount/staged workspace handling
- timeout / cancel command wiring
- runtime-class mapping for `container-fast` vs `container-guarded`

**Step 2: Run Rust test to confirm failure**

Run:
```bash
cd /Users/czk/auto-researcher/backend/rust/researchops-local-daemon && cargo test executor_container -- --nocapture
```

Expected: missing module or assertion failure

**Step 3: Implement the minimal Docker-compatible runtime adapter**

**Step 4: Re-run the container tests**

Run:
```bash
cd /Users/czk/auto-researcher/backend/rust/researchops-local-daemon && cargo test executor_container -- --nocapture
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/container_runtime.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/src/container_executor.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/tests/executor_container.rs /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/README.md
git commit -m "feat: add rust container executor v1"
```

### Task 5: Wire Managed Runtime Health to Real Executor Readiness

**Files:**
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-runtime.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-status-payload.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/runtime-overview-payload.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-supervisor.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-runtime.service.test.js`

**Step 1: Extend failing probe tests**

Add assertions for:
- `hostReady`
- `containerReady`
- `healthState`
- `lastFailureReason`

**Step 2: Run the probe test**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-runtime.service.test.js
```

Expected: FAIL

**Step 3: Implement readiness projection**

**Step 4: Run the expanded runtime/status tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-runtime.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-status-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/runtime-overview-payload.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-runtime.service.js /Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-status-payload.service.js /Users/czk/auto-researcher/backend/src/services/researchops/runtime-overview-payload.service.js /Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-supervisor.service.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-runtime.service.test.js
git commit -m "feat: project executor readiness into runtime status"
```

### Task 6: Add Managed Executor Control Routes

**Files:**
- Modify: `/Users/czk/auto-researcher/backend/src/routes/researchops/admin.js`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/researchops.js`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js`

**Step 1: Add failing route-level assertions**

Cover:
- managed runtime actions present
- executor readiness fields returned

**Step 2: Run route tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
```

Expected: FAIL

**Step 3: Implement minimal route wiring**

**Step 4: Re-run route tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
node -e "require('./backend/src/routes/researchops/admin'); require('./backend/src/routes/researchops.js')"
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/routes/researchops/admin.js /Users/czk/auto-researcher/backend/src/routes/researchops.js /Users/czk/auto-researcher/backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
git commit -m "feat: expose managed executor control routes"
```

### Task 7: Route Real Execution Requests Through the Rust Executor Plane

**Files:**
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/bridge-route-dispatch.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-bridge.service.js`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/researchops/projects.js`
- Modify: `/Users/czk/auto-researcher/backend/src/routes/researchops/runs.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-bridge.service.test.js`

**Step 1: Add failing tests for executor-backed run dispatch**

Cover:
- bridge run submission with executor metadata
- executor result normalization

**Step 2: Run failing tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-bridge.service.test.js
```

Expected: FAIL

**Step 3: Implement minimal dispatch into the Rust executor plane**

**Step 4: Re-run service and route load verification**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-bridge.service.test.js
node -e "require('./backend/src/routes/researchops/projects'); require('./backend/src/routes/researchops/runs'); require('./backend/src/routes/researchops.js')"
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/services/researchops/bridge-route-dispatch.service.js /Users/czk/auto-researcher/backend/src/services/researchops/rust-daemon-bridge.service.js /Users/czk/auto-researcher/backend/src/routes/researchops/projects.js /Users/czk/auto-researcher/backend/src/routes/researchops/runs.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-bridge.service.test.js
git commit -m "feat: route execution through rust executor plane"
```

### Task 8: Add Project and Node Control-Surface Aggregates

**Files:**
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/project-control-surface.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/node-control-surface.service.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/project-control-surface.service.test.js`
- Create: `/Users/czk/auto-researcher/backend/src/services/researchops/__tests__/node-control-surface.service.test.js`
- Modify: `/Users/czk/auto-researcher/backend/src/services/researchops/dashboard-payload.service.js`

**Step 1: Write failing aggregate tests**

Cover:
- review signals
- runtime signals
- execution signals
- observability signals
- recommended next action

**Step 2: Run failing tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/project-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/node-control-surface.service.test.js
```

Expected: FAIL

**Step 3: Implement both aggregate services**

**Step 4: Re-run the aggregate tests**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/project-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/node-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/dashboard-payload.service.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/backend/src/services/researchops/project-control-surface.service.js /Users/czk/auto-researcher/backend/src/services/researchops/node-control-surface.service.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/project-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/node-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/dashboard-payload.service.js
git commit -m "feat: add project and node control surfaces"
```

### Task 9: Surface Control-Surface Aggregates in the Workbench

**Files:**
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/daemonPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/reviewPresentation.js`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx`
- Modify: `/Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- Create: `/Users/czk/auto-researcher/frontend/src/components/vibe/controlSurfacePresentation.test.mjs`

**Step 1: Write failing UI-helper tests**

Cover:
- project control-surface rows
- node control-surface rows
- recommended next action labels

**Step 2: Run failing UI tests**

Run:
```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/controlSurfacePresentation.test.mjs
```

Expected: FAIL

**Step 3: Implement minimal presentation helpers and panel wiring**

**Step 4: Re-run helper tests and bundle checks**

Run:
```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/controlSurfacePresentation.test.mjs
npx esbuild /Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx --bundle --format=esm --platform=browser --outfile=/tmp/vibe-researcher-panel.js
npx esbuild /Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx --bundle --format=esm --platform=browser --outfile=/tmp/vibe-node-workbench.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add /Users/czk/auto-researcher/frontend/src/components/vibe/daemonPresentation.js /Users/czk/auto-researcher/frontend/src/components/vibe/reviewPresentation.js /Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/VibeNodeWorkbench.jsx /Users/czk/auto-researcher/frontend/src/components/vibe/controlSurfacePresentation.test.mjs
git commit -m "feat: surface project and node control summaries"
```

### Task 10: End-to-End Verification and Docs Sync

**Files:**
- Modify: `/Users/czk/auto-researcher/docs/plans/2026-03-06-research-agent-env-implementation-checklist.md`
- Modify: `/Users/czk/auto-researcher/docs/research_agent_env_spec/08-parallel-implementation-plan.md`

**Step 1: Run backend verification batch**

Run:
```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/runtime-catalog.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/runtime-overview-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-runtime.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-manager.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-status-payload.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-bridge.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/project-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/node-control-surface.service.test.js /Users/czk/auto-researcher/backend/src/routes/researchops/__tests__/daemon-bootstrap.routes.test.js
```

Expected: PASS

**Step 2: Run frontend verification batch**

Run:
```bash
node /Users/czk/auto-researcher/frontend/src/components/vibe/daemonPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/reviewPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/runPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/activityFeedPresentation.test.mjs
node /Users/czk/auto-researcher/frontend/src/components/vibe/controlSurfacePresentation.test.mjs
```

Expected: PASS

**Step 3: Run Rust verification**

Run:
```bash
cd /Users/czk/auto-researcher/backend/rust/researchops-local-daemon && cargo test
cd /Users/czk/auto-researcher && node /Users/czk/auto-researcher/backend/src/services/researchops/__tests__/rust-daemon-prototype-contract.test.js
```

Expected: PASS

**Step 4: Run route/module load checks**

Run:
```bash
cd /Users/czk/auto-researcher && node -e "require('./backend/src/routes/researchops/admin'); require('./backend/src/routes/researchops/projects'); require('./backend/src/routes/researchops/runs'); require('./backend/src/routes/researchops.js')"
```

Expected: PASS

**Step 5: Update docs/checklists**

Reflect:
- executor plane
- container backend v1
- managed runtime health
- control surfaces

**Step 6: Commit**

```bash
git add /Users/czk/auto-researcher/docs/plans/2026-03-06-research-agent-env-implementation-checklist.md /Users/czk/auto-researcher/docs/research_agent_env_spec/08-parallel-implementation-plan.md
git commit -m "docs: record managed runtime convergence progress"
```
