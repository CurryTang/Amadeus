import { Button } from '@radix-ui/themes';

const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex', unknown: 'tmux' };

const STATUS_STYLES = {
  running: { color: '#1e1e2e', background: '#94e2d5', label: 'running' },
  attached: { color: '#1e1e2e', background: '#a6e3a1', label: 'attached' },
  stopped: { color: '#cdd6f4', background: '#6c7086', label: 'stopped' },
  file: { color: '#cdd6f4', background: '#585b70', label: 'session file' },
};

function StatusBadge({ status, attached }) {
  const key = status === 'running' ? (attached ? 'attached' : 'running') : (status || 'stopped');
  const style = STATUS_STYLES[key] || STATUS_STYLES.stopped;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      color: style.color,
      background: style.background,
    }}>
      {style.label}
    </span>
  );
}

function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SessionRow({ session, onAttach, onKill, onResume, onRefresh, showServer }) {
  const s = session;
  const isClickable = s.status === 'running';
  const isExternal = s.source === 'discovered' || s.source === 'session_file';
  const displayName = s.label || s.tmux_session_name || s.session_file?.split('/').pop() || s.id;

  return (
    <div
      data-testid="session-row"
      data-session-id={s.id}
      data-status={s.status}
      data-source={s.source}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        borderBottom: '1px solid #313244',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onClick={isClickable ? () => onAttach(s) : undefined}
      onMouseEnter={(e) => { if (isClickable) e.currentTarget.style.background = '#1e1e2e'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Left: label + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName}
          </span>
          <StatusBadge status={s.status} attached={s.attached} />
          <span style={{ fontSize: '11px', color: '#585b70' }}>
            {AGENT_LABELS[s.agent_type] || s.agent_type}
          </span>
          {isExternal && (
            <span style={{ fontSize: '10px', color: '#45475a', fontStyle: 'italic' }}>
              {s.source === 'session_file' ? 'remote file' : 'external'}
            </span>
          )}
          {s.command && s.source === 'discovered' && (
            <span style={{ fontSize: '10px', color: '#45475a', fontFamily: 'monospace' }}>
              ({s.command})
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: '#6c7086', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {showServer && s.server_name && (
            <span>{s.server_name}</span>
          )}
          {s.cwd && s.cwd !== '~' && (
            <span style={{ fontFamily: 'monospace', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.cwd}
            </span>
          )}
          {s.prompt_digest && (
            <span style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.prompt_digest}
            </span>
          )}
        </div>
      </div>

      {/* Right: time + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={{ fontSize: '11px', color: '#585b70', minWidth: '50px', textAlign: 'right' }}>
          {formatTime(s.started_at || s.updated_at)}
        </span>
        {s.status === 'running' && (
          <>
            <Button size="1" variant="soft" data-testid="attach-btn" onClick={(e) => { e.stopPropagation(); onAttach(s); }}>
              Attach
            </Button>
            <Button size="1" variant="soft" color="red" data-testid="kill-btn" onClick={(e) => { e.stopPropagation(); onKill(s); }}>
              Kill
            </Button>
          </>
        )}
        {s.status === 'stopped' && onResume && (
          <Button size="1" variant="soft" color="green" data-testid="resume-btn" onClick={(e) => { e.stopPropagation(); onResume(s); }}>
            Resume
          </Button>
        )}
        {s.source === 'tracked' && onRefresh && (
          <Button size="1" variant="ghost" data-testid="refresh-btn" onClick={(e) => { e.stopPropagation(); onRefresh(s); }}>
            ↻
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Active Sessions (running) ────────────────────────────────────────────────

export function ActiveSessionList({ sessions, loading, onAttach, onKill, onRefresh }) {
  const active = (sessions || []).filter((s) => s.status === 'running');

  if (loading) {
    return <div data-testid="active-loading" style={{ padding: '16px', color: '#6c7086', fontSize: '13px' }}>Loading sessions...</div>;
  }

  if (active.length === 0) {
    return (
      <div data-testid="active-empty" style={{ padding: '16px', color: '#585b70', fontSize: '13px' }}>
        No active sessions. Create one to get started.
      </div>
    );
  }

  return (
    <div data-testid="active-session-list">
      {active.map((s) => (
        <SessionRow key={s.id || s.tmux_session_name} session={s} onAttach={onAttach} onKill={onKill} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

// ─── Past Sessions (scrollable, paginated) ────────────────────────────────────

export function PastSessionList({ sessions, loading, hasMore, onLoadMore, onAttach, onResume, onKill, showServer }) {
  if (loading && (!sessions || sessions.length === 0)) {
    return <div data-testid="past-loading" style={{ padding: '16px', color: '#6c7086', fontSize: '13px' }}>Loading past sessions...</div>;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div data-testid="past-empty" style={{ padding: '16px', color: '#585b70', fontSize: '13px' }}>
        No past sessions yet.
      </div>
    );
  }

  return (
    <div
      data-testid="past-session-list"
      style={{
        maxHeight: '400px',
        overflowY: 'auto',
        border: '1px solid #313244',
        borderRadius: '8px',
      }}
      onScroll={(e) => {
        // Infinite scroll: load more when near bottom
        const el = e.target;
        if (hasMore && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
          onLoadMore();
        }
      }}
    >
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          onAttach={onAttach}
          onKill={onKill}
          onResume={onResume}
          showServer={showServer}
        />
      ))}
      {loading && (
        <div style={{ padding: '12px', textAlign: 'center', color: '#6c7086', fontSize: '12px' }}>
          Loading more...
        </div>
      )}
      {hasMore && !loading && (
        <div style={{ padding: '12px', textAlign: 'center' }}>
          <Button size="1" variant="ghost" data-testid="load-more-btn" onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
