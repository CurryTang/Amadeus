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
