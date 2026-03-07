import {
  buildRunCompareSummary,
  buildRunContractSummary,
  buildRunBridgeSummary,
  buildRunDetailContext,
  buildRunExecutionSummary,
  buildRunDetailOutput,
  buildRunFollowUpSummary,
  buildRunObservabilitySummary,
  buildRunDetailPrompt,
  buildRunSnapshotSummary,
} from './runDetailView.js';

function VibeRunDetailModal({
  open,
  run,
  runReport,
  runCompare,
  compareOptions = [],
  selectedCompareRunId = '',
  onSelectCompareRunId,
  loading = false,
  compareLoading = false,
  onClose,
  onContinue,
  onRefresh,
}) {
  if (!open || !run) return null;

  const context = buildRunDetailContext(run, runReport || {});
  const execution = buildRunExecutionSummary(run);
  const followUpSummary = buildRunFollowUpSummary(run, runReport || {});
  const snapshotSummary = buildRunSnapshotSummary(run, runReport || {});
  const bridgeSummary = buildRunBridgeSummary(run, runReport || {});
  const observabilitySummary = buildRunObservabilitySummary(run, runReport || {});
  const compareSummary = buildRunCompareSummary(runCompare || {});
  const contractSummary = buildRunContractSummary(run, runReport || {});
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
              {execution.location && (
                <div>
                  <dt>Location</dt>
                  <dd>{execution.location}</dd>
                </div>
              )}
              {execution.mode && (
                <div>
                  <dt>Mode</dt>
                  <dd>{execution.mode}</dd>
                </div>
              )}
              {execution.backend && (
                <div>
                  <dt>Backend</dt>
                  <dd>{execution.backend}</dd>
                </div>
              )}
              {execution.runtimeClass && (
                <div>
                  <dt>Runtime Class</dt>
                  <dd>{execution.runtimeClass}</dd>
                </div>
              )}
              {execution.resourcesLabel && (
                <div className="vibe-run-detail-grid-span">
                  <dt>Resources</dt>
                  <dd>{execution.resourcesLabel}</dd>
                </div>
              )}
            </dl>
          </section>

          {snapshotSummary.length > 0 && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Snapshots</h4>
                <span className="vibe-card-note">workspace + env</span>
              </div>
              <dl className="vibe-run-detail-grid">
                {snapshotSummary.map((row) => (
                  <div key={row.label} className={row.label.includes('Path') || row.label.includes('Resources') ? 'vibe-run-detail-grid-span' : undefined}>
                    <dt>{row.label}</dt>
                    <dd>{row.label.includes('Path') ? <code>{row.value}</code> : row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {bridgeSummary.length > 0 && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Bridge</h4>
                <span className="vibe-card-note">client daemon workflow</span>
              </div>
              <dl className="vibe-run-detail-grid">
                {bridgeSummary.map((row) => (
                  <div key={row.label} className={row.label.includes('Tasks') ? 'vibe-run-detail-grid-span' : undefined}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {observabilitySummary.length > 0 && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Observability</h4>
                <span className="vibe-card-note">steps + artifacts + checkpoints</span>
              </div>
              <dl className="vibe-run-detail-grid">
                {observabilitySummary.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {followUpSummary.length > 0 && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Follow-up</h4>
                <span className="vibe-card-note">continuation + related runs</span>
              </div>
              <dl className="vibe-run-detail-grid">
                {followUpSummary.map((row) => (
                  <div key={row.label} className={row.label.includes('Runs') ? 'vibe-run-detail-grid-span' : undefined}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {(compareLoading || compareSummary) && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Compare</h4>
                <span className="vibe-card-note">current run vs related run</span>
              </div>
              {compareOptions.length > 1 && (
                <label className="vibe-inline-field">
                  <span className="vibe-card-note">Compare Target</span>
                  <select
                    value={selectedCompareRunId}
                    onChange={(event) => onSelectCompareRunId?.(event.target.value)}
                    disabled={compareLoading}
                  >
                    {compareOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}
              {compareLoading && !compareSummary ? (
                <p className="vibe-empty">Loading compare summary…</p>
              ) : (
                <>
                  <dl className="vibe-run-detail-grid">
                    <div>
                      <dt>Other Run</dt>
                      <dd>{compareSummary.otherRunId}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{compareSummary.otherStatus}</dd>
                    </div>
                    {compareSummary.otherNodeTitle && (
                      <div>
                        <dt>Other Node</dt>
                        <dd>{compareSummary.otherNodeTitle}</dd>
                      </div>
                    )}
                    {compareSummary.otherReadiness && (
                      <div>
                        <dt>Readiness</dt>
                        <dd>{compareSummary.otherReadiness}</dd>
                      </div>
                    )}
                    {compareSummary.otherExecutionLocation && (
                      <div>
                        <dt>Execution</dt>
                        <dd>{compareSummary.otherExecutionLocation}</dd>
                      </div>
                    )}
                    {compareSummary.otherExecutionRuntime && (
                      <div>
                        <dt>Runtime</dt>
                        <dd>{compareSummary.otherExecutionRuntime}</dd>
                      </div>
                    )}
                    {compareSummary.otherContractStatus && (
                      <div>
                        <dt>Contract</dt>
                        <dd>{compareSummary.otherContractStatus}</dd>
                      </div>
                    )}
                    {compareSummary.otherSnapshotBacked && (
                      <div>
                        <dt>Snapshot Backed</dt>
                        <dd>Yes</dd>
                      </div>
                    )}
                    {compareSummary.otherWarnings && (
                      <div>
                        <dt>Warnings</dt>
                        <dd>{compareSummary.otherWarnings}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Same Node</dt>
                      <dd>{compareSummary.sameNode ? 'Yes' : 'No'}</dd>
                    </div>
                    {compareSummary.sharedParentRunsLabel && (
                      <div className="vibe-run-detail-grid-span">
                        <dt>Shared Parent Runs</dt>
                        <dd>{compareSummary.sharedParentRunsLabel}</dd>
                      </div>
                    )}
                    {compareSummary.relatedRunsLabel && (
                      <div className="vibe-run-detail-grid-span">
                        <dt>Related Runs</dt>
                        <dd>{compareSummary.relatedRunsLabel}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Deliverables</dt>
                      <dd>{compareSummary.deliverableCount}</dd>
                    </div>
                  </dl>
                  {compareSummary.otherSummary && (
                    <pre className="vibe-report-pre vibe-report-pre-small">{compareSummary.otherSummary}</pre>
                  )}
                </>
              )}
            </section>
          )}

          {contractSummary.length > 0 && (
            <section className="vibe-run-detail-section">
              <div className="vibe-card-head">
                <h4>Contract</h4>
                <span className="vibe-card-note">output contract + validation</span>
              </div>
              <dl className="vibe-run-detail-grid">
                {contractSummary.map((row) => (
                  <div key={row.label} className={row.label.includes('Artifacts') || row.label.includes('Tables') || row.label.includes('Figures') ? 'vibe-run-detail-grid-span' : undefined}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

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
