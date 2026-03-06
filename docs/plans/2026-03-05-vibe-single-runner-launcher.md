# Vibe Single Runner Launcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the multi-mode Vibe launcher with a single auto-routing runner that decides whether a request is an implementation task or an experiment task.

**Architecture:** Keep the existing `AGENT` enqueue path and provider controls, but collapse the launcher UI to one neutral entry point. Move skill selection to a small routing helper that defaults to `auto` and emits either implementation or experiment instructions inside the prompt prefix.

**Tech Stack:** React, Next.js, existing ResearchOps enqueue-v2 workflow, node:test

---

### Task 1: Add routing tests for the new single-runner defaults

**Files:**
- Create: `frontend/src/components/vibe/launcherRouting.test.mjs`
- Create: `frontend/src/components/vibe/launcherRouting.js`

**Step 1: Write the failing test**

Add tests that assert:
- the default launcher skill resolves to `auto`
- `auto` uses a single prompt prefix that tells the agent to choose implementation vs experiment
- removed skills do not appear in the allowed launcher skill list

**Step 2: Run test to verify it fails**

Run: `node --test frontend/src/components/vibe/launcherRouting.test.mjs`
Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

Add a small pure helper module that exports:
- `DEFAULT_LAUNCHER_SKILL`
- `getLauncherPromptPrefix(skill)`

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/launcherRouting.test.mjs`
Expected: PASS

### Task 2: Collapse the Vibe launcher UI to one runner

**Files:**
- Modify: `frontend/src/components/VibeResearcherPanel.jsx`

**Step 1: Write the failing test**

Use the routing helper test coverage from Task 1 as the guardrail for launcher defaults before modifying UI wiring.

**Step 2: Run test to verify it fails**

Reuse: `node --test frontend/src/components/vibe/launcherRouting.test.mjs`

**Step 3: Write minimal implementation**

Update the launcher to:
- remove the `Advanced Run` button from the workspace action row
- remove launcher skill chips and skill-specific description copy
- use one neutral launcher heading/description/placeholder
- default `agentSkill` to `auto`
- remove the `custom` builder special case from the primary launcher button
- use the new auto-routing prefix helper during enqueue

**Step 4: Run test to verify it passes**

Run: `node --test frontend/src/components/vibe/launcherRouting.test.mjs`
Expected: PASS

### Task 3: Verify the simplified launcher still fits existing UI mode behavior

**Files:**
- Test: `frontend/src/components/vibe/vibeUiMode.test.mjs`

**Step 1: Run existing UI mode tests**

Run: `node --test frontend/src/components/vibe/vibeUiMode.test.mjs`
Expected: PASS

**Step 2: Run both targeted tests together**

Run: `node --test frontend/src/components/vibe/launcherRouting.test.mjs frontend/src/components/vibe/vibeUiMode.test.mjs`
Expected: PASS

**Step 3: Commit**

Do not commit unless explicitly requested by the user.
