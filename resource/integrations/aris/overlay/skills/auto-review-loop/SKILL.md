---
name: auto-review-loop
description: "Autonomous multi-round research review loop. Supports two modes: (1) Plan-driven: takes an implementation plan file, executes TODO items respecting dependency DAG, uses Codex MCP to verify completion of each item. (2) Free-form: iterates review → fix → re-review until positive assessment. Use when user says 'auto review loop', 'review until it passes', or wants iterative improvement."
argument-hint: "[topic-or-scope] [--plan path/to/plan.md]"
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit, Agent, Skill, mcp__codex__codex, mcp__codex__codex-reply
---

# Auto Review Loop: Autonomous Research Improvement

## Context: $ARGUMENTS

## Step 0: Local vs Remote Detection (MUST run first)

This skill must run on the **remote server**, not on the local client device. Read the project config and check:

```bash
# Read project config (structured JSON — no markdown parsing needed)
ARIS_CONFIG=".aris/project.json"
if [ -f "$ARIS_CONFIG" ]; then
  CURRENT_HOST=$(hostname -f 2>/dev/null || hostname)
  # Check if current host matches any configured server
  IS_REMOTE=$(python3 -c "
import json, sys
cfg = json.load(open('$ARIS_CONFIG'))
hosts = [s['host'] for s in cfg.get('servers', [])]
print('yes' if '$CURRENT_HOST' in hosts else 'no')
" 2>/dev/null || echo "no")
  echo "Current host: $CURRENT_HOST — is remote server: $IS_REMOTE"
fi
```

**Decision**:
- If `$IS_REMOTE` is `yes` → **proceed to Mode Detection below**
- If `$IS_REMOTE` is `no` (running on Mac/laptop) → **dispatch remotely**:

```bash
if [ -f "$ARIS_CONFIG" ]; then
  PROJECT_ID=$(python3 -c "import json;print(json.load(open('$ARIS_CONFIG'))['projectId'])")
  API_URL=$(python3 -c "import json;print(json.load(open('$ARIS_CONFIG'))['apiUrl'])")
  API_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/aris-api.json'))['token'])" 2>/dev/null)
  PROMPT=$(printf '%s' "$ARGUMENTS" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")
  if [ -n "$PROJECT_ID" ] && [ -n "$API_TOKEN" ]; then
    RESULT=$(curl -s -X POST "$API_URL/api/aris/runs" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"projectId\":\"$PROJECT_ID\",\"workflowType\":\"auto_review_loop\",\"prompt\":$PROMPT,\"title\":\"Auto Review Loop\"}")
    RUN_ID=$(echo "$RESULT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('run',{}).get('id','') or d.get('error','UNKNOWN'))" 2>/dev/null)
    echo "Dispatched to remote server. ARIS run ID: $RUN_ID"
  fi
fi
```

After dispatching, **STOP**. Tell the user:
> Dispatched to remote server via ARIS. Run ID: $RUN_ID
> Monitor on the ARIS dashboard.

If `.aris/project.json` is missing, tell the user:
> No project config found. Run `/init-repo` or add this project in the ARIS web dashboard.

## Mode Detection

Parse $ARGUMENTS for `--plan <path>`:
- If `--plan` is present → **Plan-Driven Mode** (Section A)
- Otherwise → **Free-Form Review Mode** (Section B)

---

# Section A: Plan-Driven Mode

Execute an implementation plan with dependency-aware task ordering. Each TODO item is implemented, then **verified by the Codex MCP reviewer** before marking complete.

## A.1 Initialization

1. **Read the plan file** specified by `--plan <path>`. This is a markdown file with Steps and TODO items.
2. **Parse plan structure**:
   - Steps are top-level groups (`### Step N: Title`)
   - TODO items within steps (`#### TODO-N.M: Title`)
   - Items marked with ✅ are already completed — skip them
3. **Load or create `PLAN_STATE.json`** in project root:
   ```json
   {
     "planFile": "docs/implementation_plan.md",
     "status": "in_progress",
     "currentNode": "TODO-1.1",
     "completedNodes": ["TODO-1.0"],
     "failedNodes": [],
     "threadId": "019cd392-...",
     "timestamp": "2026-03-17T10:00:00"
   }
   ```
   - If exists with `"in_progress"` and within 24h → **resume** from `currentNode`
   - Otherwise → **fresh start**

4. **Register plan with ARIS API** (if `~/.claude/aris-api.json` exists):
   ```bash
   ARIS_CFG="$HOME/.claude/aris-api.json"
   if [ -f "$ARIS_CFG" ]; then
     API_URL=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['api_url'])")
     API_TOKEN=$(python3 -c "import json;print(json.load(open('$ARIS_CFG'))['token'])")
     # Register run
     RESULT=$(curl -s -X POST "$API_URL/api/aris/runs/register" \
       -H "Authorization: Bearer $API_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"projectId":"PROJECT_ID","prompt":"Plan: PLAN_FILE","status":"running","workflowType":"auto_review_loop","title":"Plan Execution"}')
     ARIS_RUN_ID=$(echo "$RESULT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('run',{}).get('id',''))")
     # Upload plan
     PLAN_MD=$(cat PLAN_FILE)
     curl -s -X POST "$API_URL/api/aris/runs/$ARIS_RUN_ID/plan" \
       -H "Authorization: Bearer $API_TOKEN" \
       -H "Content-Type: application/json" \
       -d "{\"markdown\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PLAN_MD")}"
   fi
   ```

5. **Build execution order**: Topological sort of the TODO DAG, respecting `dependsOn` relationships.

## A.2 Execution Loop

For each TODO item in topological order:

### Phase 1: Check Prerequisites

- Verify all items in `dependsOn` are in `completedNodes`
- If any dependency failed → skip this item, mark as `skipped`
- If dependencies not yet complete → this shouldn't happen in topological order, but wait/skip if it does
- If item is already in `completedNodes` (from resume or ✅ marker) → skip

### Phase 2: Implement

Read the TODO item's description from the plan file. It contains:
- What needs to be built/implemented
- File locations
- Expected behavior
- Any code snippets or references

**Implement the TODO item.** This may involve:
- Writing new code files
- Modifying existing code
- Running commands (pip install, tests, etc.)
- Creating data adapters
- Running experiments — **check GPU availability first** (see "Multi-Server Experiment Routing" section) and dispatch to the server with free GPUs

### Phase 3: Verify via Codex MCP

After implementing, **send the work to the Codex MCP reviewer** for verification:

```
mcp__codex__codex (or mcp__codex__codex-reply if threadId exists):
  config: {"model_reasoning_effort": "xhigh"}
  prompt: |
    I am executing an implementation plan. I just completed this TODO item:

    **{TODO_KEY}: {TODO_TITLE}**

    Description from plan:
    {TODO_DESCRIPTION}

    What I implemented:
    {SUMMARY_OF_CHANGES}

    Files changed:
    {LIST_OF_FILES}

    Test results (if any):
    {TEST_OUTPUT}

    Please verify:
    1. Does the implementation match what the plan asked for? (Yes/No)
    2. Are there any bugs, missing pieces, or quality issues? (List them)
    3. Is this TODO item COMPLETE? (Yes/No/Partial)
    4. If Partial, what specific remaining work is needed?

    Be strict. Only mark complete if the implementation fully satisfies the plan.
```

### Phase 4: Process Verification Result

Parse the Codex response:
- **"Complete: Yes"** → Mark as `completed`, add to `completedNodes`, update ARIS API
- **"Complete: Partial"** → Implement the remaining work, then re-verify (max 2 retries)
- **"Complete: No"** → Fix issues, then re-verify (max 2 retries)
- After 2 failed retries → mark as `failed`, add to `failedNodes`, continue to next item

### Phase 5: Update State

After each TODO item:

1. **Update `PLAN_STATE.json`**:
   ```json
   {
     "currentNode": "NEXT_TODO_KEY",
     "completedNodes": ["TODO-1.0", "TODO-1.1", ...],
     "timestamp": "NOW"
   }
   ```

2. **Update ARIS API plan node** (if registered):
   ```bash
   curl -s -X PATCH "$API_URL/api/aris/runs/$ARIS_RUN_ID/plan/TODO_KEY" \
     -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"status":"completed","resultSummary":"CODEX_VERDICT_SUMMARY"}'
   ```

3. **Write per-TODO review report to `review/` folder**:

   Create `review/TODO-X.Y.md` (where X.Y is the TODO key, e.g. `review/TODO-1.1.md`):

   ```markdown
   # Review: TODO-X.Y — {TODO_TITLE}

   **Status**: ✅ completed / ❌ failed / ⚠️ needs_redo
   **Timestamp**: {ISO_TIMESTAMP}
   **Retries**: {0 / 1 / 2}

   ## Plan Description

   {TODO_DESCRIPTION verbatim from plan file}

   ## What Was Implemented

   {SUMMARY_OF_CHANGES — what you actually built/modified}

   **Files changed:**
   - `path/to/file1.py` — description of change
   - `path/to/file2.py` — description of change

   **Test / command output:**
   ```
   {TEST_OUTPUT or "N/A"}
   ```

   ## Codex Review Response

   {FULL raw Codex response verbatim — do not summarize}

   ## Verdict

   - **Match plan?**: Yes / No
   - **Complete?**: Yes / Partial / No
   - **Issues found**: {list or "None"}
   - **Remaining work** (if Partial): {list or "N/A"}
   ```

   Rules for this file:
   - Always write this file **immediately after receiving the Codex verdict**, even on failure.
   - If the item was retried, overwrite the same file each time (latest verdict wins).
   - If the item was **skipped** due to dependency failure, write a minimal report:
     ```markdown
     # Review: TODO-X.Y — {TODO_TITLE}

     **Status**: ⏭️ skipped
     **Reason**: Dependency {DEP_KEY} failed — skipping downstream item.
     ```
   - This folder is the primary human-readable audit trail. Keep reports factual and complete.

4. **Append to `AUTO_REVIEW.md`**:
   ```markdown
   ## TODO-X.Y: Title (timestamp)
   - Status: completed/failed
   - Reviewer verdict: [Codex response summary]
   - Files changed: [list]
   - Report: [review/TODO-X.Y.md](review/TODO-X.Y.md)
   - Notes: [any observations]
   ```

### Phase 6: Parallel Execution

When multiple TODO items have `canParallel: true` and share the same dependencies (all satisfied):
- List all ready parallel items
- Implement them sequentially (Claude can only do one at a time)
- But batch-verify: send all implementations to Codex in a single review prompt
- This is more efficient than individual reviews for independent items

## A.3 Termination

When all TODO items are processed:

1. Set `PLAN_STATE.json` → `"status": "completed"`
2. Write final summary to `AUTO_REVIEW.md`:
   ```markdown
   ## Plan Execution Summary

   | TODO | Title | Status | Reviewer Verdict | Report |
   |------|-------|--------|------------------|--------|
   | TODO-1.0 | Environment setup | ✅ completed | Pre-verified | [report](review/TODO-1.0.md) |
   | TODO-1.1 | Run SimpleMem | ✅ completed | Matches plan | [report](review/TODO-1.1.md) |
   | TODO-2.1 | Implement C1 | ✅ completed | Code correct | [report](review/TODO-2.1.md) |
   | TODO-4.3 | Implement C6 | ❌ failed | Missing graph builder | [report](review/TODO-4.3.md) |
   | ... | ... | ... | ... | ... |

   Completed: X/Y items
   Failed: Z items (listed above with reasons)

   Individual review reports: [`review/`](review/)
   ```
3. Update ARIS API run status → `completed` or `failed`

4. **Upload review reports to ARIS API** so client device can retrieve them:
   ```bash
   ARIS_CFG="$HOME/.claude/aris-api.json"
   if [ -f "$ARIS_CFG" ] && [ -n "$ARIS_RUN_ID" ] && [ -d "review" ]; then
     python3 -c "
   import os, sys, json, base64, urllib.request
   cfg = json.load(open(os.path.expanduser('~/.claude/aris-api.json')))
   api_url, token, run_id = cfg['api_url'], cfg['token'], sys.argv[1]
   files = {}
   for f in sorted(os.listdir('review')):
       if f.endswith('.md'):
           with open(os.path.join('review', f), 'rb') as fp:
               files[f] = base64.b64encode(fp.read()).decode()
   if not files:
       sys.exit(0)
   payload = json.dumps(files).encode()
   req = urllib.request.Request(
       api_url + '/api/aris/runs/' + run_id + '/review-reports',
       data=payload,
       headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
       method='POST'
   )
   urllib.request.urlopen(req, timeout=30)
   print('[ARIS] Uploaded ' + str(len(files)) + ' review report(s)')
   " "$ARIS_RUN_ID" 2>/dev/null || true
   fi
   ```

5. **Feishu notification** (if configured): Send `pipeline_done` with completion stats

---

# Section B: Free-Form Review Mode

(Original behavior when no `--plan` is specified)

Autonomously iterate: review → implement fixes → re-review, until the external reviewer gives a positive assessment or MAX_ROUNDS is reached.

## Constants

- MAX_ROUNDS = 4
- POSITIVE_THRESHOLD: score >= 6/10, or verdict contains "accept", "sufficient", "ready for submission"
- REVIEW_DOC: `AUTO_REVIEW.md` in project root (cumulative log)
- REVIEWER_MODEL = `gpt-5.4` — Model used via Codex MCP
- **HUMAN_CHECKPOINT = false** — When `true`, pause after each round's review and present the score + weaknesses to the user.

> Override: `/auto-review-loop "topic" — human checkpoint: true`

## State Persistence (Compact Recovery)

Persist state to `REVIEW_STATE.json` after each round:

```json
{
  "round": 2,
  "threadId": "019cd392-...",
  "status": "in_progress",
  "last_score": 5.0,
  "last_verdict": "not ready",
  "pending_experiments": ["screen_name_1"],
  "timestamp": "2026-03-13T21:00:00"
}
```

## Workflow

### Initialization

1. **Check for `REVIEW_STATE.json`**:
   - Not exist or `"completed"` → fresh start
   - `"in_progress"` older than 24h → fresh start
   - `"in_progress"` within 24h → resume from `round + 1`
2. Read project docs, memory files, prior reviews
3. Read recent experiment results
4. Initialize round counter

### Loop (repeat up to MAX_ROUNDS)

#### Phase A: Review via Codex MCP

```
mcp__codex__codex:
  config: {"model_reasoning_effort": "xhigh"}
  prompt: |
    [Round N/MAX_ROUNDS]
    [Full research context: claims, methods, results, known weaknesses]
    [Changes since last round]

    Please act as a senior ML reviewer (NeurIPS/ICML level).
    1. Score this work 1-10 for a top venue
    2. List remaining critical weaknesses (ranked by severity)
    3. For each weakness, specify the MINIMUM fix
    4. State clearly: is this READY for submission? Yes/No/Almost
```

Round 2+: use `mcp__codex__codex-reply` with saved threadId.

#### Phase B: Parse Assessment

Save FULL raw response verbatim. Extract: Score, Verdict, Action items.

**STOP CONDITION**: score >= 6 AND verdict "ready"/"almost" → stop, document.

#### Human Checkpoint (if enabled)

Present score + weaknesses, wait for user input.

#### Feishu Notification (if configured)

Send `review_scored` notification if `~/.claude/feishu.json` exists.

#### Phase C: Implement Fixes

For each action item (highest priority first): code changes, experiments, analysis, documentation.
When running experiments, use multi-server routing: check `/gpu-status` or `.aris/project.json` servers and dispatch to whichever has free GPUs. Run independent experiments on different servers in parallel.

#### Phase D: Wait for Results

Monitor experiments, collect results.

#### Phase E: Document Round

Append to `AUTO_REVIEW.md`. Write `REVIEW_STATE.json`.

### Termination

1. Update state → `"completed"`
2. Write final summary with score progression table
3. Feishu notification if configured

---

## Multi-Server Experiment Routing (Both Modes)

When running experiments that require GPUs, use ALL available servers — not just one.

### Before launching experiments:

1. **Check GPU availability** across all project servers:
   ```bash
   # Read servers from .aris/project.json
   python3 -c "
   import json
   cfg = json.load(open('.aris/project.json'))
   for s in cfg['servers']:
       print(f\"{s['name']}: {s['ssh']}\")
   "
   ```

2. **Run /gpu-status** (or manually SSH to each server with `nvidia-smi`) to find free GPUs.

3. **Route experiments to servers with free GPUs**:
   - Pick the server(s) with the most free GPUs
   - For multi-GPU jobs, prefer servers with contiguous free GPUs
   - If all GPUs on one server are busy, try the next server
   - Run independent experiments on different servers in parallel when possible

### Dispatching to a remote server:

```bash
# SSH to a specific server and run an experiment
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no <SSH_COMMAND_FROM_PROJECT_JSON> \
  "cd <remotePath> && CUDA_VISIBLE_DEVICES=<free_gpu_ids> <command>"
```

### Key principles:
- **Never hardcode a single server** — always check availability first
- **Parallel dispatch**: if two experiments are independent, run them on different servers simultaneously
- **Retry on a different server** if one server's GPUs fill up during the run
- The prompt may include "Available experiment servers" — use ALL of them, not just the first

## Key Rules (Both Modes)

- **Large file handling**: If Write tool fails due to file size, use Bash (`cat << 'EOF' > file`) silently.
- ALWAYS use `config: {"model_reasoning_effort": "xhigh"}` for Codex MCP calls
- Save threadId from first Codex call, use `mcp__codex__codex-reply` for subsequent calls
- Be honest — include negative results and failed experiments
- Do NOT hide weaknesses to game scores
- Implement BEFORE re-reviewing/re-verifying
- Document EVERYTHING in `AUTO_REVIEW.md`
- **Plan mode**: The Codex reviewer is the authority on whether a TODO is complete. Do not self-assess.
- **Plan mode**: Respect dependency ordering. Never implement a TODO whose dependencies haven't been verified complete.

## Prompt Template for Round 2+ (Free-Form Mode)

```
mcp__codex__codex-reply:
  threadId: [saved from round 1]
  config: {"model_reasoning_effort": "xhigh"}
  prompt: |
    [Round N update]
    Since your last review, we have:
    1. [Action 1]: [result]
    2. [Action 2]: [result]

    Updated results table: [paste metrics]

    Please re-score and re-assess.
    Same format: Score, Verdict, Remaining Weaknesses, Minimum Fixes.
```
