---
name: node-run-clarify
description: Interactive Q&A to gather run context before executing a ResearchOps tree node step. Use when a node is about to be run to collect key context the agent will need (e.g. dataset path, design doc, hyperparameters).
---

# Node Run Clarification

Gather context from the user through targeted one-at-a-time questions before launching a tree node's run step. The LLM decides what to ask based on the node kind and existing plan details.

## Workflow

1. **Trigger**: User clicks "Run Step" on a PLANNED or BLOCKED node in VibeNodeWorkbench.
2. **Q&A Loop**: Call `POST /api/researchops/projects/:projectId/tree/nodes/:nodeId/run-clarify` with:
   - `messages`: conversation so far (starts empty `[]`)
   - Response: `{ done: bool, question: string, options?: string[] }`
   - Present `question` to user (with `options` as quick-reply buttons if provided)
   - Append user answer as `{ role: "user", content: "<answer>" }` to messages
   - Repeat until `done: true`
3. **Skip**: User can skip the Q&A entirely. In that case, `clarifyMessages` is `[]`.
4. **Run**: Call `POST /api/researchops/projects/:projectId/tree/nodes/:nodeId/run-step` with:
   - `clarifyMessages`: the full Q&A exchange (or `[]` if skipped)
   - Other options: `force`, `preflightOnly`, `searchTrialCount`

## Node Kind Guidance

The clarify endpoint adapts questions by node kind:

| Kind | Typical questions |
|------|-------------------|
| `experiment` | Dataset path? Baseline to compare against? Key hyperparameters? |
| `implementation` | Which design doc to follow? Which KB files are relevant? Branch to work on? |
| `analysis` | Which run outputs to analyze? Expected metrics? Comparison baseline? |
| `knowledge` | Which papers/assets to pull in? Specific sections needed? |
| `search` | Search budget? Metric to optimize? Constraint ranges? |

## Context Storage

Clarification messages are stored in the run metadata (`clarifyContext`) so the agent can reference them during execution. They supplement — not replace — the node's existing plan fields.

## UI Integration

The ClarificationChat component lives inside VibeNodeWorkbench (always visible for runnable nodes). It resets when the selected node changes. Users can toggle Skip Q&A / Enable Q&A at any time before launching the run.
