---
name: research-lit
description: Search and analyze research papers, find related work, summarize key ideas. Use when user says "find papers", "related work", "literature review", "what does this paper say", or needs to understand academic papers.
argument-hint: [paper-topic-or-url]
allowed-tools: Bash(*), Read, Glob, Grep, WebSearch, WebFetch, Write, Agent, mcp__auto-researcher__*, mcp__zotero__*, mcp__obsidian-vault__*
---

# Research Literature Review

Research topic: $ARGUMENTS

## Constants

- **PAPER_LIBRARY** — Local directory containing user's paper collection (PDFs). Check these paths in order:
  1. `papers/` in the current project directory
  2. `literature/` in the current project directory
  3. Custom path specified by user in `CLAUDE.md` under `## Paper Library`
- **MAX_LOCAL_PAPERS = 20** — Maximum number of local PDFs to scan before prioritizing by filename relevance.

> Source overrides:
> - `/research-lit "topic" — sources: auto-researcher, local`
> - `/research-lit "topic" — sources: auto-researcher, web`
> - `/research-lit "topic" — sources: web`

## Data Sources

This skill checks multiple sources in priority order and degrades gracefully:

1. **Auto Researcher library** via MCP
2. **Obsidian** via MCP
3. **Local PDFs**
4. **Web search**

Compatibility note:

- If the MCP server is still registered under `zotero`, treat it as the same paper-library backend.
- The priority is the same either way: use the saved library before local PDFs or web search.

## Workflow

### Step 0a: Search Auto Researcher Library

Try `mcp__auto-researcher__*` tools first. If unavailable, try `mcp__zotero__*` as a compatibility alias.

If the library backend is available:

1. Search saved papers by topic.
2. For the most relevant items, read processed paper notes and manual notes.
3. Read reading-history entries when they add useful context.
4. Export BibTeX for directly relevant items when citation output is needed.
5. Compile results with:
   - title
   - authors
   - year
   - venue
   - tags
   - processed notes / summaries
   - user notes / reading annotations when available

The saved library is highest priority because it reflects what the user has already curated.

### Step 0b: Search Obsidian Vault

If an Obsidian MCP server is configured:

1. Search vault notes related to the topic.
2. Pull relevant note summaries and wikilinks.
3. Use them as processed context in the final synthesis.

### Step 0c: Scan Local Paper Library

Before external search:

1. Check `papers/**/*.pdf` and `literature/**/*.pdf`.
2. Skip papers already covered by the Auto Researcher library results.
3. Read the first few pages of relevant PDFs.
4. Summarize the most relevant local papers.

### Step 1: Search the Web

- Search recent papers on the topic.
- Focus on last 2 years unless foundational work is relevant.
- Skip papers already found in the saved library, Obsidian, or local PDFs.

### Step 2: Analyze Each Paper

For each relevant paper, extract:

- problem
- method
- results
- relevance to the current direction
- source: `auto-researcher`, `obsidian`, `local`, or `web`

### Step 3: Synthesize

- group by approach/theme
- identify consensus and disagreements
- highlight open gaps
- incorporate the user's own notes when available

### Step 4: Output

Present:

```text
| Paper | Venue | Method | Key Result | Relevance to Us | Source |
```

Then provide a short landscape summary.

If citation export is available from the library backend, include a `references.bib` snippet for directly relevant papers.

## Key Rules

- Always prefer the saved Auto Researcher library before local PDFs or web search.
- Never fail because an MCP server is missing; continue with remaining sources.
- Distinguish between curated saved-library context and newly discovered web papers.
- Include citations when possible.
