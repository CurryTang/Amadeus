---
name: project-todo-manager
description: Manage project-management TODO workflows in ResearchOps. Use this skill when a user asks to generate, prioritize, clear, classify, or execute TODO items, or asks what to do next for project management tasks.
---

# Project Todo Manager

Use this skill to answer and execute TODO-related requests against ResearchOps projects.

## Workflow

1. Resolve the target project and fetch current TODO items (`OPEN`, `DONE`, `COMPLETED`, blocked states).
2. Classify the user request into one action:
- `summarize`: show status, blockers, and top priorities.
- `prioritize`: reorder open TODOs by urgency, dependency, and execution cost.
- `execute-next`: select one actionable TODO and prepare/run the appropriate agent step.
- `clear`: bulk-close current open TODOs only when explicitly requested.
- `generate`: create TODOs from proposal/instruction text.
- `generate-dsl`: request `todo-dsl-generator` and convert free-form idea/proposal into structured step DSL first.
3. Keep updates auditable:
- preserve original TODO text;
- write concise status transition notes;
- avoid destructive edits to already completed tasks unless explicitly requested.

## Prioritization Rules

1. Prefer TODOs that unblock downstream steps.
2. Prefer TODOs with clear acceptance checks and runnable commands.
3. Defer TODOs requiring missing infra/credentials and mark as blocked with reason.
4. If two tasks are equivalent, choose lower runtime/cost first.

## Output Contract

Always return:
- `selected_action`
- `todo_snapshot` (open/done counts)
- `next_steps` (1-3 concrete commands or API actions)
- `risk_notes` (blocking assumptions)
- when `generate-dsl` is used: `todo_dsl_summary` (step count + reference coverage)

## References

Read [query-playbook](references/query-playbook.md) for request-to-action mapping examples.
