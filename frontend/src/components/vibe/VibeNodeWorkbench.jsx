import { useEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../ui/EmptyState';

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
  mode,
  runReport,
  runReportLoading,
  onSaveCommands,
  onLoadSearch,
  searchData,
  searchLoading,
}) {
  const [tab, setTab] = useState('summary');
  const [commandsDraft, setCommandsDraft] = useState('');
  const [liveLogs, setLiveLogs] = useState([]);
  const logContainerRef = useRef(null);
  const autoScrollRef = useRef(true);

  const status = cleanString(nodeState?.status).toUpperCase() || 'PLANNED';
  const editable = ['PLANNED', 'BLOCKED'].includes(status) && mode !== 'view';

  const activeRunId = cleanString(nodeState?.lastRunId);

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
          setLiveLogs((prev) => [...prev.slice(-500), data.message]);
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(data.payload?.status)) {
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
          <p className="vibe-card-note">{node.kind || 'experiment'} · {status}</p>
        </div>
        {node.kind === 'search' && (
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

          {node.kind === 'search' && (
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
    </section>
  );
}

export default VibeNodeWorkbench;
