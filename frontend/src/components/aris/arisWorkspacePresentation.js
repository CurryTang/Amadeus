export const ARIS_QUICK_ACTIONS = [
  {
    id: 'literature_review',
    label: 'Literature Review',
    workflowType: 'literature_review',
    prefillPrompt: 'Survey the literature and related work for:',
  },
  {
    id: 'idea_discovery',
    label: 'Idea Discovery',
    workflowType: 'idea_discovery',
    prefillPrompt: 'Discover promising research ideas around:',
  },
  {
    id: 'run_experiment',
    label: 'Run Experiment',
    workflowType: 'run_experiment',
    prefillPrompt: 'Run the following experiment on the persistent remote workspace:',
  },
  {
    id: 'auto_review_loop',
    label: 'Auto Review Loop',
    workflowType: 'auto_review_loop',
    prefillPrompt: 'Start an autonomous review loop for this research direction:',
  },
  {
    id: 'paper_writing',
    label: 'Paper Writing',
    workflowType: 'paper_writing',
    prefillPrompt: 'Turn the current narrative into a paper draft for:',
  },
  {
    id: 'paper_improvement',
    label: 'Paper Improvement',
    workflowType: 'paper_improvement',
    prefillPrompt: 'Improve the current paper draft in the remote ARIS workspace:',
  },
  {
    id: 'full_pipeline',
    label: 'Full Pipeline',
    workflowType: 'full_pipeline',
    prefillPrompt: 'Run the full ARIS research pipeline for:',
  },
  {
    id: 'monitor_experiment',
    label: 'Monitor Experiment',
    workflowType: 'monitor_experiment',
    prefillPrompt: 'Monitor the current experiment and summarize progress for:',
  },
];

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

export function buildArisRunCard(run = {}) {
  const workflowType = normalizeString(run.workflowType, 'custom');
  const status = normalizeString(run.status, 'queued');
  const activePhase = normalizeString(run.activePhase);
  const latestScore = run.latestScore;
  const latestVerdict = normalizeString(run.latestVerdict);

  let statusLabel = 'Queued';
  if (status === 'completed') statusLabel = 'Completed';
  else if (status === 'failed') statusLabel = 'Failed';
  else if (status === 'running') {
    if (activePhase === 'dispatch_experiment') statusLabel = 'Dispatching experiment';
    else if (activePhase === 'wait_results') statusLabel = 'Waiting for results';
    else if (activePhase === 'review') statusLabel = 'Reviewing';
    else statusLabel = 'Running on WSL';
  }

  return {
    id: normalizeString(run.id, 'pending-run'),
    title: normalizeString(run.title, 'ARIS Run'),
    workflowType,
    statusLabel,
    runnerLabel: run.runnerHost ? `WSL: ${run.runnerHost}` : 'WSL runner pending',
    destinationLabel: run.downstreamServerName
      ? `Compute: ${run.downstreamServerName}`
      : 'No downstream server',
    scoreLabel: Number.isFinite(latestScore)
      ? `${latestScore.toFixed(1)}/10${latestVerdict ? ` · ${latestVerdict}` : ''}`
      : 'No review yet',
    summary: normalizeString(run.summary, ''),
    startedAt: normalizeString(run.startedAt),
  };
}

export function buildArisWorkspaceContext(payload = {}) {
  const project = payload.project || {};
  const runner = payload.runner || {};
  const downstreamServer = payload.downstreamServer || null;
  const remoteWorkspacePath = normalizeString(payload.remoteWorkspacePath, 'Workspace pending');
  const datasetRoot = normalizeString(payload.datasetRoot);

  return {
    projectLabel: normalizeString(project.name, 'Default Project'),
    runnerLabel: runner.name ? `WSL runner: ${runner.name}` : 'WSL runner pending',
    runnerStatus: normalizeString(runner.status, 'unknown'),
    workspaceLabel: remoteWorkspacePath,
    datasetLabel: datasetRoot ? `Remote dataset: ${datasetRoot}` : 'Remote dataset not set',
    destinationLabel: downstreamServer?.name
      ? `Experiment target: ${downstreamServer.name}`
      : 'Experiment target: not selected',
  };
}
