# Step Deliverable Report

- project: {{project.name}} ({{project.id}})
- node: {{node.title}} ({{node.id}})
- run_id: {{run.id}}
- run_status: {{run.status}}
- generated_at: {{meta.generated_at}}
- base_commit: {{run_intent.base_commit}}
- project_location: {{project.location_type}}
- server_id: {{project.server_id}}

## Goal
{{run_intent.goal.summary}}

## Assumptions
{{meta.assumptions_md}}

## Commands
{{meta.commands_md}}

## Acceptance Checks
{{meta.checks_md}}

## Dependencies
{{meta.deps_md}}

## Failure Signature
- type: {{run_intent.failure_signature.type}}
- signature: {{run_intent.failure_signature.signature}}
- message: {{run_intent.failure_signature.message}}

## Context Pack
- generated_at: {{context_pack.generated_at}}
- selected_items: {{context_pack.selected_count}}

## Notes
{{meta.notes}}
