---
name: sync-workspace
description: Sync local and remote project files bidirectionally. Handles code, resources, papers, and experiment outputs. Use when user says "sync", "push files", "pull files", "upload code", "download results".
argument-hint: [direction: push|pull|both] [paths...]
allowed-tools: Bash(*), Read, Glob, Grep, Write, Agent
---

# Sync Workspace

Instruction: $ARGUMENTS

## Overview

Synchronize project files between the local client workspace and the remote
ARIS target server. Supports selective sync of code, resources, papers, and
experiment outputs with conflict detection.

## Sync Directions

- **push** — Local to remote (upload code changes, new resources, paper drafts)
- **pull** — Remote to local (download experiment outputs, updated papers, logs)
- **both** — Bidirectional sync (push then pull, with conflict detection)

If no direction is specified, default to **both**.

## Sync Categories

Files are organized into sync categories. Each can be synced independently:

| Category     | Local Path        | Remote Path       | Default Direction |
|-------------|-------------------|-------------------|-------------------|
| **code**    | `main/`, `scripts/` | `main/`, `scripts/` | push             |
| **resource** | `resource/`       | `resource/`       | push              |
| **papers**  | `papers/`         | `papers/`         | both              |
| **outputs** | `outputs/`        | `outputs/`        | pull              |
| **config**  | `pixi.toml`, `.gitignore` | same     | push              |

## Workflow

### Step 1: Determine sync parameters

Parse $ARGUMENTS for:
- Direction override (push / pull / both)
- Specific categories or paths to sync
- Dry-run flag (--dry-run)

If no arguments, sync all categories in their default direction.

### Step 2: Verify connectivity

Test SSH connection to the target server before starting sync.

### Step 3: Detect workspace paths

- Local workspace path: from the ARIS project's `localProjectPath`
- Remote workspace path: from the active target's `remoteProjectPath`

If paths are not set, report the error and stop.

### Step 4: Execute sync

#### Push (local → remote): use rsync

```bash
rsync -avz --progress \
  --exclude='.pixi/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.git/' \
  --exclude='outputs/' \
  --exclude='checkpoints/' \
  <local_path>/ <user>@<host>:<remote_path>/
```

#### Pull (remote → local): use git push + pull

Instead of rsync, use Git to transfer files from remote to local. This lets
`.gitignore` filter out large/unnecessary files (datasets, checkpoints, caches,
virtual environments, etc.) automatically.

1. **On the remote server** (via SSH), commit and push any uncommitted work:
   ```bash
   ssh <user>@<host> "cd <remote_path> && \
     git add -A && \
     git diff --cached --quiet || git commit -m 'sync: remote changes' && \
     git push origin HEAD"
   ```
   - If there's no git remote configured, fall back to rsync for that category.
   - Use the current branch (whatever branch is checked out on remote).

2. **On local**, pull from the same branch:
   ```bash
   cd <local_path>
   git fetch origin
   git pull origin <branch> --no-rebase
   ```
   - If there are merge conflicts, report them and stop (don't auto-resolve).

3. **For files that are git-ignored but still needed** (like specific outputs the
   user explicitly requested), fall back to rsync for just those paths.

#### Both direction: push first, then pull

When syncing both directions:
1. First push local→remote via rsync (code, resources, config)
2. Then pull remote→local via git push+pull (outputs, papers)

Respect the project's `syncExcludes` patterns from the ARIS project settings.

### Step 5: Report results

For each category, report:
- Number of files transferred
- Total bytes transferred
- Any errors or skipped files
- Conflicts detected (files modified on both sides)
- Which method was used (rsync vs git)

## Key Rules

- Never sync `.git/` directories via rsync — they diverge between local and remote.
- Always respect project `syncExcludes` from ARIS settings.
- For `--dry-run`, show what would be transferred without actually transferring.
  For git pull, use `git fetch` + `git diff --stat` to preview.
- Large binary files (>100MB) should be flagged with a warning before transfer.
- Outputs are pull-only by default to avoid overwriting experiment results.
- If pixi.lock exists remotely but not locally (or vice versa), sync it in the
  direction where it exists to keep environments reproducible.
- Prefer git for pull direction — `.gitignore` prevents transferring unnecessary
  files like datasets, checkpoints, `__pycache__/`, `.pixi/`, `.venv/`, etc.
- If git is not initialized on the remote, fall back to rsync with excludes.
