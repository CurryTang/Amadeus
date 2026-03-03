# Query Playbook

## Request Mapping

- "What should I do next?" -> `execute-next`
- "Help me clean up these tasks" -> `clear`
- "Generate TODOs from this proposal" -> `generate`
- "Sort tasks by priority" -> `prioritize`
- "Summarize PM status" -> `summarize`

## Clear Action Guardrail

Only clear TODOs when user intent is explicit (`clear`, `close all`, `mark all done`).

## Execute-Next Heuristic

1. Candidate must be open.
2. Candidate should not require unresolved manual gate unless user approves bypass.
3. Candidate should map to an existing skill (`implement`, `experiment`, or project-specific TODO skill).
