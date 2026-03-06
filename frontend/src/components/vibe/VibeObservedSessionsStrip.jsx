import EmptyState from '../ui/EmptyState';

function VibeObservedSessionsStrip({
  cards,
  loading = false,
  onOpenSession,
  onRefreshSession,
  refreshingId = '',
}) {
  const items = Array.isArray(cards) ? cards : [];

  return (
    <section className="vibe-observed-sessions vibe-card vibe-card--neo">
      <div className="vibe-card-head">
        <h3>Observed Sessions</h3>
        <span className="vibe-card-note">{loading ? 'Loading…' : `${items.length} visible`}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState
          className="vibe-compact-empty"
          title="No observed sessions"
          hint="Direct Claude and Codex sessions on the shared server will appear here."
        />
      ) : (
        <div className="vibe-observed-sessions-strip" role="list">
          {items.map((card) => (
            <article key={card.id} role="listitem" className="vibe-observed-session-card">
              <div className="vibe-observed-session-top">
                <span className="vibe-recent-run-badge is-agent">{card.observedLabel}</span>
                <span className="vibe-observed-session-provider">{card.providerLabel}</span>
                <span className={`vibe-tree-status-dot is-${String(card.status || '').toLowerCase()}`} />
              </div>
              <strong className="vibe-recent-run-title" title={card.title}>{card.title}</strong>
              {card.digest && (
                <span className="vibe-recent-run-snippet" title={card.digest}>
                  {card.digest}
                </span>
              )}
              <div className="vibe-observed-session-meta">
                <span>{card.nodeLabel}</span>
                <span>{card.timestamp}</span>
              </div>
              <div className="vibe-observed-session-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={() => onRefreshSession?.(card.id)}
                  disabled={refreshingId === card.id}
                >
                  {refreshingId === card.id ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={() => onOpenSession?.(card.raw)}
                  disabled={!card.detachedNodeId}
                >
                  Open Node
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default VibeObservedSessionsStrip;
