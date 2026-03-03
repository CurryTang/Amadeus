---
name: resource-kb-researcher
description: Answer research questions by mining the project's resource repository (resource/) with explicit file-path citations. Use this skill when KB chat misses context or when users ask to verify paper/code evidence from resource files.
---

# Resource KB Researcher

Use this skill when the user asks questions that depend on paper packs and notes stored in `resource/`, especially when Knowledge Hub assets are sparse or missing body text.

## Primary Workflow

1. Resolve project path and confirm `resource/` exists.
2. Read high-signal index files first:
- `resource/paper_assets_index.md`
- `resource/paper_assets_index.json`
- `resource/notes.md`
- `resource/research_questions.md`
3. Narrow to relevant paper folders, then read:
- `README.md`
- `arxiv_source/meta.json`
- small markdown/txt/json artifacts
4. Return findings with explicit file citations (`resource/...`) and state unknowns clearly.

## Evidence Rules

1. Do not claim support from a paper unless a local file in `resource/` confirms it.
2. If only title-level metadata exists, say "metadata-only evidence".
3. Separate:
- verified from local files,
- inferred hypothesis,
- missing evidence.

## Query Playbook

For question types and response format, use [query-playbook](references/query-playbook.md).
