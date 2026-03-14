# Auto Researcher VS Code Companion

This package provides a compact list-first VS Code companion for tracked papers, library papers, and ARIS runs.

## V1 scope

- Load tracked papers from the tracker feed
- Explicitly save tracked papers into the library
- Load saved library papers
- Mark library papers read or unread
- Queue reader processing for a saved paper
- Load ARIS projects and recent runs
- Launch a new ARIS run
- Refresh ARIS state
- Retry the selected ARIS run
- Inspect selected item details in a webview
- Copy the selected ARIS run id

Out of scope for v1:

- Chrome-extension save flows
- Browser page capture and PDF capture inside VS Code
- Remote file browsing
- Terminal orchestration

## Requirements

- Auto Researcher backend running with tracker, library, and ARIS routes enabled
- Valid API bearer token for the backend
- VS Code 1.97 or newer

Required backend endpoints:

- `GET /api/tracker/feed`
- `POST /api/upload/arxiv`
- `GET /api/documents`
- `GET /api/documents/:id/notes`
- `PATCH /api/documents/:id/read`
- `POST /api/reader/queue/:documentId`
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
