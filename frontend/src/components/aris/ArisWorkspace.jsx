'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ARIS_QUICK_ACTIONS,
  buildArisRunCard,
  buildArisWorkspaceContext,
} from './arisWorkspacePresentation.js';

function prefillPromptForAction(action) {
  return `${action.prefillPrompt} `;
}

export default function ArisWorkspace({ apiUrl, getAuthHeaders }) {
  const [contextData, setContextData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState('literature_review');
  const [prompt, setPrompt] = useState(prefillPromptForAction(ARIS_QUICK_ACTIONS[0]));

  const fetchContext = async () => {
    const response = await axios.get(`${apiUrl}/aris/context`, {
      headers: getAuthHeaders(),
    });
    const payload = response.data || {};
    setContextData(payload);
    const firstProjectId = payload.projects?.[0]?.id || '';
    setSelectedProjectId((prev) => prev || firstProjectId);
  };

  const fetchRuns = async () => {
    const response = await axios.get(`${apiUrl}/aris/runs`, {
      headers: getAuthHeaders(),
    });
    setRuns(response.data?.runs || []);
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setLoadingRuns(true);
      setError('');
      try {
        const [contextResponse, runsResponse] = await Promise.all([
          axios.get(`${apiUrl}/aris/context`, { headers: getAuthHeaders() }),
          axios.get(`${apiUrl}/aris/runs`, { headers: getAuthHeaders() }),
        ]);
        if (!active) return;
        const payload = contextResponse.data || {};
        setContextData(payload);
        setSelectedProjectId(payload.projects?.[0]?.id || '');
        setRuns(runsResponse.data?.runs || []);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load ARIS workspace');
      } finally {
        if (!active) return;
        setLoading(false);
        setLoadingRuns(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [apiUrl, getAuthHeaders]);

  const workspaceContext = useMemo(() => buildArisWorkspaceContext({
    project: contextData?.projects?.find((item) => item.id === selectedProjectId) || contextData?.projects?.[0] || {},
    runner: contextData?.runner || {},
    remoteWorkspacePath: contextData?.remoteWorkspacePath,
    datasetRoot: contextData?.datasetRoot,
    downstreamServer: contextData?.downstreamServer || null,
  }), [contextData, selectedProjectId]);

  const runCards = useMemo(() => runs.map((run) => buildArisRunCard(run)), [runs]);

  const handleQuickAction = (action) => {
    setSelectedWorkflow(action.workflowType);
    setPrompt(prefillPromptForAction(action));
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!selectedProjectId) {
      setError('Select a project before launching ARIS.');
      return;
    }
    if (!trimmedPrompt) {
      setError('Enter what you want ARIS to do.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await axios.post(
        `${apiUrl}/aris/runs`,
        {
          projectId: selectedProjectId,
          workflowType: selectedWorkflow,
          prompt: trimmedPrompt,
          remoteWorkspacePath: contextData?.remoteWorkspacePath || '',
          datasetRoot: contextData?.datasetRoot || '',
          downstreamServerId: contextData?.downstreamServer?.id || null,
        },
        { headers: getAuthHeaders() }
      );
      const createdRun = response.data?.run;
      if (createdRun) {
        setRuns((prev) => [createdRun, ...prev.filter((run) => run.id !== createdRun.id)]);
      } else {
        await fetchRuns();
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to launch ARIS run');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setError('');
    setLoadingRuns(true);
    try {
      await Promise.all([fetchContext(), fetchRuns()]);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to refresh ARIS workspace');
    } finally {
      setLoadingRuns(false);
    }
  };

  const quickActions = contextData?.quickActions?.length ? contextData.quickActions : ARIS_QUICK_ACTIONS;

  if (loading) {
    return (
      <section className="aris-workspace aris-workspace--loading">
        <div className="aris-empty-card">Loading ARIS workspace…</div>
      </section>
    );
  }

  return (
    <section className="aris-workspace">
      <div className="aris-hero">
        <div className="aris-hero-copy">
          <span className="aris-kicker">WSL-First ARIS</span>
          <h2>Autonomous research loops with persistent remote workspaces</h2>
          <p>
            Launch ARIS on the always-on WSL runner. The run continues even if you close this browser,
            while downstream experiments can dispatch to managed SSH servers.
          </p>
        </div>
        <button className="aris-refresh-btn" onClick={handleRefresh} disabled={loadingRuns}>
          {loadingRuns ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      <div className="aris-grid">
        <section className="aris-launch-panel">
          <div className="aris-panel-header">
            <h3>Launch</h3>
            <span className="aris-status-pill">{workspaceContext.runnerStatus}</span>
          </div>

          <div className="aris-launch-fields">
            <label className="aris-field">
              <span>Project</span>
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                {(contextData?.projects || []).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>

            <label className="aris-field">
              <span>Workflow</span>
              <select value={selectedWorkflow} onChange={(e) => setSelectedWorkflow(e.target.value)}>
                {quickActions.map((action) => (
                  <option key={action.id} value={action.workflowType}>{action.label}</option>
                ))}
              </select>
            </label>

            <label className="aris-field aris-field--prompt">
              <span>Prompt</span>
              <textarea
                rows={6}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe exactly what you want ARIS to do. Presets only prefill this box."
              />
            </label>
          </div>

          <div className="aris-quick-actions">
            {quickActions.map((action) => (
              <button
                key={action.id}
                className={`aris-action-chip${selectedWorkflow === action.workflowType ? ' is-active' : ''}`}
                onClick={() => handleQuickAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="aris-launch-footer">
            <div className="aris-launch-note">
              Input stays fully editable. Quick actions only seed the workflow and prompt.
            </div>
            <button className="aris-run-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Launching…' : 'Run On WSL'}
            </button>
          </div>
        </section>

        <section className="aris-context-panel">
          <div className="aris-panel-header">
            <h3>Run Context</h3>
          </div>
          <dl className="aris-context-list">
            <div>
              <dt>Project</dt>
              <dd>{workspaceContext.projectLabel}</dd>
            </div>
            <div>
              <dt>Runner</dt>
              <dd>{workspaceContext.runnerLabel}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{workspaceContext.workspaceLabel}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{workspaceContext.datasetLabel}</dd>
            </div>
            <div>
              <dt>Experiment Target</dt>
              <dd>{workspaceContext.destinationLabel}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="aris-runs-panel">
        <div className="aris-panel-header">
          <h3>Recent Runs</h3>
        </div>

        {runCards.length === 0 ? (
          <div className="aris-empty-card">
            No ARIS runs yet. Launch a literature review, idea discovery, or full pipeline above.
          </div>
        ) : (
          <div className="aris-run-list">
            {runCards.map((run) => (
              <article key={run.id} className="aris-run-card">
                <div className="aris-run-card-header">
                  <div>
                    <h4>{run.title}</h4>
                    <p>{run.statusLabel}</p>
                  </div>
                  <span className="aris-run-score">{run.scoreLabel}</span>
                </div>
                <div className="aris-run-meta">
                  <span>{run.runnerLabel}</span>
                  <span>{run.destinationLabel}</span>
                  {run.startedAt && <span>{new Date(run.startedAt).toLocaleString()}</span>}
                </div>
                {run.summary && <p className="aris-run-summary">{run.summary}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
