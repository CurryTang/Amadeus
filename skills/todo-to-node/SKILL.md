---
name: todo-to-node
description: Convert a project TODO item into a ResearchOps tree node via LLM. Use when a user wants to expand a TODO into an executable research plan node with commands, checks, and acceptance criteria.
---

# TODO to Tree Node

Convert a single project TODO (title + hypothesis) into a fully-specified ResearchOps tree node that can be inserted into the project plan.

## Workflow

1. **Input**: Receive `todo` object (`id`, `title`, `hypothesis`) and optional `parentNodeId`.
2. **Clarification Phase** (optional, per-run configurable): Call `POST /api/researchops/projects/:projectId/tree/nodes/from-todo/clarify` with:
   - `todo`: the TODO object
   - `messages`: conversation so far (starts empty)
   - The backend returns `{ done, question, options? }`. Ask the question; when `done: true`, proceed to generate.
   - User can Skip Q&A to bypass this phase entirely.
   - Prompts are targeted at the TODO kind: papers referenced, KB code files needed, env assumptions, implementation vs experiment differences.
3. **Generate**: Call `POST /api/researchops/projects/:projectId/tree/nodes/from-todo` with:
   - `todo`: the TODO object
   - `parentNodeId`: optional parent node to attach under
   - `messages`: clarification exchange collected in phase 2 (empty if skipped)
4. **Review**: Present the generated node fields to the user:
   - `id`, `title`, `kind`
   - `assumption[]`: what the node assumes
   - `target[]`: measurable success criteria
   - `commands[]`: concrete runnable commands
   - `checks[]`: verification steps
5. **Refine** (optional): If user wants changes, send a follow-up request with:
   - Same `todo`
   - `messages`: conversation history `[{role, content}]` where assistant messages include the previous node JSON
6. **Insert**: Call `POST /api/researchops/projects/:projectId/tree/plan/patches` with:
   ```json
   { "patches": [{ "op": "add_node", "node": <generated_node> }] }
   ```

## Node Schema

```json
{
  "id": "snake_case_slug",
  "parent": "optional_parent_node_id",
  "title": "Human-readable title",
  "kind": "experiment | analysis | knowledge | setup | milestone | patch | search",
  "assumption": ["key assumption 1"],
  "target": ["measurable criterion 1"],
  "commands": [{"cmd": "bash command", "label": "label"}],
  "checks": [{"condition": "verification", "label": "label"}],
  "tags": ["tag1"]
}
```

## Refinement Examples

- "Make commands use python3 instead of python"
- "Add a validation step that checks the model accuracy"
- "Change kind to analysis"
- "Add an assumption that the dataset is already downloaded"

## Error Handling

- If LLM fails to return valid JSON: show raw text and ask user to retry
- If insert fails: show patch error and keep generated node for retry
