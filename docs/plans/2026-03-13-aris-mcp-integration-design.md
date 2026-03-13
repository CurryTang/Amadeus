# ARIS MCP Integration Design
**Date:** 2026-03-13
**Approach:** Maintain a lightly patched fork of ARIS and integrate it into Auto Researcher through an installer-managed clone plus an Auto Researcher-backed MCP paper library server.

---

## Overview

Integrate ARIS into Auto Researcher through our maintained fork, [CurryTang/Auto-claude-code-research-in-sleep](https://github.com/CurryTang/Auto-claude-code-research-in-sleep), without hard-vendoring the upstream repository into this codebase.

The system should:

- keep ARIS updateable from upstream
- replace ARIS's Zotero dependency with an Auto Researcher-backed MCP interface
- install the ARIS skills into a project in a repeatable way
- preserve current Auto Researcher library behavior, especially the rule that tracker-discovered papers are not auto-saved into the library

The integration boundary is:

- ARIS fork owns research workflow skills and lightweight setup docs
- Auto Researcher owns the paper library, notes, citations, and MCP adapter implementation

---

## Section 1 — Fork and Upstream Strategy

### Decision

Create and maintain a GitHub fork of ARIS as a lightly patched upstream dependency.

### Why

- Directly copying their repo into this one would make upstream updates painful.
- A fork lets us publish a canonical Auto Researcher-compatible variant.
- A lightly patched fork can still merge upstream changes with standard `git merge upstream/main` flows.

### Rules for maintainability

- Keep upstream file layout intact where possible.
- Restrict fork changes to a narrow surface:
  - setup docs
  - install/bootstrap helper scripts
  - a small number of skill files, primarily `research-lit`
  - optional adapter/config notes
- Avoid broad formatting, file moves, or unrelated rewrites in the fork.
- Keep Auto Researcher-specific logic out of the fork when it can live here instead.

### Result

The fork becomes the canonical ARIS source for our users, while this repo remains the product that provisions and serves the backend functionality ARIS consumes.

---

## Section 2 — Integration Boundary in Auto Researcher

### Decision

Auto Researcher will integrate ARIS as an installer-managed external component.

### Shape

- Auto Researcher install/bootstrap scripts clone our ARIS fork into a managed location under the target project, for example `.claude/skills/aris`.
- Auto Researcher exposes a local MCP server process that surfaces the user's library and notes as MCP tools.
- The ARIS fork ships skills that call this MCP backend instead of expecting Zotero.

### Why this is better than hard-vendoring

- Upstream updates stay isolated to the fork.
- Product integration stays isolated to this repo.
- The target project gets a reproducible installed state from scripts rather than ad hoc copying.

---

## Section 3 — MCP Contract

### Decision

Expose an Auto Researcher paper-library MCP server that covers the capabilities ARIS currently expects from Zotero-like access.

### Required tool surface

V1 should support these capabilities:

- search library items by topic/query
- fetch a document by id
- list tags
- list saved user notes for a document
- fetch processed paper notes / summaries for a document
- fetch reading history for a document
- export citations in BibTeX or other supported formats

### Mapping to current Auto Researcher data

- library documents: `documents`
- user-created annotations: `user_notes`
- processed analysis: `notes_s3_key` content
- read events / reading notes: `reading_history`
- citation export: `citation.service.js`
- tags: `tag.service.js`

### Compatibility requirement

The MCP responses should be shaped for ARIS usage rather than mirroring the internal database schema. The adapter is allowed to aggregate across multiple Auto Researcher tables and S3-backed notes into a single paper-centric response.

---

## Section 4 — ARIS Skill Adaptation

### Decision

Patch the forked `research-lit` skill to prefer an Auto Researcher MCP namespace and terminology, while keeping a compatibility path for a `zotero` alias.

### Why

- Pure aliasing under the name `zotero` would work technically, but it would leave the user-facing docs and skill text semantically wrong.
- Rewriting the whole skill set is unnecessary and would create merge friction.

### V1 scope

Only patch the literature-discovery path that depends on Zotero-like data:

- rename the source description from Zotero-specific to library-specific where needed
- instruct the skill to use the Auto Researcher MCP server first
- retain graceful degradation to local PDFs and web search

### Compatibility fallback

If users still register the server under the name `zotero`, the fork should continue to work. This reduces breakage during migration and keeps older setup snippets viable.

---

## Section 5 — Installer and Bootstrap Changes

### Decision

Extend the existing bootstrap/install flow in this repo to manage both:

- cloning or updating the ARIS fork
- provisioning an Auto Researcher MCP server launcher

### Target behavior

The installer should:

1. clone or update the configured ARIS fork
2. place ARIS skills under the target project's `.claude/skills/`
3. generate or update a local MCP registration helper/config snippet for the Auto Researcher MCP server
4. document how users point Claude Code or Codex to the installed server

### Update model

Later updates should be simple:

- update the ARIS fork itself from upstream
- rerun the bootstrap script
- refresh the installed skill copy and MCP launcher

---

## Section 6 — Server Runtime Shape

### Decision

Implement the MCP server in the Auto Researcher backend workspace as a stdio process using the stable MCP TypeScript SDK v1.x line.

### Why

- ARIS is consumed in local coding-agent environments where stdio MCP is the normal integration path.
- Auto Researcher already uses Node.js and already has direct access to the services and data needed for library lookups.
- A stdio server avoids introducing another always-on HTTP service purely for local MCP registration.

### Runtime boundary

The MCP server process should call internal service logic directly where practical, or local HTTP endpoints only if that substantially reduces duplication. For V1, direct service reuse is preferred.

---

## Section 7 — Testing and Verification

### Required verification

- unit tests for the adapter logic that shapes document, notes, and citation data into MCP responses
- an integration-style smoke test that starts the MCP server and verifies tool discovery/invocation
- installer script verification for clone-or-update behavior
- documentation review for the fork/update workflow

### Non-goals for V1

- full remote HTTP MCP hosting
- real-time library sync into ARIS
- automatic saving from ARIS into Auto Researcher
- replacing every ARIS skill; only the paper-library-dependent path needs adaptation first

---

## Final Decision

We will:

- maintain a GitHub fork of ARIS as a lightly patched upstream dependency
- integrate that fork into Auto Researcher through installer-managed cloning
- add an Auto Researcher MCP paper-library server in this repo
- patch ARIS's literature skill and setup docs to use the new MCP backend
- preserve a Zotero-compatible alias to reduce migration friction

This gives us a clean separation:

- ARIS fork: workflows
- Auto Researcher: knowledge backend and installation plumbing

That separation is the best tradeoff between updateability, product ownership, and implementation speed.
