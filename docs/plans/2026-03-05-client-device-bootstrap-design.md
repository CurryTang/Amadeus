# Client Device Bootstrap Design
**Date:** 2026-03-05
**Approach:** C — Hybrid inline bootstrap (`Connect this device` now, downloadable installers later)

---

## Overview

Add an inline `Connect this device` flow to the "Create New Project" modal when the user selects:

- `Local client device`
- `Desktop agent`

The browser cannot directly install or start a native background process on a client machine. The design therefore uses an inline bootstrap flow that mints a short-lived bootstrap token, renders a local install command and bootstrap file, and lets the already-supported client processing runtime register itself automatically.

This keeps setup in the modal while preserving a realistic trust boundary:

- the browser coordinates setup
- the client machine runs one bootstrap command once
- the existing `processing-server.js` becomes the durable always-on runtime

---

## Section 1 — UX Model

### Modal behavior

When `Local client device` and `Desktop agent` are selected:

- if at least one online client device exists:
  - show the current device picker
  - show a secondary `Connect this device` action
- if no client devices are online:
  - show the inline bootstrap panel by default

### Bootstrap panel

The panel stays inside the existing create-project modal and includes:

- `Device name` input
- short-lived bootstrap token status
- `Copy install command`
- `Download bootstrap file`
- `Refresh device status`
- helper copy that explains one local command is required the first time

### State model

The frontend should treat the panel as a finite-state flow:

- `idle`
- `bootstrapping`
- `waiting-for-device`
- `connected`
- `expired`

Once a device comes online, the modal auto-selects it and returns to the standard `Check Path` and `Create Project` flow.

---

## Section 2 — Bootstrap Mechanics

### Why bootstrap tokens

The existing daemon registration route assumes the client already has a trusted backend credential. That is not true for first-time device setup from the browser. A bootstrap token bridges that first-run gap without turning the browser into a privileged installer.

### Token lifecycle

Each bootstrap token is tied to:

- `userId`
- optional `requestedHostname`
- optional `requestedPlatform`
- `expiresAt`
- `status`
- `redeemedAt`
- `redeemedServerId`

Rules:

- short lifetime
- single redemption
- never reused as a steady-state credential

### Registration flow

1. Frontend requests a bootstrap token for the current user.
2. Frontend renders:
   - shell install command
   - downloadable bootstrap config file
3. User runs the command locally.
4. Local bootstrap script writes config for the existing processing runtime.
5. `processing-server.js` starts and automatically launches the ResearchOps client daemon.
6. The daemon redeems the bootstrap token during registration.
7. Backend registers the daemon and marks the token redeemed.
8. Frontend polling sees the device online and auto-selects it.

This design uses the existing client processing runtime as the long-lived local service. It does not create a separate competing daemon stack.

---

## Section 3 — Backend Changes

### Store model

Persist bootstrap tokens in the ResearchOps store with:

- `id`
- `userId`
- `tokenHash`
- `requestedHostname`
- `requestedPlatform`
- `status`
- `expiresAt`
- `redeemedAt`
- `redeemedServerId`
- `createdAt`
- `updatedAt`

Status values:

- `PENDING`
- `REDEEMED`
- `EXPIRED`
- `CANCELLED`

### Route surface

Add backend support for:

- `POST /researchops/daemons/bootstrap`
  - mint token and return install metadata
- `GET /researchops/daemons/bootstrap/:id`
  - inspect token state for frontend polling
- bootstrap-aware daemon registration
  - either extend `/researchops/daemons/register`
  - or add a dedicated `/researchops/daemons/bootstrap/redeem`

The backend must reject:

- expired tokens
- already redeemed tokens
- malformed token ids/secrets
- cross-user token use

### Output for frontend

Bootstrap creation should return enough metadata for the modal without leaking secrets after the first response:

- `bootstrapId`
- raw one-time token secret
- `expiresAt`
- normalized API base URL
- generated shell command
- generated config payload for file download

Subsequent status checks should not return the secret again.

---

## Section 4 — Client Runtime Changes

### Daemon registration

Extend the ResearchOps client daemon runtime to support:

- bearer-token registration for already-trusted environments
- bootstrap-token redemption for first-time device setup

Once registration succeeds, the daemon continues using the existing daemon identity and heartbeat/task flow.

### Bootstrap script

Add a small bootstrap script that:

- accepts bootstrap token / API URL / optional device name
- writes config or env file locally
- starts or restarts `processing-server.js`
- optionally prepares launch-at-login for supported platforms

First version scope:

- macOS/Linux shell bootstrap
- no native GUI installer packaging yet

The earlier automatic startup integration in `processing-server.js` remains the durable mechanism. The bootstrap script only gets the client into that state.

---

## Section 5 — Frontend Changes

### Create-project modal

In the current modal:

- keep the existing device picker for already-connected machines
- add `Connect this device`
- show inline bootstrap UI when requested or when no devices are online

### Polling and matching

After token creation, the modal should:

- poll bootstrap status
- poll the client device list
- auto-select the newly connected device when either:
  - the redeemed daemon id is known, or
  - hostname matches the requested device name closely enough

### Failure handling

The UI should clearly distinguish:

- token expired before redemption
- bootstrap command not yet run
- device connected but offline
- registration failed due to invalid token

The modal should allow retry without losing the project draft.

---

## Section 6 — Security Model

The bootstrap token is an enrollment token, not a long-lived daemon credential.

Requirements:

- store only a hash server-side
- expire aggressively
- redeem once
- bind the redeemed daemon to the token’s user
- do not expose bootstrap secrets in follow-up reads or logs

The browser should never receive any credential with broader authority than “allow one device enrollment for this user.”

---

## Section 7 — Testing Strategy

### Backend

- bootstrap token creation
- token hashing and lookup
- expiry enforcement
- single redemption enforcement
- successful daemon registration through bootstrap token
- automatic selection of the redeemed server id in project creation paths

### Frontend

- modal state transitions for bootstrap panel
- install command rendering
- polling behavior
- auto-selection once device appears
- token expiry and retry UX

### Smoke verification

- start from no connected client devices
- open create-project modal
- create bootstrap token
- run bootstrap command on a local machine
- verify device appears online
- create a client-device project
- verify `Check Path` runs through daemon RPC on the connected client

---

## Recommendation

Ship the inline bootstrap flow first and keep it deliberately shell-script based. That solves the actual onboarding gap now without pretending the browser can install native software. The same modal states and backend token model can later support downloadable native installers without reworking the architecture.
