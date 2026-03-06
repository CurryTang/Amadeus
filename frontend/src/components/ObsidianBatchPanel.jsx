import { useState } from 'react';

const STATUS_ICON = {
  queued:     { icon: '○', cls: 'obs-panel-queued' },
  generating: { icon: '◌', cls: 'obs-panel-generating' },
  exported:   { icon: '✓', cls: 'obs-panel-exported' },
  failed:     { icon: '✗', cls: 'obs-panel-failed' },
};

export default function ObsidianBatchPanel({ items, onClearCompleted, onClearAll, onRetry }) {
  const [hidden, setHidden] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (items.length === 0) return null;
  if (hidden) return null;

  const total      = items.length;
  const exported   = items.filter(i => i.status === 'exported').length;
  const failed     = items.filter(i => i.status === 'failed').length;
  const inProgress = items.filter(i => i.status === 'queued' || i.status === 'generating').length;
  const allDone    = inProgress === 0;

  return (
    <div className={`obs-panel${minimized ? ' obs-panel--minimized' : ''}`}>
      <div className="obs-panel-header">
        <span className="obs-panel-title">
          → Obsidian
          {inProgress > 0
            ? <span className="obs-panel-spinner" />
            : allDone && failed === 0
              ? <span className="obs-panel-done-icon">✓</span>
              : null}
        </span>
        <span className="obs-panel-count">
          {exported}/{total} exported{failed > 0 ? ` · ${failed} failed` : ''}
        </span>
        <div className="obs-panel-actions">
          {exported > 0 && (
            <button className="obs-panel-clear" onClick={onClearCompleted} title="Clear exported">
              Clear
            </button>
          )}
          {allDone && onClearAll && (
            <button className="obs-panel-clear" onClick={onClearAll} title="Dismiss all">
              Dismiss
            </button>
          )}
          <button
            className="obs-panel-toggle"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▲' : '▼'}
          </button>
          <button className="obs-panel-close" onClick={() => setHidden(true)} title="Hide panel">×</button>
        </div>
      </div>

      {!minimized && (
        <ul className="obs-panel-list">
          {items.map(item => {
            const s = STATUS_ICON[item.status] || STATUS_ICON.queued;
            return (
              <li key={item.docId} className="obs-panel-item">
                <span className={`obs-panel-status-icon ${s.cls}`}>{s.icon}</span>
                <span className="obs-panel-item-title" title={item.title}>{item.title}</span>
                {item.status === 'failed' && onRetry && (
                  <button
                    className="obs-panel-retry"
                    onClick={() => onRetry(item.docId)}
                    title="Retry"
                  >↺</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
