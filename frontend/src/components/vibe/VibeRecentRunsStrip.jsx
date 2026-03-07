import EmptyState from '../ui/EmptyState';

function VibeRecentRunsStrip({
  cards,
  selectedRunId,
  onOpenRun,
  scopeLabel = 'Project scope',
}) {
  const items = Array.isArray(cards) ? cards : [];

  return (
    <section className="vibe-recent-runs vibe-card vibe-card--neo">
      <div className="vibe-card-head">
        <h3>Recent Runs</h3>
        <span className="vibe-card-note">{items.length} visible · {scopeLabel}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState
          className="vibe-compact-empty"
          title="No runs yet"
          hint="Launch from the runner above or run a tree node to populate this strip."
        />
      ) : (
        <div className="vibe-recent-runs-strip" role="list">
          {items.map((card) => (
            <button
              key={card.id}
              type="button"
              role="listitem"
              className={`vibe-recent-run-card${card.id === selectedRunId ? ' is-active' : ''}`}
              onClick={() => onOpenRun?.(card.id)}
            >
              <div className="vibe-recent-run-card-top">
                <span className={`vibe-recent-run-badge is-${card.runType.toLowerCase()}`}>
                  {card.runTypeLabel}
                </span>
                <span className="vibe-recent-run-source">{card.sourceLabel}</span>
                <span className={`vibe-tree-status-dot is-${String(card.status || '').toLowerCase()}`} />
              </div>
              <strong className="vibe-recent-run-title" title={card.title}>{card.title}</strong>
              {card.linkedNodeTitle && (
                <span className="vibe-recent-run-node" title={card.linkedNodeTitle}>
                  {card.linkedNodeTitle}
                </span>
              )}
              {card.snippet && (
                <span className="vibe-recent-run-snippet" title={card.snippet}>
                  {card.snippet}
                </span>
              )}
              {(card.executionLabel || card.executionRuntimeLabel || card.executionIsolationLabel || card.transportLabel || card.snapshotLabel || card.contractLabel || card.readinessLabel || card.warningsLabel || card.sinkProvidersLabel || card.summaryLabel || card.finalOutputLabel) && (
                <div className="vibe-recent-run-meta">
                  {card.executionLabel && <span>{card.executionLabel}</span>}
                  {card.executionRuntimeLabel && <span>{card.executionRuntimeLabel}</span>}
                  {card.executionIsolationLabel && <span>{card.executionIsolationLabel}</span>}
                  {card.transportLabel && <span>{card.transportLabel}</span>}
                  {card.snapshotLabel && <span>{card.snapshotLabel}</span>}
                  {card.contractLabel && <span>{card.contractLabel}</span>}
                  {card.readinessLabel && <span>{card.readinessLabel}</span>}
                  {card.warningsLabel && <span>{card.warningsLabel}</span>}
                  {card.sinkProvidersLabel && <span>{card.sinkProvidersLabel}</span>}
                  {card.summaryLabel && <span>{card.summaryLabel}</span>}
                  {card.finalOutputLabel && <span>{card.finalOutputLabel}</span>}
                </div>
              )}
              <div className="vibe-recent-run-meta">
                <span>{card.status}</span>
                <span>{card.timestamp}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default VibeRecentRunsStrip;
