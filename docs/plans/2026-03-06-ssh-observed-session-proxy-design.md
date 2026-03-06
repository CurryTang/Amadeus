# SSH Observed Session Proxy Design

## Context

The current observed-session pipeline already exists in the product UI and backend, but it only watches Claude Code and Codex session files on the backend process machine itself.

That is the wrong place for SSH-hosted projects.

For SSH projects, arbitrary Claude/Codex CLI sessions run on the SSH target host, not on the backend box. The current watcher therefore cannot see them, even though the workspace now has a place to render observed sessions.

## Goal

Show arbitrary Claude Code and Codex CLI sessions in the project workspace for SSH-hosted projects, but only when those sessions belong to the exact project root.

## Approved Direction

Use a lightweight observer worker on each SSH host.

- The worker runs near the real Claude/Codex session files.
- It incrementally indexes changed session files into compact summaries.
- It stores those summaries locally on the SSH host.
- The backend queries that worker over SSH through a narrow CLI surface.
- The backend keeps the existing observed-session classification and detached-node materialization flow.

## Why This Direction

This meets the two hard requirements:

1. It supports arbitrary direct CLI sessions, not just sessions launched through our product.
2. It stays efficient because discovery, parsing, and filtering happen on the SSH host where the files already live.

This avoids repeated backend-side SSH rescans of large JSONL trees and avoids requiring users to change how they launch Claude/Codex.

## Worker Responsibilities

The SSH-host worker watches:

- `~/.claude/projects/**.jsonl`
- `~/.codex/sessions/**/*.jsonl`

For each changed session file, it maintains a compact record with:

- `provider`
- `session_id`
- `session_file`
- `cwd`
- `git_root`
- `title`
- `prompt_digest`
- `latest_progress_digest`
- `status`
- `started_at`
- `updated_at`
- `last_size`
- `last_mtime`
- `content_hash` or equivalent rolling fingerprint

The worker persists those records locally in a small SQLite database and maintains an efficient lookup path by exact `git_root`.

## Backend Proxy Model

For SSH projects, the backend no longer tries to discover observed sessions by reading local session files.

Instead it:

1. resolves the project SSH server and exact project path
2. runs a small SSH command against the observer worker on that host
3. receives already-filtered, compact session summaries
4. feeds those summaries into the existing observed-session classification and materialization logic

For local projects, the current local watcher path can remain as the fallback.

## Transport Model

Do not expose a public observer port.

Use a host-local CLI entrypoint, for example:

- `researchops-agent-observer list --git-root /path/to/openrfm --json`
- `researchops-agent-observer get --session-id <id> --json`
- `researchops-agent-observer excerpt --session-id <id> --limit 120`

The backend uses SSH as the control-plane transport to invoke those commands.

This keeps the security surface small while still behaving like a proxy from the product’s perspective.

## Worker Execution Model

Install a small observer package on the SSH host with:

- a runtime script
- a local SQLite DB under `~/.researchops/agent-session-observer/`
- a periodic runner, preferably `systemd --user`
- a tmux/nohup fallback when `systemd --user` is unavailable

The worker runs periodically, for example every 20-30 seconds.

Each tick:

- discovers recently changed Claude/Codex session files
- updates records only for files whose `mtime/size` changed
- reuses cached `git_root` resolution
- updates the `git_root -> session ids` index

The worker does not push updates to the backend.

## Efficiency Rules

- No full rescans of unchanged files
- No full transcript transfer to the backend for list views
- No backend-side parsing of raw SSH-host session trees
- Bounded excerpt reads only for explicit detail/refresh paths
- Exact `git_root` filtering on the SSH host before data crosses SSH

## Backend API Behavior

### List

`GET /researchops/projects/:projectId/observed-sessions`

For SSH projects:

- proxy to worker `list --git-root <projectPath>`
- receive compact summaries
- classify/materialize as needed
- return existing observed-session API shape to the frontend

### Detail / Refresh

`GET /researchops/projects/:projectId/observed-sessions/:sessionId`

`POST /researchops/projects/:projectId/observed-sessions/:sessionId/refresh`

For SSH projects:

- fetch the compact record by `session_id`
- optionally fetch a bounded excerpt
- rerun existing classification/materialization flow

## UI Behavior

No structural UI redesign is required for this change.

The existing activity panel can keep showing `Session` cards. A later polish pass can add a small source hint such as `SSH observed`, but that should not block the architecture.

## Non-Goals

- No forced wrapper-only launch path
- No public observer daemon port
- No backend-side live streaming of raw remote session files
- No control plane for cancelling or steering arbitrary external sessions

## Result

This architecture makes observed sessions visible where they actually happen: on the SSH target host.

It also keeps the expensive work local to that host, which is the only efficient way to support arbitrary CLI sessions at scale.
