import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Button, Select } from '@radix-ui/themes';
import { ActiveSessionList, PastSessionList } from './SessionList';
import WebTerminal from './WebTerminal';
import AudioRecorder from './AudioRecorder';

export default function SessionMirror({ apiUrl, getAuthHeaders }) {
  const [servers, setServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'terminal'
  const [activeSession, setActiveSession] = useState(null);

  // Past sessions (paginated, all servers or filtered)
  const [pastSessions, setPastSessions] = useState([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastHasMore, setPastHasMore] = useState(false);
  const [pastCursor, setPastCursor] = useState(null);
  const [pastServerFilter, setPastServerFilter] = useState('all');

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

  // Fetch active sessions for the selected server
  const fetchSessions = useCallback(async () => {
    if (!selectedServerId) return;
    setLoading(true);
    try {
      const response = await axios.get(
        `${apiUrl}/session-mirror/servers/${selectedServerId}/sessions`,
        { headers: getAuthHeaders() },
      );
      setSessions(response.data?.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, getAuthHeaders, selectedServerId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Fetch past sessions (paginated)
  const fetchPastSessions = useCallback(async (reset = false) => {
    setPastLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (pastServerFilter !== 'all') params.set('serverId', pastServerFilter);
      if (!reset && pastCursor) params.set('cursor', pastCursor);

      const response = await axios.get(
        `${apiUrl}/session-mirror/sessions?${params}`,
        { headers: getAuthHeaders() },
      );
      const data = response.data;
      if (reset) {
        setPastSessions(data.sessions);
      } else {
        setPastSessions((prev) => [...prev, ...data.sessions]);
      }
      setPastHasMore(data.hasMore);
      setPastCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load past sessions:', err);
    } finally {
      setPastLoading(false);
    }
  }, [apiUrl, getAuthHeaders, pastCursor, pastServerFilter]);

  // Reset and refetch past sessions when filter changes
  useEffect(() => {
    setPastSessions([]);
    setPastCursor(null);
    setPastHasMore(false);
    // Use a small delay to avoid calling with stale cursor
    const timer = setTimeout(() => {
      fetchPastSessionsReset();
    }, 50);
    return () => clearTimeout(timer);
  }, [pastServerFilter]);

  const fetchPastSessionsReset = useCallback(async () => {
    setPastLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (pastServerFilter !== 'all') params.set('serverId', pastServerFilter);

      const response = await axios.get(
        `${apiUrl}/session-mirror/sessions?${params}`,
        { headers: getAuthHeaders() },
      );
      const data = response.data;
      setPastSessions(data.sessions);
      setPastHasMore(data.hasMore);
      setPastCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load past sessions:', err);
    } finally {
      setPastLoading(false);
    }
  }, [apiUrl, getAuthHeaders, pastServerFilter]);

  const handleLoadMorePast = useCallback(() => {
    if (!pastLoading && pastHasMore) fetchPastSessions(false);
  }, [fetchPastSessions, pastLoading, pastHasMore]);

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
      await fetchSessions();
      fetchPastSessionsReset();
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
      await fetchSessions();
      fetchPastSessionsReset();
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
      // If the resumed session is on the currently-selected server, refresh active list
      if (String(session.ssh_server_id) === String(selectedServerId)) {
        await fetchSessions();
      }
      fetchPastSessionsReset();
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
      await fetchSessions();
      fetchPastSessionsReset();
    } catch (err) {
      console.error('Failed to refresh session:', err);
    }
  };

  // Back from terminal
  const handleBack = () => {
    setActiveSession(null);
    setView('list');
    fetchSessions();
    fetchPastSessionsReset();
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

  return (
    <section className="session-mirror" data-testid="session-mirror-list" style={{ padding: '12px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '15px' }}>Sessions</span>

        {/* Server selector for new sessions / active view */}
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

        <Button size="1" variant="soft" data-testid="refresh-btn" onClick={fetchSessions} disabled={loading}>
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

      {/* Active Sessions */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#a6adc8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Active Sessions
        </div>
        <ActiveSessionList
          sessions={sessions}
          loading={loading}
          onAttach={handleAttach}
          onKill={handleKill}
          onRefresh={handleRefresh}
        />
      </div>

      {/* Past Sessions */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#a6adc8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Past Sessions
          </span>
          <Select.Root value={pastServerFilter} onValueChange={setPastServerFilter}>
            <Select.Trigger data-testid="past-server-filter" size="1" style={{ minWidth: '140px' }} />
            <Select.Content>
              <Select.Item value="all">All servers</Select.Item>
              {servers.map((s) => (
                <Select.Item key={s.id} value={String(s.id)}>
                  {s.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <PastSessionList
          sessions={pastSessions}
          loading={pastLoading}
          hasMore={pastHasMore}
          onLoadMore={handleLoadMorePast}
          onAttach={handleAttach}
          onResume={handleResume}
          onKill={handleKill}
          showServer={pastServerFilter === 'all'}
        />
      </div>
    </section>
  );
}
