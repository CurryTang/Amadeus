# ResearchOps Local Daemon Prototype

This crate is the first Rust-side prototype for the local bridge/runtime work in `docs/research_agent_env_spec`.

Current scope:

- mirror the v0 trait contracts from `docs/research_agent_env_spec/contracts/rust_traits.rs`
- provide a typed runtime summary for the current daemon task catalog
- expose a tiny CLI that prints the runtime summary as JSON

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

Set `RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS=false` to print a project-only runtime summary.
