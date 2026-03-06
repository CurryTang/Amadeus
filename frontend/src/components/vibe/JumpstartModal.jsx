'use client';

import { useMemo, useState } from 'react';
import axios from 'axios';

export default function JumpstartModal({
  apiUrl,
  headers,
  projectId,
  projectMode = 'new_project',
  projectTemplates = [],
  onClose,
  onCreated,
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [freeformIntent, setFreeformIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedTemplate = useMemo(
    () => projectTemplates.find((template) => String(template.id || '').trim() === selectedTemplateId) || null,
    [projectTemplates, selectedTemplateId]
  );

  const submitBootstrap = async (payload) => {
    setBusy(true);
    setError('');
    try {
      const res = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/jumpstart`,
        payload,
        { headers },
      );
      onCreated?.(res.data || null);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to create jumpstart node');
    } finally {
      setBusy(false);
    }
  };

  const handleTemplateSubmit = async () => {
    if (!selectedTemplateId) return;
    await submitBootstrap({
      projectMode: 'new_project',
      bootstrapMode: 'template',
      templateId: selectedTemplateId,
    });
  };

  const handleIntentSubmit = async () => {
    await submitBootstrap({
      projectMode: 'new_project',
      bootstrapMode: 'intent',
      freeformIntent: freeformIntent.trim(),
    });
  };

  const handleEmptySubmit = async () => {
    await submitBootstrap({
      projectMode: 'new_project',
      bootstrapMode: 'empty',
    });
  };

  const handleExistingCodebaseSubmit = async () => {
    await submitBootstrap({
      projectMode: 'existing_codebase',
      bootstrapMode: 'existing_codebase',
    });
  };

  return (
    <div className="tnm-overlay" role="dialog" aria-modal="true" aria-labelledby="js-title">
      <div className="tnm-modal vibe-jumpstart-modal">
        <div className="tnm-header">
          <div>
            <h3 id="js-title" className="tnm-title">Project jump-start</h3>
            <p className="tnm-subtitle">
              {projectMode === 'existing_codebase'
                ? 'Analyze this repository before downstream work begins.'
                : 'Choose a reusable template, describe the project, or start with an empty environment.'}
            </p>
          </div>
          <button type="button" className="tnm-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tnm-body">
          {projectMode === 'existing_codebase' ? (
            <div className="vibe-js-step">
              <div className="vibe-js-existing-card">
                <strong>Existing codebase detected</strong>
                <p>The first root should capture repository context and generate the baseline codebase document.</p>
              </div>
            </div>
          ) : (
            <div className="vibe-js-step">
              <div className="vibe-js-section">
                <div className="vibe-js-section-head">
                  <strong>Saved project templates</strong>
                  <span>{projectTemplates.length} available</span>
                </div>
                {projectTemplates.length === 0 ? (
                  <div className="vibe-js-empty">
                    No saved templates yet. Configure them in AI Notes Settings under Vibe Project Templates.
                  </div>
                ) : (
                  <div className="vibe-js-template-list">
                    {projectTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={`vibe-js-template-card${selectedTemplateId === template.id ? ' is-selected' : ''}`}
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        <div className="vibe-js-template-top">
                          <strong>{template.name}</strong>
                          <span>{template.sourceType}</span>
                        </div>
                        <p>{template.description}</p>
                        <code>{template.fileName}</code>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="vibe-launch-btn"
                  onClick={handleTemplateSubmit}
                  disabled={busy || !selectedTemplateId}
                >
                  {busy && selectedTemplate ? 'Bootstrapping…' : 'Use Selected Template'}
                </button>
              </div>

              <div className="vibe-js-section">
                <div className="vibe-js-section-head">
                  <strong>Describe the project</strong>
                  <span>One-off bootstrap</span>
                </div>
                <textarea
                  className="vibe-js-intent-input"
                  rows={5}
                  value={freeformIntent}
                  onChange={(e) => setFreeformIntent(e.target.value)}
                  placeholder="Example: Build a FastAPI service with Redis and background workers."
                />
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleIntentSubmit}
                  disabled={busy || !freeformIntent.trim()}
                >
                  {busy && !selectedTemplate ? 'Generating…' : 'Use Project Description'}
                </button>
              </div>

              <div className="vibe-js-empty-row">
                <div>
                  <strong>Start with an empty environment</strong>
                  <p>Create the environment root and run minimal validation only.</p>
                </div>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleEmptySubmit}
                  disabled={busy}
                >
                  Start Empty
                </button>
              </div>
            </div>
          )}

          {error && <div className="tnm-error"><p>{error}</p></div>}
        </div>

        <div className="tnm-footer">
          <button type="button" className="vibe-secondary-btn" onClick={onClose}>Close</button>
          {projectMode === 'existing_codebase' && (
            <button
              type="button"
              className="vibe-launch-btn"
              onClick={handleExistingCodebaseSubmit}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create Baseline Step'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
