# Obsidian Batch Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "→ Obsidian" button to Library research-mode action bar that multi-exports AI notes to Obsidian vault, auto-generating notes for papers that don't have them yet via an async background queue.

**Architecture:** Frontend-only (no backend changes). New `useObsidianExportBatch` hook stores pending jobs in localStorage and polls every 20s via existing `/api/documents/:id` and `/api/reader/queue/:id` endpoints. When notes complete, the hook auto-writes to the vault via the File System Access API. Status visible in AI Settings → Exports tab.

**Tech Stack:** React hooks, localStorage, axios, File System Access API (already in `useAiNotesSettings`), existing backend endpoints.

---

## Reference: Key File Locations

- `frontend/src/App.jsx` — main app; research action bar at lines 692–758; LibrarySettingsModal rendered at line 851–853
- `frontend/src/hooks/useAiNotesSettings.js` — vault state + `exportToVault`; currently called inside LibrarySettingsModal
- `frontend/src/components/LibrarySettingsModal.jsx` — calls `useAiNotesSettings()` internally; has Generation + Integrations tabs
- `frontend/src/components/DocumentCard.jsx:200-201` — `hasNotes = processingStatus === 'completed'`
- Notes API response shape (DocumentCard.jsx:97): `{ content, notes }` — use `data.content || data.notes || ''`
- Queue endpoint: `POST /api/reader/queue/:id` body: `{ readerMode, refinementRounds }`
- Document status endpoint: `GET /api/documents/:id` — returns doc with `processingStatus` field

---

## Task 1: Create `useObsidianExportBatch` hook

**Files:**
- Create: `frontend/src/hooks/useObsidianExportBatch.js`

**Step 1: Create the file with this exact content:**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const LS_KEY = 'auto-researcher:obsidian-batch';
const POLL_MS = 20000;

function loadItems() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw).items || [];
  } catch (_) {}
  return [];
}

function persist(items) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ items })); } catch (_) {}
}

export function useObsidianExportBatch({ apiUrl, getAuthHeaders, exportToVault }) {
  const [items, setItemsRaw] = useState(() => loadItems());
  const exportRef = useRef(exportToVault);
  useEffect(() => { exportRef.current = exportToVault; }, [exportToVault]);

  const setItems = useCallback((updater) => {
    setItemsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persist(next);
      return next;
    });
  }, []);

  // addToBatch: docs is array of { id, title } that need notes generated
  const addToBatch = useCallback(async (docs, rounds) => {
    let added = 0;
    for (const doc of docs) {
      try {
        await axios.post(
          `${apiUrl}/reader/queue/${doc.id}`,
          { readerMode: 'auto_reader_v2', refinementRounds: rounds },
          { headers: getAuthHeaders() },
        );
        setItems((prev) => {
          if (prev.some((i) => i.docId === doc.id)) return prev;
          return [...prev, { docId: doc.id, title: doc.title, status: 'queued', addedAt: Date.now() }];
        });
        added++;
      } catch (err) {
        console.error('[ObsidianBatch] failed to queue', doc.id, err);
      }
    }
    return added;
  }, [apiUrl, getAuthHeaders, setItems]);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== 'exported'));
  }, [setItems]);

  const retryItem = useCallback(async (docId, rounds) => {
    const item = items.find((i) => i.docId === docId);
    if (!item) return;
    try {
      await axios.post(
        `${apiUrl}/reader/queue/${docId}`,
        { readerMode: 'auto_reader_v2', refinementRounds: rounds },
        { headers: getAuthHeaders() },
      );
      setItems((prev) => prev.map((i) => i.docId === docId ? { ...i, status: 'queued' } : i));
    } catch (err) {
      console.error('[ObsidianBatch] retry failed', docId, err);
    }
  }, [apiUrl, getAuthHeaders, items, setItems]);

  // Background poller
  useEffect(() => {
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'generating');
    if (pending.length === 0) return;

    const poll = async () => {
      for (const item of pending) {
        try {
          const docRes = await axios.get(`${apiUrl}/documents/${item.docId}`, { headers: getAuthHeaders() });
          const ps = docRes.data?.processingStatus || docRes.data?.processing_status || '';
          if (ps === 'completed') {
            try {
              const notesRes = await axios.get(
                `${apiUrl}/documents/${item.docId}/notes?inline=true`,
                { headers: getAuthHeaders() },
              );
              const content = notesRes.data?.content || notesRes.data?.notes || '';
              await exportRef.current(item.title, typeof content === 'string' ? content : JSON.stringify(content));
              setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'exported' } : i));
            } catch (exportErr) {
              console.error('[ObsidianBatch] vault write failed', item.docId, exportErr);
              setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'failed' } : i));
            }
          } else if (ps === 'failed' || ps === 'error') {
            setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'failed' } : i));
          } else {
            setItems((prev) => prev.map((i) =>
              i.docId === item.docId && i.status === 'queued' ? { ...i, status: 'generating' } : i
            ));
          }
        } catch (err) {
          console.error('[ObsidianBatch] poll error', item.docId, err);
        }
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [items, apiUrl, getAuthHeaders, setItems]);

  return { batchItems: items, addToBatch, clearCompleted, retryItem };
}
```

**Step 2: Verify file exists:**
```bash
ls frontend/src/hooks/useObsidianExportBatch.js
```
Expected: file listed.

**Step 3: Commit:**
```bash
git add frontend/src/hooks/useObsidianExportBatch.js
git commit -m "feat: add useObsidianExportBatch hook for async Obsidian batch export"
```

---

## Task 2: Lift `useAiNotesSettings` to `App.jsx` and wire `useObsidianExportBatch`

**Files:**
- Modify: `frontend/src/App.jsx`

Currently `useAiNotesSettings()` is called only inside `LibrarySettingsModal`. We need to lift it to `App.jsx` so `exportToVault`, `vaultReady`, and `rounds` are available at the top level.

**Step 1: Add imports at the top of `App.jsx` (after existing imports, around line 16):**

Add these two lines after the existing import block:
```js
import { useAiNotesSettings } from './hooks/useAiNotesSettings';
import { useObsidianExportBatch } from './hooks/useObsidianExportBatch';
```

**Step 2: Inside `AppContent()`, after line 91 (the `useAuth` destructure), add:**

```js
const { rounds, saveRounds, vaultHandle, vaultName, vaultReady, connectVault, disconnectVault, exportToVault } =
    useAiNotesSettings();

  const { batchItems, addToBatch, clearCompleted, retryItem } = useObsidianExportBatch({
    apiUrl: API_URL,
    getAuthHeaders,
    exportToVault,
  });
```

**Step 3: Add the `handleObsidianBatch` function.** Place it after `generatePaperList` (after line 411):

```js
const handleObsidianBatch = useCallback(async () => {
    if (selectedDocIds.size === 0 || !vaultReady) return;
    const selected = documents.filter((d) => selectedDocIds.has(d.id));
    const withNotes = selected.filter((d) => (d.processingStatus || '') === 'completed');
    const withoutNotes = selected.filter((d) => (d.processingStatus || '') !== 'completed');

    // Immediately export papers that already have notes
    for (const doc of withNotes) {
      try {
        const res = await axios.get(`${API_URL}/documents/${doc.id}/notes?inline=true`, { headers: getAuthHeaders() });
        const content = res.data?.content || res.data?.notes || '';
        await exportToVault(doc.title, typeof content === 'string' ? content : JSON.stringify(content));
      } catch (err) {
        console.error('[ObsidianBatch] immediate export failed', doc.id, err);
      }
    }

    // Queue papers without notes
    if (withoutNotes.length > 0) {
      await addToBatch(withoutNotes.map((d) => ({ id: d.id, title: d.title })), rounds);
    }
  }, [addToBatch, documents, exportToVault, getAuthHeaders, rounds, selectedDocIds, vaultReady]);
```

Note: this requires adding `useCallback` to the imports at the top of the file — check if it's already imported (it's imported from React at line 3 but currently only `useState`, `useEffect`, `useRef` are imported). Update line 3 to:
```js
import { useState, useEffect, useRef, useCallback } from 'react';
```

**Step 4: Add the "→ Obsidian" button in the research action bar.**

Find the `research-action-bar-right` div (around line 729). Add the new button **before** the Cancel button:

```jsx
<button
  className="research-obsidian-btn"
  onClick={handleObsidianBatch}
  disabled={selectedDocIds.size === 0 || !vaultReady}
  title={!vaultReady ? 'Connect vault in AI Settings first' : `Export ${selectedDocIds.size} paper${selectedDocIds.size !== 1 ? 's' : ''} to Obsidian`}
>
  → Obsidian
</button>
```

Place it between the Send button and the Cancel button.

**Step 5: Update the `LibrarySettingsModal` render (around line 851) to pass the lifted hook values as props:**

Change:
```jsx
{showAiSettings && (
  <LibrarySettingsModal onClose={() => setShowAiSettings(false)} />
)}
```
To:
```jsx
{showAiSettings && (
  <LibrarySettingsModal
    onClose={() => setShowAiSettings(false)}
    rounds={rounds}
    saveRounds={saveRounds}
    vaultName={vaultName}
    vaultReady={vaultReady}
    connectVault={connectVault}
    disconnectVault={disconnectVault}
    batchItems={batchItems}
    clearCompleted={clearCompleted}
    retryItem={retryItem}
    exportRounds={rounds}
  />
)}
```

**Step 6: Build to check no errors:**
```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully` (or warnings only — no errors).

**Step 7: Commit:**
```bash
git add frontend/src/App.jsx
git commit -m "feat: lift useAiNotesSettings to App.jsx, wire Obsidian batch hook and button"
```

---

## Task 3: Update `LibrarySettingsModal` to accept props and add Exports tab

**Files:**
- Modify: `frontend/src/components/LibrarySettingsModal.jsx`

Currently the component calls `useAiNotesSettings()` internally. We switch it to accept props.

**Step 1: Replace the entire file with the following:**

```jsx
import { useState } from 'react';

const KIND_TABS = ['generation', 'integrations', 'exports'];

export default function LibrarySettingsModal({
  onClose,
  // Generation tab
  rounds,
  saveRounds,
  // Integrations tab
  vaultName,
  vaultReady,
  connectVault,
  disconnectVault,
  // Exports tab
  batchItems = [],
  clearCompleted,
  retryItem,
  exportRounds = [],
}) {
  const [activeTab, setActiveTab] = useState('generation');
  const [localRounds, setLocalRounds] = useState(() => (rounds || []).map((r) => ({ ...r })));
  const [vaultError, setVaultError] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleAddRound = () => {
    if (localRounds.length >= 5) return;
    setLocalRounds([...localRounds, { prompt: '' }]);
  };

  const handleRemoveRound = (i) => {
    if (localRounds.length <= 1) return;
    setLocalRounds(localRounds.filter((_, idx) => idx !== i));
  };

  const handlePromptChange = (i, value) => {
    setLocalRounds(localRounds.map((r, idx) => (idx === i ? { ...r, prompt: value } : r)));
  };

  const handleSave = () => {
    const valid = localRounds.filter((r) => r.prompt.trim());
    if (valid.length === 0) return;
    saveRounds?.(valid);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleConnectVault = async () => {
    setVaultError(null);
    try {
      await connectVault?.();
    } catch (e) {
      if (e.name !== 'AbortError') setVaultError(e.message);
    }
  };

  const pendingCount = batchItems.filter((i) => i.status === 'queued' || i.status === 'generating').length;

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal-container" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="header-title-row">
            <h2>AI Notes Settings</h2>
          </div>
          <div className="header-actions">
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab${activeTab === 'generation' ? ' active' : ''}`}
            onClick={() => setActiveTab('generation')}
          >
            Generation
          </button>
          <button
            className={`modal-tab${activeTab === 'integrations' ? ' active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            Integrations
          </button>
          <button
            className={`modal-tab${activeTab === 'exports' ? ' active' : ''}`}
            onClick={() => setActiveTab('exports')}
          >
            Exports{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        </div>

        <div className="modal-content">
          {activeTab === 'generation' && (
            <div className="settings-section">
              <p className="settings-hint">
                Each round runs the LLM once against the full PDF. Later rounds receive all
                previous output as context. Maximum 5 rounds.
              </p>
              {localRounds.map((round, i) => (
                <div key={i} className="settings-round-row">
                  <div className="settings-round-label">
                    <span>Round {i + 1}</span>
                    {localRounds.length > 1 && (
                      <button
                        className="settings-round-remove"
                        onClick={() => handleRemoveRound(i)}
                        title="Remove this round"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <textarea
                    className="settings-round-prompt"
                    value={round.prompt}
                    onChange={(e) => handlePromptChange(i, e.target.value)}
                    rows={3}
                    placeholder="Enter the prompt for this round…"
                  />
                </div>
              ))}
              {localRounds.length < 5 && (
                <button className="settings-add-round" onClick={handleAddRound}>
                  + Add Round
                </button>
              )}
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="settings-section">
              <h3 className="settings-subtitle">Obsidian Vault</h3>
              <p className="settings-hint">
                Connect your local Obsidian vault folder. When connected, a{' '}
                <strong>→ Vault</strong> button will appear on each paper card that has AI
                notes, letting you export them as .md files directly into your vault. Requires
                Chrome or Edge (File System Access API).
              </p>
              {vaultReady ? (
                <div className="settings-vault-connected">
                  <span className="settings-vault-name">✓ {vaultName}</span>
                  <button className="settings-vault-disconnect" onClick={disconnectVault}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <button className="settings-vault-connect" onClick={handleConnectVault}>
                  Connect Vault Folder…
                </button>
              )}
              {vaultError && <p className="settings-error">{vaultError}</p>}
            </div>
          )}

          {activeTab === 'exports' && (
            <div className="settings-section">
              <p className="settings-hint">
                Papers queued for Obsidian export. Notes are generated in the background and
                written to your vault automatically when ready.
              </p>
              {batchItems.length === 0 ? (
                <p className="obs-export-empty">No pending exports. Select papers in Library → Research Mode → Obsidian.</p>
              ) : (
                <div className="obs-export-list">
                  {batchItems.map((item) => (
                    <div key={item.docId} className="obs-export-item">
                      <span className="obs-export-title" title={item.title}>{item.title}</span>
                      <div className="obs-export-right">
                        <span className={`obs-export-status obs-export-status--${item.status}`}>
                          {item.status === 'queued' && '○ queued'}
                          {item.status === 'generating' && '◌ generating'}
                          {item.status === 'exported' && '● exported'}
                          {item.status === 'failed' && '✗ failed'}
                        </span>
                        {item.status === 'failed' && (
                          <button
                            className="obs-export-retry-btn"
                            onClick={() => retryItem?.(item.docId, exportRounds)}
                            title="Retry"
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {batchItems.some((i) => i.status === 'exported') && (
                <button className="obs-export-clear-btn" onClick={clearCompleted}>
                  Clear completed
                </button>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {activeTab === 'generation' && (
            <button className="action-btn paper-btn" onClick={handleSave}>
              {saved ? '✓ Saved' : 'Save Settings'}
            </button>
          )}
          <button className="action-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Build to check no errors:**
```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`

**Step 3: Commit:**
```bash
git add frontend/src/components/LibrarySettingsModal.jsx
git commit -m "feat: add Exports tab to LibrarySettingsModal, accept vault/batch props"
```

---

## Task 4: Add CSS for new elements

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Find the end of the `.settings-error` rule (around line 9309). Add these rules immediately after:**

```css
/* Obsidian batch export tab */
.obs-export-empty { font-size: 0.82rem; color: #94a3b8; margin: 0; }
.obs-export-list { display: flex; flex-direction: column; gap: 8px; }
.obs-export-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e8edf4; border-radius: 8px; }
.obs-export-title { font-size: 0.83rem; color: #0f172a; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obs-export-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.obs-export-status { font-size: 0.78rem; font-weight: 500; }
.obs-export-status--queued { color: #94a3b8; }
.obs-export-status--generating { color: #f59e0b; }
.obs-export-status--exported { color: #10b981; }
.obs-export-status--failed { color: #ef4444; }
.obs-export-retry-btn { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1rem; padding: 0 2px; line-height: 1; }
.obs-export-retry-btn:hover { color: #b91c1c; }
.obs-export-clear-btn { align-self: flex-start; background: none; border: 1px dashed #94a3b8; border-radius: 8px; padding: 6px 14px; font-size: 0.82rem; color: #64748b; cursor: pointer; margin-top: 4px; }
.obs-export-clear-btn:hover { border-color: #155eef; color: #155eef; }

/* Research action bar — Obsidian export button */
.research-obsidian-btn { padding: 7px 14px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: background 0.15s; }
.research-obsidian-btn:hover:not(:disabled) { background: #4f46e5; }
.research-obsidian-btn:disabled { opacity: 0.45; cursor: not-allowed; }
```

**Step 2: Build:**
```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: `✓ Compiled successfully`

**Step 3: Commit:**
```bash
git add frontend/src/index.css
git commit -m "feat: add CSS for Obsidian batch export button and status tab"
```

---

## Task 5: Deploy and verify

**Step 1: Deploy frontend using deploy-frontend skill**

**Step 2: Manual smoke test:**
1. Open Library tab → click "AI Settings" → verify "Exports" tab is present with empty state
2. Enter Research Mode → verify "→ Obsidian" button appears (disabled if no vault connected)
3. Connect vault in AI Settings → Integrations tab
4. Return to Research Mode, select a paper with existing notes → click "→ Obsidian" → file should appear in vault folder
5. Select a paper without notes → click "→ Obsidian" → AI Settings → Exports tab should show "○ queued" then "◌ generating"
6. After notes generate: verify status becomes "● exported" and file appears in vault
