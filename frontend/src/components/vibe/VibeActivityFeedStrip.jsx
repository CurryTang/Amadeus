import EmptyState from '../ui/EmptyState';
import { buildRunCardMetaLabels } from './activityFeedPresentation.js';

function VibeActivityFeedStrip({
  items,
  runCount = 0,
  sessionCount = 0,
  runReviewSummary = null,
  selectedRunId = '',
  loadingSessions = false,
  refreshingSessionId = '',
  scopeLabel = 'Project scope',
  onOpenRun,
  onOpenSession,
  onRefreshSession,
}) {
  const feedItems = Array.isArray(items) ? items : [];
  const reviewSummary = runReviewSummary && typeof runReviewSummary === 'object' ? runReviewSummary : null;
  const reviewBits = [];
  if (reviewSummary && Number(reviewSummary.activeCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.activeCount)} active`);
  }
  if (reviewSummary && Number(reviewSummary.attentionCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.attentionCount)} attention`);
  }
  if (reviewSummary && Number(reviewSummary.completedCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.completedCount)} completed`);
  }
  if (reviewSummary && Number(reviewSummary.contractFailureCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.contractFailureCount)} contract failures`);
  }
  if (reviewSummary && Number(reviewSummary.remoteExecutionCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.remoteExecutionCount)} remote`);
  }
  if (reviewSummary && Number(reviewSummary.snapshotBackedCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.snapshotBackedCount)} snapshot-backed`);
  }
  if (reviewSummary && Number(reviewSummary.instrumentedCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.instrumentedCount)} instrumented`);
  }
  if (reviewSummary && Array.isArray(reviewSummary.instrumentedProviders) && reviewSummary.instrumentedProviders.length > 0) {
    reviewBits.push(`sinks ${reviewSummary.instrumentedProviders.join(', ')}`);
  }
  if (reviewSummary && Number(reviewSummary.failedCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.failedCount)} failed`);
  }
  if (reviewSummary && Number(reviewSummary.cancelledCount) > 0) {
    reviewBits.push(`${Number(reviewSummary.cancelledCount)} cancelled`);
  }

  return (
    <section className="vibe-activity-feed vibe-card vibe-card--neo">
      <div className="vibe-card-head">
        <h3>Activity</h3>
        <div className="vibe-activity-feed-head-meta">
          <span className="vibe-activity-feed-chip">
            Runs {runCount} · {scopeLabel}{reviewBits.length > 0 ? ` · ${reviewBits.join(' · ')}` : ''}
          </span>
          <span className="vibe-activity-feed-chip">
            {loadingSessions ? 'Sessions Loading…' : `Sessions ${sessionCount}`}
          </span>
        </div>
      </div>
      {feedItems.length === 0 ? (
        <EmptyState
          className="vibe-compact-empty"
          title="No activity yet"
          hint="Runs and direct observed sessions will appear here."
        />
      ) : (
        <div className="vibe-activity-feed-strip" role="list">
          {feedItems.map((item) => {
            if (item.kind === 'run') {
              const card = item.card || {};
              const metaLabels = buildRunCardMetaLabels(card);
              return (
                <button
                  key={`activity-run-${card.id}`}
                  type="button"
                  role="listitem"
                  className={`vibe-recent-run-card vibe-activity-feed-card vibe-activity-feed-card--run${card.id === selectedRunId ? ' is-active' : ''}`}
                  onClick={() => onOpenRun?.(card.id)}
                >
                  <span className="vibe-activity-feed-type">Run</span>
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
                  {metaLabels.length > 0 && (
                    <div className="vibe-recent-run-meta">
                      {metaLabels.map((label) => <span key={label}>{label}</span>)}
                    </div>
                  )}
                  <div className="vibe-recent-run-meta">
                    <span>{card.status}</span>
                    <span>{card.timestamp}</span>
                  </div>
                </button>
              );
            }

            const card = item.card || {};
            return (
              <article
                key={`activity-session-${card.id}`}
                role="listitem"
                className="vibe-observed-session-card vibe-activity-feed-card vibe-activity-feed-card--session"
              >
                <span className="vibe-activity-feed-type">Session</span>
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
                    disabled={refreshingSessionId === card.id}
                  >
                    {refreshingSessionId === card.id ? 'Refreshing…' : 'Refresh'}
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
            );
          })}
        </div>
      )}
    </section>
  );
}

export default VibeActivityFeedStrip;
