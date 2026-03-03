import EmptyState from '../ui/EmptyState';
import StatusBadge from '../ui/StatusBadge';

function VibeRunHistory({
  runs,
  selectedRunId,
  onSelectRun,
  hasMore = false,
  loadingMore = false,
  onLoadMore = null,
  onDeleteRun = null,
  onClearFailed = null,
  onClearAll = null,
  onRerunRun = null,
}) {
  const failedCount = runs.filter((r) => r.status === 'FAILED').length;

  return (
    <div className="vibe-run-history">
      <div className="vibe-run-history-head">
        <h3>Run History</h3>
        <div className="vibe-run-history-head-actions">
          <span className="vibe-card-note">{runs.length} runs</span>
          {failedCount > 0 && onClearFailed && (
            <button
              type="button"
              className="vibe-secondary-btn vibe-run-clear-btn"
              onClick={() => onClearFailed()}
              title={`Delete ${failedCount} failed runs`}
            >
              Clear Failed ({failedCount})
            </button>
          )}
          {runs.length > 0 && onClearAll && (
            <button
              type="button"
              className="vibe-secondary-btn vibe-run-clear-btn"
              onClick={() => onClearAll()}
              title="Delete all completed runs"
            >
              Clear All
            </button>
          )}
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          className="vibe-compact-empty"
          title="No runs yet"
          hint="Launch an agent above to get started."
        />
      ) : (
        <div className="vibe-run-history-list">
          {runs.map((run) => {
            const isActive = run.id === selectedRunId;
            const ts = run.createdAt
              ? new Date(run.createdAt).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })
              : '';
            const prompt = String(run.metadata?.prompt || run.metadata?.experimentCommand || '').slice(0, 80);
            const skill = run.metadata?.agentSkill || run.runType?.toLowerCase() || 'agent';
            const parentId = run.metadata?.parentRunId;
            const isDeletable = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status);

            return (
              <button
                key={run.id}
                type="button"
                className={`vibe-run-row${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectRun(run.id)}
              >
                <StatusBadge status={run.status} className="vibe-run-status-badge" />
                <span className="vibe-run-skill">{skill}</span>
                <span className="vibe-run-prompt">{prompt || run.id}</span>
                {run.resultSnippet && (
                  <span className="vibe-run-snippet" title={run.resultSnippet}>
                    {run.resultSnippet.length > 80 ? run.resultSnippet.slice(0, 77) + '…' : run.resultSnippet}
                  </span>
                )}
                <span className="vibe-run-ts">{ts}</span>
                {parentId && <span className="vibe-run-chain" title={`Continuation of ${parentId}`}>↩</span>}
                {onRerunRun && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="vibe-run-rerun-btn"
                    title="Re-run with same spec"
                    onClick={(e) => { e.stopPropagation(); onRerunRun(run.id); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onRerunRun(run.id); }
                    }}
                  >
                    ↺
                  </span>
                )}
                {isDeletable && onDeleteRun && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="vibe-run-delete-btn"
                    title="Delete this run"
                    onClick={(e) => { e.stopPropagation(); onDeleteRun(run.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDeleteRun(run.id); } }}
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              className="vibe-secondary-btn vibe-run-history-more"
              onClick={() => onLoadMore?.()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default VibeRunHistory;
