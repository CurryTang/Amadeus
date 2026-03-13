# ARIS Fork Strategy

Use these rules to keep the fork easy to merge with upstream:

- Keep upstream repo structure intact.
- Restrict our changes to setup docs, bootstrap scripts, and a very small number of skill files.
- Do not do repo-wide formatting passes.
- Do not rename upstream folders unless absolutely necessary.
- Prefer overlay files applied after clone over large in-place rewrites.

Recommended remotes:

- `origin`: `https://github.com/CurryTang/Auto-claude-code-research-in-sleep.git`
- `upstream`: `https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep.git`

Recommended update loop:

1. `git fetch upstream`
2. `git checkout main`
3. `git merge upstream/main`
4. resolve only the narrow integration conflicts
5. push `origin/main`

If we need a clean comparison point later, maintain a branch such as `upstream-sync` that mirrors upstream with no Auto Researcher-specific commits.
