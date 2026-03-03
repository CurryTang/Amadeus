# WSL Sync Playbook

## Goal

Keep a WSL clone synchronized with upstream and ensure backend tracker runtime dependencies are present.

## Standard Path

- Typical repo path on WSL: `/home/<user>/auto-researcher`
- Backend path: `/home/<user>/auto-researcher/backend`

## Fast Checks

```bash
cd /home/<user>/auto-researcher
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git status --short
```

Interpret `git rev-list`:
- `0 0`: up to date
- `X 0`: local ahead
- `0 Y`: local behind

## Full Sync Command

```bash
cd /home/<user>/auto-researcher
bash skills/repo-sync-updater/scripts/sync_wsl_repo.sh --repo /home/<user>/auto-researcher
```

## Playwright Missing Browser Fix

If tracker errors include `Executable doesn't exist` for Playwright:

```bash
cd /home/<user>/auto-researcher/backend
npx playwright install chromium
```

Then restart backend service.

## Host Selection Rule

Run sync and Playwright install on the host/user that actually runs backend tracker jobs.
In this architecture that is usually the local executor behind FRP, not the low-memory DO proxy host.
