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
