# Tracker Authentication Guide

This guide explains authentication setup for:
- Google Scholar tracker (via Gmail alert emails)
- Twitter/X tracker (via Playwright session)

## 1) Google Scholar Tracker Authentication

The Scholar tracker does not log into Google Scholar directly. It reads unread Scholar alert emails from Gmail (`scholaralerts-noreply@google.com`) over IMAP.

### Prerequisites

1. Enable 2-Step Verification on your Google account.
2. Create a Gmail App Password:
   - https://myaccount.google.com/apppasswords
3. Make sure you already receive Google Scholar alerts in that Gmail inbox.

### Configure in Tracker Admin

Create a source with:
- `type`: `scholar`
- `email`: your Gmail address
- `password`: the 16-character App Password (not your normal Google password)
- `markRead`: optional (`true` recommended to avoid re-processing)

### Backend dependencies

If Scholar tracker dependencies are missing:

```bash
cd backend
npm install imapflow mailparser cheerio
```

## 2) Twitter/X Tracker Authentication (Playwright)

Twitter tracker uses Playwright and requires an authenticated X session.

### Important deployment note

For low-memory DO setups, run heavy tracker work on the local executor through FRP (recommended).

- DO: `TRACKER_ENABLED=false`, `TRACKER_PROXY_HEAVY_OPS=true`
- Local executor: `TRACKER_ENABLED=true`

### Install Playwright on the machine that runs tracker execution

```bash
cd backend
npm install
npx playwright install chromium
```

### Create an authenticated storage state file

Run this one-time command on the execution machine (WSL/Linux/macOS):

```bash
cd backend
npm run setup:x-session
```

Optional custom path:

```bash
npm run setup:x-session -- --out /home/<user>/.playwright/x-session.json
```

### If backend server has no GUI

Use any machine with a GUI once, then copy the session JSON to backend server.

```bash
# On GUI machine
cd backend
npm run setup:x-session -- --out ./x-session.json

# Copy to headless backend host
scp ./x-session.json <server-user>@<server-host>:/home/<user>/.playwright/x-session.json
```

### Set environment variable

In `backend/.env` on the execution machine:

```bash
X_PLAYWRIGHT_STORAGE_STATE_PATH=/absolute/path/to/x-session.json
```

WSL example:

```bash
X_PLAYWRIGHT_STORAGE_STATE_PATH=/home/<user>/.playwright/x-session.json
```

Important:
- Do not use paths from another OS/device (for example `/Users/...` on Linux).
- The file must exist on the same machine/user account that runs backend tracker.

### Configure in Tracker Admin

Create a source with:
- `type`: `twitter`
- `mode`: `playwright`
- `trackingMode`: `paper` (current default mode)
- `profileLinks`: one or more `https://x.com/<handle>`
- `maxPostsPerProfile`: e.g. `5`
- `onlyWithModeMatches`: optional (`true` to keep only mode-matching posts)

## 3) Verify Setup

1. Run source from Tracker Admin (`Run` button), or call:
   - `POST /api/tracker/run`
2. Check status:
   - `GET /api/tracker/status`
3. For DO + FRP setup, verify from DO:
   - `curl http://127.0.0.1:7001/health`

## 4) Common Issues

- `Invalid username or password` (Scholar):
  - Usually wrong app password or 2FA/app-password not configured.
- `Connection not available` (Scholar):
  - IMAP/network issue or Gmail security restriction.
- `playwright is not installed` (Twitter):
  - Install Playwright + Chromium on execution node.
- `X Playwright storage state not found`:
  - Path is wrong for current host/OS, or file not created yet.
  - Run `npm run setup:x-session` on the execution node and update `X_PLAYWRIGHT_STORAGE_STATE_PATH`.
- Timeline shows old/pinned posts repeatedly:
  - Usually unauthenticated session. Recreate session with `npm run setup:x-session`.
- `Desktop tracker request failed (404)`:
  - DO is proxying to an older local processing server; update/restart local executor.
