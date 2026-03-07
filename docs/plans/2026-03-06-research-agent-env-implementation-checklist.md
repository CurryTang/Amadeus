# Research Agent Environment Implementation Checklist

## Smoke Flow

1. Select a tree node.
2. Launch `run-step`.
3. Inspect the resulting run report.
4. Inspect observed-session linkage and detached node labels.
5. Promote a search trial if available.

## Verification Batch

### Backend

```bash
NODE_PATH=/Users/czk/auto-researcher/backend/node_modules node --test \
  backend/src/routes/researchops/__tests__/projects.jumpstart.test.js \
  backend/src/routes/researchops/__tests__/projects.observed-sessions.test.js \
  backend/src/routes/researchops/__tests__/researchops.tree-run-metadata.test.js \
  backend/src/services/researchops/__tests__/attempt-view.service.test.js \
  backend/src/services/researchops/__tests__/run-report-view.test.js \
  backend/src/services/researchops/__tests__/run-report-payload.service.test.js \
  backend/src/services/researchops/__tests__/observed-session.materialization.test.js \
  backend/src/services/researchops/__tests__/enqueue-run-payload.service.test.js \
  backend/src/services/researchops/__tests__/daemon-payload.service.test.js \
  backend/src/services/researchops/__tests__/client-daemon.service.test.js
```

### Frontend

```bash
node frontend/src/components/vibe/agentSessionApiResponse.test.mjs
node frontend/src/components/vibe/agentSessionMessageApiResponse.test.mjs
node frontend/src/components/vibe/agentSessionPresentation.test.mjs
node frontend/src/components/vibe/agentSessionContextPresentation.test.mjs
node frontend/src/components/vibe/contextPackApiResponse.test.mjs
node frontend/src/components/vibe/contextPackPresentation.test.mjs
node frontend/src/components/vibe/runDetailView.test.mjs
node frontend/src/components/vibe/observedSessionPresentation.test.mjs
```

## Results

- Status: passed
- Notes:
  - Backend verification passed: 37 tests, 0 failures
  - Frontend verification passed: 20 tests, 0 failures
  - `Recent Runs` now defaults to node scope when matching runs exist and falls back to project scope otherwise
  - `RunReport` now exposes attempt-shaped read data plus deliverable artifact highlights
  - `RunReport` now also exposes thin `workspaceSnapshot`, `envSnapshot`, and `followUp` views for current review/detail flows
  - Observed sessions now surface detached node titles without adding hard attach semantics
  - Interactive agent sessions now use normalized session/detail/message payloads and show active run context
  - Run detail now exposes normalized execution contract data (`location`, `mode`, `backend`, `runtimeClass`, `resources`)
  - Run detail and run-tree payloads now surface continuation / related-run semantics without introducing a new bundle or review workflow
  - Tree node bridge context now has a thin current-architecture payload for local bridge clients (`node`, `nodeState`, `blocking`, `lastRun`, optional `contextPack`)
  - Bridge clients can now read a compact `bridge-report` view and submit thin `workspaceSnapshot` / `localSnapshot` hints through existing enqueue APIs
  - Bridge clients can now submit markdown run notes through existing artifact storage via `bridge-note`
  - Tree `run-step` now accepts bridge snapshot hints too, so snapshot-backed runs can stay on the normal tree execution path
  - `bridge-context` can now optionally inline the latest `bridge-report`, reducing extra fetches for local bridge clients
  - Bridge clients now also have a dedicated `bridge-run` tree submission route with stable attempt/execution/follow-up payloads
  - Bridge node context/report aggregation is now centralized in a testable backend seam instead of being route-only logic
  - Bridge-oriented route parsing is now centralized, so `run-step`, `bridge-run`, and `bridge-context` share the same request normalization in modular and monolith routes
  - Runs now expose a thin current-architecture compare payload at `/runs/:runId/compare?otherRunId=...`, built from existing run/report data rather than a new review workflow
  - Compare payloads now also include concrete base/other run action descriptors for `report`, `artifacts`, `bridge-report`, and the active compare URL, so compare consumers can keep traversing current APIs without rebuilding route strings
  - Run artifact list responses now use a normalized payload with per-artifact download actions and `isDeliverable` flags, so artifact consumers no longer have to special-case the last remaining raw `items` response in the run evidence flow
  - Run step list responses now also use a normalized payload keyed by `runId`, so current detail/replay consumers no longer depend on another bare `{ items }` seam in the same evidence family
  - Run event list responses now also use a normalized payload keyed by `runId` and `afterSequence`, so replay/polling consumers no longer depend on the old raw store result while traversing the same run evidence family
  - Autopilot start/detail/stop/list responses now use a normalized session payload with follow-up actions and current-run links instead of raw `{ session } / { sessions }` wrappers
  - Run detail now auto-loads a lightweight compare summary for the first related/parent run and shows it inline without adding a new compare console
  - Run detail can now switch compare targets across related/parent runs using existing visible run history instead of a dedicated compare page
  - Node workbench review/evidence summary now includes thin compare status/evidence rows when a related run comparison exists
  - `workspaceSnapshot` views now carry through thin `localSnapshot` hints, and run detail surfaces those local snapshot notes alongside workspace/env snapshot metadata
  - `bridge-context` capability flags now explicitly report whether the latest bridge report includes workspace, local, and environment snapshot data
  - `bridge-report` now exposes deliverable counts plus lightweight `hasSummary` / `hasFinalOutput` flags for faster bridge-side result triage
  - `run`, `run-list`, and `run-report` payloads now expose a normalized `contract` view, and run detail surfaces required artifacts plus validation failures directly
  - `bridge-report` now also surfaces the normalized contract view and a direct `hasContractFailures` flag for bridge-side follow-up decisions
  - `bridge-context` capabilities now bubble up bridge-side contract failures directly, so local bridge clients can gate follow-up without reparsing the full report
  - `/runs/enqueue*` now normalizes top-level `outputContract` input before persistence, so required artifacts and summary rules follow the same contract semantics as read models
  - Plan/dashboard enqueue paths now also reuse the shared enqueue normalizer, so those side entrances no longer bypass execution and contract normalization
  - Tree execution payloads (`run-step`, `run-all`, `bridge-run`) now expose the same `execution/followUp/contract` run views as `/runs/*`, instead of only attempt metadata
  - Tree preflight responses now also include a normalized `runPreview` view, so runtime/contract/snapshot hints are readable before actual enqueue
  - Tree preflight success messages now summarize runtime class/backend and required artifact counts, so those normalized previews are visible in the current UI without a new panel
  - `bridge-context` now includes concrete bridge action paths for `bridge-run`, `context-pack`, raw `report`, `artifacts`, `bridge-report`, and `bridge-note`, so local bridge clients do not need to hardcode current route shapes
  - `bridge-context` now also includes thin `submitHints` for `bridgeContext`, `bridgeRun`, and `bridgeNote`, documenting the current query/body fields that local bridge clients can safely send
  - `bridge-report` now also includes concrete follow-up action paths for `context-pack`, raw `report`, `artifacts`, and `bridge-note`, so bridge clients can continue from a report payload without reconstructing URLs
  - Public run enqueue APIs now accept thin execution hints and normalize them into `metadata.jobSpec`
  - Daemon bridge and cluster resource pool now expose normalized execution-facing payloads while keeping legacy top-level compatibility
  - Daemon registration/list/heartbeat payloads now also expose current built-in task types plus concrete task-control action descriptors, so client-daemon code can discover current RPC surfaces without hardcoding them separately
  - Daemon bootstrap responses now also expose follow-up action paths and thin register body hints, so local installer/bootstrap consumers can continue through current register/status APIs without reverse-engineering admin route shapes
  - Daemon bootstrap status payloads now reuse the same discovery contract as bootstrap creation while omitting secrets/install artifacts, so polling clients can keep following current register/status APIs without reintroducing secret leakage
  - Daemon task claim/complete responses now also use a normalized task payload with explicit completion action and body hints, so client-daemon workers can keep executing the current task loop without relying on ad-hoc `{ task }` response shapes
  - `startClientDaemon` now actually consumes discovered daemon action paths from registration payloads for heartbeat/claim/complete instead of hardcoding those endpoints, so the current contract is executable rather than documentation-only
  - Client-agent project capabilities now explicitly declare the current `client-daemon` execution target and supported daemon RPC task types instead of only exposing generic execution booleans
  - Client-agent project path-check responses now expose the active `project.checkPath` execution transport plus follow-up `project.ensurePath` / `project.ensureGit` RPC descriptors, making the current daemon-backed bootstrap flow discoverable without route/source inspection
  - Client-agent project capabilities now also expose the current bridge route templates for node context/run submission and run follow-up APIs, so created client projects can discover the local-bridge workflow without reconstructing route patterns
  - The global observed-session feed now also uses the normalized observed-session payload shape while preserving `cached` source metadata, so `/agent-sessions` no longer remains a raw `{ items, cached }` exception
  - Project-scoped observed-session payloads now expose `list/detail/refresh` action descriptors, so observed-session consumers can follow current APIs without reconstructing those routes
  - Project create/detail/update responses now use a normalized project payload with derived capabilities, location summary, and follow-up action descriptors while keeping the existing `project` object shape intact
  - Daemon list responses now use the normalized daemon payload with list metadata and discovery actions, so `/daemons` no longer remains a raw `{ items }` exception in the execution-control surface
  - Run checkpoint list and decision responses now use a normalized checkpoint payload with filters, checkpoint action descriptors, and list follow-up actions, so the run evidence family no longer leaves checkpoints on ad-hoc raw response shapes
