# Client Device Project Location Design
**Date:** 2026-03-05
**Approach:** C — Hybrid client location (`agent` + `browser`)

---

## Overview

Extend the "Create New Project" flow so a project can live on the end user's own device, not only on the backend host or an SSH server.

The new option is a third location type:

- `Local backend host`
- `SSH server`
- `Local client device`

`Local client device` supports two connection modes:

- `Desktop agent` for full command execution, git initialization, path checks, and deploy/install workflows
- `Browser file access` for folder-backed local workspaces using the File System Access API, with explicit capability limits

---

## Section 1 — UX Model

The current modal conflates "local" with the backend host or FRP-connected executor. This change makes the execution target explicit.

### Create Project modal changes

When `Local client device` is selected, show a second control:

- `Desktop agent`
- `Browser file access`

Behavior by mode:

### `Desktop agent`

- User selects a registered client device
- User enters a filesystem path on that device
- `Check Path` runs against that device
- Project creation ensures the path exists and can initialize git there

### `Browser file access`

- User links a local folder using the browser
- The UI stores the actual directory handle in browser storage
- The backend stores metadata and a stable workspace key, not the raw browser handle
- The modal explains that this mode supports local files but not unattended execution

Existing `Local backend host` and `SSH server` flows remain unchanged.

---

## Section 2 — Data Model

Project records need enough structure to distinguish storage location from execution capability.

### New and updated fields

- `locationType`: `local | ssh | client`
- `clientMode`: nullable, `agent | browser`
- `clientDeviceId`: nullable, required for `client + agent`
- `projectPath`: required for `local`, `ssh`, and `client + agent`
- `clientWorkspaceId`: nullable, required for `client + browser`
- `capabilities`: derived, not user-authored

### Capability flags

The UI and backend should derive capability flags from project location:

- `canExecute`
- `canGitInit`
- `canBackgroundRun`
- `canDeployLocal`
- `requiresBrowserWorkspaceLink`

These flags prevent silent fallback to backend execution when the user selected the client device intentionally.

---

## Section 3 — Execution Model

The system currently has two execution domains:

- backend-local (`local-default`)
- SSH (`serverId`)

This design adds a third domain: client device.

### `client + agent`

Treat the client device as a routable execution target backed by an existing ResearchOps daemon:

- device registration and heartbeat already exist through daemon APIs
- project creation stores `clientDeviceId`
- path checks, git init, deploy/install, and agent runs route through that device
- the backend never rewrites this to `local-default`

This is the only client mode that supports full "install/deploy on local device" behavior.

### `client + browser`

Treat this as a browser-owned workspace:

- folder permission is granted by the user in the browser
- the backend stores only metadata and a stable `clientWorkspaceId`
- the browser stores the actual `FileSystemDirectoryHandle` in IndexedDB/local storage

Supported:

- create/edit files through browser-mediated flows
- export/sync artifacts
- manual packaging or copy-out flows

Unsupported:

- unattended shell execution
- background agent runs
- backend-side git initialization unless an explicit client bridge is added later

### Failure handling

- Offline client agent: disable `client + agent` project creation and show device status
- Lost browser permission: keep the project visible but require re-linking the folder
- Execution-only actions on browser-backed projects: fail fast with capability errors

---

## Section 4 — API Changes

### `POST /researchops/projects`

Accept a third location type:

- `locationType = client`

Validation rules:

- `client + agent` requires `clientMode`, `clientDeviceId`, `projectPath`
- `client + browser` requires `clientMode`, `clientWorkspaceId`, and browser workspace metadata
- reject mixed payloads such as `client + browser` plus `serverId`

### `POST /researchops/projects/path-check`

Behavior by location:

- `local`: current backend/local-executor behavior
- `ssh`: current SSH behavior
- `client + agent`: run remote path check through the client device
- `client + browser`: validate in the frontend after folder selection; backend does not own the handle

### Project reads

Project responses should include derived capabilities so the frontend can disable unsupported actions without duplicating routing logic.

---

## Section 5 — Backend Integration Points

The existing code assumes:

- `local` means backend-local
- `ssh` means a registered SSH host

That assumption appears in project creation, path checks, run dispatch, workspace preparation, and UI helper text.

### Primary backend changes

- `backend/src/services/researchops/store.js`
  - extend project validation and persistence for `client`
- `backend/src/routes/researchops/projects.js`
  - accept and validate `client` payloads
  - route `client + agent` path checks through a daemon-backed execution path
  - return capability metadata
- `backend/src/services/researchops/orchestrator.js`
  - treat `client + agent` as a third execution target
  - reject `client + browser` for git-managed execution with explicit capability errors
- `backend/src/routes/researchops/runs.js`
  - enforce capability checks before run dispatch

### Existing daemon model reuse

The project already has daemon registration and heartbeat support. Reusing that model for client devices avoids inventing a parallel "device" abstraction.

---

## Section 6 — Frontend Integration Points

### `VibeResearcherPanel`

Update the create-project modal to support:

- third location option
- mode-specific controls
- helper text that distinguishes backend-local from client-local
- client-agent device picker
- browser folder link flow

### Browser workspace registry

Browser-backed workspaces cannot store the raw directory handle on the server. The frontend needs a browser-local registry keyed by backend workspace id.

Recommended approach:

- create a small IndexedDB-backed helper similar to `useAiNotesSettings`
- store `FileSystemDirectoryHandle` by `clientWorkspaceId`
- keep lightweight display metadata in the backend project record

### Capability-driven UI

Actions that require execution should check backend-derived capability flags and explain why they are unavailable for browser-backed projects.

---

## Section 7 — Testing Strategy

### Backend

- validation matrix for all location variants
- path-check behavior for `local`, `ssh`, `client + agent`
- explicit capability errors for `client + browser`

### Frontend

- modal state transitions and required-field validation
- payload construction for `client + agent` and `client + browser`
- browser workspace linking and re-link prompts
- disabled run/deploy actions for browser-backed projects

Because the repo currently has little or no formal coverage around this flow, the implementation should add test scaffolding where needed instead of relying only on manual checks.

---

## Section 8 — Rollout Notes

- Ship schema and API support first
- Expose client-agent only when a daemon is online
- Mark browser-backed projects as limited wherever run/deploy actions appear
- Do not silently fall back from client-device execution to backend execution

---

## Out of Scope

- Multi-device browser workspace sync
- Persisting raw browser file handles on the backend
- Full shell execution for `client + browser`
- Auto-migration of existing `local` projects to `client`
