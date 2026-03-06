'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const agentSessionWatcher = require('../agent-session-watcher.service');
const { normalizePlan } = require('./plan-patch.service');
const treePlanService = require('./tree-plan.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePath(value = '') {
  const normalized = cleanString(value).replace(/\/+$/, '');
  return normalized || '';
}

function buildObservedSessionId({ provider = '', sessionFile = '' } = {}) {
  const hash = crypto
    .createHash('sha1')
    .update(`${cleanString(provider).toLowerCase()}:${normalizePath(sessionFile)}`)
    .digest('hex');
  return `obs_${hash}`;
}

function normalizeObservedSession(input = {}) {
  const provider = cleanString(input.provider || input.agentType).toLowerCase() || 'unknown';
  const sessionFile = cleanString(input.sessionFile);
  const sessionId = cleanString(input.sessionId || input.id);
  const promptDigest = cleanString(input.prompt || input.promptDigest || input.title);

  return {
    id: buildObservedSessionId({ provider, sessionFile }),
    sessionId,
    provider,
    agentType: cleanString(input.agentType || provider) || provider,
    gitRoot: normalizePath(input.gitRoot || input.cwd),
    cwd: normalizePath(input.cwd),
    sessionFile,
    title: cleanString(input.title) || promptDigest || sessionId || 'Observed session',
    promptDigest,
    latestProgressDigest: cleanString(input.latestProgressDigest || ''),
    status: cleanString(input.status).toUpperCase() || 'UNKNOWN',
    startedAt: cleanString(input.startedAt),
    updatedAt: cleanString(input.updatedAt),
    contentHash: cleanString(input.contentHash || ''),
  };
}

function getObservedSessionCachePaths(projectPath = '', observedSessionId = '') {
  const rootPath = normalizePath(projectPath);
  const dirPath = path.join(rootPath, '.researchops', 'cache', 'observed-sessions');
  const fileName = `${cleanString(observedSessionId) || 'unknown'}.json`;
  return {
    dirPath,
    recordPath: path.join(dirPath, fileName),
  };
}

function sha1(content = '') {
  return crypto.createHash('sha1').update(String(content || ''), 'utf8').digest('hex');
}

function parseJsonObject(text = '') {
  const raw = cleanString(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { return JSON.parse(objectMatch[0]); } catch (_) {}
    }
  }
  return null;
}

function extractContentText(entry = {}) {
  const type = cleanString(entry?.type).toLowerCase();
  if (type === 'event_msg') {
    const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
    return cleanString(payload.message || '');
  }

  if (type === 'turn_context') {
    const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
    return cleanString(payload.summary || '');
  }

  const message = entry?.message && typeof entry.message === 'object' ? entry.message : {};
  if (typeof message.content === 'string') return cleanString(message.content);
  if (Array.isArray(message.content)) {
    const textItem = message.content.find((item) => cleanString(item?.type).toLowerCase() === 'text' && cleanString(item?.text));
    return cleanString(textItem?.text);
  }
  return '';
}

async function defaultSummarizeSessionFile({ content = '' } = {}) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let latestProgressDigest = '';
  let toolCallCount = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      const text = extractContentText(parsed);
      if (!latestProgressDigest && text) latestProgressDigest = text.slice(0, 280);
      const serialized = JSON.stringify(parsed);
      if (serialized.includes('"tool_use"')) toolCallCount += 1;
    } catch (_) {
      if (!latestProgressDigest) latestProgressDigest = lines[index].slice(0, 280);
    }
  }

  return {
    latestProgressDigest,
    messageCount: lines.length,
    toolCallCount,
    touchedFiles: [],
  };
}

function normalizeObservedSessionClassification(input = {}) {
  const decision = cleanString(input.decision).toLowerCase();
  const normalizedDecision = ['ignore', 'candidate', 'can_be_node'].includes(decision)
    ? decision
    : 'candidate';
  const taskType = cleanString(input.taskType).toLowerCase();
  const normalizedTaskType = ['coding', 'research', 'unknown'].includes(taskType)
    ? taskType
    : 'unknown';
  const confidence = Number(input.confidence);

  return {
    decision: normalizedDecision,
    taskType: normalizedTaskType,
    goalSummary: cleanString(input.goalSummary),
    confidence: Number.isFinite(confidence) ? Math.max(Math.min(confidence, 1), 0) : 0,
    reason: cleanString(input.reason),
    classifiedAt: cleanString(input.classifiedAt) || new Date().toISOString(),
  };
}

async function defaultClassifyObservedSession(session = {}) {
  const llmService = require('../llm.service');
  const content = [
    `Provider: ${cleanString(session.provider) || 'unknown'}`,
    `Title: ${cleanString(session.title) || '(none)'}`,
    `Prompt: ${cleanString(session.promptDigest) || '(none)'}`,
    `Progress: ${cleanString(session.latestProgressDigest) || '(none)'}`,
  ].join('\n');

  const prompt = [
    'Classify whether this coding-agent session is a concrete coding or research task.',
    'Return JSON only with keys: decision, taskType, goalSummary, confidence, reason.',
    'Valid decision values: ignore, candidate, can_be_node.',
    'Use can_be_node only when there is a concrete coding or research deliverable.',
    'Use taskType values: coding, research, unknown.',
  ].join(' ');

  const result = await llmService.generateWithFallback(content, prompt);
  const parsed = parseJsonObject(result?.text || '');
  return normalizeObservedSessionClassification(parsed || {});
}

async function classifyObservedSession(session = {}, {
  classifyFn = defaultClassifyObservedSession,
} = {}) {
  const normalizedSession = normalizeObservedSession(session);
  const raw = await classifyFn(normalizedSession);
  return normalizeObservedSessionClassification(raw || {});
}

function canMaterializeObservedSession(classification = {}) {
  const normalized = normalizeObservedSessionClassification(classification);
  return normalized.decision === 'can_be_node'
    && ['coding', 'research'].includes(normalized.taskType)
    && Boolean(normalized.goalSummary);
}

function buildObservedSessionNode(record = {}) {
  const normalized = normalizeObservedSession(record);
  const classification = normalizeObservedSessionClassification(record.classification || {});
  const goalSummary = cleanString(classification.goalSummary) || cleanString(normalized.title) || 'Observed session';
  return {
    id: `observed_${cleanString(normalized.id) || sha1(goalSummary).slice(0, 12)}`,
    title: goalSummary,
    kind: 'observed_agent',
    assumption: cleanString(record.latestProgressDigest)
      ? [cleanString(record.latestProgressDigest)]
      : [],
    target: [goalSummary],
    commands: [],
    checks: [],
    evidenceDeps: [],
    resources: {
      observedSession: {
        sessionId: cleanString(normalized.sessionId),
        provider: cleanString(normalized.provider),
        sessionFile: cleanString(normalized.sessionFile),
        contentHash: cleanString(record.contentHash),
        classifiedAt: cleanString(classification.classifiedAt),
      },
    },
    ui: {
      detached: true,
    },
    tags: ['observed', 'external', cleanString(normalized.provider)].filter(Boolean),
  };
}

function findObservedSessionNode(nodes = [], record = {}) {
  const observedSessionId = cleanString(record.sessionId);
  const recordId = cleanString(record.id);
  return (Array.isArray(nodes) ? nodes : []).find((node) => {
    const source = node?.resources?.observedSession && typeof node.resources.observedSession === 'object'
      ? node.resources.observedSession
      : {};
    return cleanString(source.sessionId) === observedSessionId
      || cleanString(node?.id) === `observed_${recordId}`;
  }) || null;
}

function upsertObservedSessionNodeInPlan(planInput = {}, record = {}) {
  const plan = normalizePlan(planInput || {});
  const nextNode = buildObservedSessionNode(record);
  const existing = findObservedSessionNode(plan.nodes, record);

  if (!existing) {
    plan.nodes.push(nextNode);
    return {
      created: true,
      node: nextNode,
      plan: normalizePlan(plan),
    };
  }

  const updatedNode = {
    ...existing,
    title: nextNode.title,
    kind: nextNode.kind,
    assumption: nextNode.assumption,
    target: nextNode.target,
    resources: {
      ...(existing.resources && typeof existing.resources === 'object' ? existing.resources : {}),
      observedSession: {
        ...(existing.resources?.observedSession && typeof existing.resources.observedSession === 'object'
          ? existing.resources.observedSession
          : {}),
        ...nextNode.resources.observedSession,
      },
    },
    ui: {
      ...(existing.ui && typeof existing.ui === 'object' ? existing.ui : {}),
      detached: true,
    },
    tags: nextNode.tags,
  };

  const nextPlan = normalizePlan({
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === existing.id ? updatedNode : node)),
  });
  return {
    created: false,
    node: nextPlan.nodes.find((node) => node.id === existing.id) || updatedNode,
    plan: nextPlan,
  };
}

async function readObservedSessionCache(recordPath = '') {
  try {
    const raw = await fs.readFile(recordPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeObservedSessionCache(recordPath = '', record = {}) {
  const dirPath = path.dirname(recordPath);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function refreshObservedSessionRecord({
  projectPath = '',
  session = {},
  readFile = fs.readFile,
  summarizeSessionFile = defaultSummarizeSessionFile,
  now = () => new Date().toISOString(),
} = {}) {
  const normalized = normalizeObservedSession(session);
  const paths = getObservedSessionCachePaths(projectPath, normalized.id);
  const providedContent = typeof session?.content === 'string' ? session.content : '';
  const canUseRemoteSummary = Boolean(normalized.contentHash && normalized.latestProgressDigest);
  const content = providedContent || (!canUseRemoteSummary ? await readFile(normalized.sessionFile, 'utf8') : '');
  const contentHash = cleanString(normalized.contentHash) || sha1(content);
  const cached = await readObservedSessionCache(paths.recordPath);

  if (cached && cleanString(cached.contentHash) === contentHash) {
    return {
      cacheHit: true,
      record: {
        ...normalized,
        ...cached,
        contentHash,
        lastSeenAt: cleanString(cached.lastSeenAt) || now(),
      },
      paths,
    };
  }

  const summary = canUseRemoteSummary && !providedContent
    ? {
      latestProgressDigest: normalized.latestProgressDigest,
      messageCount: Number(session?.messageCount) || 0,
      toolCallCount: Number(session?.toolCallCount) || 0,
      touchedFiles: Array.isArray(session?.touchedFiles) ? session.touchedFiles : [],
    }
    : await summarizeSessionFile({
      content,
      session: normalized,
    });

  const record = {
    ...normalized,
    latestProgressDigest: cleanString(summary?.latestProgressDigest || normalized.latestProgressDigest),
    messageCount: Number(summary?.messageCount) || 0,
    toolCallCount: Number(summary?.toolCallCount) || 0,
    touchedFiles: Array.isArray(summary?.touchedFiles) ? summary.touchedFiles.map((item) => cleanString(item)).filter(Boolean) : [],
    contentHash,
    lastSeenAt: now(),
  };

  await writeObservedSessionCache(paths.recordPath, record);

  return {
    cacheHit: false,
    record,
    paths,
  };
}

function shouldClassifyObservedSessionRecord(record = {}, { cacheHit = false, forceClassify = false } = {}) {
  if (forceClassify) return true;
  const existing = normalizeObservedSessionClassification(record.classification || {});
  if (!cacheHit) return true;
  if (!cleanString(record.lastClassifiedHash)) return true;
  if (cleanString(record.lastClassifiedHash) !== cleanString(record.contentHash)) return true;
  if (!existing.reason) return true;
  return false;
}

async function classifyObservedSessionRecord({
  projectPath = '',
  record = {},
  classifyFn = defaultClassifyObservedSession,
  forceClassify = false,
  cacheHit = false,
} = {}) {
  const needsClassification = shouldClassifyObservedSessionRecord(record, {
    cacheHit,
    forceClassify,
  });
  if (!needsClassification) {
    return {
      classified: false,
      record: {
        ...record,
        classification: normalizeObservedSessionClassification(record.classification || {}),
      },
    };
  }

  const classification = await classifyObservedSession(record, { classifyFn });
  const nextRecord = {
    ...record,
    classification,
    lastClassifiedHash: cleanString(record.contentHash),
  };
  const paths = getObservedSessionCachePaths(projectPath, record.id);
  await writeObservedSessionCache(paths.recordPath, nextRecord);
  return {
    classified: true,
    record: nextRecord,
  };
}

async function processObservedSession({
  projectPath = '',
  session = {},
  project = null,
  autoMaterialize = true,
  forceClassify = false,
  readFile = fs.readFile,
  summarizeSessionFile = defaultSummarizeSessionFile,
  classifyFn = defaultClassifyObservedSession,
  currentPlan = null,
} = {}) {
  const refreshed = await refreshObservedSessionRecord({
    projectPath,
    session,
    readFile,
    summarizeSessionFile,
  });
  const classified = await classifyObservedSessionRecord({
    projectPath,
    record: refreshed.record,
    classifyFn,
    forceClassify,
    cacheHit: refreshed.cacheHit,
  });

  let nextPlan = currentPlan;
  let node = nextPlan ? findObservedSessionNode(nextPlan.nodes, classified.record) : null;
  let planChanged = false;
  let materialization = node ? 'existing' : 'none';

  if (project && autoMaterialize && nextPlan && canMaterializeObservedSession(classified.record.classification)) {
    const beforePlan = JSON.stringify(nextPlan);
    const upserted = upsertObservedSessionNodeInPlan(nextPlan, classified.record);
    nextPlan = upserted.plan;
    node = upserted.node;
    materialization = upserted.created ? 'created' : 'updated';
    planChanged = beforePlan !== JSON.stringify(nextPlan);
  }

  return {
    record: {
      ...classified.record,
      classification: normalizeObservedSessionClassification(classified.record.classification || {}),
      hasDetachedNode: Boolean(node),
      detachedNodeId: cleanString(node?.id),
      detachedNodeTitle: cleanString(node?.title),
      materialization,
    },
    plan: nextPlan,
    planChanged,
  };
}

async function syncProjectObservedSessions({
  project = null,
  server = null,
  sessions = null,
  watcher = agentSessionWatcher,
  autoMaterialize = true,
  forceClassify = false,
  readProjectPlan = treePlanService.readProjectPlan,
  writeProjectPlan = treePlanService.writeProjectPlan,
  readFile = fs.readFile,
  summarizeSessionFile = defaultSummarizeSessionFile,
  classifyFn = defaultClassifyObservedSession,
} = {}) {
  const projectPath = cleanString(project?.projectPath);
  const sourceSessions = Array.isArray(sessions)
    ? sessions.map((item) => normalizeObservedSession(item))
    : listProjectObservedSessions({
      projectPath,
      watcher,
    });

  let currentPlan = null;
  let planDirty = false;
  if (project && autoMaterialize) {
    const planRead = await readProjectPlan({ project, server });
    currentPlan = normalizePlan(planRead?.plan || {});
  }

  const items = [];
  for (const session of sourceSessions) {
    const processed = await processObservedSession({
      projectPath,
      session,
      project,
      autoMaterialize,
      forceClassify,
      readFile,
      summarizeSessionFile,
      classifyFn,
      currentPlan,
    });
    currentPlan = processed.plan;
    if (processed.planChanged) planDirty = true;
    items.push(processed.record);
  }

  if (project && autoMaterialize && planDirty && currentPlan) {
    await writeProjectPlan({ project, server, plan: currentPlan });
  }

  return {
    items,
    plan: currentPlan,
    wrotePlan: planDirty,
  };
}

async function refreshProjectObservedSession({
  project = null,
  server = null,
  sessionId = '',
  session = null,
  sessions = null,
  watcher = agentSessionWatcher,
  autoMaterialize = true,
  forceClassify = true,
  readProjectPlan = treePlanService.readProjectPlan,
  writeProjectPlan = treePlanService.writeProjectPlan,
  readFile = fs.readFile,
  summarizeSessionFile = defaultSummarizeSessionFile,
  classifyFn = defaultClassifyObservedSession,
} = {}) {
  const projectPath = cleanString(project?.projectPath);
  const targetId = cleanString(sessionId);
  const sourceSessions = Array.isArray(sessions)
    ? sessions.map((item) => normalizeObservedSession(item))
    : listProjectObservedSessions({
      projectPath,
      watcher,
    });
  const targetSession = session
    ? normalizeObservedSession(session)
    : sourceSessions.find((item) => cleanString(item.id) === targetId || cleanString(item.sessionId) === targetId);
  if (!targetSession) {
    const error = new Error(`Observed session not found: ${targetId}`);
    error.code = 'OBSERVED_SESSION_NOT_FOUND';
    throw error;
  }

  let currentPlan = null;
  if (project && autoMaterialize) {
    const planRead = await readProjectPlan({ project, server });
    currentPlan = normalizePlan(planRead?.plan || {});
  }

  const processed = await processObservedSession({
    projectPath,
    session: targetSession,
    project,
    autoMaterialize,
    forceClassify,
    readFile,
    summarizeSessionFile,
    classifyFn,
    currentPlan,
  });

  if (project && autoMaterialize && processed.planChanged && processed.plan) {
    await writeProjectPlan({ project, server, plan: processed.plan });
  }

  return {
    item: processed.record,
    plan: processed.plan,
    wrotePlan: processed.planChanged,
  };
}

function selectObservedSessionsForProject(sessions = [], projectPath = '') {
  const targetPath = normalizePath(projectPath);
  if (!targetPath) return [];

  return (Array.isArray(sessions) ? sessions : [])
    .map((item) => normalizeObservedSession(item))
    .filter((item) => normalizePath(item.gitRoot || item.cwd) === targetPath)
    .sort((a, b) => cleanString(b.updatedAt).localeCompare(cleanString(a.updatedAt)));
}

function listProjectObservedSessions({ projectPath = '', watcher = agentSessionWatcher } = {}) {
  const targetPath = normalizePath(projectPath);
  if (!targetPath) return [];

  if (watcher && typeof watcher.getSessionsByPath === 'function') {
    return selectObservedSessionsForProject(watcher.getSessionsByPath(targetPath), targetPath);
  }

  const all = watcher && typeof watcher.getAllSessions === 'function'
    ? watcher.getAllSessions()
    : [];
  return selectObservedSessionsForProject(all, targetPath);
}

module.exports = {
  buildObservedSessionNode,
  buildObservedSessionId,
  canMaterializeObservedSession,
  classifyObservedSession,
  classifyObservedSessionRecord,
  findObservedSessionNode,
  getObservedSessionCachePaths,
  normalizeObservedSession,
  normalizeObservedSessionClassification,
  processObservedSession,
  refreshProjectObservedSession,
  refreshObservedSessionRecord,
  selectObservedSessionsForProject,
  shouldClassifyObservedSessionRecord,
  syncProjectObservedSessions,
  upsertObservedSessionNodeInPlan,
  listProjectObservedSessions,
};
