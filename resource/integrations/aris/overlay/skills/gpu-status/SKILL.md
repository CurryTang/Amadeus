---
name: gpu-status
description: Show GPU availability across all SSH servers listed in this project's CLAUDE.md. Use when user says "check GPUs", "which GPUs are free", "gpu status", "GPU 状态", or needs to know where to run experiments.
argument-hint: "optional: server name to filter"
---

# GPU Status

Check GPU availability: $ARGUMENTS

## Workflow

### Step 1: Read Servers from Local CLAUDE.md

Read the project's `CLAUDE.md` file in the workspace root. Find the `## Remote Server` section inside the `<!-- AUTO_RESEARCHER_ARIS START -->` managed block. Each server appears as:

```
### server-name

- SSH: `ssh [-J proxy] user@host`
- SSH key: `path/to/key` (optional)
- Remote project path: `/path/to/project`
- ...
```

Parse each `### <name>` subsection under `## Remote Server`:
- Extract the SSH command from the `- SSH: \`...\`` line
- Extract the SSH key from `- SSH key: \`...\`` line (if present)
- Extract remote project path from `- Remote project path: \`...\`` line

If `$ARGUMENTS` names a specific server, filter to only that server.

If no `## Remote Server` section is found or it has no `###` entries, tell the user:
> No remote servers found in CLAUDE.md. Add SSH server targets to this project in the ARIS workspace.

### Step 2: Query Each Server

For each server, run `nvidia-smi` via SSH:

```bash
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    [-J <proxyJump>] [-i <sshKeyPath>] \
    <user>@<host> \
    "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader" 2>&1
```

The SSH command components come directly from the CLAUDE.md `SSH:` line. Parse it:
- `ssh user@host` → user, host (no proxy)
- `ssh -J proxy user@host` → user, host, proxyJump
- `ssh -p PORT user@host` → user, host, port

If `nvidia-smi` is not found, try `/usr/bin/nvidia-smi`.
If the server is unreachable or has no GPUs, note it and move on.

**Query all servers in parallel** (use multiple tool calls in one message).

### Step 3: Determine Availability

A GPU is **free** if:
- `memory.used < 500 MiB` — completely idle
- `memory.used < 2000 MiB` AND `utilization.gpu < 10%` — likely idle (small framework overhead)

A GPU is **partially available** if:
- Used memory is less than 50% of total memory

A GPU is **busy** if:
- Used memory exceeds 50% of total memory

### Step 4: Present Results

Display a table per server:

```
### papermachine.egr.msu.edu

| GPU | Model       | VRAM Used   | VRAM Total | Util % | Temp | Status    |
|-----|-------------|-------------|------------|--------|------|-----------|
| 0   | RTX A5000   | 234 MiB     | 24564 MiB  | 0%     | 32C  | Free      |
| 1   | RTX A5000   | 22100 MiB   | 24564 MiB  | 87%    | 71C  | Busy      |
| ...                                                                       |
```

Then a summary:

```
### Summary

- papermachine: 5 free, 1 partial, 2 busy (8 GPUs)
- chatdse:      4 free, 0 partial, 0 busy (4 GPUs)
- ...
Total free GPUs: 28
```

### Step 5: Recommend

Based on availability:
- If user mentioned a specific workload, suggest which server + GPU(s) to use
- Prefer servers with the most contiguous free GPUs for multi-GPU jobs
- Prefer GPUs with lower temperature (cooler = less thermal throttling risk)
- Note any servers that were unreachable

## Key Rules

- Never modify anything on the servers — this skill is read-only
- If SSH times out after 10 seconds, mark server as unreachable and continue
- Query all servers in parallel when possible (use multiple tool calls)
- The source of truth is the local CLAUDE.md — do NOT call any API endpoints
