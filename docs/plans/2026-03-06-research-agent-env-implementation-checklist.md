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
  - `run` and `run-list` payloads now also expose thin `workspaceSnapshot` and `envSnapshot` views, so current list/detail/triage flows can read normalized snapshot/runtime hints without first loading a full `RunReport`
  - `run` and `run-list` payloads now also expose a thin normalized `observability` view when summary data already exists on the run record, so current strips/cards can consume readiness and warning signals without waiting for a full report fetch
  - Run detail snapshot and bridge/runtime summaries now fall back to thin run-level `workspaceSnapshot` / `envSnapshot` / `resolvedTransport` views when a full `RunReport` is not yet loaded, so current detail flows no longer silently lose runtime context during partial loads
  - `bridge-report` now also surfaces the normalized contract view and a direct `hasContractFailures` flag for bridge-side follow-up decisions
  - `bridge-context` capabilities now bubble up bridge-side contract failures directly, so local bridge clients can gate follow-up without reparsing the full report
  - `/runs/enqueue*` now normalizes top-level `outputContract` input before persistence, so required artifacts and summary rules follow the same contract semantics as read models
  - Plan/dashboard enqueue paths now also reuse the shared enqueue normalizer, so those side entrances no longer bypass execution and contract normalization
  - Tree execution payloads (`run-step`, `run-all`, `bridge-run`) now expose the same `execution/followUp/contract` run views as `/runs/*`, instead of only attempt metadata
  - Tree preflight responses now also include a normalized `runPreview` view, so runtime/contract/snapshot hints are readable before actual enqueue
  - Tree preflight success messages now summarize runtime class/backend and required artifact counts, so those normalized previews are visible in the current UI without a new panel
  - Tree preflight success messages now also call out snapshot-backed submissions from normalized `runPreview.workspaceSnapshot` data, so local-bridge snapshot runs are visible before enqueue rather than only after report/detail load
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
  - Project list responses now keep top-level project items compatible while adding derived capabilities, location summaries, and follow-up actions, so `/projects` no longer remains a raw list seam
  - Project create/detail/update responses now use a normalized project payload with derived capabilities, location summary, and follow-up action descriptors while keeping the existing `project` object shape intact
  - Daemon list responses now use the normalized daemon payload with list metadata and discovery actions, so `/daemons` no longer remains a raw `{ items }` exception in the execution-control surface
  - Run checkpoint list and decision responses now use a normalized checkpoint payload with filters, checkpoint action descriptors, and list follow-up actions, so the run evidence family no longer leaves checkpoints on ad-hoc raw response shapes
  - Scheduler queue responses now use a normalized queue payload built from enriched run-list items, and dashboard queue aggregation now reuses the same normalizer instead of mixing raw queued-run shapes
  - Idea list/detail/create/update responses now use normalized idea payloads with compatible top-level idea items plus follow-up action descriptors, and dashboard idea aggregation now reuses the same normalizer
  - Skill list responses now use a normalized payload with content-edit action descriptors, and dashboard skill aggregation now reuses the same normalizer instead of raw merged skill items
  - Tree plan read/validate/patch/impact-preview responses now use a normalized plan payload family with consistent follow-up action descriptors while preserving the existing `plan`, `validation`, and `impact` roots used by the workbench
  - Knowledge-group list/detail/project-link responses now use a normalized payload family with compatible top-level group items plus project linking actions, so current knowledge-hub and workbench consumers no longer depend on raw group/store response shapes
  - Knowledge-asset list/detail/upload/group-link responses now use a normalized payload family with compatible top-level asset items plus filter/action metadata, so current knowledge-hub flows no longer depend on raw asset/store response shapes
  - Knowledge-group document list/link responses now use a normalized payload family with per-document unlink actions and list follow-up actions, so the remaining knowledge-group document surface no longer depends on raw group-document service results
  - Scheduler lease/recovery/status responses now use a normalized payload family with run follow-up views and dispatcher actions across modular/admin/monolith routes, so execution-control consumers no longer depend on raw runner/store response shapes
  - Dashboard plan generate/enqueue responses now use a normalized payload family with compatible `plan` roots plus run follow-up views/actions, so that planning flow no longer depends on raw `{ plan }` / `{ plan, run }` wrappers
  - Skill sync/content responses now use normalized payloads with compatible roots plus follow-up actions, so dashboard skill editing no longer depends on raw sync/content wrappers
  - KB search responses now use a normalized payload with compatible `source/items` roots plus request metadata and action descriptors, so dashboard KB search no longer depends on raw proxy/fallback wrappers
  - Project file search responses now use a normalized payload with compatible `items` roots plus scope/query metadata and search actions, so current project/kb search consumers no longer depend on raw `{ projectId, rootMode, items }` wrappers
  - Run delete/project-clear/event-publish responses now use a normalized mutation payload family with follow-up actions and compatible event items, so the remaining run lifecycle mutations no longer depend on raw `{ ok }`, `{ deletedCount }`, or `{ count, items }` wrappers
  - KB sync start/detail responses now use a normalized job payload family with compatible `job` roots plus follow-up actions, so the project KB sync polling flow no longer depends on raw `{ accepted, job, message }` / `{ job }` wrappers
  - Knowledge delete/unlink mutations now use compatible success payloads with follow-up actions across modular/project/monolith routes, so the remaining knowledge mutation seams no longer depend on raw `{ success: true }` wrappers
  - Project path-check responses now use a normalized payload with compatible root fields plus explicit `checkPath` actions, so local/ssh/client path validation no longer mixes typed and raw response shapes
  - Tree node approval and todo-generated node responses now use normalized action payloads with compatible roots plus follow-up action descriptors, so those tree-node mutations no longer depend on raw `{ ok, nodeId }` or `{ node, provider }` wrappers
  - Experiment execute responses now use a normalized payload across admin/monolith paths, preserving proxied result roots and local `run` roots while adding follow-up actions and run views
  - Horizon cancel, project KB setup-from-resource, and project git restore responses now use normalized control payloads with compatible success roots plus follow-up actions, so those remaining project/run control seams no longer depend on raw `{ ok }` or `{ success: true }` wrappers
  - Project `kb/add-paper` responses now use a normalized payload with compatible `results/paperFolder/documentTitle` roots plus KB follow-up actions, so that paper-ingest helper no longer remains a raw `{ ok, results, paperFolder }` exception
  - Project file tree/content and KB resource-locate responses now use a normalized browse payload family with compatible roots plus follow-up actions, so those project workspace browse/read helpers no longer remain route-local raw `{ projectId, rootMode, ... }` wrappers
  - Project workspace snapshot, venv, git-log, server-files, and changed-files responses now use a normalized project-insights payload family with compatible roots plus follow-up actions, so those project insight helpers no longer remain ad-hoc route-local wrappers
  - Run delete, bridge-note, tree approve, and skill-content save routes now emit their success markers directly from normalized payload services instead of wrapping payloads in route-local `{ ok: true, ... }` shells
  - Runner `running` and cluster `agent-capacity` responses now use normalized execution-status payloads with follow-up actions, and `backend/data.sqlite` is now ignored locally via `backend/.gitignore`
  - Monolith daemon register/heartbeat now reuse the same normalized daemon payloads as admin routes instead of returning a narrower ad-hoc subset
  - Project delete now uses a normalized payload with compatible `projectId/force/deleteStorage/summary` roots plus project-list follow-up actions across modular and monolith routes
  - Dashboard aggregate and runs-router `runner/running` now use normalized payload services, so those remaining aggregate/status reads no longer depend on route-local wrappers
  - Project TODO `next-actions` and `clear` now use normalized payloads with compatible roots plus follow-up actions across modular and monolith routes
  - Tree `root-node`, tree plan save, and tree state now use normalized payload services with compatible roots plus follow-up actions across modular and monolith routes
  - Tree queue pause/resume/abort plus search read/promote now use normalized payload services with compatible roots plus follow-up actions across modular and monolith routes
  - Tree `jumpstart` now uses a normalized payload with compatible roots plus follow-up actions on the modular route, matching the current architecture where this endpoint is not exposed in the monolith router
  - Horizon status now uses a normalized run payload with compatible status/log roots plus follow-up actions across modular and monolith routes
  - Tree `run-all` payloads now include follow-up actions and the monolith route now reuses the same normalized response shape as the modular route
  - Project `kb/files` and `context/repo-map` now use normalized payload services with compatible roots plus follow-up actions across modular and monolith routes instead of route-local wrappers
  - Project knowledge-group link mutation now emits the `knowledgeGroups` compatibility alias directly from the payload service, so modular and monolith routes no longer re-wrap the same response differently
  - Monolith run delete and cluster resource-pool now reuse existing normalized payload services instead of layering extra route-local wrappers on top
  - Tree todo-clarify and run-clarify responses now use a normalized payload service with compatible `done/question/options` roots plus explicit clarify actions
  - ResearchOps health, project `kb/files`, and project `context/repo-map` now also use normalized payload services; a final raw-success scan of modular + monolith `researchops` routes now returns no remaining `res.json({ ... })` success wrappers
  - Daemon registration/list/task payloads and client-agent project capabilities now share a typed daemon task catalog (`v0`) that distinguishes current built-in project tasks from optional bridge workflow tasks, so the future Rust daemon/bridge layer has explicit payload/result contracts to target
  - Client daemons now advertise `supportedTaskTypes` and `taskCatalogVersion` during register/heartbeat, the metadata store persists that capability set, and normalized daemon payloads now expose each daemon's actual supported task list instead of only the global catalog
  - Client-agent path-check and bootstrap flows now gate on the daemon's advertised `supportedTaskTypes` instead of blindly sending RPCs, so missing built-in tasks fail fast before `project.checkPath` / `project.ensure*` requests are enqueued
  - Client-agent path-check responses now also surface daemon-aware bootstrap capability metadata and only expose `ensurePath` / `ensureGit` follow-up actions when the connected daemon actually advertises those tasks
  - Client-agent path-check responses now also report local bridge workflow readiness (`canUseLocalBridgeWorkflow` and `missingBridgeTaskTypes`) based on the daemon's advertised bridge task family, so the frontend can distinguish “project bootstrap ready” from “bridge workflow ready”
  - Normalized daemon payloads and client-device option labels now surface bootstrap/bridge readiness directly (`supportsProjectBootstrap`, `supportsLocalBridgeWorkflow`, missing task lists, and a `bridge ready` device label), so daemon selection no longer requires inferring readiness from raw task arrays alone
  - The Node-based client daemon runtime now advertises the optional bridge task family out of the box, so local executor deployments can actually receive bridge workflow tasks instead of only documenting them in payloads
  - Bridge transport dispatch is now centralized in a shared service and reused by both modular and monolith bridge routes, so `daemon-task` versus direct-HTTP routing no longer drifts across `bridge-context`, `bridge-run`, `bridge-report`, `bridge-note`, and run `context-pack`
  - The Node client daemon now exposes a stable runtime summary (`supportedTaskTypes`, `taskCatalogVersion`, bridge readiness) and the desktop processing server health endpoint now surfaces that runtime state directly, so local execution observability no longer depends on reading startup logs
  - A first Rust prototype now exists at `backend/rust/researchops-local-daemon`, compiling against the v0 trait contract and printing a typed daemon runtime summary, so the future Rust bridge layer is no longer only a doc artifact
  - The Rust prototype now also emits a typed daemon task catalog matching the current JS bridge/project task families, so both runtimes share the same v0 contract vocabulary instead of only sharing plain task strings
  - The Rust prototype now also serves a minimal localhost HTTP surface for `/health`, `/runtime`, and `/task-catalog` (single-request mode), so the “localhost HTTP daemon” direction in the execution spec now has a verified starting point
  - The Rust prototype now also supports a persistent `--serve` localhost mode plus a backend npm script, so the execution-environment work now has a repeatable developer entrypoint instead of only one-shot smoke commands
  - The Rust prototype now also supports Unix domain socket serving, so both daemon shapes called out in the execution spec (`localhost HTTP` and `Unix socket`) now exist as verified prototype paths
  - The Rust prototype now also proxies thin backend bridge read APIs (`bridge-report` and `context-pack`) through its localhost/Unix HTTP surface when `RESEARCHOPS_API_BASE_URL` is configured, so the daemon/bridge runtime is no longer limited to self-reported health/runtime/catalog JSON
  - The Rust prototype now also proxies the remaining high-value bridge current APIs (`node-context`, `bridge-run`, and `bridge-note`) through the same localhost/Unix HTTP surface, so the bridge task catalog now maps to executable Rust-side proxy routes instead of only typed metadata
  - The Rust prototype now also exposes a `POST /tasks/execute` endpoint keyed by `taskType + payload`, so current bridge task catalog entries can be executed through one typed local endpoint instead of every consumer needing to know the daemon-local route fanout
  - The Rust prototype now also executes the built-in project task family (`project.checkPath`, `project.ensurePath`, `project.ensureGit`) through that same typed task endpoint, so the current JS daemon catalog is no longer “real for project tasks, metadata-only for Rust”
  - The Rust prototype now also decodes chunked backend proxy responses, and the Node-side verifier now smokes real proxy + task execution paths instead of only diffing task catalogs
  - The Node-side verifier now also smokes Unix-socket task execution, so both supported daemon transports (`localhost HTTP` and `Unix socket`) are covered outside the Rust crate itself
  - ResearchOps health payloads now optionally include a typed Rust-daemon runtime probe over either localhost HTTP or a Unix socket, so the backend can surface real execution-runtime status instead of relying only on out-of-band smoke scripts
  - The project creation workbench now surfaces that Rust-daemon health summary next to the client-device selector, so local-execution readiness is visible in the current UI without a separate runtime dashboard
  - Daemon bootstrap payloads now also expose Rust prototype runtime options (`researchops:rust-daemon-serve` and `researchops:rust-daemon-serve-unix`) without leaking bootstrap secrets into that path
  - The client connect panel now surfaces those Rust prototype runtime commands as copyable alternatives next to the existing Node daemon install flow
  - Rust prototype bootstrap now also has its own shell entrypoint (`backend/scripts/researchops-bootstrap-rust-daemon.sh`), so the admin bootstrap surface no longer points users at raw npm commands only
  - Rust prototype launch arguments are now centralized in a shared launcher service plus `backend/scripts/researchops-rust-daemon.js`, so HTTP versus Unix transport selection is no longer duplicated across package scripts and bootstrap shell logic
  - Rust daemon launcher/runtime surfaces now also expose a stable supervisor state (`managed/unmanaged`, `pid`, `pidFile`, `logFile`) plus a background launch command, so the long-running local runtime path is no longer limited to foreground serve commands and ad-hoc terminal state
  - Backend now exposes managed Rust daemon lifecycle actions (`start`, `stop`, `restart`) and the runtime panel consumes them directly, so the current UI can control the local Rust runtime instead of only displaying probe/launcher/debug commands
  - Rust prototype bootstrap payloads now also expose downloadable `.env` variants for both HTTP and Unix transports, and the connect panel lets users download them directly
  - Rust-daemon runtime probes now also fetch `/task-catalog` and compute a normalized `catalogParity` view (`aligned` vs `mismatch`, with missing/extra task types), so backend health can flag JS/Rust task drift directly instead of relying only on the standalone verifier
  - The client connect panel now surfaces compact Rust-daemon status details (`transport`, `endpoint/socket`, catalog size, parity, missing/extra tasks) in addition to the one-line readiness note, so local runtime debugging no longer requires jumping straight to backend logs
  - Admin and monolith routes now also expose a dedicated `GET /researchops/daemons/rust/status` read model with probe roots, catalog parity, reusable Rust bootstrap runtime options, and follow-up actions, so runtime management no longer has to overload the generic health endpoint
  - The client connect panel now consumes that dedicated Rust status read model directly instead of piggybacking on `/researchops/health`, and the daemon presentation helpers accept both wrapped health payloads and direct status payloads during the transition
  - Rust prototype launch commands and downloadable env files now also fall back to the dedicated Rust status payload, so local runtime testing no longer depends on first minting a daemon bootstrap token
  - The dedicated Rust status payload now also exposes `launcher` and `verify` commands, and the workbench surfaces them alongside HTTP/Unix serve commands, so local runtime operation and parity verification are both reachable from the same runtime panel
  - Dedicated Rust status responses now include `refreshedAt`, and the workbench has a separate “Refresh Rust Status” action plus a visible last-checked row, so runtime probing no longer depends on reloading the full client-device list
  - The Rust status payload now also exposes direct debug probe commands for `/health`, `/runtime`, and `/task-catalog`, and the workbench surfaces them alongside launcher/verify commands, so transport-level troubleshooting no longer requires hand-building curl invocations
  - Rust runtime commands in the workbench are now grouped by intent (`Operate`, `Serve`, `Verify`, `Debug`), and route-level tests now pin `refreshedAt` plus debug-command exposure on the dedicated status response, so the management panel is both easier to scan and better regression-protected
  - Backend now exposes a dedicated `GET /researchops/runtime/overview` aggregate that combines client daemons, Rust daemon status, and runner state, and the project creation workbench now reads its client-device/runtime data from that single payload instead of stitching multiple requests together
  - Run detail now surfaces a compact observability summary (`steps`, `artifacts`, `checkpoints`, `summary`, `final output`, `deliverables`) directly from the normalized `RunReport`, so current evidence triage no longer requires mentally stitching together multiple sections
  - `RunReport` now also exposes a normalized `observability` view (`counts`, `flags`, `statuses`, sink providers, warnings) derived from existing manifest/report data, so review and observability consumers no longer need to recompute readiness from raw steps/artifacts/checkpoints on the frontend
  - Backend now exposes a dedicated `GET /researchops/runs/:runId/observability` current-architecture read model, so run-centered evidence review no longer has to overload the full report payload just to answer “is this run review-ready?”
  - Run compare payloads now preserve normalized observability state for the compared run, and the run detail compare panel surfaces readiness and warning counts directly, so follow-up decisions no longer rely on status/evidence alone
  - Run report resource loading and inline manifest/summary decoding are now centralized in a shared backend service reused by both modular and monolith routes, so current report/observability flows no longer duplicate the same store + S3 stitching logic in two router files
  - Dashboard payloads now include a lightweight `reviewSummary` aggregate for recent runs, and the activity feed header surfaces active/attention/completed counts directly, so project-level review triage no longer requires opening individual runs first
  - Dashboard and node-scoped activity headers now also surface `contract failures`, `failed`, and `cancelled` counts from the normalized run review summary, so project-level triage is no longer forced to collapse all attention into one bucket
  - Current bridge routes (`bridge-context`, `bridge-run`, `bridge-report`, `bridge-note`, and run `context-pack`) now also accept `transport=rust-daemon`, using the local Rust daemon task endpoint as a third execution path beside direct HTTP and client-daemon `daemon-task`
  - When bridge routes are called without an explicit `transport`, backend dispatch now automatically uses the normalized preferred transport (`daemon-task`, then `rust-daemon`, then `http`) instead of always falling back to direct HTTP
  - Bridge route payloads now also carry `resolvedTransport`, and the selected-node workbench surfaces it in the bridge/runtime summary, so users can tell which bridge path was actually used after preferred-transport auto-selection
  - Thin run and run-list payloads now also preserve `resolvedTransport`, and both the recent-runs strip and activity-feed run cards surface it as `via ...`, so bridge-path triage is visible in high-level run lists instead of only inside node/run detail panels
  - JS client daemons and the Rust daemon prototype now both advertise and execute a built-in `bridge.captureWorkspaceSnapshot` task that returns thin `workspaceSnapshot/localSnapshot` hints from a local path, so the local bridge/runtime layer now has an explicit snapshot-sync capability instead of only ad-hoc note/run submission
  - Bridge context, bridge-run, and bridge-report payloads now surface `captureWorkspaceSnapshot` daemon task actions plus task-level submit hints, and the selected-node workbench shows that task directly in the bridge/runtime summary instead of requiring consumers to infer it from the global daemon catalog
  - Run detail bridge/runtime summaries now also surface the `bridge.captureWorkspaceSnapshot` task when present, so snapshot-sync readiness is visible from both node-centered and run-centered execution views
  - Run detail bridge/runtime summaries now also surface the `resolvedTransport` returned by bridge payloads, so run-centered bridge triage shows which transport actually served the current report instead of only the preferred transport
  - Normalized daemon payloads now expose `supportsWorkspaceSnapshotCapture`, and client-device labels now show `snapshot ready` when that task is advertised, so local executor readiness is visible before opening any node or run detail
  - Dedicated Rust daemon status payloads now also expose a copyable `bridge.captureWorkspaceSnapshot` debug command, and the runtime panel shows it alongside health/runtime/catalog probes so the new snapshot task is testable from the current UI
  - Rust daemon `/runtime` summaries, backend runtime probes, and runtime-panel rows now explicitly expose `supports_workspace_snapshot_capture`, so snapshot-sync readiness is visible even before opening the full task catalog or running a debug command
  - Runtime overview payloads now aggregate `online / bridge-ready / snapshot-ready / running` counts, and the client-runtime panel surfaces those summary rows directly instead of forcing the UI to rescan every daemon item ad hoc
  - Runtime overview and Rust status rows now also surface whether the Rust daemon is currently under managed supervision, so runtime readiness is no longer disconnected from long-running process state
  - The client-runtime panel now renders runtime-overview summary rows even when no dedicated Rust status rows are available, so summary-only current-overview payloads no longer disappear behind a Rust-specific render gate
  - Dashboard/project run review summaries now also track `remoteExecutionCount` and `snapshotBackedCount`, and the activity header surfaces those bits directly so execution-path triage is no longer purely status-based
  - Dashboard/project run review summaries now also track `instrumentedCount` from normalized observability sink providers, and the activity header surfaces that count directly so telemetry coverage is visible alongside remote/snapshot execution triage
  - Dashboard/project and node-scoped run review summaries now also preserve the active sink-provider set, and the activity header surfaces it as `sinks ...`, so telemetry coverage is visible by provider instead of only by aggregate count
  - Dashboard/project and node-scoped run review summaries now also preserve the active `resolvedTransport` set, and the activity header surfaces it as `transports ...`, so current bridge-path usage is visible at summary level instead of only per-run
  - Node-scoped recent-run review summaries now also track `instrumentedCount`, so activity triage does not silently lose telemetry-coverage signals when the user narrows from project scope to a specific tree node
  - Node-scoped recent-run review summaries now use the same `remoteExecutionCount` / `snapshotBackedCount` logic as dashboard/project scope, so activity triage does not silently downgrade when the user narrows to a specific tree node
  - Recent run cards now surface `Remote` and `Snapshot-backed` badges from normalized `execution` and `workspaceSnapshot` views, so execution-path triage is visible directly in the most-used run strip instead of only in summaries/detail modals
  - Recent run cards now also surface `Validation failed` from normalized contract views, so contract failures are visible in the same strip as execution/snapshot hints instead of being hidden behind run detail only
  - Recent run cards now also surface normalized `backend/runtimeClass` labels, so the run strip can distinguish different remote/runtime paths instead of collapsing them into a single `Remote` badge
  - Recent run cards now also surface normalized observability readiness and warning counts, so the main run strip carries the same “needs attention” signal family that was previously only visible in run detail and node review
  - Recent run cards now also surface normalized observability sink providers, so the main run strip shows which telemetry backends a run is already writing to without requiring the user to open run detail first
  - Thin `run` and `run-list` payloads now also expose a lightweight `output` view (`hasSummary`, `hasFinalOutput`, deliverable ids), and recent-run/activity cards surface `Summary` / `Final output` directly, so key-output triage no longer requires a full report fetch
  - Execution hints are now normalized through a shared runtime catalog (`local/container/k8s/slurm` + `wasm-lite/container-fast/container-guarded/microvm-strong`), so enqueue/job-spec aliases and run execution views converge on the same current-compatible backend/runtime semantics
  - Runtime overview now ships the shared execution runtime catalog and a dedicated `GET /researchops/runtime/catalog` control-plane route, so current runtime/control surfaces no longer need to rediscover backend/runtime-class descriptors from scattered docs
  - Rust daemon supervision now tracks `desiredState` separately from the live process, and current payloads/routes expose `enable-managed`, `disable-managed`, and `reconcile` actions, so the local Rust runtime can be driven as a managed control plane instead of only via start/stop/restart buttons
  - Runtime overview summaries and Rust status rows now surface `Rust Desired` alongside `Rust Managed`, so managed-runtime drift is visible even when the process is currently down
  - The runtime panel now includes a unified review/runtime control-surface summary (`control status`, `attention`, `runtime drift`, `telemetry`, `transports`, client coverage), so users no longer need to mentally merge dashboard review counts and runtime readiness from separate sections
  - Run detail, compare, node review, recent-run cards, and activity cards now surface normalized runtime isolation tiers (`Host-native`, `Standard isolation`, `Guarded isolation`, `Strong isolation`), so execution triage can distinguish isolation posture in the same flows that already show backend/runtime path
  - Tree preflight success messages now also surface normalized isolation posture alongside backend/runtime class, so launch-time feedback answers “what isolation tier will this run use?” before the run is actually enqueued
  - Runtime profiles now also flag incompatible backend/runtime-class combinations (for example `local + container-fast`), and current run detail plus tree preflight surface those warnings directly so execution mistakes are visible before or during triage instead of being hidden in raw job-spec strings
  - Runtime compatibility warnings now also flow into recent-run cards, activity-feed cards, and node review summaries, so incompatible backend/runtime combinations are visible in the same high-frequency triage surfaces as transport, snapshot, contract, and observability signals
  - Activity-feed run cards now also surface the same execution/runtime/snapshot/contract/readiness/warning/sink labels as the main recent-runs strip, so users no longer lose current execution-review context when triaging from the combined activity feed
  - Run compare summaries now also surface the compared run’s execution location and whether it was snapshot-backed, so follow-up decisions in the detail modal are no longer based on status/readiness text alone
  - Run compare summaries and node review compare rows now also surface the compared run’s `backend/runtimeClass`, so execution triage can distinguish “remote on different runtime” cases instead of collapsing everything into location-only labels
  - Run compare summaries and node review compare rows now also fall back to thin compare-side `workspaceSnapshot` views when a full compare report is absent, so snapshot-backed compare triage still works during partial compare loads
  - Run compare summaries and node review compare rows now also surface the compared run’s normalized contract status (`Validated` / `Validation failed`), so compare triage can distinguish runtime regressions from output-contract failures without opening the full contract section
  - Run compare summaries and node review compare rows now also surface compare-side observability sink providers, so follow-up triage can tell which telemetry backends were active on the compared run without opening the full observability section
  - Run compare summaries and node review compare rows now also surface compare-side `resolvedTransport`, so bridge-path regressions can be triaged in compare flows without drilling into the compared run separately
  - The current `run compare` backend payload now also preserves the base run’s thin `contract / workspaceSnapshot / envSnapshot / observability / resolvedTransport` views, so compare consumers no longer need a separate `GET /runs/:runId` just to render the left-hand side of the comparison consistently
  - Node workbench compare rows now also surface compare-side readiness and warning counts from normalized observability data, so node-centered triage no longer loses the same review signals that are already visible in the run-detail compare panel
  - Node workbench `Review / Evidence` summaries now also surface compare execution location and snapshot-backed status, so node-centered compare triage matches the richer run-detail compare view
  - The selected-node workbench now also loads `bridge-context?includeContextPack=true&includeReport=true` and shows thin bridge/runtime rows (`preferred transport`, `available transports`, runtime target, bridge task readiness, snapshots), so node-level execution readiness is visible without opening run detail first
  - The selected-node workbench `Review / Evidence` summary now falls back to `bridgeReport.report` when no active run detail is open, so node-centered triage still shows checkpoints, readiness, and bridge readiness from the latest node run
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback sink providers, so node-centered observability triage no longer loses the same telemetry-provider signal already visible in run detail
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback `resolvedTransport`, so node-centered bridge-path triage no longer depends on opening run detail for the latest node run
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback contract status, so node-centered output-contract triage no longer depends on compare rows or the full run-detail panel
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback snapshot presence, so node-centered review triage no longer loses the same snapshot-backed signal already exposed in compare and run-detail flows
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback execution location/runtime, so node-centered execution triage no longer depends on compare rows or the run-detail panel for the latest node run
  - The selected-node workbench `Review / Evidence` summary now also surfaces current-run and bridge-fallback summary/final-output presence, so node-centered evidence triage no longer requires opening the full run-detail output section just to know whether key outputs exist
  - Run compare summaries and node review compare rows now also surface compare-side summary/final-output presence, so compare triage no longer requires opening the full output section to tell whether the alternate run actually produced key deliverables
  - A Node-side verifier now checks that the Rust prototype task catalog stays aligned with the JS daemon catalog, so the new Rust bridge/runtime prototype cannot silently drift away from the current `v0` task contract

## Section Status Audit

- `01 Design Principles`: effectively complete in implementation terms; current-vs-target distinctions are now consistently reflected in shipped read models and UI seams
- `02 System Architecture`: mostly complete for the current architecture; remaining gap is target-state convergence of runtime/control-plane pieces
- `03 Domain Model and State Machines`: mostly complete; `Attempt ≈ Run`, `TreeNode`, `RunReport`, `AgentSession`, and `ObservedSession` are all reflected in current payloads and UI
- `04 Execution Environment and Sandbox`: partially complete; runtime hints, bridge transports, snapshot capture, and Rust daemon prototype exist, but full long-running runtime/container backend is still incomplete
- `05 Agent API / Context / Session Sync`: mostly complete for current APIs; remaining gap is stronger unified control-plane behavior rather than route-shape normalization
- `06 Frontend and Interaction Spec`: mostly complete for the tree-centered workbench; remaining gap is deeper target-state runtime/review console behavior
- `07 Review / Deliverables / Observability`: mostly complete for current run-centered review; remaining gap is fuller project/node review workflow convergence
- `08 Parallel Implementation Plan`: Phase A is effectively done, Phase B is mostly done, and Phase C is underway but not finished
- `09 Repo Layout and Module Boundaries`: mostly complete at the seam level; remaining gap is deeper runtime backend consolidation rather than route/service wrapper cleanup

## Unified Final Step

All meaningful remaining work should now be treated as one unified step:

**Target-State Convergence**

This step covers the remaining cross-cutting gap between the current-compatible implementation and the target architecture:

- Turn the Rust daemon from a verified prototype into a stable long-running local runtime/session-bridge surface
- Promote typed bridge flows from “discoverable and executable” into the default managed execution/control path
- Converge review, compare, output, transport, snapshot, contract, and observability signals into a single consistent node/project triage model
- Finish the runtime boundary needed for stronger container/isolation backends without re-breaking current workbench flows

### Practical meaning

From this point on, remaining work should not be tracked as many unrelated small slices.

It should be judged by one question:

**Can the system now operate as a unified runtime + bridge + review control surface, rather than a collection of compatible current-state seams?**
