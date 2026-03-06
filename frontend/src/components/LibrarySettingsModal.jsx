import { useEffect, useState } from 'react';
import axios from 'axios';
import { PROVIDER_OPTIONS, MODEL_OPTIONS, THINKING_OPTIONS, REASONING_OPTIONS } from '../hooks/useAiNotesSettings';
import { buildUiConfigPatch, normalizeUiConfig } from '../lib/uiConfig';
import {
  addProjectTemplateDraft,
  createProjectTemplateDraft,
  removeProjectTemplateDraft,
  serializeProjectTemplateDrafts,
  updateProjectTemplateDraft,
  validateProjectTemplateDrafts,
} from './projectTemplates';

const looksLikeUrl = (s) => /^https?:\/\//i.test((s || '').trim());

function SkillCard({ round, index, total, onChange, onRemove }) {
  const isEditing = round.editing;
  const isResolving = round.resolving;
  const hasPrompt = !!(round.prompt && round.prompt.trim());

  const handleEditClick = () => {
    onChange({ ...round, editing: true, editText: round.input || '' });
  };

  const handleCancel = () => {
    onChange({ ...round, editing: false, editText: '' });
  };

  const handleTextChange = (e) => {
    onChange({ ...round, editText: e.target.value });
  };

  return (
    <div className="skill-card">
      <div className="skill-card-header">
        <span className="skill-card-label">Round {index + 1}</span>
        {total > 1 && (
          <button className="settings-round-remove" onClick={onRemove} title="Remove round">×</button>
        )}
      </div>

      {isResolving && (
        <div className="skill-resolving">
          <span className="skill-spinner" />
          Installing skill…
        </div>
      )}

      {!isResolving && round.error && (
        <div className="skill-error">{round.error}</div>
      )}

      {!isResolving && isEditing && (
        <div className="skill-edit-area">
          <div className="skill-input-prefix">
            {looksLikeUrl(round.editText)
              ? <span className="skill-type-icon" title="Will install from URL">🔗</span>
              : <span className="skill-type-icon" title="Will create with AI">✨</span>}
          </div>
          <textarea
            className="skill-input"
            rows={2}
            value={round.editText}
            onChange={handleTextChange}
            placeholder="Paste a skill URL (e.g. https://github.com/…/SKILL.md) or describe what you want…"
            autoFocus
          />
          <p className="skill-input-hint">
            URL → downloads & installs skill &nbsp;·&nbsp; Text → AI creates a skill for you
          </p>
          {hasPrompt && (
            <button className="skill-cancel-btn" onClick={handleCancel}>Cancel</button>
          )}
        </div>
      )}

      {!isResolving && !isEditing && hasPrompt && (
        <div className="skill-resolved-row">
          <div className="skill-resolved-info">
            <span className="skill-name">{round.name || 'Custom Skill'}</span>
            {round.type === 'url' && (
              <span className="skill-badge skill-badge-url" title={round.sourceUrl}>🔗 URL</span>
            )}
            {round.type === 'created' && (
              <span className="skill-badge skill-badge-created">✨ AI</span>
            )}
          </div>
          <button className="skill-edit-btn" onClick={handleEditClick}>Edit</button>
        </div>
      )}

      {!isResolving && !isEditing && !hasPrompt && (
        <div className="skill-edit-area">
          <textarea
            className="skill-input"
            rows={2}
            value={round.editText || ''}
            onChange={handleTextChange}
            placeholder="Paste a skill URL or describe what you want…"
          />
          <p className="skill-input-hint">
            URL → downloads & installs skill &nbsp;·&nbsp; Text → AI creates a skill for you
          </p>
        </div>
      )}
    </div>
  );
}

export default function LibrarySettingsModal({
  onClose,
  apiUrl,
  getAuthHeaders,
  // Generation tab
  rounds,
  saveRounds,
  // Provider/model/thinking settings
  provider = 'claude-code',
  model = 'claude-sonnet-4-6',
  thinkingBudget = 0,
  reasoningEffort = 'extra-high',
  saveProviderSettings,
  // Integrations tab
  vaultName,
  vaultReady,
  connectVault,
  disconnectVault,
  // Exports tab
  batchItems = [],
  clearCompleted,
  retryItem,
  syncFromBackend,
  exportRounds = [],
  uiConfig = { simplifiedAlphaMode: false, projectTemplates: [] },
  uiConfigLoading = false,
  saveUiConfig,
}) {
  const [activeTab, setActiveTab] = useState('generation');
  const [syncState, setSyncState] = useState(null); // null | 'loading' | { count, error }

  // Initialize localRounds from rounds prop, adding UI state fields
  const [localRounds, setLocalRounds] = useState(() =>
    (rounds || []).map((r) => ({
      name: r.name || 'Custom Skill',
      prompt: r.prompt || '',
      input: r.input || r.prompt || '',
      type: r.type || 'created',
      sourceUrl: r.sourceUrl || '',
      editing: false,
      editText: '',
      resolving: false,
      error: null,
    }))
  );

  const [localProvider, setLocalProvider] = useState(provider);
  const [localModel, setLocalModel] = useState(model);
  const [localThinkingBudget, setLocalThinkingBudget] = useState(thinkingBudget);
  const [localReasoningEffort, setLocalReasoningEffort] = useState(reasoningEffort);
  const [localUiConfig, setLocalUiConfig] = useState(() => normalizeUiConfig(uiConfig));
  const [localProjectTemplates, setLocalProjectTemplates] = useState(() =>
    (normalizeUiConfig(uiConfig).projectTemplates || []).map((template) => createProjectTemplateDraft(template))
  );
  const [vaultError, setVaultError] = useState(null);
  const [uiConfigError, setUiConfigError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const normalized = normalizeUiConfig(uiConfig);
    setLocalUiConfig(normalized);
    setLocalProjectTemplates((normalized.projectTemplates || []).map((template) => createProjectTemplateDraft(template)));
  }, [uiConfig]);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleRoundChange = (index, updated) => {
    setLocalRounds((prev) => prev.map((r, i) => (i === index ? updated : r)));
  };

  const handleRemoveRound = (index) => {
    if (localRounds.length <= 1) return;
    setLocalRounds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddRound = () => {
    if (localRounds.length >= 5) return;
    setLocalRounds((prev) => [
      ...prev,
      { name: '', prompt: '', input: '', type: 'default', sourceUrl: '', editing: true, editText: '', resolving: false, error: null },
    ]);
  };

  const buildNextUiConfigPatch = () => {
    const validationError = validateProjectTemplateDrafts(localProjectTemplates);
    if (validationError) {
      throw new Error(validationError);
    }
    return buildUiConfigPatch({
      ...localUiConfig,
      projectTemplates: serializeProjectTemplateDrafts(localProjectTemplates),
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setUiConfigError(null);

    if (activeTab === 'release') {
      try {
        await saveUiConfig?.(buildNextUiConfigPatch());
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } catch (err) {
        setUiConfigError(err?.response?.data?.error || err?.message || 'Failed to save release settings');
      }
      setSaving(false);
      return;
    }

    const updatedRounds = localRounds.map((r) => ({ ...r }));

    for (let i = 0; i < updatedRounds.length; i++) {
      const round = updatedRounds[i];
      const hasPrompt = !!(round.prompt && round.prompt.trim());
      const pendingText = (round.editText || '').trim();
      // Empty/new rounds can be in "not editing" UI state but still contain text.
      const shouldResolve = round.editing || (!hasPrompt && !!pendingText);

      // Round not being edited/resolved → keep as-is
      if (!shouldResolve) continue;

      const text = pendingText;

      // Empty text in edit mode → just close edit (keep existing prompt)
      if (!text) {
        updatedRounds[i] = { ...round, editing: false };
        continue;
      }

      // Resolve the skill
      updatedRounds[i] = { ...round, resolving: true, error: null };
      setLocalRounds([...updatedRounds]);

      try {
        const res = await axios.post(
          `${apiUrl}/reader/skills/resolve`,
          { input: text },
          { headers: getAuthHeaders?.() || {} },
        );
        const { name, prompt, type, sourceUrl } = res.data;
        updatedRounds[i] = {
          name,
          prompt,
          input: text,
          type,
          sourceUrl: sourceUrl || '',
          editing: false,
          editText: '',
          resolving: false,
          error: null,
        };
      } catch (err) {
        const msg = err?.response?.data?.error || err?.message || 'Failed to install skill';
        updatedRounds[i] = { ...round, resolving: false, error: msg };
      }

      setLocalRounds([...updatedRounds]);
    }

    const hasErrors = updatedRounds.some((r) => r.error);
    if (!hasErrors) {
      // Strip UI-only fields before saving
      const toSave = updatedRounds.map(({ name, prompt, input, type, sourceUrl }) => ({
        name, prompt, input, type, sourceUrl,
      }));
      try {
        saveRounds?.(toSave);
        saveProviderSettings?.(localProvider, localModel, localThinkingBudget, localReasoningEffort);
        await saveUiConfig?.(buildNextUiConfigPatch());
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } catch (err) {
        setUiConfigError(err?.response?.data?.error || err?.message || 'Failed to save project templates');
      }
    }

    setSaving(false);
  };

  const handleProviderChange = (newProvider) => {
    setLocalProvider(newProvider);
    const models = MODEL_OPTIONS[newProvider] || [];
    setLocalModel(models.length > 0 ? models[0].value : '');
    if (newProvider !== 'claude-code') setLocalThinkingBudget(0);
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
      <div className="modal-container" style={{ maxWidth: 860 }}>
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
          <button
            className={`modal-tab${activeTab === 'release' ? ' active' : ''}`}
            onClick={() => setActiveTab('release')}
          >
            Release
          </button>
        </div>

        <div className="modal-content">
          {activeTab === 'generation' && (
            <div className="settings-section">
              <h3 className="settings-subtitle">AI Provider</h3>
              <div className="settings-provider-row">
                <div className="settings-field">
                  <label className="settings-label">Provider</label>
                  <select
                    className="settings-select"
                    value={localProvider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {MODEL_OPTIONS[localProvider]?.length > 0 && (
                  <div className="settings-field">
                    <label className="settings-label">Model</label>
                    <select
                      className="settings-select"
                      value={localModel}
                      onChange={(e) => setLocalModel(e.target.value)}
                    >
                      {MODEL_OPTIONS[localProvider].map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {localProvider === 'claude-code' && (
                  <div className="settings-field">
                    <label className="settings-label">Thinking</label>
                    <select
                      className="settings-select"
                      value={localThinkingBudget}
                      onChange={(e) => setLocalThinkingBudget(Number(e.target.value))}
                    >
                      {THINKING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {localProvider === 'codex-cli' && (
                  <div className="settings-field">
                    <label className="settings-label">Reasoning</label>
                    <select
                      className="settings-select"
                      value={localReasoningEffort}
                      onChange={(e) => setLocalReasoningEffort(e.target.value)}
                    >
                      {REASONING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <h3 className="settings-subtitle" style={{ marginTop: '20px' }}>Reading Skills</h3>
              <p className="settings-hint">
                Each round runs the selected skill against your paper. Later rounds receive previous output as context.
                Paste a <strong>skill URL</strong> (e.g. a SKILL.md on GitHub) or <strong>describe what you want</strong> and AI will build the skill. Max 5 rounds.
              </p>

              {localRounds.map((round, i) => (
                <SkillCard
                  key={i}
                  round={round}
                  index={i}
                  total={localRounds.length}
                  onChange={(updated) => handleRoundChange(i, updated)}
                  onRemove={() => handleRemoveRound(i)}
                />
              ))}

              {localRounds.length < 5 && (
                <button className="settings-add-round" onClick={handleAddRound}>
                  + Add Round
                </button>
              )}

              <h3 className="settings-subtitle" style={{ marginTop: '24px' }}>Vibe Project Templates</h3>
              <p className="settings-hint">
                Configure reusable project bootstrap templates for Vibe Research. These appear in the new-project jump-start popup and can be based on <strong>pixi</strong>, <strong>requirements.txt</strong>, or a <strong>Dockerfile</strong>.
              </p>

              <div className="settings-template-list">
                {localProjectTemplates.length === 0 ? (
                  <div className="settings-template-empty">
                    No project templates yet. Add one below or users can still start from free text or an empty environment.
                  </div>
                ) : (
                  localProjectTemplates.map((template, index) => (
                    <article key={template.id || `draft-${index}`} className="settings-template-card">
                      <div className="settings-template-head">
                        <div>
                          <span className="settings-template-label">Template {index + 1}</span>
                          <h4>{template.name || 'New template'}</h4>
                        </div>
                        <button
                          type="button"
                          className="settings-template-remove"
                          onClick={() => setLocalProjectTemplates((prev) => removeProjectTemplateDraft(prev, index))}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="settings-template-grid">
                        <label className="settings-field">
                          <span className="settings-label">Name</span>
                          <input
                            className="settings-select settings-template-input"
                            value={template.name}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { name: e.target.value }))}
                            placeholder="Data Science Pixi"
                          />
                        </label>

                        <label className="settings-field">
                          <span className="settings-label">Type</span>
                          <select
                            className="settings-select"
                            value={template.sourceType}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { sourceType: e.target.value }))}
                          >
                            <option value="pixi">pixi</option>
                            <option value="requirements">requirements.txt</option>
                            <option value="docker">Dockerfile</option>
                          </select>
                        </label>

                        <label className="settings-field settings-template-grid-span">
                          <span className="settings-label">Description</span>
                          <input
                            className="settings-select settings-template-input"
                            value={template.description}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { description: e.target.value }))}
                            placeholder="Bootstrap a Python data science workspace."
                          />
                        </label>

                        <label className="settings-field settings-template-grid-span">
                          <span className="settings-label">File Name</span>
                          <input
                            className="settings-select settings-template-input"
                            value={template.fileName}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { fileName: e.target.value }))}
                            placeholder="pixi.toml"
                          />
                        </label>
                      </div>

                      <label className="settings-field">
                        <span className="settings-label">Template File Content</span>
                        <textarea
                          className="settings-round-prompt settings-template-code"
                          rows={8}
                          spellCheck={false}
                          value={template.fileContent}
                          onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { fileContent: e.target.value }))}
                          placeholder={'[project]\nname = "demo"\nchannels = ["conda-forge"]'}
                        />
                      </label>

                      <div className="settings-template-grid">
                        <label className="settings-field">
                          <span className="settings-label">Python Imports</span>
                          <textarea
                            className="settings-round-prompt"
                            rows={3}
                            value={template.pythonImportsText}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { pythonImportsText: e.target.value }))}
                            placeholder="pandas, numpy, sklearn"
                          />
                        </label>

                        <label className="settings-field">
                          <span className="settings-label">Shell Smoke Tests</span>
                          <textarea
                            className="settings-round-prompt"
                            rows={3}
                            value={template.shellCommandsText}
                            onChange={(e) => setLocalProjectTemplates((prev) => updateProjectTemplateDraft(prev, index, { shellCommandsText: e.target.value }))}
                            placeholder={'python -c "import pandas"\npython -c "import numpy"'}
                          />
                        </label>
                      </div>
                    </article>
                  ))
                )}
              </div>

              <button
                type="button"
                className="settings-add-round"
                onClick={() => setLocalProjectTemplates((prev) => addProjectTemplateDraft(prev))}
              >
                + Add Project Template
              </button>
              {uiConfigError && <p className="settings-error">{uiConfigError}</p>}
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
                <div className="obs-export-empty-state">
                  <p className="obs-export-empty">No pending exports. Select papers in Library → Research Mode → → Obsidian.</p>
                  {syncFromBackend && (
                    <button
                      className="obs-export-sync-btn"
                      disabled={syncState === 'loading'}
                      onClick={async () => {
                        setSyncState('loading');
                        const result = await syncFromBackend();
                        setSyncState(result);
                        setTimeout(() => setSyncState(null), 4000);
                      }}
                    >
                      {syncState === 'loading'
                        ? 'Syncing…'
                        : syncState?.error
                          ? `Error: ${syncState.error}`
                          : syncState?.count != null
                            ? syncState.count === 0 ? 'Nothing found' : `Restored ${syncState.count}`
                            : 'Sync from server'}
                    </button>
                  )}
                </div>
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

          {activeTab === 'release' && (
            <div className="settings-section">
              <h3 className="settings-subtitle">Product Mode</h3>
              <p className="settings-hint">
                Control simplified Vibe behavior for early alpha release mode. This setting is global and affects the Vibe workspace across the app.
              </p>
              <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={localUiConfig.simplifiedAlphaMode}
                  disabled={uiConfigLoading || saving}
                  onChange={(e) => setLocalUiConfig((prev) => ({
                    ...prev,
                    simplifiedAlphaMode: e.target.checked,
                  }))}
                />
                Simplified Vibe alpha mode
              </label>
              <p className="settings-hint">
                When enabled, the Vibe workspace hides the skill menu and tree-based research planning UI.
              </p>
              {uiConfigError && <p className="settings-error">{uiConfigError}</p>}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {(activeTab === 'generation' || activeTab === 'release') && (
            <button
              className="action-btn paper-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? <><span className="skill-spinner skill-spinner-sm" /> Installing…</>
                : saved ? '✓ Saved' : 'Save Settings'}
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
