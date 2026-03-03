import { useState } from 'react';

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
                <p className="obs-export-empty">No pending exports. Select papers in Library → Research Mode → → Obsidian.</p>
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
