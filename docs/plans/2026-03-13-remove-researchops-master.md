# Remove ResearchOps From Master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the current ResearchOps state on a legacy branch and turn `master` into the non-ResearchOps product line.

**Architecture:** Create a legacy branch at the saved checkpoint, then remove dedicated ResearchOps frontend/backend codepaths while editing shared entrypoints so the remaining library, notes, extension, and tracker flows still work. Verify by searching for stale runtime references and running focused checks for the changed surfaces.

**Tech Stack:** Git, Node.js, Express, React, Next.js, shell verification

---

### Task 1: Planning And Branch Preservation

**Files:**
- Create: `docs/plans/2026-03-13-remove-researchops-design.md`
- Create: `docs/plans/2026-03-13-remove-researchops-master.md`

**Step 1: Verify the preservation commit exists**

Run: `git rev-parse --verify 22049b4`
Expected: prints the full hash for `22049b4`

**Step 2: Create the legacy branch at the approved checkpoint**

Run: `git branch legacy/researchops-2026-03-13 22049b4`
Expected: branch is created without moving `HEAD`

**Step 3: Confirm the branch points at the checkpoint**

Run: `git rev-parse --verify legacy/researchops-2026-03-13`
Expected: same hash as `22049b4`

### Task 2: Remove Dedicated Frontend ResearchOps Code

**Files:**
- Delete: `frontend/src/components/VibeResearcherPanel.jsx`
- Delete: `frontend/src/components/VibeKnowledgeHubModal.jsx`
- Delete: `frontend/src/components/InteractiveAgentBashModal.jsx`
- Delete: `frontend/src/components/vibe`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/app/layout.jsx`
- Modify: `frontend/public/manifest.json`

**Step 1: Write a failing frontend check**

Run: `rg -n "VibeResearcherPanel|researchops/ui-config|activeArea.*vibe" frontend/src/App.jsx frontend/app/layout.jsx frontend/public/manifest.json`
Expected: matches existing ResearchOps/Vibe references before removal

**Step 2: Remove the dedicated frontend files**

Use the approved deletion list to remove the standalone Vibe/ResearchOps frontend files and directory.

**Step 3: Trim shared frontend entrypoints**

- Remove Vibe imports, state, tab wiring, and API calls from `frontend/src/App.jsx`
- Update metadata copy in `frontend/app/layout.jsx`
- Update manifest copy in `frontend/public/manifest.json`

**Step 4: Re-run the frontend reference check**

Run: `rg -n "VibeResearcherPanel|researchops/ui-config|activeArea.*vibe" frontend/src/App.jsx frontend/app/layout.jsx frontend/public/manifest.json`
Expected: no matches

### Task 3: Remove Dedicated Backend ResearchOps Code

**Files:**
- Delete: `backend/src/routes/researchops`
- Delete: `backend/src/routes/researchops.js`
- Delete: `backend/src/services/researchops`
- Delete: `backend/src/services/agent-session-watcher.service.js`
- Delete: `backend/src/services/agent-session-observer`
- Delete: `backend/src/services/project-insights.service.js`
- Delete: `backend/src/services/project-insights-proxy.service.js`
- Delete: `backend/scripts/install-agent-session-observer.sh`
- Delete: `backend/scripts/researchops-agent-observer.js`
- Delete: `backend/scripts/researchops-bootstrap-client.sh`
- Delete: `backend/scripts/researchops-bootstrap-rust-daemon.sh`
- Delete: `backend/scripts/researchops-client-daemon.js`
- Delete: `backend/scripts/researchops-rust-daemon.js`
- Delete: `backend/scripts/verify-rust-daemon-prototype.js`
- Delete: `backend/rust/researchops-local-daemon`
- Modify: `backend/src/routes/index.js`
- Modify: `backend/src/index.js`
- Modify: `backend/processing-server.js`
- Modify: `backend/package.json`

**Step 1: Write a failing backend reference check**

Run: `rg -n "researchops|agentSessionWatcher|project-insights|researchops:" backend/src backend/package.json backend/processing-server.js`
Expected: matches existing ResearchOps-only imports and scripts before removal

**Step 2: Remove the dedicated backend paths**

Use the approved deletion list to remove the standalone ResearchOps route, service, daemon, and rust daemon paths.

**Step 3: Trim shared backend entrypoints**

- Remove the `/researchops` router mount from `backend/src/routes/index.js`
- Remove ResearchOps startup imports, rate-limit exceptions, and health metadata from `backend/src/index.js`
- Remove ResearchOps env loading, project-insights endpoints, watcher usage, and daemon runtime from `backend/processing-server.js`
- Remove ResearchOps npm scripts from `backend/package.json`

**Step 4: Re-run the backend reference check**

Run: `rg -n "researchops|agentSessionWatcher|project-insights|researchops:" backend/src backend/package.json backend/processing-server.js`
Expected: no runtime matches outside intentional historical/docs text

### Task 4: Update Public Product Copy

**Files:**
- Modify: `README.md`

**Step 1: Write a failing doc check**

Run: `rg -n "Vibe Researcher|ResearchOps|agentic DAG|knowledge hub" README.md`
Expected: current product copy still advertises ResearchOps

**Step 2: Update README**

- Remove Vibe Researcher / ResearchOps feature descriptions
- Remove ResearchOps-specific architecture and config copy
- Keep extension, paper saving, library, notes, tracker, and code analysis guidance

**Step 3: Re-run the doc check**

Run: `rg -n "Vibe Researcher|ResearchOps|agentic DAG|knowledge hub" README.md`
Expected: no user-facing product references remain

### Task 5: Verify The Cleaned Master

**Files:**
- Modify: no additional source files expected

**Step 1: Verify backend route loading**

Run: `node -e "require('./backend/src/routes'); require('./backend/src/index'); console.log('backend ok')"`
Expected: prints `backend ok`

**Step 2: Verify frontend/build-facing source compiles cleanly enough for import resolution**

Run: `rg -n "from './components/VibeResearcherPanel'|from './vibe/" frontend/src`
Expected: no matches

**Step 3: Run focused backend and frontend checks**

Run: `git status --short && npm --prefix backend test -- --runInBand`
Expected: backend tests pass or clearly identify the remaining cleanup needed

**Step 4: Run the frontend build/test command that exists in the repo**

Run: `npm --prefix frontend test`
Expected: frontend tests pass if configured; if not configured, capture the limitation and run the available build check instead

**Step 5: Commit the cleaned master state**

Run: `git add -A && git commit -m "refactor: remove researchops from master"`
Expected: commit succeeds with the cleaned product line
