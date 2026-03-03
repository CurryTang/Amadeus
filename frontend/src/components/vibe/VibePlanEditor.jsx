import { useEffect, useMemo, useState } from 'react';
import yaml from 'js-yaml';

const MODES = ['view', 'edit', 'run'];
const VIEWS = ['canvas', 'split', 'dsl'];

function safeDumpYaml(plan) {
  try {
    return yaml.dump(plan || {}, {
      noRefs: true,
      lineWidth: 120,
      sortKeys: false,
    });
  } catch (_) {
    return '';
  }
}

function VibePlanEditor({
  plan,
  validation,
  mode,
  viewMode,
  queueState,
  onModeChange,
  onViewModeChange,
  onApplyDsl,
  onValidateDsl,
  onRunAll,
  onPause,
  onResume,
  onAbort,
  runScope,
  onRunScopeChange,
  onQuickBash = null,
}) {
  const [dslText, setDslText] = useState('');
  const [dslError, setDslError] = useState('');

  const validationSummary = useMemo(() => {
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
    return { errors, warnings };
  }, [validation]);

  useEffect(() => {
    setDslText(safeDumpYaml(plan));
    setDslError('');
  }, [plan]);

  const parseDsl = () => {
    try {
      const parsed = yaml.load(dslText || '') || {};
      setDslError('');
      return parsed;
    } catch (error) {
      const message = String(error?.message || 'Invalid DSL');
      setDslError(message);
      return null;
    }
  };

  const handleApply = () => {
    const parsed = parseDsl();
    if (!parsed) return;
    onApplyDsl?.(parsed);
  };

  const handleValidate = () => {
    const parsed = parseDsl();
    if (!parsed) return;
    onValidateDsl?.(parsed);
  };

  return (
    <section className="vibe-plan-editor">
      <div className="vibe-plan-editor-row">
        <div className="vibe-plan-editor-group">
          <span className="vibe-card-note">Plan Mode</span>
          <div className="vibe-plan-editor-switch">
            {MODES.map((item) => (
              <button
                key={item}
                type="button"
                className={`vibe-plan-chip${mode === item ? ' is-active' : ''}`}
                onClick={() => onModeChange?.(item)}
              >
                {item === 'view' ? 'View' : item === 'edit' ? 'Edit Plan' : 'Run'}
              </button>
            ))}
          </div>
        </div>

        <div className="vibe-plan-editor-group">
          <span className="vibe-card-note">Editor View</span>
          <div className="vibe-plan-editor-switch">
            {VIEWS.map((item) => (
              <button
                key={item}
                type="button"
                className={`vibe-plan-chip${viewMode === item ? ' is-active' : ''}`}
                onClick={() => onViewModeChange?.(item)}
              >
                {item === 'canvas' ? 'Canvas' : item === 'split' ? 'Split' : 'DSL'}
              </button>
            ))}
          </div>
        </div>

        <div className="vibe-plan-editor-group vibe-plan-editor-group--status">
          <span className="vibe-card-note">Validation</span>
          <div className="vibe-plan-editor-status">
            <span className={validationSummary.errors.length ? 'is-error' : 'is-ok'}>
              {validationSummary.errors.length} errors
            </span>
            <span>{validationSummary.warnings.length} warnings</span>
          </div>
        </div>

        {onQuickBash && (
          <div className="vibe-plan-editor-group">
            <button
              type="button"
              className="vibe-secondary-btn vibe-quick-bash-btn"
              onClick={onQuickBash}
              title="Run a one-off bash command on the current project server"
            >
              ⚡ Quick Bash
            </button>
          </div>
        )}
      </div>

      {mode === 'run' && (
        <div className="vibe-plan-editor-row vibe-plan-editor-row--run">
          <div className="vibe-plan-editor-group">
            <span className="vibe-card-note">Run All Scope</span>
            <select
              className="vibe-run-scope-select"
              value={runScope}
              onChange={(event) => onRunScopeChange?.(event.target.value)}
            >
              <option value="active_path">Selected - Active Path</option>
              <option value="subtree_all_branches">Selected - Subtree (All Branches)</option>
              <option value="entire_ready">Entire Plan (All Ready Nodes)</option>
            </select>
          </div>
          <div className="vibe-plan-editor-actions">
            <button type="button" className="vibe-secondary-btn" onClick={onRunAll}>Run All</button>
            {queueState?.paused ? (
              <button type="button" className="vibe-secondary-btn" onClick={onResume}>Resume</button>
            ) : (
              <button type="button" className="vibe-secondary-btn" onClick={onPause}>Pause</button>
            )}
            <button type="button" className="vibe-secondary-btn" onClick={onAbort}>Abort</button>
          </div>
        </div>
      )}

      {(viewMode === 'dsl' || viewMode === 'split') && (
        <div className="vibe-plan-editor-dsl">
          <textarea
            value={dslText}
            onChange={(event) => setDslText(event.target.value)}
            rows={viewMode === 'dsl' ? 16 : 8}
            spellCheck={false}
          />
          <div className="vibe-plan-editor-actions">
            <button type="button" className="vibe-secondary-btn" onClick={handleValidate}>Validate DSL</button>
            <button type="button" className="vibe-secondary-btn" onClick={handleApply}>Apply DSL</button>
          </div>
          {dslError && <p className="vibe-card-error">{dslError}</p>}
        </div>
      )}
    </section>
  );
}

export default VibePlanEditor;
