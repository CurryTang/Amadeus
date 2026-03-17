---
name: aris-register
description: "Register or update an ARIS run on the web dashboard. Internal utility used by other skills and CLAUDE.md auto-registration. Call at skill start to register, at skill end to report completion. If ~/.claude/aris-api.json is absent, does nothing (zero-impact)."
argument-hint: [action: start|end] [run-id] [details...]
allowed-tools: Bash(curl *), Bash(cat *), Bash(python3 *), Bash(tail *), Read
---

# ARIS Run Registration

Register or update an ARIS run on the web dashboard: **$ARGUMENTS**

## Overview

This skill provides automatic run registration for ARIS. It is designed as an **internal utility** — other skills call it at key moments (skill start, skill end). It can also be invoked manually to register a CLI-initiated run.

**Zero-impact guarantee**: If no `aris-api.json` config exists, this skill does nothing and returns silently. All existing workflows are completely unaffected.

## Configuration

The skill reads `~/.claude/aris-api.json`. If this file does not exist, **all registration is disabled** — skills behave exactly as before.

### Config Format

```json
{
  "api_url": "https://auto-reader.duckdns.org",
  "token": "YOUR_ADMIN_TOKEN"
}
```

## Workflow

### Step 1: Read Config

```bash
cat ~/.claude/aris-api.json 2>/dev/null
```

- **File not found** → return silently, do nothing
- **File found** → extract `api_url` and `token`, proceed

### Step 2: Determine Action

Parse `$ARGUMENTS` to determine what to do:

#### Action: `start` (register a new run)

Register a new run at skill start. Required info:
- `projectId` — read from CLAUDE.md (`ARIS Project ID:` line), or pass explicitly
- `workflowType` — the skill/workflow being run (e.g., `run_experiment`, `auto_review_loop`, `custom_run`)
- `prompt` — the user's original prompt/arguments
- `title` — short descriptive title

```bash
ARIS_CFG="$HOME/.claude/aris-api.json"
API_URL=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['api_url'])" 2>/dev/null)
API_TOKEN=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['token'])" 2>/dev/null)
# Auto-detect project ID from CLAUDE.md
ARIS_PROJECT_ID=$(grep -o 'aris_project_[0-9]*' CLAUDE.md 2>/dev/null | head -1)

RESULT=$(curl -s -X POST "$API_URL/api/aris/runs/register" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$ARIS_PROJECT_ID\",\"workflowType\":\"WORKFLOW_TYPE\",\"prompt\":\"USER_PROMPT\",\"title\":\"SHORT_TITLE\",\"status\":\"running\",\"runnerHost\":\"$(hostname)\"}")

ARIS_RUN_ID=$(echo "$RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('run',{}).get('id',''))" 2>/dev/null)
echo "Registered ARIS run: $ARIS_RUN_ID"
```

**Save the `ARIS_RUN_ID`** — you'll need it for the `end` action.

#### Action: `end` (report completion)

Update the run status when the skill finishes. Include a result summary (last few lines of meaningful output).

```bash
ARIS_CFG="$HOME/.claude/aris-api.json"
API_URL=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['api_url'])" 2>/dev/null)
API_TOKEN=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['token'])" 2>/dev/null)

# Build a concise result summary — last few meaningful lines of output
SUMMARY_JSON=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "RESULT_SUMMARY_TEXT")

curl -s -X PATCH "$API_URL/api/aris/runs/ARIS_RUN_ID/status" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"completed\",\"resultSummary\":$SUMMARY_JSON}" \
  >/dev/null 2>&1 || true

echo "Updated ARIS run ARIS_RUN_ID → completed"
```

Use `"failed"` instead of `"completed"` if the skill encountered errors.

### Step 3: Return

- **Success**: Print the run ID (for `start`) or confirmation (for `end`)
- **Failure**: Log warning but **never block** the parent workflow

## Integration Pattern for Other Skills

Other skills should integrate run registration by following these steps:

1. **At skill start**, before main work begins:
   - Read `~/.claude/aris-api.json`
   - If config exists, call `POST /api/aris/runs/register` with `status: "running"`
   - Save the returned `ARIS_RUN_ID` for later

2. **At skill end**, after all work is done:
   - If `ARIS_RUN_ID` was captured, call `PATCH /api/aris/runs/{id}/status`
   - Include `resultSummary` with the last few sentences describing the outcome
   - Set `status` to `"completed"` or `"failed"`

**This is always guarded.** If the config file doesn't exist, skip the registration entirely — zero overhead, zero side effects.

## Key Rules

- **NEVER block a workflow** because registration fails. Always fail open.
- **NEVER require aris-api.json** — all skills must work without it.
- **Config file absent = registration disabled.** No error, no warning, no log.
- **Registration is fire-and-forget.** Send curl, check exit code, move on.
- **No secrets in result summaries.** Never include API keys, tokens, or passwords.
- **Result summaries should be concise** — last 3-5 sentences of meaningful output, not raw log dumps.
