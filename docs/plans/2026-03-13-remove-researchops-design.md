# Remove ResearchOps Design

## Goal

Preserve the current ResearchOps-heavy product state on a legacy branch, then repurpose `master` into a slimmer product line focused on the Chrome extension, paper saving, paper notes, tracker/latest feed, and the existing library workflows.

## Approved Scope

- Keep the Chrome extension save flow.
- Keep document upload/import, library browsing, notes, tags, read state, and search.
- Keep the latest papers and tracker surfaces.
- Remove the Vibe Researcher / ResearchOps module entirely from the active product line.
- Remove dedicated ResearchOps codepaths rather than feature-flagging them.

## Branch Strategy

- The preservation point is commit `22049b4` on `master`.
- Create `legacy/researchops-2026-03-13` at that commit.
- Continue cleanup work on `master` so the public default branch becomes the slimmer product line.

## Removal Strategy

Delete only paths that exist solely for ResearchOps/Vibe:

- `backend/src/routes/researchops`
- `backend/src/routes/researchops.js`
- `backend/src/services/researchops`
- `backend/src/services/agent-session-watcher.service.js`
- `backend/src/services/agent-session-observer`
- `backend/src/services/project-insights.service.js`
- `backend/src/services/project-insights-proxy.service.js`
- `backend/scripts/install-agent-session-observer.sh`
- `backend/scripts/researchops-agent-observer.js`
- `backend/scripts/researchops-bootstrap-client.sh`
- `backend/scripts/researchops-bootstrap-rust-daemon.sh`
- `backend/scripts/researchops-client-daemon.js`
- `backend/scripts/researchops-rust-daemon.js`
- `backend/scripts/verify-rust-daemon-prototype.js`
- `backend/rust/researchops-local-daemon`
- `frontend/src/components/VibeResearcherPanel.jsx`
- `frontend/src/components/VibeKnowledgeHubModal.jsx`
- `frontend/src/components/InteractiveAgentBashModal.jsx`
- `frontend/src/components/vibe`

Edit shared files in place instead of deleting them:

- `frontend/src/App.jsx`
- `backend/src/index.js`
- `backend/src/routes/index.js`
- `backend/processing-server.js`
- `backend/package.json`
- `README.md`
- `frontend/app/layout.jsx`
- `frontend/public/manifest.json`

## Behavioral Outcome

- The app no longer renders or fetches any ResearchOps/Vibe UI.
- The backend no longer mounts `/api/researchops` or starts ResearchOps-only background services.
- The processing server continues to support document processing, code analysis, and tracker-heavy work, but drops ResearchOps desktop endpoints and daemon bootstrapping.
- Product copy stops advertising Vibe Researcher / ResearchOps.

## Verification

- Search for remaining runtime references to `researchops`, `VibeResearcherPanel`, and `InteractiveAgentBashModal`.
- Ensure backend route loading still succeeds after route removal.
- Ensure frontend entrypoints compile after Vibe imports/state are removed.
- Run focused test/build commands for the touched frontend and backend areas.
- Confirm git status only contains the intended cleanup.
