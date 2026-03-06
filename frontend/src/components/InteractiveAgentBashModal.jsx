import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

function cleanString(value) {
  return String(value || '').trim();
}

function formatTimestamp(value) {
  const input = cleanString(value);
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}

function isSessionRunning(session = null, activeRun = null) {
  const status = cleanString(session?.status).toUpperCase();
  const runStatus = cleanString(activeRun?.status).toUpperCase();
  if (['QUEUED', 'PROVISIONING', 'RUNNING'].includes(runStatus)) return true;
  return status === 'RUNNING';
}

function normalizeProvider(provider = '') {
  return cleanString(provider).toLowerCase() === 'claude_code_cli' ? 'claude_code_cli' : 'codex_cli';
}

function roleLabel(role = '') {
  const normalized = cleanString(role).toLowerCase();
  if (normalized === 'assistant') return 'Agent';
  if (normalized === 'system') return 'System';
  return 'User';
}

function revokeComposerImages(images = []) {
  for (const item of images) {
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

function sessionStorageKey(projectId = '') {
  const id = cleanString(projectId);
  return id ? `vibe_interactive_agent_session_${id}` : '';
}

function InteractiveAgentBashModal({
  open,
  onClose,
  apiUrl,
  getAuthHeaders,
  project,
  sshServers = [],
  defaultServerId = 'local-default',
  onError,
}) {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionDetail, setSessionDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [content, setContent] = useState('');
  const [provider, setProvider] = useState('codex_cli');
  const [codexModel, setCodexModel] = useState('gpt-5.3-codex');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-6');
  const [reasoningEffort, setReasoningEffort] = useState('high');
  const [serverId, setServerId] = useState(defaultServerId || 'local-default');
  const [composerImages, setComposerImages] = useState([]);
  const imageSeqRef = useRef(0);
  const composerRef = useRef(null);
  const composerImagesRef = useRef([]);

  const projectId = cleanString(project?.id);
  const selectedSession = useMemo(() => (
    sessions.find((item) => item.id === selectedSessionId)
    || (sessionDetail?.session?.id === selectedSessionId ? sessionDetail.session : null)
    || null
  ), [sessions, selectedSessionId, sessionDetail]);
  const activeRun = sessionDetail?.activeRun || null;
  const running = isSessionRunning(selectedSession, activeRun);
  const hasComposerInput = cleanString(content) || composerImages.length > 0;
  const canSend = Boolean(open && selectedSessionId && hasComposerInput && !running && !sending);
  const activeModel = provider === 'codex_cli' ? codexModel : claudeModel;

  const reportError = useCallback((message) => {
    const next = cleanString(message);
    if (!next) return;
    setInlineError(next);
    if (typeof onError === 'function') onError(next);
  }, [onError]);

  const authHeaders = useCallback(() => (getAuthHeaders ? getAuthHeaders() : {}), [getAuthHeaders]);

  const syncComposerFromSession = useCallback((session) => {
    if (!session) return;
    const nextProvider = normalizeProvider(session.provider);
    setProvider(nextProvider);
    setServerId(cleanString(session.serverId) || defaultServerId || 'local-default');
    if (nextProvider === 'codex_cli') {
      setCodexModel(cleanString(session.model) || 'gpt-5.3-codex');
      setReasoningEffort(cleanString(session.reasoningEffort) || 'high');
    } else {
      setClaudeModel(cleanString(session.model) || 'claude-sonnet-4-6');
    }
  }, [defaultServerId]);

  const loadSessions = useCallback(async ({ silent = false } = {}) => {
    if (!projectId || !open) return [];
    if (!silent) setSessionsLoading(true);
    try {
      const resp = await axios.get(`${apiUrl}/researchops/projects/${projectId}/agent-sessions`, {
        headers: authHeaders(),
        params: { limit: 200 },
      });
      const items = Array.isArray(resp.data?.sessions) ? resp.data.sessions : [];
      setSessions(items);
      if (items.length === 0) {
        setSelectedSessionId('');
        return items;
      }
      setSelectedSessionId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        const storedKey = sessionStorageKey(projectId);
        const stored = storedKey ? localStorage.getItem(storedKey) : '';
        if (stored && items.some((item) => item.id === stored)) return stored;
        return items[0].id;
      });
      return items;
    } catch (error) {
      reportError(error?.response?.data?.error || error?.message || 'Failed to load interactive sessions');
      return [];
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  }, [apiUrl, authHeaders, open, projectId, reportError]);

  const loadSelectedSession = useCallback(async (sessionId, { silent = false } = {}) => {
    const sid = cleanString(sessionId);
    if (!sid || !open) return null;
    if (!silent) setMessagesLoading(true);
    try {
      const [sessionResp, msgResp] = await Promise.all([
        axios.get(`${apiUrl}/researchops/agent-sessions/${sid}`, { headers: authHeaders() }),
        axios.get(`${apiUrl}/researchops/agent-sessions/${sid}/messages`, {
          headers: authHeaders(),
          params: { limit: 500 },
        }),
      ]);
      const sessionPayload = sessionResp.data?.session || null;
      const activeRunPayload = sessionResp.data?.activeRun || null;
      setSessionDetail({ session: sessionPayload, activeRun: activeRunPayload });
      setMessages(Array.isArray(msgResp.data?.items) ? msgResp.data.items : []);
      if (sessionPayload) syncComposerFromSession(sessionPayload);
      return { session: sessionPayload, activeRun: activeRunPayload };
    } catch (error) {
      reportError(error?.response?.data?.error || error?.message || 'Failed to load session details');
      return null;
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, [apiUrl, authHeaders, open, reportError, syncComposerFromSession]);

  const clearComposerImages = useCallback(() => {
    setComposerImages((prev) => {
      revokeComposerImages(prev);
      return [];
    });
  }, []);

  const handleCreateSession = useCallback(async () => {
    if (!projectId || creatingSession) return;
    setCreatingSession(true);
    setInlineError('');
    try {
      const payload = {
        provider,
        model: activeModel,
        reasoningEffort: provider === 'codex_cli' ? reasoningEffort : undefined,
        serverId,
      };
      const resp = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/agent-sessions`,
        payload,
        { headers: authHeaders() }
      );
      const created = resp.data?.session || null;
      const items = await loadSessions({ silent: true });
      if (created?.id) {
        setSelectedSessionId(created.id);
        await loadSelectedSession(created.id, { silent: true });
      } else if (items[0]?.id) {
        setSelectedSessionId(items[0].id);
        await loadSelectedSession(items[0].id, { silent: true });
      }
    } catch (error) {
      reportError(error?.response?.data?.error || error?.message || 'Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  }, [
    activeModel,
    apiUrl,
    authHeaders,
    creatingSession,
    loadSelectedSession,
    loadSessions,
    projectId,
    provider,
    reasoningEffort,
    reportError,
    serverId,
  ]);

  const handleStopSession = useCallback(async () => {
    const sid = cleanString(selectedSessionId);
    if (!sid || stopping) return;
    setStopping(true);
    setInlineError('');
    try {
      await axios.post(`${apiUrl}/researchops/agent-sessions/${sid}/stop`, {}, { headers: authHeaders() });
      await loadSessions({ silent: true });
      await loadSelectedSession(sid, { silent: true });
    } catch (error) {
      reportError(error?.response?.data?.error || error?.message || 'Failed to stop running session');
    } finally {
      setStopping(false);
    }
  }, [apiUrl, authHeaders, loadSelectedSession, loadSessions, reportError, selectedSessionId, stopping]);

  const appendImageFile = useCallback((file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const next = {
      id: `img_${Date.now()}_${imageSeqRef.current += 1}`,
      file,
      previewUrl,
      filename: cleanString(file.name) || `paste-${Date.now()}.png`,
      mimeType: cleanString(file.type) || 'image/png',
      sizeBytes: Number(file.size) || 0,
      note: '',
    };
    setComposerImages((prev) => [...prev, next]);
  }, []);

  const handlePaste = useCallback((event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter((item) => cleanString(item.type).startsWith('image/'));
    if (imageItems.length === 0) return;
    event.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) appendImageFile(file);
    });
  }, [appendImageFile]);

  const removeComposerImage = useCallback((imageId) => {
    setComposerImages((prev) => {
      const target = prev.find((item) => item.id === imageId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== imageId);
    });
  }, []);

  const updateImageNote = useCallback((imageId, note) => {
    setComposerImages((prev) => prev.map((item) => (
      item.id === imageId ? { ...item, note } : item
    )));
  }, []);

  const handleSend = useCallback(async () => {
    const sid = cleanString(selectedSessionId);
    if (!sid || !canSend) return;
    setSending(true);
    setInlineError('');
    try {
      const formData = new FormData();
      formData.append('content', content);
      formData.append('provider', provider);
      formData.append('model', activeModel);
      formData.append('serverId', serverId);
      if (provider === 'codex_cli') formData.append('reasoningEffort', reasoningEffort);
      formData.append('imageMeta', JSON.stringify(composerImages.map((item) => ({
        note: cleanString(item.note) || '',
      }))));
      composerImages.forEach((item) => {
        formData.append('images', item.file, item.filename);
      });

      await axios.post(`${apiUrl}/researchops/agent-sessions/${sid}/messages`, formData, {
        headers: {
          ...authHeaders(),
          'Content-Type': 'multipart/form-data',
        },
      });

      setContent('');
      clearComposerImages();
      await loadSessions({ silent: true });
      await loadSelectedSession(sid, { silent: true });
      if (composerRef.current) composerRef.current.focus();
    } catch (error) {
      reportError(error?.response?.data?.error || error?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [
    activeModel,
    apiUrl,
    authHeaders,
    canSend,
    clearComposerImages,
    composerImages,
    content,
    loadSelectedSession,
    loadSessions,
    provider,
    reasoningEffort,
    reportError,
    selectedSessionId,
    sending,
    serverId,
  ]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  useEffect(() => {
    if (!open || !projectId) return;
    setInlineError('');
    const storedKey = sessionStorageKey(projectId);
    const storedSessionId = storedKey ? localStorage.getItem(storedKey) : '';
    if (storedSessionId) setSelectedSessionId(storedSessionId);
    setServerId(defaultServerId || 'local-default');
    loadSessions();
  }, [defaultServerId, loadSessions, open, projectId]);

  useEffect(() => {
    if (!open || !selectedSessionId) return;
    loadSelectedSession(selectedSessionId);
    const key = sessionStorageKey(projectId);
    if (key) localStorage.setItem(key, selectedSessionId);
  }, [loadSelectedSession, open, projectId, selectedSessionId]);

  useEffect(() => {
    if (!open || !projectId) return undefined;
    const timer = setInterval(async () => {
      await loadSessions({ silent: true });
      const sid = cleanString(selectedSessionId);
      if (sid) await loadSelectedSession(sid, { silent: true });
    }, 4000);
    return () => clearInterval(timer);
  }, [loadSelectedSession, loadSessions, open, projectId, selectedSessionId]);

  useEffect(() => () => {
    revokeComposerImages(composerImagesRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setInlineError('');
      setContent('');
      clearComposerImages();
    }
  }, [clearComposerImages, open]);

  if (!open || !projectId) return null;

  return (
    <div className="vibe-modal-backdrop" onClick={() => !sending && onClose()}>
      <article
        className="vibe-modal vibe-agent-bash-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vibe-agent-bash-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vibe-modal-header">
          <h3 id="vibe-agent-bash-title">Interactive Agent Bash</h3>
          <button
            type="button"
            className="vibe-modal-close"
            onClick={() => !sending && onClose()}
            aria-label="Close interactive agent modal"
          >
            &times;
          </button>
        </div>

        <div className="vibe-agent-bash-layout">
          <aside className="vibe-agent-session-pane">
            <div className="vibe-agent-pane-head">
              <h4>Sessions</h4>
              <button
                type="button"
                className="vibe-secondary-btn"
                onClick={handleCreateSession}
                disabled={creatingSession}
              >
                {creatingSession ? 'Creating…' : 'New Session'}
              </button>
            </div>
            <div className="vibe-agent-session-list">
              {sessionsLoading && sessions.length === 0 && (
                <p className="vibe-empty">Loading sessions...</p>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <p className="vibe-empty">No sessions yet. Create one to begin.</p>
              )}
              {sessions.map((session) => {
                const sessionRunState = cleanString(session.status).toUpperCase();
                const sessionIsRunning = sessionRunState === 'RUNNING';
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`vibe-agent-session-item${session.id === selectedSessionId ? ' is-active' : ''}`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <span className="vibe-agent-session-title">{session.title || session.id}</span>
                    <span className={`vibe-agent-session-status vibe-agent-session-status--${sessionRunState.toLowerCase() || 'idle'}`}>
                      {sessionIsRunning ? 'Running' : (sessionRunState || 'Idle')}
                    </span>
                    <span className="vibe-agent-session-meta">{formatTimestamp(session.updatedAt)}</span>
                    {session.lastMessage && (
                      <span className="vibe-agent-session-preview">{session.lastMessage}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="vibe-agent-chat-pane">
            <div className="vibe-agent-chat-head">
              <div className="vibe-agent-chat-head-main">
                <strong>{selectedSession?.title || 'No session selected'}</strong>
                {selectedSession && (
                  <span className={`vibe-agent-session-status vibe-agent-session-status--${cleanString(selectedSession.status).toLowerCase() || 'idle'}`}>
                    {running ? `Running${activeRun?.status ? ` (${activeRun.status})` : ''}` : (selectedSession.status || 'IDLE')}
                  </span>
                )}
                {activeRun?.id && (
                  <span className="vibe-card-note">run: {activeRun.id}</span>
                )}
              </div>
              <div className="vibe-agent-chat-controls">
                <select
                  className="vibe-model-select"
                  value={serverId}
                  onChange={(event) => setServerId(event.target.value)}
                  disabled={running || sending}
                  title="Execution server"
                >
                  <option value="local-default">Local</option>
                  {sshServers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name || server.host}</option>
                  ))}
                </select>
                <div className="vibe-provider-toggle">
                  <button
                    type="button"
                    className={`vibe-provider-chip${provider === 'codex_cli' ? ' is-active' : ''}`}
                    onClick={() => setProvider('codex_cli')}
                    disabled={running || sending}
                  >
                    Codex
                  </button>
                  <button
                    type="button"
                    className={`vibe-provider-chip${provider === 'claude_code_cli' ? ' is-active' : ''}`}
                    onClick={() => setProvider('claude_code_cli')}
                    disabled={running || sending}
                  >
                    Claude
                  </button>
                </div>
                {provider === 'codex_cli' ? (
                  <>
                    <select
                      className="vibe-model-select"
                      value={codexModel}
                      onChange={(event) => setCodexModel(event.target.value)}
                      disabled={running || sending}
                      title="Codex model"
                    >
                      <option value="gpt-5.3-codex">gpt-5.3-codex</option>
                    </select>
                    <select
                      className="vibe-model-select"
                      value={reasoningEffort}
                      onChange={(event) => setReasoningEffort(event.target.value)}
                      disabled={running || sending}
                      title="Reasoning effort"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </>
                ) : (
                  <select
                    className="vibe-model-select"
                    value={claudeModel}
                    onChange={(event) => setClaudeModel(event.target.value)}
                    disabled={running || sending}
                    title="Claude model"
                  >
                    <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                  </select>
                )}
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleStopSession}
                  disabled={!running || stopping}
                >
                  {stopping ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            </div>

            {inlineError && (
              <div className="vibe-card-error">{inlineError}</div>
            )}

            <div className="vibe-agent-messages">
              {messagesLoading && messages.length === 0 && (
                <p className="vibe-empty">Loading messages...</p>
              )}
              {!messagesLoading && messages.length === 0 && (
                <p className="vibe-empty">No messages yet. Enter a request to start.</p>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`vibe-agent-msg vibe-agent-msg--${cleanString(message.role).toLowerCase() || 'user'}`}
                >
                  <header className="vibe-agent-msg-meta">
                    <span>{roleLabel(message.role)}</span>
                    <span>#{message.sequence}</span>
                    <span>{formatTimestamp(message.createdAt)}</span>
                    {message.status && <span>{message.status}</span>}
                  </header>
                  {message.content && (
                    <pre className="vibe-agent-msg-body">{message.content}</pre>
                  )}
                  {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                    <div className="vibe-agent-msg-attachments">
                      {message.attachments.map((attachment, index) => {
                        const imageUrl = cleanString(attachment?.objectUrl);
                        const name = cleanString(attachment?.filename) || `attachment-${index + 1}`;
                        const note = cleanString(attachment?.note);
                        return (
                          <figure key={`${message.id}_att_${index}`} className="vibe-agent-msg-attachment">
                            {imageUrl ? (
                              <img src={imageUrl} alt={name} loading="lazy" />
                            ) : (
                              <div className="vibe-agent-attachment-fallback">{name}</div>
                            )}
                            <figcaption>
                              <span>{name}</span>
                              {note && <small>{note}</small>}
                            </figcaption>
                          </figure>
                        );
                      })}
                    </div>
                  )}
                </article>
              ))}
            </div>

            <div className="vibe-agent-composer">
              <textarea
                ref={composerRef}
                className="vibe-launcher-textarea"
                placeholder={running
                  ? 'Session is running. Wait for completion or click Stop.'
                  : 'Type a coding/bash instruction. Press Enter to send, Shift+Enter for newline. Paste images directly here.'}
                rows={4}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onPaste={handlePaste}
                disabled={!selectedSessionId || sending || running}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (canSend) handleSend();
                  }
                }}
              />
              {composerImages.length > 0 && (
                <div className="vibe-agent-composer-images">
                  {composerImages.map((image) => (
                    <div key={image.id} className="vibe-agent-composer-image">
                      <img src={image.previewUrl} alt={image.filename} />
                      <input
                        type="text"
                        value={image.note || ''}
                        onChange={(event) => updateImageNote(image.id, event.target.value)}
                        placeholder="Optional note"
                        disabled={sending || running}
                      />
                      <button
                        type="button"
                        className="vibe-project-delete-btn"
                        onClick={() => removeComposerImage(image.id)}
                        disabled={sending || running}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="vibe-agent-composer-actions">
                <span className="vibe-card-note">Headless run persists server-side after closing this window.</span>
                <button
                  type="button"
                  className="vibe-primary-btn"
                  onClick={handleSend}
                  disabled={!canSend}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}

export default InteractiveAgentBashModal;
