# Continuous Integration

This repository uses GitHub Actions to run core checks on every `push` and `pull_request`.

Workflow file: `.github/workflows/ci.yml`

## What CI runs

1. Frontend build (`frontend`)
- `npm ci`
- `npm run build`

2. Backend install and syntax check (`backend`)
- `npm ci`
- `node --check` over all `backend/src/**/*.js` plus `backend/processing-server.js`
- Browser downloads are skipped in CI for speed and reliability:
  - `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
  - `PUPPETEER_SKIP_DOWNLOAD=true`

## Local parity commands

Run the same checks locally before opening a PR:

```bash
cd frontend && npm ci && npm run build
cd ../backend && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=true npm ci
cd ../backend && find src -type f -name '*.js' -print0 | xargs -0 -I{} node --check "{}" && node --check processing-server.js
```

## Extending CI

- Add unit/integration tests when test scripts are available.
- Add lint checks after ESLint config is introduced.
- Add deployment workflow separately so CI remains fast and deterministic.
