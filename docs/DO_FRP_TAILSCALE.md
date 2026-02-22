# DO + FRP + Optional Tailscale (Merged Deployment)

This repo keeps one codebase and one auth/metadata system, with heavy work offloaded.

Flow:
`Client -> DO API -> FRP -> local executor -> DO API -> Client`

## DO server (lightweight)

Set in `backend/.env`:

```bash
TRACKER_ENABLED=false
TRACKER_PROXY_HEAVY_OPS=true
TRACKER_DESKTOP_URL=http://127.0.0.1:7001
TRACKER_PROXY_TIMEOUT=120000
PROCESSING_DESKTOP_URL=http://127.0.0.1:7001
```

Apply remotely with:

```bash
./scripts/set-do-tracker-proxy.sh
```

## Local executor (heavy jobs)

Set in local `backend/.env`:

```bash
TRACKER_ENABLED=true
TRACKER_PROXY_HEAVY_OPS=false
```

Start local services:

```bash
cd backend
npm run processing
```

## Optional Tailscale support

If FRP is tunneled through Tailscale, enable:

```bash
TAILSCALE_ENABLED=true
TAILSCALE_DESKTOP_URL=http://100.x.y.z:7001
```

When `PROCESSING_DESKTOP_URL` is not set, backend will use `TAILSCALE_DESKTOP_URL`.

## Verify offload

```bash
./scripts/verify-frp-offload.sh
```

Checks:
- DO API local health
- FRP target health from DO
- Public tracker status
- DO log mode showing scheduler disabled for tracker
