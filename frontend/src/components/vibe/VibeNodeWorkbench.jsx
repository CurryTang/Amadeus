import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import EmptyState from '../ui/EmptyState';
import ClarificationChat from './ClarificationChat';
import { buildContextPackSummary } from './contextPackPresentation.js';
import { buildNodeReviewSummary } from './reviewPresentation.js';
import { getTreeNodeKindLabel, isObservedTreeNode, isSearchTreeNode } from './treeNodePresentation.js';

const TABS = ['summary', 'commands', 'diff', 'outputs', 'deliverables', 'notes'];

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCommands(node = {}) {
  const commands = [];
  const raw = Array.isArray(node?.commands) ? node.commands : [];
  raw.forEach((item, index) => {
    if (typeof item === 'string') {
      commands.push({
        id: `cmd_${index + 1}`,
        name: `command_${index + 1}`,
        run: item,
      });
      return;
    }
    commands.push({
      id: cleanString(item?.name) || `cmd_${index + 1}`,
      name: cleanString(item?.name) || `command_${index + 1}`,
      run: cleanString(item?.run),
      raw: item,
    });
  });
  return commands;
}

function VibeNodeWorkbench({
  node,
  nodeState,
  observedSession,
  observedSessionRefreshing = false,
  mode,
  runReport,
  runReportLoading,
  runContextView,
  runContextLoading = false,
  onSaveCommands,
  onLoadSearch,
  onRefreshObservedSession,
  searchData,
  searchLoading,
  // Run Context Q&A props
  apiUrl,
  headers,
  projectId,
  onRunStep,
}) {
  const [tab, setTab] = useState('summary');
  const [commandsDraft, setCommandsDraft] = useState('');
  const [liveLogs, setLiveLogs] = useState([]);
  const logContainerRef = useRef(null);
  const autoScrollRef = useRef(true);

  // Run context Q&A state
  const [clarifyMessages, setClarifyMessages] = useState([]);
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [clarifyOptions, setClarifyOptions] = useState([]);
  const [clarifyDone, setClarifyDone] = useState(false);
  const [clarifyBusy, setClarifyBusy] = useState(false);
  const [clarifySkipped, setClarifySkipped] = useState(false);
  const [running, setRunning] = useState(false);

  const isObservedNode = isObservedTreeNode(node);
  const isSearchNode = isSearchTreeNode(node);
  const status = cleanString(nodeState?.status).toUpperCase() || 'PLANNED';
  const editable = !isObservedNode && ['PLANNED', 'BLOCKED'].includes(status) && mode !== 'view';
  const canRun = !isObservedNode && ['PLANNED', 'BLOCKED'].includes(status) && !!onRunStep && mode !== 'view';

  const activeRunId = cleanString(nodeState?.lastRunId);

  // Reset clarify state when node changes
  const prevNodeIdRef = useRef(null);
  useEffect(() => {
    const nodeId = String(node?.id || '');
    if (nodeId && nodeId !== prevNodeIdRef.current) {
      prevNodeIdRef.current = nodeId;
      setClarifyMessages([]);
      setClarifyQuestion('');
      setClarifyOptions([]);
      setClarifyDone(false);
      setClarifyBusy(false);
      setClarifySkipped(false);
      setRunning(false);
      // Kick off first question if node can be run
      if (canRun && apiUrl && projectId) {
        fetchNextQuestion(nodeId, []);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  const fetchNextQuestion = useCallback(async (nodeId, msgs) => {
    if (!apiUrl || !projectId || !nodeId) return;
    setClarifyBusy(true);
    try {
      const res = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/${nodeId}/run-clarify`,
        { messages: msgs },
        { headers },
      );
      const { done, question, options } = res.data;
      setClarifyDone(!!done);
      setClarifyQuestion(done ? '' : (question || ''));
      setClarifyOptions(done ? [] : (options || []));
    } catch (_) {
      setClarifyDone(true);
    } finally {
      setClarifyBusy(false);
    }
  }, [apiUrl, headers, projectId]);

  const handleClarifySend = useCallback(async (text) => {
    const userMsg = { role: 'user', content: text };
    const nextMsgs = [...clarifyMessages, userMsg];
    setClarifyMessages(nextMsgs);
    await fetchNextQuestion(String(node?.id || ''), nextMsgs);
  }, [clarifyMessages, fetchNextQuestion, node?.id]);

  const handleClarifySkip = useCallback(() => {
    setClarifySkipped(true);
  }, []);

  const handleClarifyUnskip = useCallback(() => {
    setClarifySkipped(false);
  }, []);

  const handleRun = useCallback(async () => {
    if (!onRunStep || running) return;
    setRunning(true);
    try {
      await onRunStep(String(node?.id || ''), {
        clarifyMessages: clarifySkipped ? [] : clarifyMessages,
      });
    } finally {
      setRunning(false);
    }
  }, [clarifyMessages, clarifySkipped, node?.id, onRunStep, running]);

  useEffect(() => {
    if (status !== 'RUNNING' || !activeRunId) {
      setLiveLogs([]);
      return;
    }
    setLiveLogs([]);
    autoScrollRef.current = true;
    const url = `/api/researchops/runs/${encodeURIComponent(activeRunId)}/events`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.eventType === 'LOG_LINE' && data.message) {
          setLiveLogs((prev) => [...prev.slice(-499), data.message]);
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(data.status)) {
          es.close();
        }
      } catch (_) {}
    };

    es.onerror = () => es.close();

    return () => es.close();
  }, [activeRunId, status]);

  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [liveLogs]);

  const commands = useMemo(() => parseCommands(node), [node]);

  const artifacts = Array.isArray(runReport?.artifacts) ? runReport.artifacts : [];
  const contextSummaryRows = useMemo(
    () => buildContextPackSummary(runContextView || {}),
    [runContextView]
  );
  const reviewSummaryRows = useMemo(
    () => buildNodeReviewSummary(node, nodeState, runReport),
    [node, nodeState, runReport]
  );
  const deliverables = useMemo(() => {
    const manifest = runReport?.manifest && typeof runReport.manifest === 'object' ? runReport.manifest : {};
    const items = [];
    (Array.isArray(manifest.figures) ? manifest.figures : []).forEach((item) => items.push(item));
    (Array.isArray(manifest.tables) ? manifest.tables : []).forEach((item) => items.push(item));
    return items;
  }, [runReport]);

  if (!node) {
    return (
      <section className="vibe-node-workbench">
        <EmptyState
          className="vibe-compact-empty"
          title="No node selected"
          hint="Select a node in the tree to inspect assumptions, checks, commands and outputs."
        />
      </section>
    );
  }

  return (
    <section className="vibe-node-workbench">
      <header className="vibe-node-workbench-head">
        <div>
          <h3>{node.title || node.id}</h3>
          <p className="vibe-card-note">{getTreeNodeKindLabel(node).toLowerCase()} · {status}</p>
        </div>
        {isObservedNode && (
          <button
            type="button"
            className="vibe-secondary-btn"
            onClick={() => onRefreshObservedSession?.(cleanString(observedSession?.id || node?.resources?.observedSession?.sessionId))}
            disabled={observedSessionRefreshing}
          >
            {observedSessionRefreshing ? 'Refreshing…' : 'Refresh Session'}
          </button>
        )}
        {!isObservedNode && isSearchNode && (
          <button
            type="button"
            className="vibe-secondary-btn"
            onClick={() => onLoadSearch?.(node.id)}
            disabled={searchLoading}
          >
            {searchLoading ? 'Loading...' : 'Refresh Search'}
          </button>
        )}
      </header>

      <div className="vibe-node-tab-strip">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={`vibe-plan-chip${tab === item ? ' is-active' : ''}`}
            onClick={() => setTab(item)}
          >
            {item === 'summary' ? 'Summary' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="vibe-node-tab-body">
          <div className="vibe-node-summary-grid">
            <article>
              <h4>Assumptions</h4>
              {(Array.isArray(node.assumption) ? node.assumption : []).length === 0 ? (
                <p className="vibe-empty">No assumptions.</p>
              ) : (
                <ul>
                  {(Array.isArray(node.assumption) ? node.assumption : []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
            <article>
              <h4>Targets</h4>
              {(Array.isArray(node.target) ? node.target : []).length === 0 ? (
                <p className="vibe-empty">No targets.</p>
              ) : (
                <ul>
                  {(Array.isArray(node.target) ? node.target : []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
            {isObservedNode && (
              <article>
                <h4>Observed Session</h4>
                <div className="vibe-list">
                  <div className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>Provider</strong>
                      <span>{cleanString(observedSession?.provider || node?.resources?.observedSession?.provider) || 'unknown'}</span>
                    </div>
                    <code>{status}</code>
                  </div>
                  <div className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>Source</strong>
                      <span>{cleanString(observedSession?.sessionFile || node?.resources?.observedSession?.sessionFile) || 'unknown'}</span>
                    </div>
                    <code>{cleanString(observedSession?.updatedAt || '') || '-'}</code>
                  </div>
                  <div className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>Progress</strong>
                      <span>{cleanString(observedSession?.latestProgressDigest) || 'No cached progress digest yet.'}</span>
                    </div>
                    <code>{cleanString(observedSession?.materialization || '') || '-'}</code>
                  </div>
                </div>
              </article>
            )}
            {!isObservedNode && (
              <article>
                <h4>Run Context</h4>
                {runContextLoading ? (
                  <p className="vibe-empty">Loading context…</p>
                ) : contextSummaryRows.length === 0 ? (
                  <p className="vibe-empty">No routed context loaded for the active run.</p>
                ) : (
                  <div className="vibe-list">
                    {contextSummaryRows.map((row) => (
                      <div key={row.label} className="vibe-list-item">
                        <div className="vibe-list-main">
                          <strong>{row.label}</strong>
                          <span>{row.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )}
            {!isObservedNode && (
              <article>
                <h4>Review / Evidence</h4>
                {reviewSummaryRows.length === 0 ? (
                  <p className="vibe-empty">No review state available yet.</p>
                ) : (
                  <div className="vibe-list">
                    {reviewSummaryRows.map((row) => (
                      <div key={row.label} className="vibe-list-item">
                        <div className="vibe-list-main">
                          <strong>{row.label}</strong>
                          <span>{row.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )}
          </div>

          <article>
            <h4>Checks / Gate</h4>
            {(Array.isArray(node.checks) ? node.checks : []).length === 0 ? (
              <p className="vibe-empty">No checks defined.</p>
            ) : (
              <div className="vibe-list">
                {(Array.isArray(node.checks) ? node.checks : []).map((check, index) => (
                  <div key={`${check?.name || check?.type || 'check'}-${index}`} className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>{check?.name || check?.type || `check_${index + 1}`}</strong>
                      <span>{check?.type || 'custom'}</span>
                    </div>
                    <code>{status === 'PASSED' ? 'pass' : status === 'FAILED' ? 'fail' : 'pending'}</code>
                  </div>
                ))}
              </div>
            )}
          </article>

          {isSearchNode && (
            <article>
              <h4>Search Leaderboard</h4>
              {!searchData || !Array.isArray(searchData.trials) || searchData.trials.length === 0 ? (
                <p className="vibe-empty">No trials yet.</p>
              ) : (
                <div className="vibe-list">
                  {searchData.trials
                    .slice()
                    .sort((a, b) => Number(b.reward || 0) - Number(a.reward || 0))
                    .slice(0, 8)
                    .map((trial) => (
                      <div key={trial.id} className="vibe-list-item">
                        <div className="vibe-list-main">
                          <strong>{trial.id}</strong>
                          <span>{trial.status} · reward {Number(trial.reward || 0).toFixed(3)}</span>
                        </div>
                        <code>{trial.runId || '-'}</code>
                      </div>
                    ))}
                </div>
              )}
            </article>
          )}
        </div>
      )}

      {tab === 'commands' && (
        <div className="vibe-node-tab-body">
          {commands.length === 0 ? (
            <p className="vibe-empty">No commands configured for this node.</p>
          ) : (
            <div className="vibe-list">
              {commands.map((command) => (
                <div key={command.id} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{command.name}</strong>
                    <span>{command.run}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {editable && (
            <div className="vibe-node-command-editor">
              <textarea
                rows={8}
                value={commandsDraft}
                placeholder="Optional: override commands as newline-separated shell commands"
                onChange={(event) => setCommandsDraft(event.target.value)}
              />
              <button
                type="button"
                className="vibe-secondary-btn"
                onClick={() => {
                  const rows = String(commandsDraft || '')
                    .split(/\r?\n/)
                    .map((row) => row.trim())
                    .filter(Boolean)
                    .map((run, index) => ({ id: `cmd_${index + 1}`, name: `command_${index + 1}`, run }));
                  if (!rows.length) return;
                  onSaveCommands?.(node.id, rows);
                }}
              >
                Save Commands
              </button>
            </div>
          )}

          {status === 'RUNNING' && liveLogs.length > 0 && (
            <div className="vibe-live-log">
              <h4 className="vibe-live-log-title">Live Output</h4>
              <pre
                ref={logContainerRef}
                className="vibe-live-log-pre"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
                  autoScrollRef.current = atBottom;
                }}
              >
                {liveLogs.join('')}
              </pre>
            </div>
          )}
          {status === 'RUNNING' && liveLogs.length === 0 && (
            <p className="vibe-empty">Waiting for output…</p>
          )}
        </div>
      )}

      {tab === 'diff' && (
        <div className="vibe-node-tab-body">
          <p className="vibe-card-note">Changed files are tracked at run level. Use run artifacts/report for full diff context.</p>
          {Array.isArray(runReport?.changedFiles) && runReport.changedFiles.length > 0 ? (
            <div className="vibe-list">
              {runReport.changedFiles.slice(0, 16).map((item) => (
                <div key={item.path} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{item.path}</strong>
                    <span>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="vibe-empty">No diff available.</p>
          )}
        </div>
      )}

      {tab === 'outputs' && (
        <div className="vibe-node-tab-body">
          {runReportLoading ? (
            <p className="vibe-empty">Loading outputs...</p>
          ) : artifacts.length === 0 ? (
            <p className="vibe-empty">No outputs yet.</p>
          ) : (
            <div className="vibe-list">
              {artifacts.slice(0, 24).map((artifact) => (
                <div key={artifact.id || artifact.path} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{artifact.title || artifact.path || artifact.id}</strong>
                    <span>{artifact.mimeType || artifact.kind || 'artifact'}</span>
                  </div>
                  {artifact.objectUrl ? (
                    <a className="vibe-secondary-btn" href={artifact.objectUrl} target="_blank" rel="noreferrer">Open</a>
                  ) : (
                    <code>inline</code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'deliverables' && (
        <div className="vibe-node-tab-body">
          {deliverables.length === 0 ? (
            <p className="vibe-empty">No deliverables yet.</p>
          ) : (
            <div className="vibe-list">
              {deliverables.slice(0, 16).map((item, index) => (
                <div key={`${item.id || item.path || 'deliverable'}-${index}`} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{item.title || item.path || item.id || `deliverable_${index + 1}`}</strong>
                    <span>{item.mimeType || item.kind || 'artifact'}</span>
                  </div>
                  {item.objectUrl ? (
                    <a className="vibe-secondary-btn" href={item.objectUrl} target="_blank" rel="noreferrer">Open</a>
                  ) : (
                    <code>pending</code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="vibe-node-tab-body">
          <textarea
            rows={10}
            defaultValue={cleanString(nodeState?.notes) || ''}
            placeholder="Decision rationale, failed assumptions, and next step notes..."
          />
          <p className="vibe-card-note">Notes are currently local draft; persistence can be added through plan patch path `ui.notes`.</p>
        </div>
      )}

      {/* Run Context Q&A + Run button — shown for runnable nodes */}
      {canRun && (
        <div className="vibe-workbench-run-section">
          <ClarificationChat
            messages={clarifyMessages}
            currentQuestion={clarifyQuestion}
            options={clarifyOptions}
            done={clarifyDone}
            busy={clarifyBusy}
            skipped={clarifySkipped}
            onSend={handleClarifySend}
            onSkip={handleClarifySkip}
            onUnskip={handleClarifyUnskip}
            onProceed={handleRun}
            proceedLabel={running ? 'Running…' : 'Run Step'}
          />
          {!clarifyDone && !clarifySkipped && (
            <button
              type="button"
              className="vibe-launch-btn vibe-workbench-run-btn"
              onClick={handleRun}
              disabled={running}
            >
              {running ? 'Running…' : '▶ Run Step'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default VibeNodeWorkbench;
