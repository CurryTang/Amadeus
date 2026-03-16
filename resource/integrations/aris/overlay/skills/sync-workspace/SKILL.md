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

For each category, use rsync over SSH:

```bash
# Push (local → remote)
rsync -avz --progress \
  --exclude='.pixi/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.git/' \
  --exclude='outputs/' \
  --exclude='checkpoints/' \
  <local_path>/ <user>@<host>:<remote_path>/

# Pull (remote → local)
rsync -avz --progress \
  --exclude='.pixi/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.git/' \
  <user>@<host>:<remote_path>/ <local_path>/
```

Respect the project's `syncExcludes` patterns from the ARIS project settings.

### Step 5: Report results

For each category, report:
- Number of files transferred
- Total bytes transferred
- Any errors or skipped files
- Conflicts detected (files modified on both sides)

## Key Rules

- Never sync `.git/` directories — they diverge between local and remote.
- Always respect project `syncExcludes` from ARIS settings.
- For `--dry-run`, show what would be transferred without actually transferring.
- Large binary files (>100MB) should be flagged with a warning before transfer.
- Outputs are pull-only by default to avoid overwriting experiment results.
- If pixi.lock exists remotely but not locally (or vice versa), sync it in the
  direction where it exists to keep environments reproducible.
