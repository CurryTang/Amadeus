---
name: init-repo
description: Initialize a new research repository with the recommended AIRS project structure. Use when starting a new project, setting up a repo, or user says "init repo", "scaffold project", "create project structure".
argument-hint: [project-name-or-description]
allowed-tools: Bash(*), Read, Glob, Grep, Write, Agent
---

# Initialize Research Repository

Project: $ARGUMENTS

## Overview

Scaffold a new research repository following the AIRS recommended structure.
This creates a reproducible, well-organized project layout with pixi for
environment management and clearly separated concerns.

## Target Directory Structure

```
<project-root>/
├── pixi.toml              # Pixi environment config (conda/pip dependencies)
├── pixi.lock              # Auto-generated lock file (do NOT create manually)
├── .gitignore             # Ignore patterns for data, checkpoints, outputs
├── README.md              # Project overview and getting started
├── resource/              # Related papers (PDFs) and reference codebases
│   ├── papers/            # PDFs of related work
│   └── codebase/          # Cloned or vendored reference implementations
├── papers/                # LaTeX paper sources
│   ├── main.tex           # Main LaTeX entry point
│   ├── references.bib     # BibTeX references
│   └── figures/           # Figures for the paper
├── scripts/               # Experiment-related scripts (train, eval, plot)
├── main/                  # Main entry functions and core source code
│   └── __init__.py        # Package init (empty)
└── outputs/               # Experiment outputs, logs, checkpoints (gitignored)
```

## Workflow

### Step 1: Determine project root

- If a project name or path is given in $ARGUMENTS, use it.
- If the current directory is empty or looks like a fresh repo, use it as root.
- Otherwise, create a subdirectory named after the project.

### Step 2: Create directory structure

Create all directories:

```bash
mkdir -p resource/papers resource/codebase papers/figures scripts main outputs
```

### Step 3: Create pixi.toml

Generate a `pixi.toml` with:
- Project name derived from the directory name or $ARGUMENTS
- Python as the default dependency
- A `default` environment
- Common scientific computing channels (conda-forge)

Template:

```toml
[project]
name = "<project-name>"
version = "0.1.0"
description = "<one-line description from ARGUMENTS or 'Research project'>"
channels = ["conda-forge"]
platforms = ["linux-64"]

[tasks]
train = "python main/train.py"
eval = "python main/eval.py"

[dependencies]
python = ">=3.10"

[pypi-dependencies]
```

Adjust `platforms` based on the target system if known (e.g., add `osx-arm64` for Mac).

### Step 4: Create .gitignore

```gitignore
# Outputs and checkpoints
outputs/
checkpoints/
*.ckpt
*.pt
*.pth

# Pixi
.pixi/
pixi.lock

# Python
__pycache__/
*.pyc
*.egg-info/
dist/
build/

# Data
data/
*.h5
*.hdf5
*.parquet

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

### Step 5: Create placeholder files

1. `main/__init__.py` — empty file
2. `papers/main.tex` — minimal LaTeX skeleton:

```latex
\documentclass{article}
\usepackage{amsmath,graphicx}
\bibliographystyle{plain}

\title{<Project Name>}
\author{}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
TODO: Abstract
\end{abstract}

\section{Introduction}
TODO: Introduction

\section{Related Work}
TODO: Related Work

\section{Method}
TODO: Method

\section{Experiments}
TODO: Experiments

\section{Conclusion}
TODO: Conclusion

\bibliography{references}
\end{document}
```

3. `papers/references.bib` — empty file with a header comment
4. `README.md` — brief project overview with the directory structure explained
5. `scripts/.gitkeep` — keep the directory in git
6. `resource/papers/.gitkeep` — keep the directory in git
7. `resource/codebase/.gitkeep` — keep the directory in git

### Step 6: Initialize git (if not already a repo)

```bash
git init
git add -A
git commit -m "init: scaffold AIRS research repository structure"
```

If already inside a git repo, just stage and commit the new files.

### Step 7: Initialize pixi environment

If `pixi` is available on the system:

```bash
pixi install
```

If pixi is not installed, skip this step and note in the output that the user
should install pixi (`curl -fsSL https://pixi.sh/install.sh | bash`) and run
`pixi install` manually.

## Key Rules

- Never overwrite existing files. If a file already exists, skip it and report.
- Use the project name from $ARGUMENTS to populate pixi.toml and LaTeX title.
- Keep all generated files minimal — no boilerplate beyond what's shown above.
- The `outputs/` directory must be gitignored.
- Always create the full directory tree even if some directories start empty.
