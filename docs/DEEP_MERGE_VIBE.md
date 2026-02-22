# Deep Merge Plan: `real-auto-researcher` -> `auto-researcher`

This repository now integrates Vibe Researcher at code level (not as a standalone app process).

## What is merged now

### Backend (native integration)
- New merged API namespace: `/api/researchops/*`
- Added routes in `backend/src/routes/researchops.js`:
  - `GET/POST /projects`
  - `GET /projects/:projectId`
  - `GET/POST /ideas`
  - `GET /ideas/:ideaId`
  - `POST /runs/enqueue`
  - `GET /runs`
  - `GET /runs/:runId`
  - `POST /runs/:runId/status`
  - `POST /runs/:runId/cancel`
  - `GET/POST /runs/:runId/events`
  - `GET /scheduler/queue`
  - `POST /scheduler/lease-next`
  - `POST /scheduler/lease-and-execute`
  - `POST /scheduler/recover-stale`
  - `GET /runner/running`
  - `POST /daemons/register`
  - `POST /daemons/heartbeat`
  - `GET /daemons`
  - `POST /kb/search`
  - `POST /experiments/execute`
  - `GET /skills`
- Added metadata store in `backend/src/services/researchops/store.js`:
  - MongoDB default (`DB_PROVIDER=mongodb`)
  - Per-user ownership using this repo's login (`req.userId`)
  - Memory fallback if Mongo is unavailable
  - Queue leasing with daemon-capacity checks
  - Atomic run-event sequence reservation (duplicate-safe)
  - Stale run recovery (`PROVISIONING` -> `QUEUED`, `RUNNING` -> `FAILED`)
- Added local runner execution in `backend/src/services/researchops/runner.js`:
  - Command spawn for AGENT/EXPERIMENT runs
  - Streaming log events + status transitions
  - Cancellation and timeout handling

### Frontend (native integration)
- New in-app panel: `frontend/src/components/VibeResearcherPanel.jsx`
- Wired into existing app tab system in `frontend/src/App.jsx` as third subwindow `Vibe`
- Uses merged backend endpoints above (same login/session/auth headers)
- Converted frontend runtime to Next.js app-router in-place (`frontend/app/*`)
- Header and subwindow tabs are now sticky and layout-consistent across `Latest / Library / Vibe`

### Security / hygiene
- Legacy standalone folder `apps/vibe-researcher/` has been removed.
- Keep generated frontend artifacts out of git:
  - `frontend/.next/`

### Infra (DO + FRP + optional Tailscale)
- Added DO/local offload automation scripts:
  - `scripts/set-do-tracker-proxy.sh`
  - `scripts/verify-frp-offload.sh`
- Added optional tailscale-aware desktop endpoint support in backend config:
  - `TAILSCALE_ENABLED`
  - `TAILSCALE_DESKTOP_URL`
- DO remains lightweight proxy; local executor keeps heavy jobs.

## Source mapping from `real-auto-researcher`

- Control-plane concepts merged into existing backend:
  - Projects, Ideas, Runs, Queue, Skills
- Web dashboard flows merged into existing frontend:
  - Create project, create idea, enqueue run, queue/projects/ideas views

## Remaining deep-merge follow-ups

1. Port project-level RBAC from control-plane model into current auth users without breaking existing login UX.
2. Add artifact persistence model for run outputs (summary/log/git diffs) and UI drill-down pages.
3. Add daemon process isolation/workspace manager parity with `real-auto-researcher` runner-daemon.
4. Expand KB/experiment bridges from proxy mode to first-class managed services.
