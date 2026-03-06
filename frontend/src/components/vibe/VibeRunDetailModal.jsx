import { buildRunDetailContext, buildRunDetailOutput, buildRunDetailPrompt } from './runDetailView.js';

function VibeRunDetailModal({
  open,
  run,
  runReport,
  loading = false,
  onClose,
  onContinue,
  onRefresh,
}) {
  if (!open || !run) return null;

  const context = buildRunDetailContext(run, runReport || {});
  const prompt = buildRunDetailPrompt(run);
  const output = buildRunDetailOutput(run, runReport || {});
  const artifacts = Array.isArray(runReport?.artifacts) ? runReport.artifacts : [];

  return (
    <div className="vibe-modal-backdrop" onClick={onClose}>
      <article
        className="vibe-modal vibe-run-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vibe-run-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vibe-modal-head">
          <div>
            <h3 id="vibe-run-detail-title" className="vibe-modal-title">Run Detail</h3>
            <p className="vibe-card-note">{run.id}</p>
          </div>
          <button type="button" className="vibe-modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="vibe-run-detail-layout">
          <section className="vibe-run-detail-section">
            <div className="vibe-card-head">
              <h4>Context</h4>
              <span className="vibe-card-note">{context.sourceLabel}</span>
            </div>
            <dl className="vibe-run-detail-grid">
              <div>
                <dt>Source</dt>
                <dd>{context.sourceLabel}</dd>
              </div>
              {context.treeNodeTitle && (
                <div>
                  <dt>Tree Node</dt>
                  <dd>{context.treeNodeTitle}</dd>
                </div>
              )}
              {context.todoTitle && (
                <div>
                  <dt>TODO</dt>
                  <dd>{context.todoTitle}</dd>
                </div>
              )}
              {context.parentRunId && (
                <div>
                  <dt>Parent Run</dt>
                  <dd>{context.parentRunId}</dd>
                </div>
              )}
              {context.serverId && (
                <div>
                  <dt>Server</dt>
                  <dd>{context.serverId}</dd>
                </div>
              )}
              {context.workspacePath && (
                <div className="vibe-run-detail-grid-span">
                  <dt>Workspace</dt>
                  <dd><code>{context.workspacePath}</code></dd>
                </div>
              )}
            </dl>
          </section>

          <section className="vibe-run-detail-section">
            <div className="vibe-card-head">
              <h4>{prompt.label}</h4>
              <span className="vibe-card-note">{run.runType}</span>
            </div>
            <pre className="vibe-report-pre vibe-report-pre-small">{prompt.text || '(empty)'}</pre>
          </section>

          <section className="vibe-run-detail-section">
            <div className="vibe-card-head">
              <h4>Output</h4>
              <div className="vibe-inline-actions">
                <span className="vibe-card-note">{artifacts.length} artifacts</span>
                <button type="button" className="vibe-secondary-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>
            {output.summary && (
              <pre className="vibe-report-pre vibe-report-pre-small">{output.summary}</pre>
            )}
            {output.finalOutputArtifact && (
              <div className="vibe-run-detail-artifact">
                <strong>{output.finalOutputArtifact.title || output.finalOutputArtifact.kind || 'Final Output'}</strong>
                {output.finalOutputArtifact.objectUrl ? (
                  <a href={output.finalOutputArtifact.objectUrl} target="_blank" rel="noreferrer" className="vibe-secondary-btn">
                    Open
                  </a>
                ) : (
                  <code>{output.finalOutputArtifact.kind || 'artifact'}</code>
                )}
              </div>
            )}
            {output.deliverables.length > 0 && (
              <div className="vibe-run-detail-deliverables">
                {output.deliverables.slice(0, 6).map((item) => (
                  <div key={item.id || item.path || item.title} className="vibe-run-detail-deliverable">
                    <strong>{item.title || item.path || item.id}</strong>
                    {item.objectUrl && (
                      <a href={item.objectUrl} target="_blank" rel="noreferrer">Open</a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {artifacts.length > 0 && (
              <div className="vibe-run-detail-artifact-list">
                {artifacts.slice(0, 8).map((artifact) => (
                  <div key={artifact.id || artifact.path || artifact.title} className="vibe-run-detail-artifact">
                    <strong>{artifact.title || artifact.path || artifact.kind || artifact.id}</strong>
                    {artifact.objectUrl ? (
                      <a href={artifact.objectUrl} target="_blank" rel="noreferrer" className="vibe-secondary-btn">
                        Open
                      </a>
                    ) : (
                      <code>{artifact.kind || 'artifact'}</code>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!output.summary && artifacts.length === 0 && (
              <p className="vibe-empty">No output available yet.</p>
            )}
          </section>
        </div>

        <div className="vibe-modal-actions">
          <button type="button" className="vibe-secondary-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={() => onContinue?.(run)}>
            Continue
          </button>
        </div>
      </article>
    </div>
  );
}

export default VibeRunDetailModal;
