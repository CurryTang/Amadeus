# SSH Transport Design

## Goal

Create one clean, robust SSH transport layer for the backend so every module uses the same connection setup, execution semantics, file transfer behavior, and error handling.

## Current Problem

SSH behavior is duplicated across multiple modules:

- `backend/src/services/ssh-auth.service.js`
- `backend/src/routes/ssh-servers.js`
- `backend/src/routes/researchops/projects.js`
- `backend/src/services/researchops/modules/bash-run.module.js`
- `backend/src/services/researchops/modules/agent-run.module.js`
- `backend/src/routes/documents.js`
- other scattered SSH/ProxyJump helpers

This creates drift. One path gets fixed, another still uses stale quoting, stale timeout defaults, or a different jump-host strategy.

## Chosen Approach

Build a single low-level transport service:

- `backend/src/services/ssh-transport.service.js`

It will own:

- SSH argument construction
- SCP argument construction
- shell quoting
- `ProxyJump` / proxy-command fallback
- key precedence
- `exec(...)`
- `script(...)`
- `copyTo(...)`
- `copyFrom(...)`
- timeout handling
- normalized SSH error classification

Existing callers will migrate onto this service. Compatibility wrappers may remain temporarily where that keeps the migration low-risk, but the transport service becomes the one implementation.

## API Shape

Primary exports:

- `buildSshArgs(server, options?)`
- `buildScpArgs(server, options?)`
- `resolveTargetKeyPaths(server)`
- `exec(server, remoteArgs, options?)`
- `script(server, scriptText, scriptArgs?, options?)`
- `copyTo(server, localPath, remotePath, options?)`
- `copyFrom(server, remotePath, localPath, options?)`
- `classifyError(error)`

Options should stay narrow and predictable:

- `connectTimeout`
- `timeoutMs`
- `strictHostKeyChecking`
- `targetKeyPath`
- `input`
- optional process `env`

## Migration Plan

Phase 1:

- Add transport tests first.
- Implement `ssh-transport.service.js`.
- Re-export existing `ssh-auth.service.js` helpers from the transport to avoid breaking imports immediately.

Phase 2:

- Migrate direct SSH execution in `ssh-servers.js` to transport calls.
- Migrate ResearchOps callers that currently assemble SSH commands or script wrappers.
- Migrate legacy `documents.js` paths.

Phase 3:

- Remove duplicated helper implementations once all callers are on the shared service.

## Non-Goals

- Do not add connection pooling or ControlMaster in this pass.
- Do not redesign all remote filesystem workflows.
- Do not change user-facing SSH server configuration formats.

## Expected Benefit

- One fix applies everywhere.
- Lower risk when adding new SSH-backed features.
- Clearer errors for auth, timeout, and host reachability failures.
- Less route-specific shell glue.
