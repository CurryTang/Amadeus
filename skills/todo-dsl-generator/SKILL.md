---
name: todo-dsl-generator
description: Convert rough user ideas/proposals/chat transcripts into structured TODO DSL steps, with per-step knowledge/codebase references for low-bias orchestration.
---

# TODO DSL Generator

Use this skill when a user provides:
- rough idea bullets,
- long proposal text,
- chat logs from Claude/GPT,
and wants actionable structured steps.

## Input
- user instruction or proposal text
- project metadata (`name`, `projectPath`, `knowledgeGroupIds`)

## Output Contract
Return `todoDsl` with ordered `steps`:
- `step_id`
- `title`
- `kind`
- `objective`
- `assumptions[]`
- `acceptance[]`
- `commands[]`
- `checks[]`
- `depends_on[]`
- `references.knowledge[]`
- `references.codebase[]`

Also return flattened `todoCandidates[]` for TODO cards.

## Reference Policy
For each step, bind references from:
1. knowledge base assets/documents
2. project codebase files

If no strong match exists, keep references empty rather than fabricating.

## Quality Gates
- avoid generic placeholders
- one step should be runnable/reviewable in one session
- dependency order must be explicit
- acceptance/check definitions should be concrete
