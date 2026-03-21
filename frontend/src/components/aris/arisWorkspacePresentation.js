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

function titleCase(value, fallback = '') {
  const text = normalizeString(value, fallback);
  if (!text) return '';
  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatUtcDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function isPastDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
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
    if (phase === 'running_on_wsl') return 'Executing on server';
    return 'Running';
  }
  return 'Queued';
}

function statusColor(status) {
  const s = normalizeString(status, 'queued');
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'running') return 'running';
  return 'queued';
}

function isActiveStatus(status) {
  const s = normalizeString(status, 'queued');
  return s === 'running' || s === 'queued';
}

function formatElapsed(startedAt) {
  if (!startedAt) return '';
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return '';
  const diff = Date.now() - start.getTime();
  if (diff < 0) return '';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just started';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) return remainMinutes > 0 ? `${hours}h ${remainMinutes}m elapsed` : `${hours}h elapsed`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h elapsed`;
}

function labelControlTowerKind(kind) {
  const labels = {
    wakeup: 'Wake-up',
    wakeups: 'Wake-ups',
    review: 'Review',
    reviews: 'Reviews',
    work_item: 'Work Item',
    work_items: 'Work Items',
    run: 'Run',
    runs: 'Runs',
    project: 'Project',
    projects: 'Projects',
    metric: 'Metric',
  };
  const key = normalizeString(kind, 'item');
  return labels[key] || titleCase(key, 'Item');
}

function labelControlTowerStatus(status) {
  const key = normalizeString(status, 'active');
  const labels = {
    overdue: 'Overdue',
    review_ready: 'Review ready',
    blocked: 'Blocked',
    active: 'Active',
    ready: 'Ready',
    waiting: 'Waiting',
    complete: 'Complete',
    completed: 'Completed',
  };
  return labels[key] || titleCase(key, 'Active');
}

function labelWorkItemStatus(status) {
  const key = normalizeString(status, 'backlog');
  const labels = {
    backlog: 'Backlog',
    ready: 'Ready',
    in_progress: 'In Progress',
    waiting: 'Waiting',
    review: 'In Review',
    blocked: 'Blocked',
    parked: 'Parked',
    done: 'Done',
    canceled: 'Canceled',
  };
  return labels[key] || titleCase(key, 'Backlog');
}

function labelWorkItemType(type) {
  const key = normalizeString(type, 'task');
  const labels = {
    task: 'Task',
    feature: 'Feature',
    bug: 'Bug',
    experiment: 'Experiment',
    hypothesis: 'Hypothesis',
    analysis: 'Analysis',
    paper: 'Paper',
    ops: 'Ops',
    decision: 'Decision',
    research: 'Research',
    note: 'Note',
    question: 'Question',
  };
  return labels[key] || titleCase(key, 'Task');
}

function labelActorType(actorType) {
  const key = normalizeString(actorType, 'unknown');
  const labels = {
    human: 'Human',
    agent: 'Agent',
    hybrid: 'Hybrid',
    unknown: 'Unknown',
  };
  return labels[key] || titleCase(key, 'Unknown');
}

function labelWakeupStatus(status) {
  const key = normalizeString(status, 'scheduled');
  const labels = {
    scheduled: 'Scheduled',
    fired: 'Fired',
    dismissed: 'Dismissed',
    snoozed: 'Snoozed',
    resolved: 'Resolved',
  };
  return labels[key] || titleCase(key, 'Scheduled');
}

function labelReviewDecision(decision) {
  const key = normalizeString(decision, 'pending');
  const labels = {
    accept: 'Accept',
    revise: 'Revise',
    split: 'Split',
    park: 'Park',
    reject: 'Reject',
    escalate: 'Escalate',
    pending: 'Pending',
  };
  return labels[key] || titleCase(key, 'Pending');
}

function reviewDecisionColor(decision) {
  const key = normalizeString(decision, 'pending');
  const colors = {
    accept: 'accepted',
    revise: 'review',
    split: 'review',
    park: 'parked',
    reject: 'blocked',
    escalate: 'blocked',
    pending: 'queued',
  };
  return colors[key] || 'queued';
}

function workItemStatusColor(status) {
  const key = normalizeString(status, 'backlog');
  const colors = {
    backlog: 'queued',
    ready: 'queued',
    in_progress: 'running',
    waiting: 'queued',
    review: 'review',
    blocked: 'failed',
    parked: 'queued',
    done: 'completed',
    canceled: 'failed',
  };
  return colors[key] || 'queued';
}

function wakeupStatusColor(status, isOverdue) {
  if (isOverdue) return 'failed';
  const key = normalizeString(status, 'scheduled');
  const colors = {
    scheduled: 'queued',
    fired: 'running',
    dismissed: 'queued',
    snoozed: 'queued',
    resolved: 'completed',
  };
  return colors[key] || 'queued';
}

export function buildArisControlTowerCard(card = {}) {
  const kind = normalizeString(card.kind, 'item');
  const status = normalizeString(card.status, 'active');
  const count = Number(card.count || 0) || 0;
  const dueAt = card.dueAt || card.scheduledFor || '';
  const isUrgent = Boolean(card.isUrgent)
    || status === 'overdue'
    || status === 'review_ready'
    || status === 'blocked'
    || (kind === 'wakeup' && isPastDateTime(dueAt))
    || (kind === 'review' && count > 0);

  return {
    id: normalizeString(card.id, 'pending-card'),
    title: normalizeString(card.title, labelControlTowerKind(kind)),
    kind,
    kindLabel: labelControlTowerKind(kind),
    projectLabel: card.projectName ? `Project: ${card.projectName}` : 'All projects',
    statusLabel: labelControlTowerStatus(status),
    countLabel: Number.isFinite(count) ? String(count) : '',
    summaryLabel: normalizeString(card.summary || card.note),
    dueLabel: dueAt ? `Due ${formatUtcDateTime(dueAt)}` : '',
    isUrgent,
  };
}

export function buildArisWorkItemRow(workItem = {}) {
  const status = normalizeString(workItem.status, 'backlog');
  const nextCheckAt = workItem.nextCheckAt || '';
  const blockedReason = normalizeString(workItem.blockedReason);
  const isOverdue = Boolean(nextCheckAt) && isPastDateTime(nextCheckAt) && ['ready', 'in_progress', 'waiting', 'review'].includes(status);

  return {
    id: normalizeString(workItem.id, 'pending-work-item'),
    title: normalizeString(workItem.title, 'Untitled Work Item'),
    summary: normalizeString(workItem.summary),
    status,
    statusLabel: labelWorkItemStatus(status),
    statusColor: workItemStatusColor(status),
    typeLabel: labelWorkItemType(workItem.type),
    actorLabel: labelActorType(workItem.actorType),
    priorityLabel: Number.isFinite(Number(workItem.priority)) ? `P${Number(workItem.priority)}` : '',
    nextCheckLabel: nextCheckAt ? `Next check ${formatUtcDateTime(nextCheckAt)}` : '',
    dueLabel: workItem.dueAt ? `Due ${formatUtcDateTime(workItem.dueAt)}` : '',
    blockedLabel: blockedReason || (status === 'blocked' ? 'Blocked' : ''),
    runCountLabel: Number.isFinite(Number(workItem.runCount)) ? `${Number(workItem.runCount)} runs` : '',
    decisionCountLabel: Number.isFinite(Number(workItem.decisionCount)) ? `${Number(workItem.decisionCount)} decisions` : '',
    isOverdue,
    isUrgent: status === 'blocked' || isOverdue,
  };
}

export function buildArisWakeupRow(wakeup = {}) {
  const status = normalizeString(wakeup.status, 'scheduled');
  const scheduledFor = wakeup.scheduledFor || wakeup.nextCheckAt || '';
  const firedAt = wakeup.firedAt || '';
  const isOverdue = status === 'scheduled' && Boolean(scheduledFor) && isPastDateTime(scheduledFor);

  return {
    id: normalizeString(wakeup.id, 'pending-wakeup'),
    title: normalizeString(wakeup.reason, 'Wake-up'),
    reason: normalizeString(wakeup.reason, 'Wake-up'),
    status,
    statusLabel: isOverdue ? 'Overdue' : labelWakeupStatus(status),
    statusColor: wakeupStatusColor(status, isOverdue),
    scheduledLabel: scheduledFor ? `Scheduled ${formatUtcDateTime(scheduledFor)}` : '',
    firedLabel: firedAt ? `Fired ${formatUtcDateTime(firedAt)}` : '',
    resolvedLabel: wakeup.resolvedAt ? `Resolved ${formatUtcDateTime(wakeup.resolvedAt)}` : '',
    isOverdue,
    isResolved: status === 'resolved' || status === 'dismissed',
    isUrgent: isOverdue,
  };
}

export function buildArisReviewRow(review = {}) {
  const decision = normalizeString(review.decision, 'pending');
  return {
    id: normalizeString(review.id, 'pending-review'),
    title: normalizeString(review.title, 'Review'),
    decision,
    decisionLabel: labelReviewDecision(decision),
    statusColor: reviewDecisionColor(decision),
    reviewerLabel: review.reviewerName ? `Reviewer: ${review.reviewerName}` : 'Reviewer pending',
    notes: normalizeString(review.notes || review.notesMd),
    notesLabel: normalizeString(review.notes || review.notesMd),
    createdAt: normalizeString(review.createdAt),
  };
}

export function buildArisProjectSummaryRow(project = {}) {
  const workItemCount = Number(project.workItemCount || 0) || 0;
  const activeRunCount = Number(project.activeRunCount || 0) || 0;
  const reviewReadyCount = Number(project.reviewReadyCount || 0) || 0;
  const overdueWakeupCount = Number(project.overdueWakeupCount || 0) || 0;
  const blockedCount = Number(project.blockedCount || 0) || 0;
  const parkedCount = Number(project.parkedCount || 0) || 0;

  return {
    id: normalizeString(project.id, 'pending-project'),
    title: normalizeString(project.name, 'Untitled Project'),
    projectLabel: `Project: ${normalizeString(project.name, 'Untitled Project')}`,
    workItemLabel: `${workItemCount} work items`,
    runLabel: `${activeRunCount} active runs`,
    reviewLabel: `${reviewReadyCount} review-ready`,
    attentionLabel: overdueWakeupCount > 0
      ? `${pluralize(overdueWakeupCount, 'overdue wake-up')}`
      : (blockedCount > 0
        ? `${pluralize(blockedCount, 'blocked item')}`
        : `${pluralize(parkedCount, 'parked item')}`),
    statusLabel: overdueWakeupCount > 0 || reviewReadyCount > 0 ? 'Needs attention' : 'On track',
    isUrgent: overdueWakeupCount > 0 || reviewReadyCount > 0,
  };
}

export function buildArisRunCard(run = {}) {
  const workflowType = normalizeString(run.workflowType, 'custom_run');
  const latestScore = run.latestScore;
  const latestVerdict = normalizeString(run.latestVerdict);
  const destinationName = normalizeString(run.downstreamServerName || run.targetName || run.runnerHost);
  const status = normalizeString(run.status, 'queued');

  return {
    id: normalizeString(run.id, 'pending-run'),
    title: normalizeString(run.title, 'ARIS Run'),
    workflowType,
    workflowLabel: labelWorkflow(workflowType),
    statusLabel: labelStatus(run.status, run.activePhase),
    statusColor: statusColor(run.status),
    isActive: isActiveStatus(run.status),
    elapsedLabel: (status === 'running' || status === 'queued') ? formatElapsed(run.startedAt) : '',
    runnerLabel: run.runnerHost ? `Server: ${run.runnerHost}` : 'Target server pending',
    destinationLabel: destinationName ? `Target: ${destinationName}` : 'No saved target',
    scoreLabel: Number.isFinite(latestScore)
      ? `${latestScore.toFixed(1)}/10${latestVerdict ? ` · ${latestVerdict}` : ''}`
      : '',
    startedAt: normalizeString(run.startedAt),
    resultSummary: normalizeString(run.resultSummary),
    source: normalizeString(run.source, 'web'),
    isCliRun: normalizeString(run.source) === 'cli',
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

  const rawFullPath = normalizeString(project.localFullPath);
  const localFullPath = rawFullPath.startsWith('/') ? rawFullPath : (project.localProjectPath?.startsWith('/') ? project.localProjectPath : '');

  return {
    id: normalizeString(project.id, 'pending-project'),
    title: normalizeString(project.name, 'Untitled Project'),
    localPathLabel: project.localProjectPath
      ? `Local workspace: ${project.localProjectPath}`
      : 'Local workspace not linked',
    localFullPath,
    hasWorkspace: Boolean(project.clientWorkspaceId || project.localProjectPath),
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
    statusColor: statusColor(action.status),
    isActive: isActiveStatus(action.status),
    prompt: normalizeString(action.prompt),
    targetLabel: action.downstreamServerName
      ? `Target: ${action.downstreamServerName}`
      : 'Same target as parent run',
    createdAt: normalizeString(action.createdAt),
  };
}

export function buildArisRunDetail(run = {}) {
  const destinationName = normalizeString(run.downstreamServerName || run.targetName || run.runnerHost);
  const status = normalizeString(run.status, 'queued');
  return {
    id: normalizeString(run.id, 'pending-run'),
    title: normalizeString(run.title, 'ARIS Run'),
    workflowType: normalizeString(run.workflowType, 'custom_run'),
    workflowLabel: labelWorkflow(run.workflowType),
    statusLabel: labelStatus(run.status, run.activePhase),
    statusColor: statusColor(run.status),
    isActive: isActiveStatus(run.status),
    elapsedLabel: formatElapsed(run.startedAt),
    prompt: normalizeString(run.prompt),
    runnerLabel: run.runnerHost ? `Server: ${run.runnerHost}` : 'Target server pending',
    destinationLabel: destinationName
      ? `Target: ${destinationName}`
      : 'No saved target',
    workspaceLabel: normalizeString(run.remoteWorkspacePath, 'Workspace pending'),
    datasetLabel: normalizeString(run.datasetRoot, 'Not set'),
    logPath: normalizeString(run.logPath),
    runDirectory: normalizeString(run.runDirectory),
    startedAt: normalizeString(run.startedAt),
    finishedLabel: (status === 'completed' || status === 'failed') ? formatElapsed(run.updatedAt) : '',
    resultSummary: normalizeString(run.resultSummary),
    source: normalizeString(run.source, 'web'),
    isCliRun: normalizeString(run.source) === 'cli',
    actionRows: Array.isArray(run.actions) ? run.actions.map((action) => buildArisRunActionRow(action)) : [],
  };
}

// ─── Daily Tasks & Day Plans ─────────────────────────────────────────────────

export const DAILY_TASK_CATEGORIES = [
  { id: 'reading', label: 'Reading', icon: '📖' },
  { id: 'exercise', label: 'Exercise', icon: '🏃' },
  { id: 'coding', label: 'Coding', icon: '💻' },
  { id: 'research', label: 'Research', icon: '🔬' },
  { id: 'writing', label: 'Writing', icon: '✍️' },
  { id: 'review', label: 'Review', icon: '👁️' },
  { id: 'learning', label: 'Learning', icon: '📚' },
  { id: 'general', label: 'General', icon: '📋' },
];

export const DAILY_TASK_FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'one_time', label: 'One-time' },
];

export function categoryLabel(categoryId) {
  const cat = DAILY_TASK_CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.label : titleCase(categoryId, 'General');
}

export function categoryIcon(categoryId) {
  const cat = DAILY_TASK_CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.icon : '📋';
}

export function frequencyLabel(frequencyId) {
  const freq = DAILY_TASK_FREQUENCIES.find((f) => f.id === frequencyId);
  return freq ? freq.label : titleCase(frequencyId, 'Daily');
}

export function buildDailyTaskRow(task) {
  const totalTarget = task.totalTarget ?? null;
  const weeklyTarget = task.weeklyTarget ?? task.weeklyCredit ?? (totalTarget || 7);
  return {
    id: task.id,
    title: normalizeString(task.title, 'Untitled'),
    description: normalizeString(task.description),
    category: task.category || 'general',
    categoryLabel: categoryLabel(task.category),
    categoryIcon: categoryIcon(task.category),
    frequency: task.frequency || 'daily',
    frequencyLabel: frequencyLabel(task.frequency),
    estimatedMinutes: task.estimatedMinutes ?? 30,
    weeklyCredit: weeklyTarget, // backward compat
    weeklyTarget,
    totalTarget,
    targetPeriod: task.targetPeriod || 'weekly',
    isRoutine: totalTarget == null,
    completedThisWeek: task.completedThisWeek ?? 0,
    remaining: task.remaining ?? 0,
    dailyQuota: task.dailyQuota ?? 0,
    isOnTrack: task.isOnTrack ?? false,
    isActive: task.isActive !== false,
    priority: task.priority ?? 0,
  };
}

export function buildOngoingWorkItemRow(item) {
  const status = normalizeString(item.status, 'ready');
  const workItemLabels = {
    backlog: 'Backlog', ready: 'Ready', in_progress: 'In Progress',
    waiting: 'Waiting', review: 'Review', blocked: 'Blocked',
    parked: 'Parked', done: 'Done', canceled: 'Canceled',
  };
  return {
    id: item.id,
    projectId: item.projectId,
    projectName: normalizeString(item.projectName, 'Unknown Project'),
    title: normalizeString(item.title, 'Untitled'),
    type: item.type || 'task',
    typeLabel: titleCase(item.type, 'Task'),
    status,
    statusLabel: workItemLabels[status] || titleCase(status, 'Ready'),
    statusColor: workItemStatusColor(status),
    priority: item.priority ?? 0,
    actorType: item.actorType || 'human',
    dueAt: item.dueAt || null,
    isOverdue: Boolean(item.dueAt) && isPastDateTime(item.dueAt),
    nextBestAction: normalizeString(item.nextBestAction),
  };
}

export function buildDayPlanItem(item) {
  return {
    id: item.id || '',
    time: item.time || '',
    title: item.title || '',
    description: item.description || '',
    category: item.category || 'general',
    categoryIcon: categoryIcon(item.category),
    estimatedMinutes: item.estimatedMinutes ?? 30,
    sourceType: item.sourceType || 'daily_task', // 'daily_task' | 'work_item' | 'break'
    sourceId: item.sourceId || '',
    isDone: item.isDone || false,
  };
}
