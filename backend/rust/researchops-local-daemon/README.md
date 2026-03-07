# ResearchOps Local Daemon Prototype

This crate is the first Rust-side prototype for the local bridge/runtime work in `docs/research_agent_env_spec`.

Current scope:

- mirror the v0 trait contracts from `docs/research_agent_env_spec/contracts/rust_traits.rs`
- provide a typed runtime summary for the current daemon task catalog
- provide a typed task catalog view for built-in and bridge task families
- expose a tiny CLI that prints the runtime summary as JSON
- expose localhost HTTP and Unix socket prototypes for `/health`, `/runtime`, and `/task-catalog`
- proxy thin backend bridge routes for local clients:
  - `/node-context?projectId=...&nodeId=...`
  - `/bridge-report?runId=...`
  - `/context-pack?runId=...`
  - `POST /node-run?projectId=...&nodeId=...`
  - `POST /bridge-note?runId=...`
- expose `POST /tasks/execute` for task-catalog-aligned bridge execution
- execute the current built-in project task family through the same task endpoint:
  - `project.checkPath`
  - `project.ensurePath`
  - `project.ensureGit`
- execute a thin local snapshot helper through the same task endpoint:
  - `bridge.captureWorkspaceSnapshot`

It does not yet implement:

- real task execution
- snapshot syncing
- artifact upload or event reporting beyond the current bridge-note flow

Run it with:

```bash
cd /Users/czk/auto-researcher/backend
npm run researchops:rust-daemon-prototype
```

Or directly:

```bash
source "$HOME/.cargo/env"
cargo run --manifest-path /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/Cargo.toml --quiet
```

Print the task catalog instead:

```bash
source "$HOME/.cargo/env"
cargo run --manifest-path /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/Cargo.toml --quiet -- --task-catalog
```

Serve one local HTTP request on an explicit address:

```bash
source "$HOME/.cargo/env"
cargo run --manifest-path /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/Cargo.toml --quiet -- --serve-once 127.0.0.1:7788
```

Serve continuously on localhost:

```bash
cd /Users/czk/auto-researcher/backend
npm run researchops:rust-daemon-serve
```

Serve continuously over a Unix domain socket:

```bash
cd /Users/czk/auto-researcher/backend
npm run researchops:rust-daemon-serve-unix
```

You can also cap the loop for testing:

```bash
source "$HOME/.cargo/env"
cargo run --manifest-path /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/Cargo.toml --quiet -- --serve 127.0.0.1:7788 --max-requests 2
```

Or do the same on a socket:

```bash
source "$HOME/.cargo/env"
cargo run --manifest-path /Users/czk/auto-researcher/backend/rust/researchops-local-daemon/Cargo.toml --quiet -- --serve-unix /tmp/researchops-local-daemon.sock --max-requests 2
```

Set `RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS=false` to print a project-only runtime summary.

Set these when you want the prototype to proxy existing backend read APIs:

```bash
export RESEARCHOPS_API_BASE_URL=http://127.0.0.1:3001
export ADMIN_TOKEN=your-admin-token
```

Then the daemon can proxy:

```bash
curl "http://127.0.0.1:7788/node-context?projectId=proj_1&nodeId=node_eval&includeContextPack=true&includeReport=true"
curl "http://127.0.0.1:7788/bridge-report?runId=run_123"
curl "http://127.0.0.1:7788/context-pack?runId=run_123"
curl -X POST "http://127.0.0.1:7788/node-run?projectId=proj_1&nodeId=node_eval" \
  -H 'Content-Type: application/json' \
  -d '{"force":true}'
curl -X POST "http://127.0.0.1:7788/bridge-note?runId=run_123" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Bridge note","content":"hello from rust"}'
curl -X POST "http://127.0.0.1:7788/tasks/execute" \
  -H 'Content-Type: application/json' \
  -d '{"taskType":"bridge.fetchRunReport","payload":{"runId":"run_123"}}'
curl -X POST "http://127.0.0.1:7788/tasks/execute" \
  -H 'Content-Type: application/json' \
  -d '{"taskType":"project.checkPath","payload":{"projectPath":"/tmp/my-project"}}'
curl -X POST "http://127.0.0.1:7788/tasks/execute" \
  -H 'Content-Type: application/json' \
  -d '{"taskType":"bridge.captureWorkspaceSnapshot","payload":{"workspacePath":"./frontend","kind":"workspace_patch","note":"local edits"}}'
```
