import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Button, Select } from '@radix-ui/themes';
import { UnifiedSessionList } from './SessionList';
import WebTerminal from './WebTerminal';
import AudioRecorder from './AudioRecorder';

export default function SessionMirror({ apiUrl, getAuthHeaders }) {
  const [servers, setServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [liveSessions, setLiveSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'terminal'
  const [activeSession, setActiveSession] = useState(null);

  // DB sessions (paginated, all servers or filtered by selected server)
  const [dbSessions, setDbSessions] = useState([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbHasMore, setDbHasMore] = useState(false);
  const [dbCursor, setDbCursor] = useState(null);

  // New session form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAgentType, setNewAgentType] = useState('claude');
  const [newCwd, setNewCwd] = useState('~');
  const [newLabel, setNewLabel] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [creating, setCreating] = useState(false);

  // Fetch SSH servers
  useEffect(() => {
    (async () => {
      try {
        const response = await axios.get(`${apiUrl}/ssh-servers`, {
          headers: getAuthHeaders(),
        });
        const list = response.data?.servers || response.data || [];
        setServers(list);
        if (list.length > 0 && !selectedServerId) {
          setSelectedServerId(String(list[0].id));
        }
      } catch (err) {
        console.error('Failed to load SSH servers:', err);
      }
    })();
  }, [apiUrl, getAuthHeaders]);

  // Fetch live sessions for the selected server
  const fetchLiveSessions = useCallback(async () => {
    if (!selectedServerId) return;
    setLoading(true);
    try {
      const response = await axios.get(
        `${apiUrl}/session-mirror/servers/${selectedServerId}/sessions`,
        { headers: getAuthHeaders() },
      );
      setLiveSessions(response.data?.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setLiveSessions([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, getAuthHeaders, selectedServerId]);

  useEffect(() => {
    fetchLiveSessions();
  }, [fetchLiveSessions]);

  // Fetch DB sessions (paginated, filtered to selected server for dedup)
  const fetchDbSessionsReset = useCallback(async () => {
    setDbLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (selectedServerId) params.set('serverId', selectedServerId);

      const response = await axios.get(
        `${apiUrl}/session-mirror/sessions?${params}`,
        { headers: getAuthHeaders() },
      );
      const data = response.data;
      setDbSessions(data.sessions);
      setDbHasMore(data.hasMore);
      setDbCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load DB sessions:', err);
    } finally {
      setDbLoading(false);
    }
  }, [apiUrl, getAuthHeaders, selectedServerId]);

  // Reset DB sessions when server changes
  useEffect(() => {
    setDbSessions([]);
    setDbCursor(null);
    setDbHasMore(false);
    const timer = setTimeout(() => {
      fetchDbSessionsReset();
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedServerId]);

  const fetchDbSessionsMore = useCallback(async () => {
    if (dbLoading || !dbHasMore) return;
    setDbLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (selectedServerId) params.set('serverId', selectedServerId);
      if (dbCursor) params.set('cursor', dbCursor);

      const response = await axios.get(
        `${apiUrl}/session-mirror/sessions?${params}`,
        { headers: getAuthHeaders() },
      );
      const data = response.data;
      setDbSessions((prev) => [...prev, ...data.sessions]);
      setDbHasMore(data.hasMore);
      setDbCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load more sessions:', err);
    } finally {
      setDbLoading(false);
    }
  }, [apiUrl, getAuthHeaders, dbCursor, dbLoading, dbHasMore, selectedServerId]);

  // Create new session
  const handleCreate = async () => {
    if (!selectedServerId) return;
    setCreating(true);
    try {
      await axios.post(
        `${apiUrl}/session-mirror/servers/${selectedServerId}/sessions`,
        { agentType: newAgentType, cwd: newCwd, label: newLabel, prompt: newPrompt },
        { headers: getAuthHeaders() },
      );
      setShowNewForm(false);
      setNewPrompt('');
      setNewLabel('');
      await fetchLiveSessions();
      fetchDbSessionsReset();
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreating(false);
    }
  };

  // Attach to session
  const handleAttach = (session) => {
    setActiveSession(session);
    setView('terminal');
  };

  // Kill session
  const handleKill = async (session) => {
    try {
      await axios.delete(
        `${apiUrl}/session-mirror/sessions/${session.id}`,
        { headers: getAuthHeaders() },
      );
      await fetchLiveSessions();
      fetchDbSessionsReset();
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
  };

  // Resume a stopped session
  const handleResume = async (session) => {
    try {
      await axios.post(
        `${apiUrl}/session-mirror/sessions/${session.id}/resume`,
        {},
        { headers: getAuthHeaders() },
      );
      await fetchLiveSessions();
      fetchDbSessionsReset();
    } catch (err) {
      console.error('Failed to resume session:', err);
    }
  };

  // Refresh metadata
  const handleRefresh = async (session) => {
    try {
      await axios.post(
        `${apiUrl}/session-mirror/sessions/${session.id}/refresh`,
        {},
        { headers: getAuthHeaders() },
      );
      await fetchLiveSessions();
      fetchDbSessionsReset();
    } catch (err) {
      console.error('Failed to refresh session:', err);
    }
  };

  // Back from terminal
  const handleBack = () => {
    setActiveSession(null);
    setView('list');
    fetchLiveSessions();
    fetchDbSessionsReset();
  };

  // ─── Terminal view ──────────────────────────────────────────────────────────

  if (view === 'terminal' && activeSession) {
    return (
      <section className="session-mirror" data-testid="session-mirror-terminal" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Button size="1" variant="soft" data-testid="back-btn" onClick={handleBack}>← Back</Button>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '14px' }}>
            {activeSession.label || activeSession.tmux_session_name || activeSession.id}
          </span>
          <span style={{ fontSize: '11px', color: '#6c7086' }}>
            {activeSession.agent_type === 'codex' ? 'Codex' : 'Claude Code'}
          </span>
          <div style={{ flex: 1 }} />
          <Button size="1" variant="soft" color="red" data-testid="kill-active-btn" onClick={() => { handleKill(activeSession); handleBack(); }}>
            Kill Session
          </Button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WebTerminal
            sessionId={activeSession.id || activeSession.tmux_session_name}
            serverId={activeSession.ssh_server_id || selectedServerId}
            apiUrl={apiUrl}
          />
        </div>
      </section>
    );
  }

  // ─── List view ──────────────────────────────────────────────────────────────

  const selectedServerName = servers.find((s) => String(s.id) === selectedServerId)?.name || '';

  return (
    <section className="session-mirror" data-testid="session-mirror-list" style={{ padding: '12px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '15px' }}>Sessions</span>

        {/* Server selector */}
        <Select.Root value={selectedServerId || ''} onValueChange={setSelectedServerId}>
          <Select.Trigger placeholder="Select server..." data-testid="server-select" style={{ minWidth: '180px' }} />
          <Select.Content>
            {servers.map((s) => (
              <Select.Item key={s.id} value={String(s.id)}>
                {s.name} ({s.user}@{s.host})
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        <div style={{ flex: 1 }} />

        <Button size="1" variant="soft" data-testid="refresh-btn" onClick={() => { fetchLiveSessions(); fetchDbSessionsReset(); }} disabled={loading}>
          Refresh
        </Button>
        <Button size="1" variant="solid" data-testid="new-session-btn" onClick={() => setShowNewForm(!showNewForm)}>
          {showNewForm ? 'Cancel' : '+ New Session'}
        </Button>
      </div>

      {/* New session form */}
      {showNewForm && (
        <div data-testid="new-session-form" style={{
          padding: '12px 16px',
          marginBottom: '16px',
          background: '#181825',
          borderRadius: '8px',
          border: '1px solid #313244',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#6c7086', marginBottom: '4px' }}>Agent</label>
              <Select.Root value={newAgentType} onValueChange={setNewAgentType}>
                <Select.Trigger data-testid="agent-type-select" style={{ minWidth: '130px' }} />
                <Select.Content>
                  <Select.Item value="claude">Claude Code</Select.Item>
                  <Select.Item value="codex">Codex</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#6c7086', marginBottom: '4px' }}>Working Dir</label>
              <input
                data-testid="cwd-input"
                type="text"
                value={newCwd}
                onChange={(e) => setNewCwd(e.target.value)}
                placeholder="~ or /path/to/project"
                style={{
                  padding: '6px 10px', borderRadius: '6px', border: '1px solid #313244',
                  background: '#1e1e2e', color: '#cdd6f4', fontSize: '13px', fontFamily: 'monospace',
                  width: '250px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#6c7086', marginBottom: '4px' }}>Label (optional)</label>
              <input
                data-testid="label-input"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="My research session"
                style={{
                  padding: '6px 10px', borderRadius: '6px', border: '1px solid #313244',
                  background: '#1e1e2e', color: '#cdd6f4', fontSize: '13px',
                  width: '200px',
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#6c7086', marginBottom: '4px' }}>
              Initial Prompt (optional — sent as first input to the agent)
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <textarea
                data-testid="prompt-input"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="What would you like the agent to work on?"
                rows={2}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid #313244',
                  background: '#1e1e2e', color: '#cdd6f4', fontSize: '13px', fontFamily: 'monospace',
                  resize: 'vertical',
                }}
              />
              <AudioRecorder
                apiUrl={apiUrl}
                getAuthHeaders={getAuthHeaders}
                onTranscription={(text) => setNewPrompt((prev) => prev ? `${prev} ${text}` : text)}
              />
            </div>
          </div>

          <div style={{ marginTop: '10px', textAlign: 'right' }}>
            <Button size="2" variant="solid" data-testid="create-btn" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Session'}
            </Button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: '#6c7086', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: '#a6adc8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {selectedServerName || 'All Sessions'}
        </span>
        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#89b4fa', display: 'inline-block' }} />
          client — created from this UI, tracked in DB
        </span>
        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f9e2af', display: 'inline-block' }} />
          server — discovered on remote host, may predate this UI
        </span>
      </div>

      {/* Unified session list */}
      <UnifiedSessionList
        liveSessions={liveSessions}
        dbSessions={dbSessions}
        loading={loading || dbLoading}
        hasMore={dbHasMore}
        onLoadMore={fetchDbSessionsMore}
        onAttach={handleAttach}
        onResume={handleResume}
        onKill={handleKill}
        onRefresh={handleRefresh}
        showServer
      />
    </section>
  );
}
