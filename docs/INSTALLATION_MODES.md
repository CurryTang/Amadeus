# Installation Modes and Provider Matrix

Use the interactive installer:

```bash
./scripts/install.sh
```

It generates:
- `backend/.env.generated`
- `frontend/.env.generated`
- `deployment.mode.generated`

Installer prompts include:
- Deployment mode preset (1-4)
- Object storage provider
- Document metadata provider (sqlite/Turso)
- ResearchOps metadata provider (Mongo local/Atlas)
- Network topology (direct/FRP/FRP+Tailscale)
- Twitter/X Playwright refresh execution target (backend vs client)
- Frontend compile target + deploy target
- Backend compile target + deploy target
- Optional ARIS workflow integration flag

## Supported deployment modes

1. Frontend local, backend remote, cloud databases  
2. All local (frontend + backend + local databases)  
3. All remote with cloud databases  
4. All remote with self-hosted databases on same server

## Paper storage providers

- `aws-s3`
- `minio` (local host server, local client machine, or LAN device)
- `aliyun-oss` (S3 compatible endpoint mode)

Configured by:
- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_FORCE_PATH_STYLE`
- `OBJECT_STORAGE_PUBLIC_BASE_URL`

Common MinIO endpoint examples:
- MinIO on backend host: `OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000`
- MinIO on another LAN device/client: `OBJECT_STORAGE_ENDPOINT=http://192.168.x.x:9000`

## Metadata providers

Documents/tags/auth (libSQL layer):
- local sqlite: `TURSO_DATABASE_URL=file:./local.db`
- Turso cloud: `TURSO_DATABASE_URL=libsql://...`

ResearchOps metadata (Mongo layer):
- local MongoDB: `MONGODB_URI=mongodb://127.0.0.1:27017/...`
- MongoDB Atlas: `MONGODB_URI=mongodb+srv://...`

## Remote offload options

- direct (no FRP)
- FRP offload
- FRP + Tailscale

Related env keys:
- `PROCESSING_ENABLED`
- `PROCESSING_DESKTOP_URL`
- `TRACKER_PROXY_HEAVY_OPS`
- `TRACKER_PROXY_STRICT`
- `TRACKER_EXECUTION_TARGET`
- `TRACKER_STALE_AUTO_RUN`
- `TRACKER_STALE_PROXY_AUTO_RUN`
- `TRACKER_STALE_RUN_TRIGGER_MS`
- `TAILSCALE_ENABLED`
- `TAILSCALE_DESKTOP_URL`

## Tracker execution target

Installer now asks where Twitter/X Playwright refresh should run:

- `backend` target:
  - `TRACKER_ENABLED=true`
  - `TRACKER_PROXY_HEAVY_OPS=false`
  - scheduler/refresh runs on backend node.

- `client` target (proxied):
  - `TRACKER_ENABLED=false`
  - `TRACKER_PROXY_HEAVY_OPS=true`
  - `TRACKER_PROXY_STRICT=true` (no fallback to backend-local heavy run)
  - refresh only runs when the client executor is reachable/online.

24h stale refresh behavior:
- Installer sets `TRACKER_STALE_RUN_TRIGGER_MS=86400000` (24h).
- On client checks (`/api/tracker/status`), if last refresh is older than threshold and client executor is online, backend triggers a proxied refresh.
- If client executor is offline, no refresh is started.

Helper scripts:

```bash
./scripts/set-do-tracker-proxy.sh
./scripts/verify-frp-offload.sh
```

## ARIS workflow integration

The installer can also enable ARIS integration metadata in `deployment.mode.generated`.

ARIS is intended to run on the always-on WSL/local executor host, not on the browser machine. The frontend `ARIS` workspace launches runs against that persistent runner so autonomous loops can continue if the laptop sleeps or the browser tab closes.

The actual project-side install is handled by:

```bash
./scripts/setup-aris-integration.sh /path/to/project
```

That flow:

- clones or updates the configured ARIS repo into the target project's `.claude/skills/aris`
- applies the Auto Researcher overlay for `research-lit`
- prints the MCP registration commands for the Auto Researcher library backend
- assumes a persistent remote workspace model where code sync is incremental and datasets remain on remote paths instead of being uploaded from the client
- pairs naturally with managed SSH server records, where the WSL runner is the ARIS control plane and other servers are downstream experiment targets
- expects the chosen WSL runner to have `claude` installed and reachable through the configured SSH server record; set `ARIS_REMOTE_AGENT_BIN` if the binary name differs

Configurable environment variables:

- `ARIS_SKILLS_REPO`
- `ARIS_SKILLS_REF`
- `ARIS_INTEGRATION_ENABLED`

## VS Code companion surface

The VS Code companion is not a separate deployment mode. It is a client surface that talks to the existing backend.

Use it when:

- ARIS is already running through the normal backend/local-executor topology
- you want a compact in-editor control surface for ARIS runs
- you do not need Chrome-extension save flows inside VS Code

The extension currently depends on the backend exposing:

- `GET /api/aris/context`
- `GET /api/aris/runs`
- `GET /api/aris/runs/:runId`
- `POST /api/aris/runs`
- `POST /api/aris/runs/:runId/retry`

The extension package lives in `vscode-extension/`. Development details are in `vscode-extension/README.md`.
