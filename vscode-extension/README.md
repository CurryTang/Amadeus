# ARIS VS Code Companion

This package provides a compact VS Code companion for ARIS runs.

## V1 scope

- Load ARIS projects and recent runs
- Launch a new ARIS run
- Refresh ARIS state
- Retry the selected ARIS run
- Inspect selected run details in a webview
- Copy the selected run id

Out of scope for v1:

- Chrome-extension save flows
- Remote file browsing
- Terminal orchestration
- General library/document management

## Requirements

- Auto Researcher backend running with ARIS routes enabled
- Valid API bearer token for the backend
- VS Code 1.97 or newer

Required backend endpoints:

- `GET /api/aris/context`
- `GET /api/aris/runs`
- `GET /api/aris/runs/:runId`
- `POST /api/aris/runs`
- `POST /api/aris/runs/:runId/retry`

## Development

```bash
cd vscode-extension
npm install
npm run compile
npm test
```

To run the extension in VS Code:

1. Open the repository in VS Code.
2. Open the `vscode-extension/` folder as part of the workspace.
3. Run `Developer: Reload Window` if the extension manifest changed.
4. Press `F5` from the extension project to open an Extension Development Host.

## Configuration

Settings:

- `aris.apiBaseUrl`
- `aris.refreshIntervalSeconds`
- `aris.defaultProjectId`
- `aris.defaultWorkflowType`

Auth:

- The extension stores the bearer token in VS Code secret storage under `aris.authToken`.
- On first refresh or run launch, it prompts for the token if none is stored yet.
