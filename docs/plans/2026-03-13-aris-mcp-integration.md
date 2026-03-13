# ARIS MCP Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate a maintained fork of ARIS into Auto Researcher by adding an Auto Researcher-backed MCP paper-library server, wiring installer/bootstrap support, and documenting the fork/update workflow.

**Architecture:** Keep ARIS as an installer-managed external dependency cloned from our fork, implement a stdio MCP server in the backend workspace using the stable MCP v1.x TypeScript SDK, and adapt the ARIS literature skill to query Auto Researcher library data through a small paper-centric adapter layer.

**Tech Stack:** Node.js 20, Express/backend services already in this repo, libSQL/Turso, S3-backed notes, stable MCP TypeScript SDK v1.x, shell bootstrap scripts, lightweight Node tests.

---

### Task 1: Add the design and fork/update documentation

**Files:**
- Create: `docs/plans/2026-03-13-aris-mcp-integration-design.md`
- Create: `docs/plans/2026-03-13-aris-mcp-integration.md`
- Modify: `README.md`

**Step 1: Write the failing doc expectation**

Expectation:
- README should mention the ARIS integration path, our fork, and the MCP backend role.

**Step 2: Verify current docs are missing it**

Run:
```bash
rg -n "ARIS|Auto-claude-code-research-in-sleep|MCP paper library|research-lit" README.md
```

Expected: no relevant integration section exists yet.

**Step 3: Write the minimal documentation**

Add:
- a short ARIS integration section in `README.md`
- fork/update notes
- a reference to the installer/bootstrap flow

**Step 4: Verify the docs changed as expected**

Run:
```bash
rg -n "ARIS|Auto-claude-code-research-in-sleep|MCP" README.md docs/plans/2026-03-13-aris-mcp-integration-design.md docs/plans/2026-03-13-aris-mcp-integration.md
```

Expected: all new sections are discoverable.

**Step 5: Commit**

```bash
git add README.md docs/plans/2026-03-13-aris-mcp-integration-design.md docs/plans/2026-03-13-aris-mcp-integration.md
git commit -m "docs: add ARIS MCP integration design"
```

### Task 2: Add backend paper-library adapter functions with tests

**Files:**
- Create: `backend/src/services/mcp-paper-library.service.js`
- Create: `backend/src/services/__tests__/mcp-paper-library.service.test.js`
- Modify: `backend/src/services/document.service.js`
- Modify: `backend/src/services/citation.service.js`

**Step 1: Write the failing test**

Write tests for:
- search result shaping
- document detail aggregation
- note extraction
- citation export shaping

Example behaviors:
- a library search item contains `id`, `title`, `authors`, `year`, `tags`, `sourceUrl`
- a detail response includes user notes, reading history, and processed notes when present
- citation export returns BibTeX text for a document id

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/services/__tests__/mcp-paper-library.service.test.js
```

Expected: fail because the service file does not exist yet.

**Step 3: Write minimal implementation**

Implement a service that:
- queries documents from the current database
- reads S3-backed processed notes when requested
- fetches `user_notes`
- fetches `reading_history`
- uses the citation service for BibTeX output
- returns MCP-friendly paper-centric objects

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/services/__tests__/mcp-paper-library.service.test.js
```

Expected: pass.

**Step 5: Commit**

```bash
git add backend/src/services/mcp-paper-library.service.js backend/src/services/__tests__/mcp-paper-library.service.test.js backend/src/services/document.service.js backend/src/services/citation.service.js
git commit -m "feat: add paper library adapter service"
```

### Task 3: Add the stdio MCP server and smoke test

**Files:**
- Create: `backend/src/mcp/auto-researcher-mcp-server.js`
- Create: `backend/src/mcp/__tests__/auto-researcher-mcp-server.test.js`
- Modify: `backend/package.json`

**Step 1: Write the failing smoke test**

Write a test that:
- spawns the stdio MCP server
- verifies initialization and tool registration through a minimal MCP exchange, or at least verifies the server process starts and exposes the expected tool names through the SDK entrypoints used in test mode

Expected tools:
- `search_library`
- `get_document`
- `list_tags`
- `get_document_notes`
- `get_user_notes`
- `get_reading_history`
- `export_citation`

**Step 2: Run test to verify it fails**

Run:
```bash
node --test backend/src/mcp/__tests__/auto-researcher-mcp-server.test.js
```

Expected: fail because the server and dependency are missing.

**Step 3: Write minimal implementation**

Add:
- MCP SDK dependency on the stable v1.x package line
- stdio server bootstrap
- tool handlers that call `mcp-paper-library.service.js`
- a small test-mode export if needed to make smoke testing stable

**Step 4: Run test to verify it passes**

Run:
```bash
node --test backend/src/mcp/__tests__/auto-researcher-mcp-server.test.js
```

Expected: pass.

**Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/mcp/auto-researcher-mcp-server.js backend/src/mcp/__tests__/auto-researcher-mcp-server.test.js
git commit -m "feat: add auto researcher mcp server"
```

### Task 4: Wire installer/bootstrap support for ARIS fork cloning

**Files:**
- Modify: `scripts/bootstrap-project-skills.sh`
- Modify: `scripts/install.sh`
- Create: `scripts/setup-aris-integration.sh`
- Modify: `docs/INSTALLATION_MODES.md`

**Step 1: Write the failing behavior expectation**

Expectation:
- bootstrap should be able to clone or update our configured ARIS fork into the target project and surface the MCP setup instructions.

**Step 2: Verify the current scripts do not support it**

Run:
```bash
rg -n "ARIS|Auto-claude-code-research-in-sleep|research-lit|MCP" scripts/bootstrap-project-skills.sh scripts/install.sh docs/INSTALLATION_MODES.md
```

Expected: no ARIS integration flow exists.

**Step 3: Write minimal implementation**

Implement:
- configurable ARIS fork repo URL
- clone-or-pull logic into the target project's managed skills path
- a helper that prints the MCP registration command/snippet
- installer wording that points users at the ARIS integration option

**Step 4: Verify the scripts and docs**

Run:
```bash
bash -n scripts/bootstrap-project-skills.sh
bash -n scripts/install.sh
bash -n scripts/setup-aris-integration.sh
rg -n "ARIS|Auto-claude-code-research-in-sleep|MCP" scripts/bootstrap-project-skills.sh scripts/install.sh scripts/setup-aris-integration.sh docs/INSTALLATION_MODES.md
```

Expected: shell syntax is valid and the integration text is present.

**Step 5: Commit**

```bash
git add scripts/bootstrap-project-skills.sh scripts/install.sh scripts/setup-aris-integration.sh docs/INSTALLATION_MODES.md
git commit -m "feat: add aris bootstrap integration"
```

### Task 5: Vendor a maintained ARIS fork snapshot and adapter overlay metadata

**Files:**
- Create: `resource/integrations/aris/README.md`
- Create: `resource/integrations/aris/fork-strategy.md`
- Create: `resource/integrations/aris/adapter-contract.md`

**Step 1: Write the failing expectation**

Expectation:
- project-local reference docs should describe how the fork is maintained and what MCP contract the fork depends on.

**Step 2: Verify they do not exist**

Run:
```bash
rg --files resource/integrations/aris
```

Expected: no files.

**Step 3: Write minimal reference docs**

Add:
- fork maintenance instructions
- upstream sync workflow
- the MCP tool contract the fork expects

**Step 4: Verify they exist**

Run:
```bash
rg -n "fork|upstream|search_library|export_citation" resource/integrations/aris
```

Expected: the contract and process are documented.

**Step 5: Commit**

```bash
git add resource/integrations/aris/README.md resource/integrations/aris/fork-strategy.md resource/integrations/aris/adapter-contract.md
git commit -m "docs: add aris integration references"
```

### Task 6: Verify end-to-end integration readiness

**Files:**
- Modify: `README.md`
- Modify: `docs/INSTALLATION_MODES.md`
- Modify: `resource/integrations/aris/README.md`

**Step 1: Run focused verification**

Run:
```bash
node --test backend/src/services/__tests__/mcp-paper-library.service.test.js
node --test backend/src/mcp/__tests__/auto-researcher-mcp-server.test.js
bash -n scripts/bootstrap-project-skills.sh
bash -n scripts/install.sh
bash -n scripts/setup-aris-integration.sh
```

Expected: all targeted tests and shell validations pass.

**Step 2: Run a final repo status check**

Run:
```bash
git status --short
```

Expected: only intended files are changed in the areas touched for this feature, unless unrelated pre-existing workspace changes are present.

**Step 3: Commit**

```bash
git add README.md docs/INSTALLATION_MODES.md resource/integrations/aris/README.md
git commit -m "chore: finalize aris integration documentation"
```
