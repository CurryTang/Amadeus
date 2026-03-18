---
name: gpu-status
description: Show GPU availability across all SSH servers listed in this project's CLAUDE.md. Use when user says "check GPUs", "which GPUs are free", "gpu status", "GPU 状态", or needs to know where to run experiments.
argument-hint: "optional: server name to filter"
---

# GPU Status

Check GPU availability: $ARGUMENTS

## Workflow

### Step 1: Read Servers from `.aris/project.json`

Read the project config file:

```bash
cat .aris/project.json
```

This is a structured JSON file with all server details:
```json
{
  "projectId": "...",
  "servers": [
    {
      "name": "papermachine.egr.msu.edu",
      "ssh": "ssh -J chenzh85@scully chenzh85@papermachine",
      "host": "papermachine.egr.msu.edu",
      "user": "chenzh85",
      "proxyJump": "chenzh85@scully.egr.msu.edu",
      "sshKeyPath": "~/.auto-researcher/id_ed25519",
      "remotePath": "/egr/research-dselab/chenzh85/AutoRDL"
    }
  ]
}
```

Extract servers from the JSON. If `$ARGUMENTS` names a specific server, filter to that server only.

If `.aris/project.json` is missing or has no `servers`, tell the user:
> No remote servers configured. Add SSH server targets to this project in the ARIS workspace.

### Step 2: Query Each Server

For each server, run `nvidia-smi` via SSH:

```bash
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    [-J <proxyJump>] [-i <sshKeyPath>] \
    <user>@<host> \
    "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader" 2>&1
```

The SSH command is in the `ssh` field of each server object. Use it directly — no parsing needed.

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
