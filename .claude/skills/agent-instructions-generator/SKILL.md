---
name: agent-instructions-generator
description: Generate baseline CLAUDE.md and AGENTS.md instruction files for a project. Use when a repo is missing instruction files or needs standardized agent guidance.
---

# Agent Instructions Generator

## What this skill does

- Creates `CLAUDE.md` and `AGENTS.md` from templates.
- Enforces a reference-first rule pointing agents to `resource/`.

## How to run

From repo root:

```bash
./scripts/generate-agent-instructions.sh
```

For a different project and name:

```bash
./scripts/generate-agent-instructions.sh /path/to/project ProjectName
```

Overwrite existing files:

```bash
./scripts/generate-agent-instructions.sh /path/to/project ProjectName --force
```
