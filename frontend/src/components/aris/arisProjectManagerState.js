const DEFAULT_SYNC_EXCLUDES_TEXT = 'local/\noutputs/\ncheckpoints/';

function normalizeString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function readAny(source = {}, keys = [], fallback = '') {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && String(source[key]).trim() !== '') {
      return source[key];
    }
  }
  return fallback;
}

function trimString(value) {
  return String(value || '').trim();
}

function createEmptyWakeupDraft() {
  return {
    id: '',
    reason: '',
    scheduledFor: '',
    status: 'scheduled',
    firedAt: '',
    resolvedAt: '',
  };
}

export function createEmptyRemoteEndpointDraft() {
  return {
    id: '',
    sshServerId: '',
    remoteProjectPath: '',
    remoteDatasetRoot: '',
    remoteCheckpointRoot: '',
    remoteOutputRoot: '',
  };
}

export function createEmptyProjectSettingsDraft() {
  return {
    id: '',
    name: '',
    clientWorkspaceId: '',
    localProjectPath: '',
    localFullPath: '',
    syncExcludesText: DEFAULT_SYNC_EXCLUDES_TEXT,
    noRemote: true,
    remoteEndpoints: [createEmptyRemoteEndpointDraft()],
  };
}

export function createEmptyWorkItemDraft() {
  return {
    id: '',
    projectId: '',
    milestoneId: '',
    parentWorkItemId: '',
    title: '',
    summary: '',
    type: 'task',
    status: 'backlog',
    priority: 0,
    ownerUserId: '',
    actorType: 'unknown',
    goal: '',
    whyItMatters: '',
    contextMd: '',
    constraintsMd: '',
    deliverableMd: '',
    verificationMd: '',
    blockedBehaviorMd: '',
    outputFormatMd: '',
    nextBestAction: '',
    nextCheckAt: '',
    blockedReason: '',
    dueAt: '',
    archivedAt: '',
    wakeups: [createEmptyWakeupDraft()],
  };
}

export function createEmptyRunLaunchDraft() {
  return {
    id: '',
    projectId: '',
    workItemId: '',
    title: '',
    prompt: '',
    wakeups: [createEmptyWakeupDraft()],
  };
}

export function syncExcludesTextToArray(text) {
  return String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWakeupDraft(wakeup = {}) {
  return {
    id: trimString(readAny(wakeup, ['id'])),
    reason: trimString(readAny(wakeup, ['reason'])),
    scheduledFor: trimString(readAny(wakeup, ['scheduledFor', 'scheduled_for', 'nextCheckAt', 'next_check_at'])),
    status: trimString(readAny(wakeup, ['status'], 'scheduled')) || 'scheduled',
    firedAt: trimString(readAny(wakeup, ['firedAt', 'fired_at'])),
    resolvedAt: trimString(readAny(wakeup, ['resolvedAt', 'resolved_at'])),
  };
}

function wakeupDraftToPayload(wakeup = {}) {
  const normalized = normalizeWakeupDraft(wakeup);
  return {
    id: normalized.id,
    reason: normalized.reason,
    scheduledFor: normalized.scheduledFor,
    status: normalized.status,
    firedAt: normalized.firedAt,
    resolvedAt: normalized.resolvedAt,
  };
}

function filterWakeups(wakeups = []) {
  return (Array.isArray(wakeups) ? wakeups : [])
    .map((wakeup) => normalizeWakeupDraft(wakeup))
    .filter((wakeup) => wakeup.reason || wakeup.scheduledFor || wakeup.firedAt || wakeup.resolvedAt);
}

function targetToDraft(target = {}) {
  return {
    id: target.id || '',
    sshServerId: target.sshServerId ? String(target.sshServerId) : '',
    remoteProjectPath: target.remoteProjectPath || '',
    remoteDatasetRoot: target.remoteDatasetRoot || '',
    remoteCheckpointRoot: target.remoteCheckpointRoot || '',
    remoteOutputRoot: target.remoteOutputRoot || '',
  };
}

export function projectToSettingsDraft(project = null, targets = []) {
  if (!project) return createEmptyProjectSettingsDraft();

  const nextTargets = Array.isArray(targets) && targets.length > 0
    ? targets.map((target) => targetToDraft(target))
    : [createEmptyRemoteEndpointDraft()];
  const hasTargets = Array.isArray(targets) && targets.length > 0;

  return {
    id: project.id || '',
    name: project.name || '',
    clientWorkspaceId: project.clientWorkspaceId || '',
    localProjectPath: project.localProjectPath || '',
    localFullPath: project.localFullPath || '',
    syncExcludesText: Array.isArray(project.syncExcludes) && project.syncExcludes.length > 0
      ? project.syncExcludes.join('\n')
      : DEFAULT_SYNC_EXCLUDES_TEXT,
    noRemote: hasTargets ? project.noRemote === true : true,
    remoteEndpoints: nextTargets,
  };
}

export function settingsDraftToPayload(draft = {}) {
  const noRemote = draft.noRemote === true;
  const remoteEndpoints = noRemote
    ? []
    : (Array.isArray(draft.remoteEndpoints) ? draft.remoteEndpoints : []).map((endpoint) => ({
      id: endpoint.id || '',
      sshServerId: endpoint.sshServerId ? Number(endpoint.sshServerId) : null,
      remoteProjectPath: String(endpoint.remoteProjectPath || '').trim(),
      remoteDatasetRoot: String(endpoint.remoteDatasetRoot || '').trim(),
      remoteCheckpointRoot: String(endpoint.remoteCheckpointRoot || '').trim(),
      remoteOutputRoot: String(endpoint.remoteOutputRoot || '').trim(),
    }));

  // Only save localFullPath if it's an absolute path — relative names are useless
  const rawFullPath = String(draft.localFullPath || '').trim();
  const localFullPath = rawFullPath.startsWith('/') ? rawFullPath : '';

  return {
    name: String(draft.name || '').trim(),
    clientWorkspaceId: String(draft.clientWorkspaceId || '').trim(),
    localProjectPath: String(draft.localProjectPath || '').trim(),
    localFullPath,
    syncExcludes: syncExcludesTextToArray(draft.syncExcludesText),
    noRemote,
    remoteEndpoints,
  };
}

export function workItemToDraft(workItem = {}) {
  const wakeups = filterWakeups(readAny(workItem, ['wakeups', 'wakeUps'], []));
  return {
    id: trimString(readAny(workItem, ['id'])),
    projectId: trimString(readAny(workItem, ['projectId', 'project_id'])),
    milestoneId: trimString(readAny(workItem, ['milestoneId', 'milestone_id'])),
    parentWorkItemId: trimString(readAny(workItem, ['parentWorkItemId', 'parent_work_item_id'])),
    title: trimString(readAny(workItem, ['title'])),
    summary: trimString(readAny(workItem, ['summary'])),
    type: trimString(readAny(workItem, ['type'], 'feature')) || 'feature',
    status: trimString(readAny(workItem, ['status'], 'backlog')) || 'backlog',
    priority: Number(readAny(workItem, ['priority'], 0)) || 0,
    ownerUserId: trimString(readAny(workItem, ['ownerUserId', 'owner_user_id'])),
    actorType: trimString(readAny(workItem, ['actorType', 'actor_type'], 'unknown')) || 'unknown',
    goal: trimString(readAny(workItem, ['goal'])),
    whyItMatters: trimString(readAny(workItem, ['whyItMatters', 'why_it_matters'])),
    contextMd: trimString(readAny(workItem, ['contextMd', 'context_md'])),
    constraintsMd: trimString(readAny(workItem, ['constraintsMd', 'constraints_md'])),
    deliverableMd: trimString(readAny(workItem, ['deliverableMd', 'deliverable_md'])),
    verificationMd: trimString(readAny(workItem, ['verificationMd', 'verification_md'])),
    blockedBehaviorMd: trimString(readAny(workItem, ['blockedBehaviorMd', 'blocked_behavior_md'])),
    outputFormatMd: trimString(readAny(workItem, ['outputFormatMd', 'output_format_md'])),
    nextBestAction: trimString(readAny(workItem, ['nextBestAction', 'next_best_action'])),
    nextCheckAt: trimString(readAny(workItem, ['nextCheckAt', 'next_check_at'])),
    blockedReason: trimString(readAny(workItem, ['blockedReason', 'blocked_reason'])),
    dueAt: trimString(readAny(workItem, ['dueAt', 'due_at'])),
    archivedAt: trimString(readAny(workItem, ['archivedAt', 'archived_at'])),
    wakeups: wakeups.length > 0 ? wakeups : [createEmptyWakeupDraft()],
  };
}

export function workItemDraftToPayload(draft = {}) {
  const wakeups = filterWakeups(readAny(draft, ['wakeups', 'wakeUps'], []));
  return {
    id: trimString(readAny(draft, ['id'])),
    projectId: trimString(readAny(draft, ['projectId', 'project_id'])),
    milestoneId: trimString(readAny(draft, ['milestoneId', 'milestone_id'])),
    parentWorkItemId: trimString(readAny(draft, ['parentWorkItemId', 'parent_work_item_id'])),
    title: trimString(readAny(draft, ['title'])),
    summary: trimString(readAny(draft, ['summary'])),
    type: trimString(readAny(draft, ['type'], 'feature')) || 'feature',
    status: trimString(readAny(draft, ['status'], 'backlog')) || 'backlog',
    priority: Number(readAny(draft, ['priority'], 0)) || 0,
    ownerUserId: trimString(readAny(draft, ['ownerUserId', 'owner_user_id'])),
    actorType: trimString(readAny(draft, ['actorType', 'actor_type'], 'unknown')) || 'unknown',
    goal: trimString(readAny(draft, ['goal'])),
    whyItMatters: trimString(readAny(draft, ['whyItMatters', 'why_it_matters'])),
    contextMd: trimString(readAny(draft, ['contextMd', 'context_md'])),
    constraintsMd: trimString(readAny(draft, ['constraintsMd', 'constraints_md'])),
    deliverableMd: trimString(readAny(draft, ['deliverableMd', 'deliverable_md'])),
    verificationMd: trimString(readAny(draft, ['verificationMd', 'verification_md'])),
    blockedBehaviorMd: trimString(readAny(draft, ['blockedBehaviorMd', 'blocked_behavior_md'])),
    outputFormatMd: trimString(readAny(draft, ['outputFormatMd', 'output_format_md'])),
    nextBestAction: trimString(readAny(draft, ['nextBestAction', 'next_best_action'])),
    nextCheckAt: trimString(readAny(draft, ['nextCheckAt', 'next_check_at'])),
    blockedReason: trimString(readAny(draft, ['blockedReason', 'blocked_reason'])),
    dueAt: trimString(readAny(draft, ['dueAt', 'due_at'])),
    archivedAt: trimString(readAny(draft, ['archivedAt', 'archived_at'])),
    wakeups: wakeups.map((wakeup) => wakeupDraftToPayload(wakeup)),
  };
}

export function validateWorkItemDraft(draft = {}) {
  if (!trimString(readAny(draft, ['title']))) {
    return 'Work item title is required.';
  }
  return '';
}

export function validateRunLaunchDraft(draft = {}) {
  const wakeups = filterWakeups(readAny(draft, ['wakeups', 'wakeUps'], []));
  if (wakeups.length === 0) {
    return 'Add at least one wake-up before launching a run.';
  }
  if (!trimString(readAny(draft, ['projectId', 'project_id']))) {
    return 'Project is required before launching a run.';
  }
  if (!trimString(readAny(draft, ['workItemId', 'work_item_id']))) {
    return 'Work item is required before launching a run.';
  }
  return '';
}

export function runLaunchDraftToPayload(draft = {}) {
  const wakeups = filterWakeups(readAny(draft, ['wakeups', 'wakeUps'], []));
  return {
    id: trimString(readAny(draft, ['id'])),
    projectId: trimString(readAny(draft, ['projectId', 'project_id'])),
    workItemId: trimString(readAny(draft, ['workItemId', 'work_item_id'])),
    title: trimString(readAny(draft, ['title'])),
    prompt: trimString(readAny(draft, ['prompt'])),
    wakeups: wakeups.map((wakeup) => wakeupDraftToPayload(wakeup)),
  };
}

export function validateProjectSettingsDraft(draft = {}) {
  if (!String(draft.name || '').trim()) {
    return 'Project name is required.';
  }
  // Local workspace is optional — remote-only projects don't need it
  if (draft.noRemote === true) {
    return '';
  }

  const endpoints = Array.isArray(draft.remoteEndpoints) ? draft.remoteEndpoints : [];
  if (endpoints.length === 0) {
    return 'Add at least one remote endpoint or enable No Remote.';
  }

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index] || {};
    if (!String(endpoint.sshServerId || '').trim()) {
      return `Select an SSH server for remote endpoint ${index + 1}.`;
    }
    if (!String(endpoint.remoteProjectPath || '').trim()) {
      return `Enter a remote project path for remote endpoint ${index + 1}.`;
    }
  }

  return '';
}

// ─── Daily Task Drafts ───────────────────────────────────────────────────────

export function createEmptyDailyTaskDraft() {
  return {
    title: '',
    description: '',
    category: 'general',
    frequency: 'daily',
    weekday: null,
    estimatedMinutes: 30,
    totalTarget: '', // empty = routine task (no target)
    targetPeriod: 'weekly',
    priority: 0,
  };
}

export function dailyTaskToDraft(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    category: task.category || 'general',
    frequency: task.frequency || 'daily',
    weekday: task.weekday ?? null,
    estimatedMinutes: task.estimatedMinutes ?? 30,
    totalTarget: task.totalTarget != null ? String(task.totalTarget) : '',
    targetPeriod: task.targetPeriod || 'weekly',
    priority: task.priority ?? 0,
  };
}

export function dailyTaskDraftToPayload(draft) {
  const totalTarget = draft.totalTarget !== '' ? (parseInt(draft.totalTarget, 10) || null) : null;
  return {
    title: draft.title?.trim() || '',
    description: draft.description?.trim() || '',
    category: draft.category || 'general',
    frequency: draft.frequency || 'daily',
    weekday: draft.frequency === 'weekly' ? (draft.weekday ?? null) : null,
    estimatedMinutes: parseInt(draft.estimatedMinutes, 10) || 30,
    totalTarget,
    targetPeriod: draft.targetPeriod || 'weekly',
    priority: parseInt(draft.priority, 10) || 0,
  };
}

export function validateDailyTaskDraft(draft) {
  if (!draft.title?.trim()) return 'Title is required';
  return '';
}
