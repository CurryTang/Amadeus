---
name: repo-sync-updater
description: Synchronize a local or WSL clone with its upstream branch and verify backend runtime prerequisites for this project. Use when users ask to check whether the server is up to date, pull latest changes, fix drift between local and remote branches, or resolve backend tracker runtime issues after updates (especially Playwright browser missing errors).
---

# Repo Sync Updater

Keep this clone synchronized with upstream in a safe, repeatable way and confirm backend runtime readiness for tracker jobs.

## Workflow

1. Confirm execution host and repo path.
- Prefer running on the real executor host that runs heavy tracker/backend tasks.
- For this project, that is usually the local machine behind FRP, not the lightweight DO proxy host.
- Typical WSL path: `/home/<user>/auto-researcher`.

2. Run a non-mutating preflight first.
- Command:
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher --dry-run --skip-backend`
- Review `ahead/behind` and dirty-tree status before mutating.

3. Run sync with fast-forward safety.
- Command:
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher`
- Behavior:
  - Fetches remote.
  - Pulls with `--ff-only`.
  - Refuses to pull if branch is behind and working tree is dirty (unless `--allow-dirty` is set explicitly).

4. Refresh backend runtime prerequisites.
- Included in default script behavior:
  - `npm ci` in `backend/`
  - `npx playwright install chromium`
- This specifically prevents tracker failures like missing Playwright browser executables.

5. Restart backend service.
- Restart whichever process manager you use (`pm2`, `systemd`, docker compose, etc.).

## Command Reference

- Full sync + runtime refresh:
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher`
- Sync only (skip backend install):
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher --skip-backend`
- Dry run:
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher --dry-run --skip-backend`
- Custom branch:
  - `bash scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher --branch main`

## Bundled Resources

- Script: `scripts/sync_wsl_repo.sh`
- Reference: `references/wsl-sync-playbook.md`
