import { Button } from '@radix-ui/themes';

const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex', unknown: 'tmux' };

const STATUS_STYLES = {
  running: { color: '#1e1e2e', background: '#94e2d5', label: 'running' },
  attached: { color: '#1e1e2e', background: '#a6e3a1', label: 'attached' },
  stopped: { color: '#cdd6f4', background: '#6c7086', label: 'stopped' },
  file: { color: '#cdd6f4', background: '#585b70', label: 'session file' },
};

const SOURCE_STYLES = {
  tracked: { color: '#89b4fa', background: '#89b4fa22', label: 'client' },
  discovered: { color: '#f9e2af', background: '#f9e2af22', label: 'server' },
  session_file: { color: '#585b70', background: '#585b7022', label: 'history' },
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

function SourceBadge({ source }) {
  const style = SOURCE_STYLES[source];
  if (!style) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: '3px',
      fontSize: '10px',
      fontWeight: 500,
      color: style.color,
      background: style.background,
      border: `1px solid ${style.color}33`,
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
  const isRunning = s.status === 'running';
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
        cursor: isRunning ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onClick={isRunning ? () => onAttach(s) : undefined}
      onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.background = '#1e1e2e'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Left: label + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName}
          </span>
          <StatusBadge status={s.status} attached={s.attached} />
          <SourceBadge source={s.source} />
          <span style={{ fontSize: '11px', color: '#585b70' }}>
            {AGENT_LABELS[s.agent_type] || s.agent_type}
          </span>
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
        {isRunning && (
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

// ─── Unified Session List ─────────────────────────────────────────────────────
// Merges live (active) and DB (past) sessions into a single deduplicated list.
// Running sessions appear first, then stopped, sorted by time within each group.

export function UnifiedSessionList({
  liveSessions,
  dbSessions,
  loading,
  hasMore,
  onLoadMore,
  onAttach,
  onResume,
  onKill,
  onRefresh,
  showServer,
}) {
  // Merge & deduplicate: live sessions take priority (they have real-time status)
  const liveById = new Map();
  for (const s of (liveSessions || [])) {
    liveById.set(s.id, s);
    if (s.tmux_session_name) liveById.set(s.tmux_session_name, s);
  }

  const merged = [];
  const seen = new Set();

  // Add all live sessions first
  for (const s of (liveSessions || [])) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  // Add DB sessions that aren't already represented by live sessions
  for (const s of (dbSessions || [])) {
    if (!seen.has(s.id) && !liveById.has(s.tmux_session_name)) {
      seen.add(s.id);
      // Enrich DB sessions with server info and source tag
      merged.push({ ...s, source: s.source || 'tracked' });
    }
  }

  // Sort: running first, then stopped, then files. Within each group, newest first.
  const statusOrder = { running: 0, stopped: 1, file: 2 };
  merged.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 1;
    const sb = statusOrder[b.status] ?? 1;
    if (sa !== sb) return sa - sb;
    const ta = a.started_at || a.updated_at || '';
    const tb = b.started_at || b.updated_at || '';
    return tb.localeCompare(ta);
  });

  if (loading && merged.length === 0) {
    return <div data-testid="sessions-loading" style={{ padding: '16px', color: '#6c7086', fontSize: '13px' }}>Loading sessions...</div>;
  }

  if (merged.length === 0) {
    return (
      <div data-testid="sessions-empty" style={{ padding: '16px', color: '#585b70', fontSize: '13px' }}>
        No sessions yet. Create one to get started.
      </div>
    );
  }

  return (
    <div
      data-testid="unified-session-list"
      style={{
        maxHeight: '600px',
        overflowY: 'auto',
        border: '1px solid #313244',
        borderRadius: '8px',
      }}
      onScroll={(e) => {
        const el = e.target;
        if (hasMore && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
          onLoadMore?.();
        }
      }}
    >
      {merged.map((s) => (
        <SessionRow
          key={s.id || s.tmux_session_name}
          session={s}
          onAttach={onAttach}
          onKill={onKill}
          onResume={onResume}
          onRefresh={onRefresh}
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

// Keep legacy exports for backward compatibility during transition
export function ActiveSessionList(props) {
  return <UnifiedSessionList liveSessions={props.sessions} dbSessions={[]} loading={props.loading} onAttach={props.onAttach} onKill={props.onKill} onRefresh={props.onRefresh} />;
}

export function PastSessionList(props) {
  return <UnifiedSessionList liveSessions={[]} dbSessions={props.sessions} loading={props.loading} hasMore={props.hasMore} onLoadMore={props.onLoadMore} onAttach={props.onAttach} onResume={props.onResume} onKill={props.onKill} showServer={props.showServer} />;
}
