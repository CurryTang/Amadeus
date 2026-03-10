# Remote KBCTL Design
**Date:** 2026-03-10
**Approach:** Remote-only `kbctl` with persistent lexical/structural indexing on the SSH host

---

## Overview

Build a real knowledge-base retrieval system for coding agents by placing `kbctl` next to the actual KB corpus on the SSH server, not inside this web app workspace.

The current app only exposes `POST /researchops/kb/search` as:
- a proxy to `KB_SERVICE_URL` when configured, or
- a trivial substring fallback over ideas/projects metadata.

That behavior is not a usable KB. The real corpus lives on the SSH host, for example at:
- `/egr/research-dselab/testuser/AutoRDL/resource`

Each resource item is a paper-centric folder that may contain:
- `paper.pdf`
- `README.md`
- `arxiv_source/...`
- `notes/...`
- `code/<repo>/...`

There are also corpus-level helper files such as:
- `paper_assets_index.md`
- `paper_assets_index.json`
- `notes.md`
- `research_questions.md`

The design goal is a broad CLI surface that agents can call reliably for paper/code retrieval:
- `search-docs`
- `search-sections`
- `read-node`
- `search-symbols`
- `read-symbol`
- `map-paper-code`
- `build-pack`

V1 uses lexical/structural retrieval only: SQLite metadata plus FTS5-based ranking, stable node IDs, and explicit graph relations. No embeddings or hybrid retrieval in the first cut.

---

## Section 1 — Architecture Boundary

### Decision

`kbctl` lives and runs on the SSH server beside the KB corpus. This app does not build a local KB index from its own `resource/` directory.

### Why

- The real project resources are remote and materially larger than the local workspace snapshot.
- Agents need retrieval over the server-side paper/code corpus they actually execute against.
- A remote-local split avoids duplicate indexing logic and prevents stale local indexes from drifting from the true corpus.

### Resulting boundary

- Remote host responsibilities:
  - scan corpus
  - parse/index assets
  - answer `kbctl` commands
  - persist KB index state
- App responsibilities:
  - locate the project’s remote KB root
  - invoke remote `kbctl`
  - return structured payloads to frontend and agent surfaces
  - surface failures and index status

### V1 invocation model

Start with remote CLI execution over SSH. A service wrapper can be added later if needed, but the first integration path should work by running commands on the remote host directly.

---

## Section 2 — Corpus Model

Each folder under the remote `resource/` root becomes a KB asset group.

### Asset group types

- Paper group
  - primary paper document
  - source materials
  - notes
  - optional linked code repos
- Corpus helper document
  - top-level notes or index files not tied to a single paper folder

### Expected source inputs per paper group

- `paper.pdf`
- `README.md`
- `arxiv_source/meta.json`
- `arxiv_source/source.bundle`
- extracted text-like files under `arxiv_source/`
- `notes/*.md`
- `code/<repo>/**/*`

### Stable identifiers

Every indexed object gets a stable ID derived from project scope plus normalized relative path.

Examples:
- document: `doc:PluRel_Synthetic_Data_unlocks_Scaling_Laws_for_Relational_Fo:paper_pdf`
- paper section node: `node:PluRel_Synthetic_Data_unlocks_Scaling_Laws_for_Relational_Fo:sec:intro:0003`
- file node: `file:PluRel_Synthetic_Data_unlocks_Scaling_Laws_for_Relational_Fo:code:snap-stanford__plurel:train.py`
- symbol node: `sym:PluRel_Synthetic_Data_unlocks_Scaling_Laws_for_Relational_Fo:snap-stanford__plurel:train.py:Trainer`

These IDs must remain deterministic across rebuilds as long as the source path and segmentation are stable.

---

## Section 3 — Index Design

### Storage

Use a project-scoped SQLite database on the SSH host with:
- metadata tables
- FTS5 text index
- relation tables
- lightweight manifest snapshots

### Core tables

- `documents`
  - one row per logical document or repo
  - type: `paper`, `readme`, `note`, `source_file`, `repo`
- `nodes`
  - one row per retrievable unit
  - type: `page`, `section`, `chunk`, `file`, `symbol`
- `node_text_fts`
  - FTS5 virtual table over normalized text
- `edges`
  - relation graph:
    - `paper_to_repo`
    - `document_to_node`
    - `parent_to_child`
    - `file_to_symbol`
    - `paper_node_to_code_file`
    - `paper_node_to_symbol`
- `index_runs`
  - last build metadata, durations, errors, counts

### Retrieval units

Paper side:
- top-level document metadata
- page/chunk text units from PDF or source-derived text
- section/header-aware units when source structure is available

Code side:
- file-level units for general search
- symbol-level units for functions/classes/modules when extraction is possible

### Ranking

V1 ranking is lexical plus structural:
- FTS/BM25 base score
- boost title matches
- boost README and abstract-like nodes
- boost section-header hits
- boost exact symbol-name and file-name matches
- boost paper/code assets already linked by `paper_assets_index.json`

No embedding score is included in V1.

---

## Section 4 — Ingestion and Parsing

### Paper ingestion priority

1. Use corpus metadata from `paper_assets_index.json` and folder structure.
2. Index `README.md` directly.
3. Index `notes/*.md` directly.
4. Extract text from `paper.pdf` when present.
5. Use `arxiv_source/` text files and metadata to derive better section structure where available.

### PDF extraction

V1 does not need perfect scholarly parsing. It only needs:
- page text
- chunk boundaries
- optional heading heuristics
- source path and page references

If heading extraction is weak, `search-sections` can still operate on chunk nodes tagged with page spans.

### Code ingestion

For each repo under `code/`:
- walk text-like files
- skip binary, vendored, cache, and `.git`
- index file content
- extract symbols where language parser support is available
- fall back to regex/name heuristics for unsupported languages

### Symbol extraction

V1 can start with pragmatic extraction:
- Python: `ast`
- JS/TS: regex or lightweight parser if already available
- generic fallback:
  - class/function definitions
  - top-level exported names

The important requirement is that `search-symbols` and `read-symbol` work on the dominant repo languages first, even if coverage is incomplete.

---

## Section 5 — CLI Surface

### `kbctl search-docs`

Purpose:
- resolve which paper groups, top-level docs, or repos are most relevant to a query

Inputs:
- `--query`
- `--scope` (`project` default)
- `--json`
- optional project/root arguments

Output:
- ranked documents with title, kind, folder/repo identifiers, short rationale, and scores

### `kbctl search-sections`

Purpose:
- search inside one paper/doc group for relevant chunks or section-like nodes

Inputs:
- `--doc`
- `--query`
- `--json`

Output:
- ranked nodes with node ID, title/header if known, page span, snippet, score

### `kbctl read-node`

Purpose:
- return the full text and neighbors for a specific node

Inputs:
- `--doc`
- `--node`
- `--neighbors`
- `--json`

Output:
- node body plus previous/next/parent/children context when available

### `kbctl search-symbols`

Purpose:
- search code symbols within a specific repo or linked repo set

Inputs:
- `--repo`
- `--query`
- `--json`

Output:
- ranked symbol/file matches with path, symbol name, kind, and score

### `kbctl read-symbol`

Purpose:
- read the body and metadata of a specific symbol or fallback file span

Inputs:
- `--repo`
- `--symbol`
- `--path`
- `--json`

Output:
- code body, enclosing file path, surrounding context, and symbol metadata

### `kbctl map-paper-code`

Purpose:
- bridge a paper node to likely relevant files/symbols in linked repos

Inputs:
- `--paper`
- `--node`
- `--json`

Output:
- paper node metadata
- linked repo candidates
- matched files/symbols
- score/explanation

### `kbctl build-pack`

Purpose:
- build the evidence pack agents should consume before planning or implementation

Inputs:
- `--project`
- `--query`
- `--context` such as `planning`, `implementation`, or `debugging`
- `--json`

Output:
- resolved assets
- evidence items across paper/code/config
- coverage flags
- gaps
- next actions

This is the primary agent-facing command.

---

## Section 6 — Remote Backend Integration

### Replace current search behavior

The current `/researchops/kb/search` route must stop using the substring fallback over ideas/projects metadata as the main non-service path.

Instead:
- resolve the project’s remote server and KB root
- execute remote `kbctl search-docs` or `kbctl build-pack`
- normalize the result into backend payloads

### Integration path

Add a backend service dedicated to remote KB execution:
- builds SSH invocation
- validates remote paths
- runs `kbctl` with `--json`
- parses stdout
- maps stderr and exit codes into named API errors

### Endpoint strategy

V1 backend endpoints should cover the commands needed by the UI and agents first:
- `/researchops/kb/search`
- `/researchops/kb/build-pack`
- `/researchops/kb/docs/:docId/sections/search`
- `/researchops/kb/docs/:docId/nodes/:nodeId`
- `/researchops/kb/repos/:repoId/symbols/search`
- `/researchops/kb/repos/:repoId/symbols/read`

Internally, these remain wrappers around remote `kbctl`.

### Failure handling

Return explicit errors for:
- remote server unavailable
- KB root missing
- `kbctl` missing on remote host
- index missing
- stale/failed build
- malformed CLI JSON

---

## Section 7 — Index Lifecycle

### Commands

Add explicit lifecycle commands:
- `kbctl index build`
- `kbctl index refresh`
- `kbctl index status`

### Build behavior

- `build` creates the DB and full manifest from scratch
- `refresh` updates only changed files where possible
- `status` reports corpus root, doc/node counts, last build time, and last error

### Freshness detection

Use path + mtime + size, with optional content hashing for text files when needed.

V1 does not need perfect incremental invalidation; correctness matters more than maximal speed.

### Location

Store the index on the SSH host in a project-scoped path adjacent to the resource corpus or under a dedicated KB cache root, for example:
- `<project_root>/.kb/`
- or a central server-scoped cache keyed by project ID

The location must be deterministic and discoverable by the backend.

---

## Section 8 — Testing and Validation

### Remote `kbctl` tests

Add unit tests for:
- corpus discovery
- ID normalization
- FTS indexing
- section chunking
- code symbol extraction
- pack assembly

### Backend tests

Add tests for:
- remote CLI invocation and JSON parsing
- route error mapping
- fallback removal/replacement behavior
- payload normalization

### Acceptance checks

Minimum validation on the real remote KB:
- `search-docs` finds PluRel/RelBench/RT-style papers by natural-language queries
- `search-sections` returns section/page evidence from a selected paper
- `search-symbols` finds repo entrypoints and trainer/config symbols
- `map-paper-code` links paper evidence to the cloned repo when one exists
- `build-pack` returns mixed paper/code evidence with gaps and next actions

---

## Out of Scope

- embedding or hybrid retrieval
- remote HTTP KB daemon as the primary execution path
- perfect academic PDF parsing
- full multi-language AST support
- automatic answer generation on top of retrieval

V1 is retrieval-first infrastructure for agents, not a complete QA system.
