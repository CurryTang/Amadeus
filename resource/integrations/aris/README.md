# ARIS Integration

This directory contains the Auto Researcher integration material for ARIS (Auto-claude-code-research-in-sleep).

Contents:

- `fork-strategy.md`: how to maintain a fork that stays mergeable with upstream
- `adapter-contract.md`: the MCP tool contract the ARIS integration expects
- `overlay/`: small maintained file overlays applied after cloning the ARIS repo

The intended flow is:

1. Maintain a lightweight GitHub fork of ARIS.
2. Clone that fork into a target project with `scripts/setup-aris-integration.sh`.
3. Apply the overlay in this folder to adapt ARIS toward Auto Researcher.
4. Register the Auto Researcher MCP server in the coding-agent environment.
