# ResearchOps Local Daemon Prototype

This crate is the first Rust-side prototype for the local bridge/runtime work in `docs/research_agent_env_spec`.

Current scope:

- mirror the v0 trait contracts from `docs/research_agent_env_spec/contracts/rust_traits.rs`
- provide a typed runtime summary for the current daemon task catalog
- provide a typed task catalog view for built-in and bridge task families
- expose a tiny CLI that prints the runtime summary as JSON
- expose a single-request localhost HTTP prototype for `/health`, `/runtime`, and `/task-catalog`

It does not yet implement:

- HTTP or Unix socket serving
- real task execution
- snapshot syncing
- artifact upload or event reporting

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
