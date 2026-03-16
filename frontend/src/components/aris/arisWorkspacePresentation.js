export const ARIS_QUICK_ACTIONS = [
  {
    id: 'init_repo',
    label: 'Init Repo',
    workflowType: 'init_repo',
    prefillPrompt: 'Initialize a new AIRS research repository for:',
  },
  {
    id: 'custom_run',
    label: 'Custom Run',
    workflowType: 'custom_run',
    prefillPrompt: 'Run this custom ARIS workflow on the selected project target:',
  },
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
  {
    id: 'sync_workspace',
    label: 'Sync Workspace',
    workflowType: 'sync_workspace',
    prefillPrompt: 'Sync local and remote project files (code, resources, papers) for:',
  },
];

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function labelWorkflow(workflowType) {
  const key = normalizeString(workflowType, 'custom_run');
  const match = ARIS_QUICK_ACTIONS.find((action) => action.workflowType === key || action.id === key);
  return match?.label || 'Custom Run';
}

function labelStatus(status, activePhase = '') {
  const normalizedStatus = normalizeString(status, 'queued');
  const phase = normalizeString(activePhase);
  if (normalizedStatus === 'completed') return 'Completed';
  if (normalizedStatus === 'failed') return 'Failed';
  if (normalizedStatus === 'running') {
    if (phase === 'dispatch_experiment') return 'Dispatching experiment';
    if (phase === 'wait_results') return 'Waiting for results';
    if (phase === 'review') return 'Reviewing';
    return 'Running on target';
  }
  return 'Queued';
}

export function buildArisRunCard(run = {}) {
  const workflowType = normalizeString(run.workflowType, 'custom');
  const latestScore = run.latestScore;
  const latestVerdict = normalizeString(run.latestVerdict);
  const destinationName = normalizeString(run.downstreamServerName || run.targetName || run.runnerHost);

  return {
    id: normalizeString(run.id, 'pending-run'),
    title: normalizeString(run.title, 'ARIS Run'),
    workflowType,
    workflowLabel: labelWorkflow(workflowType),
    statusLabel: labelStatus(run.status, run.activePhase),
    runnerLabel: run.runnerHost ? `Server: ${run.runnerHost}` : 'Target server pending',
    destinationLabel: destinationName
      ? `Target: ${destinationName}`
      : 'No saved target',
    scoreLabel: Number.isFinite(latestScore)
      ? `${latestScore.toFixed(1)}/10${latestVerdict ? ` · ${latestVerdict}` : ''}`
      : 'No review yet',
    summary: normalizeString(run.summary, ''),
    startedAt: normalizeString(run.startedAt),
  };
}

export function buildArisWorkspaceContext(payload = {}) {
  const project = payload.project || {};
  const target = payload.target || {};

  return {
    projectLabel: normalizeString(project.name, 'No project selected'),
    localPathLabel: project.localProjectPath
      ? `Client workspace: ${project.localProjectPath}`
      : 'Client workspace not linked',
    targetLabel: target.sshServerName
      ? `Target: ${target.sshServerName}`
      : 'No target selected',
    workspaceLabel: normalizeString(target.remoteProjectPath, 'Remote path pending'),
    datasetLabel: target.remoteDatasetRoot
      ? `Dataset: ${target.remoteDatasetRoot}`
      : 'Dataset root not set',
    checkpointLabel: target.remoteCheckpointRoot
      ? `Checkpoints: ${target.remoteCheckpointRoot}`
      : 'Checkpoint root not set',
    outputLabel: target.remoteOutputRoot
      ? `Outputs: ${target.remoteOutputRoot}`
      : 'Output root not set',
    syncLabel: Array.isArray(project.syncExcludes) && project.syncExcludes.length > 0
      ? `Sync excludes: ${project.syncExcludes.join(', ')}`
      : 'Sync excludes not set',
  };
}

export function buildArisProjectRow(project = {}) {
  const syncExcludes = Array.isArray(project.syncExcludes) ? project.syncExcludes.filter(Boolean) : [];
  const targetCount = Number(project.targetCount || 0) || 0;
  const noRemote = project.noRemote === true || targetCount === 0;

  return {
    id: normalizeString(project.id, 'pending-project'),
    title: normalizeString(project.name, 'Untitled Project'),
    localPathLabel: project.localProjectPath
      ? `Local workspace: ${project.localProjectPath}`
      : 'Local workspace not linked',
    localFullPath: normalizeString(project.localFullPath) || (project.localProjectPath?.startsWith('/') ? project.localProjectPath : ''),
    targetCountLabel: `${pluralize(targetCount, 'saved target')}`,
    remoteModeLabel: noRemote ? 'No remote servers' : 'Remote servers configured',
    excludeSummary: syncExcludes.length > 0
      ? `Excludes: ${syncExcludes.join(', ')}`
      : 'Excludes: none',
  };
}

export function buildArisTargetRow(target = {}) {
  return {
    id: normalizeString(target.id, 'pending-target'),
    title: normalizeString(target.sshServerName, 'Unassigned server'),
    remotePathLabel: normalizeString(target.remoteProjectPath, 'Remote path pending'),
    datasetLabel: target.remoteDatasetRoot
      ? `Dataset: ${target.remoteDatasetRoot}`
      : 'Dataset: not set',
    checkpointLabel: target.remoteCheckpointRoot
      ? `Checkpoints: ${target.remoteCheckpointRoot}`
      : 'Checkpoints: not set',
    outputLabel: target.remoteOutputRoot
      ? `Outputs: ${target.remoteOutputRoot}`
      : 'Outputs: not set',
    sharedFsLabel: target.sharedFsGroup
      ? `Shared FS: ${target.sharedFsGroup}`
      : 'Shared FS: none',
  };
}

export function buildArisRunActionRow(action = {}) {
  const actionType = normalizeString(action.actionType, 'continue');
  const labels = {
    continue: 'Continue Run',
    run_experiment: 'Run Experiment',
    monitor: 'Monitor Run',
    review: 'Review Outputs',
    retry: 'Retry Run',
  };

  return {
    id: normalizeString(action.id, 'pending-action'),
    actionType,
    actionLabel: labels[actionType] || 'Follow-up Action',
    statusLabel: normalizeString(action.status) === 'running' && !normalizeString(action.activePhase)
      ? 'Running'
      : labelStatus(action.status, action.activePhase),
    prompt: normalizeString(action.prompt),
    targetLabel: action.downstreamServerName
      ? `Target: ${action.downstreamServerName}`
      : 'Same target as parent run',
    createdAt: normalizeString(action.createdAt),
  };
}

export function buildArisRunDetail(run = {}) {
  const destinationName = normalizeString(run.downstreamServerName || run.targetName || run.runnerHost);
  return {
    id: normalizeString(run.id, 'pending-run'),
    title: normalizeString(run.title, 'ARIS Run'),
    workflowType: normalizeString(run.workflowType, 'custom_run'),
    workflowLabel: labelWorkflow(run.workflowType),
    statusLabel: labelStatus(run.status, run.activePhase),
    prompt: normalizeString(run.prompt),
    runnerLabel: run.runnerHost ? `Server: ${run.runnerHost}` : 'Target server pending',
    destinationLabel: destinationName
      ? `Target: ${destinationName}`
      : 'No saved target',
    workspaceLabel: normalizeString(run.remoteWorkspacePath, 'Workspace pending'),
    datasetLabel: normalizeString(run.datasetRoot, 'Not set'),
    logPath: normalizeString(run.logPath),
    runDirectory: normalizeString(run.runDirectory),
    actionRows: Array.isArray(run.actions) ? run.actions.map((action) => buildArisRunActionRow(action)) : [],
  };
}
