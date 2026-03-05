# Observed Agent Session Sync Design

## Context

The codebase already has a filesystem watcher in [backend/src/services/agent-session-watcher.service.js](/Users/czk/auto-researcher/backend/src/services/agent-session-watcher.service.js) that parses local Claude Code and Codex session files into run-like records. That watcher is backend-only today.

The current Vibe workspace renders only:

- persisted managed runs from [backend/src/routes/researchops/runs.js](/Users/czk/auto-researcher/backend/src/routes/researchops/runs.js)
- tree plan and tree state from [backend/src/routes/researchops/projects.js](/Users/czk/auto-researcher/backend/src/routes/researchops/projects.js)
- runner and tree surfaces in [frontend/src/components/VibeResearcherPanel.jsx](/Users/czk/auto-researcher/frontend/src/components/VibeResearcherPanel.jsx)

This leaves an important gap: users may run Claude or Codex directly on the shared server filesystem instead of launching through the product, but those sessions are not visible in the runner area or tree.

The requested behavior is:

- treat direct Claude/Codex server sessions as passive observed sessions
- detect them from the shared filesystem on one server
- run a lightweight classifier to decide whether a session is a concrete coding/research task
- auto-create detached tree nodes only for qualifying sessions
- show observed sessions in the runner area with running state and content digest
- refresh detached nodes and observed-session cards on demand rather than continuously syncing them

## Goals

- Expose direct Claude/Codex sessions as project-scoped observed sessions.
- Keep observed sessions distinct from managed runs.
- Show observed sessions in the runner area with clear provider and running status.
- Auto-materialize qualifying sessions into detached tree nodes.
- Require a concrete coding or research task before node creation.
- Refresh from the session file only when the user asks.
- Reuse the current tree plan and tree state model instead of creating a parallel planner.

## Non-Goals

- No attempt to cancel, retry, or control sessions not launched by the product.
- No automatic streaming or live binding from a detached node to its underlying session.
- No support for arbitrary external machines in `v1`.
- No auto-connecting observed nodes into the existing tree graph.
- No forced ingestion of observed sessions into the managed run store.
- No deletion of detached nodes when the source session changes or disappears.

## Recommended Approach

Use an observed-session overlay layered on top of the current run and tree model.

This means:

- the existing filesystem watcher remains the low-level discovery mechanism
- a new researchops service converts watcher output into cached observed-session digests
- a lightweight classifier decides whether a changed session can become a node
- qualifying sessions are materialized into detached tree nodes through the existing plan patch flow
- observed sessions are rendered in the runner area, but remain labeled as external and unmanaged

This is the lowest-risk path because it preserves the distinction between observed and managed execution while reusing the current planner, state, and UI surfaces.

## Architecture

### 1. Detect

Extend the current watcher-based discovery path to operate as the source of truth for session file metadata on the shared server filesystem.

Input sources:

- Claude Code JSONL session files under `~/.claude/projects/...`
- Codex JSONL session files under `~/.codex/sessions/...`

For each discovered session, normalize:

- provider
- session id
- session file path
- cwd and resolved git root
- prompt title
- started/updated timestamps
- status inferred from recent file modification

The watcher should continue to discover sessions broadly, but project-scoped views should filter by exact git root match.

### 2. Digest

For each project-scoped observed session, compute a compact cached digest so the UI can render quickly without rereading the full JSONL file every time.

The digest should include:

- title
- prompt digest
- latest progress digest
- message count
- tool call count
- touched files summary when available
- provider
- status
- startedAt and updatedAt
- current content hash

The digest should be stored under `.researchops/cache/observed-sessions/` inside the project cache area.

### 3. Classify

A lightweight classifier agent reads only the cached digest plus a bounded excerpt from the session file when needed.

Classifier output:

- `ignore`
- `candidate`
- `can_be_node`

Qualification rule:

- the session must describe a concrete coding or research task with a reasonably identifiable goal

Disqualifying examples:

- open-ended chat
- vague brainstorming with no concrete deliverable
- meta conversation about tools without a project task

The classifier should also emit:

- `taskType`
- `goalSummary`
- `confidence`
- `reason`

### 4. Materialize

Only `can_be_node` sessions become detached tree nodes.

Detached nodes should be written into the normal plan model rather than a separate tree overlay. This keeps layout, selection, and drag-connect behavior inside the existing tree canvas.

Materialization rules:

- create a node only once per observed session
- no parent
- no evidence deps
- distinct `kind`
- explicit origin metadata

### 5. Refresh On Demand

Observed sessions and detached nodes do not live-update automatically in `v1`.

Refresh behavior:

- user triggers refresh from observed-session UI or node UI
- backend checks current session file hash
- if unchanged, return cached digest immediately
- if changed, rebuild digest and rerun classification if needed
- if the session already has a detached node, update only the safe summary fields on that node

This keeps the product responsive while avoiding noisy automatic tree mutations.

## Scope Assumptions

`v1` assumes:

- one shared server filesystem
- Claude and Codex session files are readable from the same machine that hosts the ResearchOps backend or its effective filesystem view
- git-root matching is enough to map an observed session to the correct project

The design does not require arbitrary remote agents or new daemon registration.

## Data Model

### Observed Session Cache Record

Store one cache record per observed session under a stable key derived from:

- provider
- normalized session file path

Recommended fields:

- `id`
- `provider`
- `sessionId`
- `sessionFile`
- `cwd`
- `gitRoot`
- `title`
- `promptDigest`
- `latestProgressDigest`
- `messageCount`
- `toolCallCount`
- `touchedFiles`
- `status`
- `startedAt`
- `updatedAt`
- `lastSeenAt`
- `contentHash`
- `lastClassifiedHash`
- `classification`

### Classification Payload

Recommended nested shape:

- `decision`
- `taskType`
- `goalSummary`
- `confidence`
- `reason`
- `classifiedAt`

### Detached Tree Node

Represent qualifying sessions as normal plan nodes with explicit origin metadata:

- `kind: observed_agent`
- `title: <goal summary>`
- `target: [<goal summary>]`
- `tags: ['observed', 'external', <provider>]`
- `ui.detached = true`
- `resources.observedSession = { sessionId, provider, sessionFile, contentHash, classifiedAt }`

No parent or dependencies are created automatically.

### Tree State

Tree state should not attempt to mirror managed run semantics. For detached observed nodes, keep status lightweight:

- `RUNNING` when the last refresh sees recent file activity
- `SUCCEEDED` or `IDLE` equivalent status after activity stops
- `STALE` when the source session is unavailable or the cache is outdated

If current tree status enums require compatibility, use the nearest existing values and surface the richer observed-session meaning in node metadata instead of inventing a separate state machine.

## API Design

Add project-scoped read and refresh endpoints:

- `GET /researchops/projects/:projectId/observed-sessions`
- `GET /researchops/projects/:projectId/observed-sessions/:sessionId`
- `POST /researchops/projects/:projectId/observed-sessions/:sessionId/refresh`

List response should return:

- observed-session cards for the runner area
- whether a detached node exists
- detached node id when present

Refresh response should return:

- current digest
- previous and current content hash
- classification result
- detached node info when applicable
- whether the node was created, updated, or left unchanged

Existing tree plan and state APIs remain authoritative for tree rendering.

## UI Design

### Runner Area

Add observed sessions into the runner area as a clearly labeled secondary class of cards.

Each card should show:

- provider badge
- observed badge
- running indicator
- goal summary or prompt title
- short progress digest
- updated timestamp

These cards must not imply control actions such as cancel or retry.

### Tree Area

Auto-created detached nodes should appear in the main tree canvas with a visibly different treatment from planned nodes.

Recommended cues:

- `OBSERVED_AGENT` kind label
- `external` tag
- detached styling

They should remain draggable and connectable by the user, but start with no edges.

### Node Workbench

The node workbench should show:

- origin provider
- session source path
- cached goal summary
- last refresh time
- refresh button

It should not expose run-event streaming because the node is not backed by a managed run.

## Materialization Rules

- Create at most one detached node per observed session.
- Never overwrite user-authored parent or dependency links during refresh.
- Update only safe fields on refresh:
  - title
  - summary/target text
  - provider/status metadata
  - cached hash/classification metadata
- If the user manually edits the observed node title or structure, prefer preserving user graph edits and updating only origin metadata plus refresh timestamps.

## Failure Handling

If discovery fails:

- keep cached observed-session records
- mark the source stale
- do not break normal project, tree, or run loading

If classification fails:

- keep the observed session visible in the runner area
- mark it `needs_review`
- do not auto-create a node

If the session file disappears:

- keep the detached node
- mark the source unavailable or stale
- never auto-delete the node

If node materialization conflicts with current plan edits:

- do not overwrite user changes
- return a refresh conflict result
- allow manual follow-up rather than forcing reconciliation

## Verification Strategy

### Backend

Add tests for:

- watcher normalization and project scoping
- digest hashing and cache reuse
- classifier gating into `can_be_node`
- one-time node materialization
- refresh when hash changes versus unchanged hash
- stale/unavailable source handling

### API

Add route tests for:

- list observed sessions
- fetch one observed session
- refresh an observed session into a new detached node
- refresh an observed session with no file change

### Frontend

Add tests for:

- observed-session card rendering and labeling
- runner presentation separation between managed runs and observed sessions
- detached observed node rendering in the tree
- node refresh interaction and updated digest display

## Rollout Plan

### Phase 1

- expose observed sessions through backend APIs
- render them in the runner area
- no tree materialization yet

### Phase 2

- enable classifier and detached node materialization
- show detached observed nodes in the tree

### Phase 3

- add refresh UI and conflict/stale handling polish

This phased rollout keeps the first delivery useful even before detached-node behavior is complete.
