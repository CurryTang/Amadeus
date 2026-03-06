# AI Notes Settings + Obsidian Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Library Settings modal for configuring AI notes refinement rounds and Obsidian vault export, with an export button per paper card.

**Architecture:** Frontend stores round prompts in localStorage + vault handle in IndexedDB via a `useAiNotesSettings` hook. Backend accepts `refinementRounds[]` in POST /reader/queue/:id, stores in the queue row, and runs custom passes in auto-reader.service.js when present. Obsidian export uses the browser File System Access API to write .md files directly into the user's local vault folder.

**Tech Stack:** React hooks, localStorage, IndexedDB (raw API), File System Access API, Express.js, libSQL/Turso

---

### Task 1: Backend — accept refinementRounds in queue route + persist in DB

**Files:**
- Modify: `backend/src/db/index.js` (processing_queue CREATE TABLE)
- Modify: `backend/src/services/queue.service.js` (enqueueDocument + dequeueNext)
- Modify: `backend/src/routes/reader.js` (POST /queue/:id)

**Step 1: Add `refinement_rounds_json` column to processing_queue table**

In `backend/src/db/index.js`, find the `CREATE TABLE IF NOT EXISTS processing_queue` statement and add the column:

```sql
refinement_rounds_json TEXT DEFAULT NULL,
```

Also add an ALTER TABLE migration after the CREATE TABLE block so existing DBs get the column:

```js
// After the CREATE TABLE for processing_queue:
try {
  await db.execute(`ALTER TABLE processing_queue ADD COLUMN refinement_rounds_json TEXT DEFAULT NULL`);
} catch (e) { /* column already exists */ }
```

**Step 2: Update enqueueDocument to accept and store rounds**

In `queue.service.js`, change signature and INSERT:

```js
async enqueueDocument(documentId, priority = 0, refinementRounds = null) {
  // ...existing validation...
  const roundsJson = refinementRounds && refinementRounds.length > 0
    ? JSON.stringify(refinementRounds) : null;

  await db.execute({
    sql: `INSERT INTO processing_queue (document_id, priority, scheduled_at, refinement_rounds_json)
          VALUES (?, ?, CURRENT_TIMESTAMP, ?)
          ON CONFLICT(document_id) DO UPDATE SET
            priority = excluded.priority,
            scheduled_at = CURRENT_TIMESTAMP,
            refinement_rounds_json = excluded.refinement_rounds_json`,
    args: [documentId, priority, roundsJson],
  });
  // ...rest unchanged...
}
```

**Step 3: Update dequeueNext to return rounds**

In the SELECT query, add `pq.refinement_rounds_json` to the SELECT columns. In the returned object:

```js
refinementRounds: item.refinement_rounds_json
  ? JSON.parse(item.refinement_rounds_json) : null,
```

**Step 4: Update POST /reader/queue/:id route to accept refinementRounds**

In `backend/src/routes/reader.js`:

```js
const { priority = 0, readerMode = 'auto_reader_v2', codeUrl, provider, refinementRounds } = req.body;
// ...existing document UPDATE...
const result = await queueService.enqueueDocument(parseInt(documentId), priority, refinementRounds || null);
```

**Step 5: Verify locally**

```bash
cd /Users/czk/auto-researcher/backend
node -e "require('./src/routes/reader')" && echo OK
```
Expected: `OK`

---

### Task 2: Backend — custom round processing in auto-reader.service.js

**Files:**
- Modify: `backend/src/services/auto-reader.service.js`
- Modify: `backend/src/services/reader.service.js`

**Step 1: Add processDocumentCustomRounds method to AutoReaderService**

After `processDocumentV2`, add:

```js
async processDocumentCustomRounds(item, options = {}) {
  const { documentId, s3Key, title, analysisProvider, refinementRounds } = item;
  let tempFilePath = null;
  const notesFilePath = path.join(this.processingDir, `${documentId}_notes.md`);
  this._currentProvider = this._resolveProvider(analysisProvider);

  try {
    await this.ensureProcessingDir();
    console.log(`[AutoReaderCustom] Starting ${refinementRounds.length}-round processing: ${title}`);

    const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
    tempFilePath = pdfInfo.filePath;

    await this.initNotesFile(notesFilePath, title, documentId);

    let previousNotes = '';
    for (let i = 0; i < refinementRounds.length; i++) {
      const round = refinementRounds[i];
      const roundNum = i + 1;
      console.log(`[AutoReaderCustom] === Round ${roundNum}/${refinementRounds.length} ===`);

      const prompt = previousNotes
        ? `${round.prompt}\n\n---\nPrevious notes for context:\n${previousNotes}`
        : round.prompt;

      const result = await this.executePass(tempFilePath, prompt, notesFilePath, roundNum);
      const cleaned = cleanLLMResponse(result.text);

      if (i === 0) {
        await this.appendToNotesFile(notesFilePath, cleaned);
      } else {
        await this.appendToNotesFile(notesFilePath, `\n\n---\n\n## Round ${roundNum}\n\n${cleaned}`);
      }
      previousNotes = await fs.readFile(notesFilePath, 'utf-8');
    }

    const finalNotes = await fs.readFile(notesFilePath, 'utf-8');
    const notesS3Key = await s3Service.uploadNotes(documentId, finalNotes);

    await db.execute({
      sql: `UPDATE documents SET notes_s3_key = ?, processing_status = 'completed',
            processing_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [notesS3Key, documentId],
    });

    return { notesS3Key, pageCount: pdfInfo.pageCount };
  } catch (error) {
    console.error(`[AutoReaderCustom] Error:`, error);
    throw error;
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
    await fs.unlink(notesFilePath).catch(() => {});
  }
}
```

**Step 2: Route to custom rounds in reader.service.js**

In `processDocument`, before the mode routing, add:

```js
// Custom refinement rounds override the mode-based routing
if (item.refinementRounds && Array.isArray(item.refinementRounds) && item.refinementRounds.length > 0) {
  console.log(`[Reader] Using custom ${item.refinementRounds.length}-round refinement for: ${title}`);
  return await autoReaderService.processDocumentCustomRounds(item, options);
}
```

**Step 3: Verify**

```bash
node -e "require('./src/services/reader.service')" && echo OK
```
Expected: `OK`

---

### Task 3: Frontend — useAiNotesSettings hook

**Files:**
- Create: `frontend/src/hooks/useAiNotesSettings.js`

**Step 1: Create the hook**

```js
import { useState, useEffect, useCallback } from 'react';

const LS_KEY = 'auto-researcher:aiNotesSettings';
const IDB_DB = 'auto-researcher-settings';
const IDB_STORE = 'kv';
const IDB_VAULT_KEY = 'obsidianVaultHandle';

const DEFAULT_ROUNDS = [
  {
    prompt: 'Based on this research paper, generate comprehensive structured notes covering: (1) core problem and motivation, (2) proposed approach and key innovations, (3) experimental setup and results, (4) limitations and future work.',
  },
  {
    prompt: 'Review and refine the notes above. Add: (1) critical analysis of the methodology, (2) connections to related work, (3) practical implications, (4) your assessment of the contribution\'s significance.',
  },
];

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbDel(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

export function useAiNotesSettings() {
  const [rounds, setRoundsState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.refinementRounds) && parsed.refinementRounds.length > 0) {
          return parsed.refinementRounds;
        }
      }
    } catch {}
    return DEFAULT_ROUNDS;
  });

  const [vaultHandle, setVaultHandle] = useState(null);
  const [vaultName, setVaultName] = useState(null);
  const [vaultReady, setVaultReady] = useState(false);

  // Load vault handle from IDB on mount
  useEffect(() => {
    idbGet(IDB_VAULT_KEY).then(async (handle) => {
      if (!handle) return;
      try {
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          setVaultHandle(handle);
          setVaultName(handle.name);
          setVaultReady(true);
        }
      } catch {}
    }).catch(() => {});
  }, []);

  const saveRounds = useCallback((newRounds) => {
    setRoundsState(newRounds);
    localStorage.setItem(LS_KEY, JSON.stringify({ refinementRounds: newRounds }));
  }, []);

  const connectVault = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('File System Access API not supported in this browser');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(IDB_VAULT_KEY, handle);
    setVaultHandle(handle);
    setVaultName(handle.name);
    setVaultReady(true);
  }, []);

  const disconnectVault = useCallback(async () => {
    await idbDel(IDB_VAULT_KEY);
    setVaultHandle(null);
    setVaultName(null);
    setVaultReady(false);
  }, []);

  const exportToVault = useCallback(async (title, notesContent) => {
    if (!vaultHandle) throw new Error('No vault connected');
    const safeName = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    const fileName = `${safeName}.md`;
    const fileHandle = await vaultHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(notesContent);
    await writable.close();
    return fileName;
  }, [vaultHandle]);

  return {
    rounds,
    saveRounds,
    vaultHandle,
    vaultName,
    vaultReady,
    connectVault,
    disconnectVault,
    exportToVault,
  };
}
```

---

### Task 4: Frontend — LibrarySettingsModal component

**Files:**
- Create: `frontend/src/components/LibrarySettingsModal.jsx`

```jsx
import { useState } from 'react';
import { useAiNotesSettings } from '../hooks/useAiNotesSettings';

export default function LibrarySettingsModal({ onClose }) {
  const { rounds, saveRounds, vaultName, vaultReady, connectVault, disconnectVault } = useAiNotesSettings();
  const [activeTab, setActiveTab] = useState('generation');
  const [localRounds, setLocalRounds] = useState(() => rounds.map((r) => ({ ...r })));
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
    const updated = localRounds.map((r, idx) => idx === i ? { ...r, prompt: value } : r);
    setLocalRounds(updated);
  };

  const handleSave = () => {
    const valid = localRounds.filter((r) => r.prompt.trim());
    if (valid.length === 0) return;
    saveRounds(valid);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleConnectVault = async () => {
    setVaultError(null);
    try {
      await connectVault();
    } catch (e) {
      if (e.name !== 'AbortError') setVaultError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal-container" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>AI Notes Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
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
        </div>

        <div className="modal-content">
          {activeTab === 'generation' && (
            <div className="settings-section">
              <p className="settings-hint">
                Each round runs the LLM once. Later rounds receive the previous output as context.
                Maximum 5 rounds.
              </p>
              {localRounds.map((round, i) => (
                <div key={i} className="settings-round-row">
                  <div className="settings-round-label">
                    <span>Round {i + 1}</span>
                    {localRounds.length > 1 && (
                      <button
                        className="settings-round-remove"
                        onClick={() => handleRemoveRound(i)}
                        title="Remove round"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <textarea
                    className="settings-round-prompt"
                    value={round.prompt}
                    onChange={(e) => handlePromptChange(i, e.target.value)}
                    rows={4}
                    placeholder="Enter prompt for this round..."
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
                Connect your local Obsidian vault folder. Exported notes will be written there as .md files.
                Requires Chrome/Edge (File System Access API).
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
        </div>

        <div className="modal-footer">
          {activeTab === 'generation' && (
            <button className="action-btn paper-btn" onClick={handleSave}>
              {saved ? '✓ Saved' : 'Save Settings'}
            </button>
          )}
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add CSS for settings-specific classes to `frontend/src/index.css`** (append at end):

```css
/* ---- LibrarySettingsModal ---- */
.settings-section { display: flex; flex-direction: column; gap: 14px; }
.settings-hint { font-size: 0.82rem; color: #64748b; margin: 0; }
.settings-subtitle { font-size: 0.95rem; font-weight: 600; color: #1e3a4c; margin: 0; }
.settings-round-row { display: flex; flex-direction: column; gap: 6px; }
.settings-round-label { display: flex; justify-content: space-between; align-items: center; font-size: 0.83rem; font-weight: 600; color: #334155; }
.settings-round-remove { background: none; border: none; color: #c73737; cursor: pointer; font-size: 1.1rem; padding: 0 4px; }
.settings-round-prompt { width: 100%; padding: 8px 10px; border: 1px solid #d4deef; border-radius: 8px; font-size: 0.83rem; font-family: inherit; resize: vertical; color: #0f172a; }
.settings-round-prompt:focus { outline: none; border-color: #155eef; }
.settings-add-round { align-self: flex-start; background: none; border: 1px dashed #94a3b8; border-radius: 8px; padding: 6px 14px; font-size: 0.82rem; color: #64748b; cursor: pointer; }
.settings-add-round:hover { border-color: #155eef; color: #155eef; }
.settings-vault-connected { display: flex; align-items: center; gap: 12px; }
.settings-vault-name { font-size: 0.88rem; font-weight: 600; color: #0f9d66; }
.settings-vault-connect { padding: 8px 16px; background: #155eef; color: #fff; border: none; border-radius: 8px; font-size: 0.85rem; cursor: pointer; }
.settings-vault-connect:hover { background: #1049c2; }
.settings-vault-disconnect { padding: 5px 12px; background: none; border: 1px solid #c73737; color: #c73737; border-radius: 8px; font-size: 0.82rem; cursor: pointer; }
.settings-error { font-size: 0.82rem; color: #c73737; margin: 0; }
```

---

### Task 5: Frontend — AI Settings button in App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

**Step 1: Import LibrarySettingsModal**

Add near other modal imports:
```js
import LibrarySettingsModal from './components/LibrarySettingsModal';
```

**Step 2: Add state**
```js
const [showAiSettings, setShowAiSettings] = useState(false);
```

**Step 3: Add button in header-actions**, right before the Auth button, only when `activeArea === 'library'` and `isAuthenticated`:

```jsx
{isAuthenticated && activeArea === 'library' && (
  <Button
    className="header-btn"
    variant="soft"
    size="2"
    onClick={() => setShowAiSettings(true)}
    title="AI Notes Settings"
  >
    AI Settings
  </Button>
)}
```

**Step 4: Render modal** near other modal renders:

```jsx
{showAiSettings && (
  <LibrarySettingsModal onClose={() => setShowAiSettings(false)} />
)}
```

---

### Task 6: Frontend — NotesModal passes refinementRounds in POST

**Files:**
- Modify: `frontend/src/components/NotesModal.jsx`

**Step 1: Import the hook**
```js
import { useAiNotesSettings } from '../hooks/useAiNotesSettings';
```

**Step 2: Use it inside the component**
```js
const { rounds } = useAiNotesSettings();
```

**Step 3: Include rounds in POST body** in `handleGenerateNotes`:
```js
body: JSON.stringify({
  readerMode: selectedMode,
  provider: selectedProvider,
  refinementRounds: rounds,
}),
```

**Step 4: Show round count summary** in the Generate panel, after the dropdowns:
```jsx
<p className="hint" style={{ marginTop: 4 }}>
  {rounds.length} refinement round{rounds.length !== 1 ? 's' : ''} configured
</p>
```

---

### Task 7: Frontend — DocumentCard Obsidian export button

**Files:**
- Modify: `frontend/src/components/DocumentCard.jsx`

**Step 1: Import hook and apiUrl prop**

The component already receives `apiUrl` — check if it's already a prop. If not, it needs to be passed from DocumentList/App.

```js
import { useAiNotesSettings } from '../hooks/useAiNotesSettings';
```

**Step 2: Use hook and add export state**

```js
const { vaultReady, exportToVault } = useAiNotesSettings();
const [exporting, setExporting] = useState(false);
const [exportResult, setExportResult] = useState(null); // null | 'ok' | 'error'
```

**Step 3: Add export handler**

```js
const handleExportToVault = async () => {
  if (!vaultReady || !hasNotes) return;
  setExporting(true);
  setExportResult(null);
  try {
    const res = await fetch(`${apiUrl}/documents/${document.id}/notes?inline=true`, {
      headers: getAuthHeaders ? getAuthHeaders() : {},
    });
    if (!res.ok) throw new Error('Failed to fetch notes');
    const data = await res.json();
    const content = data.content || data.notes || '';
    await exportToVault(document.title, content);
    setExportResult('ok');
    setTimeout(() => setExportResult(null), 2000);
  } catch (e) {
    console.error('Export error:', e);
    setExportResult('error');
    setTimeout(() => setExportResult(null), 3000);
  } finally {
    setExporting(false);
  }
};
```

**Step 4: Add button in the actions row** after the AI Notes button:

```jsx
{hasNotes && vaultReady && (
  <button
    className="action-btn vault-btn"
    onClick={handleExportToVault}
    disabled={exporting}
    title="Export to Obsidian vault"
  >
    {exporting ? '…' : exportResult === 'ok' ? '✓' : exportResult === 'error' ? '!' : '→ Vault'}
  </button>
)}
```

**Step 5: Add vault-btn CSS** in `index.css`:
```css
.vault-btn { background: #f0fdf4; border-color: #6ee7b7; color: #065f46; }
.vault-btn:hover { background: #dcfce7; }
```

---

### Task 8: Deploy

```bash
# Backend
cd /Users/czk/auto-researcher/backend
git add src/db/index.js src/services/queue.service.js src/routes/reader.js src/services/auto-reader.service.js src/services/reader.service.js
git commit -m "feat: add refinementRounds support in queue and auto-reader"
# then deploy-backend skill

# Frontend
# deploy-frontend skill
```
