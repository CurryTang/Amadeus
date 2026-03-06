# Vibe Researcher — UX Design Review & Bug Report

**Reviewer:** Claude (Playwright automated test session)
**Date:** 2026-02-26
**Test task:** Benchmark study on SOTA time series forecasting models (TabPFN-TS, TabICLv2, Chronos) on `compute.example.edu`
**Scope:** End-to-end workflow — proposal → TODO generation → project setup → implementation → experiment execution → output review

---

## Executive Summary

The Vibe Researcher platform has a solid conceptual architecture and well-designed UI layout. The **file browser, run history, TODO management, Git progress tracking, and SSH bash execution all work correctly**. However, the platform has several critical issues that make the core agent-driven workflow (Implement / Experiment / Agent Chat) non-functional in standard usage:

1. A critical API endpoint bug (now fixed) caused all agent launches to return 404.
2. The `agent.run` module fails when the project cwd is a remote SSH path — it tries to spawn the agent locally with a non-existent cwd.
3. Runs stay `QUEUED` indefinitely without a running worker process, with no explanation to the user.
4. Artifact "Open" links return S3 `AccessDenied`.
5. Agent Chat doesn't surface run failure states to the user.

---

## Bugs (Critical)

### BUG-1: Launch Button Returned 404 (FIXED)
**Severity:** Critical
**Status:** Fixed in this session

`handleLaunchAgent` (Implement/Experiment tabs) and the Agent Chat send function both called `POST /api/researchops/runs`, which doesn't exist. The backend only has `/api/researchops/runs/enqueue-v2`. Every agent launch returned 404.

**Fix applied:**
- `handleLaunchAgent`: Changed endpoint to `/researchops/runs/enqueue-v2`
- Agent Chat send: Same fix, plus added proper v2 workflow structure and corrected `runId` extraction from `res.data?.run?.id`

**Reproduction:** Click Launch on the Implement tab → browser network shows `POST /api/researchops/runs` → 404.

---

### BUG-2: `agent.run` Fails with ENOENT for SSH Projects
**Severity:** Critical
**Status:** Open

When a project has an SSH server cwd (e.g., `/egr/research-dselab/testuser/ts-sota-benchmark`), the `agent.run` module in `orchestrator.js` calls:

```javascript
const cwd = cwdInput ? path.resolve(cwdInput) : process.cwd();
spawn(command, args, { cwd, ... })
```

The path `/egr/research-dselab/testuser/ts-sota-benchmark` only exists on the remote SSH server (`compute.example.edu`), not on the local executor machine. Node.js `spawn()` throws `ENOENT` when the `cwd` doesn't exist.

**Impact:** All Implement, Experiment, and Agent Chat runs fail immediately for SSH projects. This is the single biggest blocker to using the platform as a research tool.

**Observed error in run events:**
```
spawn codex ENOENT   (or: spawn claude ENOENT)
```

**Fix direction:**
- Fall back to a local temp directory if the cwd doesn't exist locally
- OR check if cwd exists before spawning, and create a temp dir + sync
- OR document that the executor must have the remote path mounted via SSHFS

---

### BUG-3: Runs Stay QUEUED Indefinitely — No Auto-Dispatch
**Severity:** Critical
**Status:** Open (architectural)

After a run is created, it sits in `QUEUED` status forever. The dispatch mechanism (`POST /scheduler/lease-and-execute`) must be called externally by a worker process. No worker is auto-started. Users see:

```
Pipeline: Running  ←  (misleading; run is actually waiting in queue)
Run History: QUEUED
```

The UI offers no explanation. There is no "worker offline" indicator, no documentation link, no retry hint.

**Root cause:** The platform requires a persistent worker process polling the scheduler. In the intended architecture, the local machine's backend calls `lease-and-execute` periodically. Without this, no runs execute.

**Fix direction:**
- Add a visible "Worker status" indicator to the UI (Online / Offline)
- Show a helpful message when a run has been QUEUED for more than N seconds
- OR implement auto-polling in the backend scheduler
- OR add a one-click "Run locally" button that triggers execution

---

### BUG-4: Artifact "Open" Links Return S3 AccessDenied
**Severity:** High
**Status:** Open

The Outputs section links artifacts to direct S3 URLs like:
```
https://auto-reader-documents.s3.us-east-1.amazonaws.com/runs/.../artifacts/...txt
```

Clicking "Open" loads a browser tab showing an AWS XML `AccessDenied` error. The S3 bucket is private and no signed URL or API proxy is used.

**Fix direction:**
- Use AWS S3 pre-signed URLs with expiry (e.g., 15 min) when generating artifact links
- OR proxy artifact downloads through `/api/researchops/runs/:id/artifacts/:artifactId/download`

---

### BUG-5: Agent Chat Shows "Thinking…" Forever on Run Failure
**Severity:** High
**Status:** Open

When an Agent Chat run fails (e.g., due to BUG-2 or BUG-3), the chat UI continues to show "Thinking…" indefinitely. The run failure event is never surfaced to the chat interface.

**Observed:** Chat input remains disabled; no error message appears; the run in Run History shows FAILED, but the chat panel doesn't update.

**Fix direction:**
- Poll the run status from the chat component
- On FAILED status, show the error message in the chat thread (e.g., "Agent failed: spawn codex ENOENT")

---

### BUG-6: Claude CLI Requires `--dangerously-skip-permissions` for Headless Use
**Severity:** High
**Status:** Open

When the platform uses `claude_code_cli` as provider, the `agent.run` module calls:
```
claude -p "<prompt>"
```

The Claude CLI in `-p` (print) mode still requires permission grants for any file operation. In a headless agent run with no stdin, the permission dialog hangs until timeout.

**Observed:** `agent.run` with `claude_code_cli` timed out after 60 seconds with no files created.

**Fix direction:**
- Pass `--dangerously-skip-permissions` flag when spawning Claude in agent.run mode
- Or add a provider config option for headless flags

---

## UX Issues (Non-Critical)

### UX-1: Venv Modal Appears Every Time a Project is Opened
**Severity:** Medium

The "Project Virtual Environment" modal auto-pops on every project click. There is no "Don't show again" checkbox. Users who have already reviewed the venv status must dismiss it every time they navigate to a project.

**Reproduction:** Click any SSH project → modal immediately appears.

**Fix:** Add a "Don't show again for this project" checkbox that persists a `dismissedVenvModal` flag in localStorage.

---

### UX-2: TODO Auto-Generation Produces Generic Tasks
**Severity:** Medium

When given a specific task description ("Benchmark study on SOTA time series models TabPFN-TS, TabICLv2, Chronos..."), the LLM-generated TODOs were generic:
- "Scan knowledge base and collect hypotheses"
- "Run benchmark branch A"
- "Run benchmark branch B"
- "Aggregate results and propose next steps"

No task-specific steps were generated (e.g., "Install TabPFN-TS", "Download Monash Time Series datasets", "Evaluate MAE/MSE on held-out test set").

**Fix:** Improve the TODO generation prompt to include the project description and task context, and request domain-specific actionable items.

---

### UX-3: File Browser Shows Relative Path in Breadcrumb
**Severity:** Low

When navigating into a subdirectory, the breadcrumb shows a relative path (`/scripts`) instead of the full absolute path (`/egr/research-dselab/testuser/ts-sota-benchmark/scripts`). This is confusing for SSH projects where the absolute path matters.

**Fix:** Show the full absolute path in the breadcrumb.

---

### UX-4: Experiment Tab Still Uses Agent for Planning
**Severity:** Medium

The Experiment tab description says "Agent plans a bash experiment, schedules it to run, then analyzes results automatically." Despite the name suggesting direct bash execution, the Experiment workflow first creates an `agent.run` step. This means experiments are blocked by the same agent execution issues (BUG-2) as the Implement tab.

Users expecting "Experiment = run a script on the server" are surprised to find it requires an agent intermediary.

**Fix direction:**
- Add a "Direct Script" mode within the Experiment tab that creates a pure `bash.run` workflow
- Or clarify in the UI that experiment planning requires a local agent executor

---

### UX-5: No Clear Architecture Guidance for SSH Project Execution
**Severity:** Medium

The platform supports SSH projects but it is not obvious to users that:
- `agent.run` steps (Implement, Experiment, Agent Chat) run the AI agent **locally**
- `bash.run` steps run commands on the **SSH server**
- The AI agent's cwd must be accessible on the **local executor machine**

New users setting up an SSH project with a remote cwd will encounter silent failures (BUG-2) with no guidance on the required setup (SSHFS mount, local code checkout, etc.).

**Fix:** Add a "How it works" tooltip or setup guide for SSH projects explaining the split execution model.

---

## What Works Well

| Feature | Status | Notes |
|---|---|---|
| Project creation | ✅ Working | Name, description, server, path setup flow is clear |
| Project list view | ✅ Working | Shows SSH badge, run counts, queued count |
| Run History display | ✅ Working | SUCCEEDED/FAILED badges, type labels, timestamps |
| Execution Pipeline view | ✅ Working | Shows step names, types, SUCCEEDED/FAILED per step |
| TODO management | ✅ Working | Done/Reopen, New TODO, USER vs LLM type distinction |
| Git Progress section | ✅ Working | Shows branch, commit messages, hashes, timestamps |
| Project Files browser | ✅ Working | List, navigate subdirectories, file preview |
| SSH bash.run execution | ✅ Working | Confirmed: executes on `compute.example.edu`, Python 3.12.3 available |
| Server dropdown | ✅ Working | Lists all configured SSH servers |
| Stats bar | ✅ Working | Pipeline, Runs, Knowledge, Files Changed, Commits, Venv |
| Artifact creation | ✅ Working | Artifacts uploaded to S3; viewing is broken (BUG-4) |
| Continue button | ✅ Working | Appears on all runs |

---

## Test Session Trace

The following steps were executed during the test session:

1. **Login** — navigated to `your-domain.example.com`, authenticated as `czk`
2. **Create project** — "ts-sota-benchmark", SSH server `compute.example.edu`, path `/egr/research-dselab/testuser/ts-sota-benchmark`
3. **Auto-generate TODOs** — provided full benchmark task description → generic TODOs produced (UX-2)
4. **Launch Implement run** → 404 error (BUG-1, fixed)
5. **Deploy fix** — patched `VibeResearcherPanel.jsx` endpoint, deployed via Next.js build
6. **Re-launch Implement run** — run enqueued (run_f1faac6434c446a283ab), stayed QUEUED (BUG-3)
7. **Manually trigger scheduler** with wrong serverId → `no_queued_runs`; found correct serverId (`5`) via API
8. **Trigger with serverId 5** → run executed on DO server → `spawn codex ENOENT` (no codex on DO)
9. **Trigger via local backend** with `claude_code_cli` → `spawn claude ENOENT` (cwd doesn't exist locally, BUG-2)
10. **Test bash.run SSH** — direct bash.run workflow → **SUCCEEDED**: `chatdse` hostname, Python 3.12.3
11. **Setup project on remote** — bash.run multi-step: created directories, requirements.txt, scripts, git init → **SUCCEEDED**
12. **File browser** — browsed `scripts/`, previewed `load_data.py` → works
13. **Artifact "Open"** — clicked link → S3 AccessDenied (BUG-4)
14. **TODO management** — marked "Scan knowledge base" as Done → works; added new TODO → works
15. **Agent Chat** — typed question about requirements.txt → run enqueued, stayed "Thinking…" after failure (BUG-5)

---

## Recommendations by Priority

### P0 — Fix Before Any User Testing
1. **BUG-2:** Make `agent.run` gracefully handle missing cwd (fall back to temp dir or skip cd)
2. **BUG-3:** Add a "Worker Offline" banner when runs stay QUEUED beyond 10 seconds, with a "Run Now" button or documentation link
3. **BUG-4:** Use signed S3 URLs or proxy artifact downloads through the backend API

### P1 — Fix Before General Availability
4. **BUG-5:** Surface run failure state in Agent Chat UI
5. **BUG-6:** Pass `--dangerously-skip-permissions` when using Claude in headless agent runs
6. **UX-1:** Add "Don't show again" to the Venv modal
7. **UX-2:** Improve TODO generation prompt with task-specific context

### P2 — Polish
8. **UX-3:** Show full absolute path in file browser breadcrumb
9. **UX-4:** Add "Direct Script" mode to Experiment tab
10. **UX-5:** Add architecture explanation for SSH projects

---

*Generated from Playwright automated test session — 2026-02-26*
