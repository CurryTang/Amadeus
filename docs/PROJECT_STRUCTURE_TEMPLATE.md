# Project Structure Template

Use this as a starter layout for new research projects.

```text
ProjectName/
├── scripts/        # Download/generation scripts
├── data/           # Loading/processing
├── relbench-new/   # Modified relbench / custom benchmark code
├── models/         # dfs/, griffin/, nn/ (RT, GNN)
├── rustler/        # Rust sequence generator (Polars, PyO3, rkyv)
├── dbinfer/        # DBInfer solutions
├── main/           # Entry points
├── cache_data/     # Cached data/embeddings
├── .claude/
│   └── skills/     # Agent skills (local + external bootstrap)
└── resource/       # Project knowledge base / references
```

## Required startup rule

- Agents must check `resource/` first for project references.

## Skills bootstrap

```bash
./scripts/bootstrap-project-skills.sh /path/to/ProjectName
```

This includes:

- `https://github.com/Orchestra-Research/AI-Research-SKILLs`
- local `agent-instructions-generator` skill
