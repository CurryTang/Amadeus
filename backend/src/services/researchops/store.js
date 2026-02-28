const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');
const config = require('../../config');
const s3Service = require('../s3.service');
const workflowSchemaService = require('./workflow-schema.service');

let initPromise = null;
let storeMode = 'memory';
let mongoClient = null;
let mongoDb = null;

const memory = {
  projects: [],
  ideas: [],
  runs: [],
  daemons: [],
  runEvents: [],
  runSteps: [],
  runArtifacts: [],
  runCheckpoints: [],
};

const RUN_STATUS = new Set(['QUEUED', 'PROVISIONING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
const RUN_TRANSITIONS = {
  QUEUED: new Set(['PROVISIONING', 'CANCELLED']),
  PROVISIONING: new Set(['RUNNING', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']),
  SUCCEEDED: new Set([]),
  FAILED: new Set([]),
  CANCELLED: new Set([]),
};
const RUN_EVENT_TYPES = new Set([
  'RUN_STATUS',
  'LOG_LINE',
  'PROGRESS',
  'TOOL_CALL',
  'RESULT_SUMMARY',
  'STEP_STARTED',
  'STEP_LOG',
  'STEP_RESULT',
  'ARTIFACT_CREATED',
  'CHECKPOINT_REQUIRED',
  'CHECKPOINT_DECIDED',
  'REVIEW_ACTION',
  'RUN_SUMMARY',
]);
const SKILL_OBJECT_SCHEMA_VERSION = '1.0';
const SKILL_OBJECT_STANDARD = 'claude-code-codex-skill';
const SKILL_CATALOG_STANDARD = 'claude-code-codex-skill-catalog';
const SKILLS_ROOT_DIR = path.join(__dirname, '..', '..', '..', '..', 'skills');
const SKILLS_CATALOG_PREFIX = cleanString(process.env.SKILLS_CATALOG_PREFIX || 'skills/catalog');
const SKILLS_OBJECT_PREFIX = cleanString(process.env.SKILLS_OBJECT_PREFIX || 'skills/objects');

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(userId) {
  const raw = String(userId || '').trim().toLowerCase();
  return raw || 'czk';
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function normalizeKnowledgeGroupIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of input) {
    const num = Number(item);
    if (!Number.isFinite(num)) continue;
    const id = Math.floor(num);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function toInt(value, fallback, min = 1, max = 10000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function getMongoUri() {
  const fromConfig = String(config.database?.mongodbUri || '').trim();
  if (fromConfig) return fromConfig;
  return 'mongodb://127.0.0.1:27017/auto_researcher';
}

function getMongoDbName(uri) {
  const configured = String(config.database?.mongodbDbName || '').trim();
  if (configured) return configured;
  try {
    const parsed = new URL(uri);
    const fromPath = String(parsed.pathname || '').replace(/^\/+/, '').trim();
    return fromPath || 'auto_researcher';
  } catch (_) {
    return 'auto_researcher';
  }
}

async function ensureMongoIndexes(db) {
  await Promise.all([
    db.collection('researchops_projects').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_projects').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('researchops_ideas').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_ideas').createIndex({ userId: 1, projectId: 1, updatedAt: -1 }),
    db.collection('researchops_runs').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_runs').createIndex({ userId: 1, status: 1, createdAt: -1 }),
    db.collection('researchops_runs').createIndex({ userId: 1, serverId: 1, status: 1, createdAt: 1 }),
    db.collection('researchops_daemons').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_daemons').createIndex({ userId: 1, hostname: 1 }, { unique: true }),
    db.collection('researchops_run_events').createIndex({ runId: 1, sequence: 1 }, { unique: true }),
    db.collection('researchops_run_events').createIndex({ userId: 1, runId: 1, sequence: 1 }),
    db.collection('researchops_run_steps').createIndex({ runId: 1, stepId: 1 }, { unique: true }),
    db.collection('researchops_run_steps').createIndex({ userId: 1, runId: 1, updatedAt: -1 }),
    db.collection('researchops_run_artifacts').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_run_artifacts').createIndex({ userId: 1, runId: 1, createdAt: -1 }),
    db.collection('researchops_run_checkpoints').createIndex({ id: 1 }, { unique: true }),
    db.collection('researchops_run_checkpoints').createIndex({ userId: 1, runId: 1, status: 1, createdAt: -1 }),
  ]);
}

async function initStore() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const provider = String(config.database?.provider || 'mongodb').toLowerCase();
    if (provider !== 'mongodb' && provider !== 'mongodb-atlas') {
      storeMode = 'memory';
      return;
    }

    const mongoUri = getMongoUri();
    try {
      mongoClient = new MongoClient(mongoUri, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
      });
      await mongoClient.connect();
      mongoDb = mongoClient.db(getMongoDbName(mongoUri));
      await ensureMongoIndexes(mongoDb);
      storeMode = 'mongodb';
      console.log(`[ResearchOps] Metadata store ready (mongodb:${mongoDb.databaseName})`);
    } catch (error) {
      storeMode = 'memory';
      console.error('[ResearchOps] Mongo unavailable, using memory fallback:', error.message);
    }
  })();

  return initPromise;
}

function projectShape(doc) {
  return {
    id: doc.id,
    userId: doc.userId,
    name: doc.name,
    description: doc.description || null,
    locationType: doc.locationType || 'local',
    serverId: doc.serverId || 'local-default',
    projectPath: doc.projectPath || null,
    gitBranch: cleanString(doc.gitBranch) || null,
    kbFolderPath: cleanString(doc.kbFolderPath) || null,
    knowledgeGroupIds: normalizeKnowledgeGroupIds(doc.knowledgeGroupIds),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function ideaShape(doc) {
  return {
    id: doc.id,
    userId: doc.userId,
    projectId: doc.projectId,
    title: doc.title,
    hypothesis: doc.hypothesis,
    expectedOutcome: doc.expectedOutcome || null,
    experimentPlan: doc.experimentPlan || null,
    summary: doc.summary || null,
    threadId: doc.threadId || null,
    status: doc.status || 'DRAFT',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function runShape(doc) {
  return {
    id: doc.id,
    userId: doc.userId,
    schemaVersion: cleanString(doc.schemaVersion) || '1.0',
    projectId: doc.projectId,
    serverId: doc.serverId,
    runType: doc.runType,
    provider: doc.provider || null,
    status: doc.status,
    mode: cleanString(doc.mode) || 'interactive',
    workflow: Array.isArray(doc.workflow) ? doc.workflow : [],
    skillRefs: Array.isArray(doc.skillRefs) ? doc.skillRefs : [],
    contextRefs: doc.contextRefs && typeof doc.contextRefs === 'object' ? doc.contextRefs : {},
    outputContract: doc.outputContract && typeof doc.outputContract === 'object' ? doc.outputContract : {},
    budgets: doc.budgets && typeof doc.budgets === 'object' ? doc.budgets : {},
    hitlPolicy: doc.hitlPolicy && typeof doc.hitlPolicy === 'object' ? doc.hitlPolicy : {},
    metadata: doc.metadata || {},
    lastMessage: cleanString(doc.lastMessage) || null,
    createdAt: doc.createdAt,
    startedAt: doc.startedAt || null,
    endedAt: doc.endedAt || null,
    updatedAt: doc.updatedAt || doc.createdAt,
  };
}

function daemonShape(doc) {
  return {
    id: doc.id,
    userId: doc.userId,
    hostname: doc.hostname,
    status: doc.status || 'ONLINE',
    capacity: doc.capacity || {},
    labels: doc.labels || {},
    concurrencyLimit: doc.concurrencyLimit || 1,
    heartbeatAt: doc.heartbeatAt || nowIso(),
    createdAt: doc.createdAt || nowIso(),
  };
}

function runEventShape(doc) {
  return {
    id: doc.id,
    runId: doc.runId,
    sequence: doc.sequence,
    eventType: doc.eventType,
    status: doc.status || null,
    message: doc.message || null,
    progress: typeof doc.progress === 'number' ? doc.progress : null,
    payload: doc.payload || null,
    timestamp: doc.timestamp,
  };
}

const ACTIVE_RUN_STATUSES = ['PROVISIONING', 'RUNNING'];

function unwrapFindOneAndUpdate(result) {
  if (!result) return null;
  // Older Mongo driver returns ModifyResult { value, ok, lastErrorObject }.
  if (
    typeof result === 'object' &&
    Object.prototype.hasOwnProperty.call(result, 'lastErrorObject') &&
    Object.prototype.hasOwnProperty.call(result, 'value')
  ) {
    return result.value;
  }
  return result;
}

async function getRawDaemonById(userId, serverId) {
  const uid = normalizeUserId(userId);
  const sid = cleanString(serverId);
  if (!sid) return null;

  if (storeMode === 'mongodb') {
    return mongoDb.collection('researchops_daemons').findOne({ id: sid, userId: uid });
  }
  return memory.daemons.find((item) => item.id === sid && item.userId === uid) || null;
}

async function countActiveRunsForServer(userId, serverId) {
  const uid = normalizeUserId(userId);
  const sid = cleanString(serverId);
  if (!sid) return 0;

  if (storeMode === 'mongodb') {
    return mongoDb.collection('researchops_runs').countDocuments({
      userId: uid,
      serverId: sid,
      status: { $in: ACTIVE_RUN_STATUSES },
    });
  }

  return memory.runs.filter(
    (run) => run.userId === uid && run.serverId === sid && ACTIVE_RUN_STATUSES.includes(run.status)
  ).length;
}

async function listProjects(userId, { limit = 50 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const cap = toInt(limit, 50, 1, 300);

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_projects')
      .find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(projectShape);
  }

  return memory.projects
    .filter((doc) => doc.userId === uid)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, cap)
    .map(projectShape);
}

async function createProject(userId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const normalizedName = cleanString(payload?.name);
  if (!normalizedName) throw new Error('Project name is required');
  const locationType = cleanString(payload?.locationType).toLowerCase() || 'local';
  if (!['local', 'ssh'].includes(locationType)) {
    throw new Error('locationType must be local or ssh');
  }
  const serverId = locationType === 'ssh'
    ? cleanString(payload?.serverId)
    : 'local-default';
  if (locationType === 'ssh' && !serverId) {
    throw new Error('serverId is required when locationType=ssh');
  }
  const projectPath = cleanString(payload?.projectPath);
  if (!projectPath) {
    throw new Error('projectPath is required');
  }

  const ts = nowIso();
  const doc = {
    id: newId('proj'),
    userId: uid,
    name: normalizedName,
    description: cleanString(payload?.description) || null,
    locationType,
    serverId,
    projectPath,
    kbFolderPath: cleanString(payload?.kbFolderPath) || null,
    knowledgeGroupIds: normalizeKnowledgeGroupIds(payload?.knowledgeGroupIds),
    createdAt: ts,
    updatedAt: ts,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_projects').insertOne(doc);
  } else {
    memory.projects.push(doc);
  }

  return projectShape(doc);
}

async function getProject(userId, projectId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return null;

  if (storeMode === 'mongodb') {
    const doc = await mongoDb.collection('researchops_projects').findOne({ id, userId: uid });
    return doc ? projectShape(doc) : null;
  }

  const doc = memory.projects.find((item) => item.id === id && item.userId === uid);
  return doc ? projectShape(doc) : null;
}

async function setProjectKnowledgeGroups(userId, projectId, knowledgeGroupIds = []) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return null;
  const nextGroupIds = normalizeKnowledgeGroupIds(knowledgeGroupIds);
  const ts = nowIso();

  let updated = null;
  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_projects').findOneAndUpdate(
      { id, userId: uid },
      { $set: { knowledgeGroupIds: nextGroupIds, updatedAt: ts } },
      { returnDocument: 'after' }
    );
    updated = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.projects.findIndex((item) => item.id === id && item.userId === uid);
    if (idx === -1) return null;
    memory.projects[idx] = {
      ...memory.projects[idx],
      knowledgeGroupIds: nextGroupIds,
      updatedAt: ts,
    };
    updated = memory.projects[idx];
  }

  return updated ? projectShape(updated) : null;
}

async function setProjectKnowledgeBaseFolder(userId, projectId, kbFolderPath = null) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return null;
  const ts = nowIso();
  const normalizedKbPath = cleanString(kbFolderPath) || null;

  let updated = null;
  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_projects').findOneAndUpdate(
      { id, userId: uid },
      { $set: { kbFolderPath: normalizedKbPath, updatedAt: ts } },
      { returnDocument: 'after' }
    );
    updated = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.projects.findIndex((item) => item.id === id && item.userId === uid);
    if (idx === -1) return null;
    memory.projects[idx] = {
      ...memory.projects[idx],
      kbFolderPath: normalizedKbPath,
      updatedAt: ts,
    };
    updated = memory.projects[idx];
  }

  return updated ? projectShape(updated) : null;
}

async function updateProject(userId, projectId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return null;
  const ts = nowIso();

  const patch = { updatedAt: ts };
  if (payload.name !== undefined) {
    const name = cleanString(payload.name);
    if (name) patch.name = name;
  }
  if (payload.description !== undefined) {
    patch.description = cleanString(payload.description) || null;
  }
  if (payload.projectPath !== undefined) {
    const p = cleanString(payload.projectPath);
    if (p) patch.projectPath = p;
  }
  if (payload.gitBranch !== undefined) {
    patch.gitBranch = cleanString(payload.gitBranch) || null;
  }

  let updated = null;
  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_projects').findOneAndUpdate(
      { id, userId: uid },
      { $set: patch },
      { returnDocument: 'after' }
    );
    updated = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.projects.findIndex((item) => item.id === id && item.userId === uid);
    if (idx === -1) return null;
    memory.projects[idx] = { ...memory.projects[idx], ...patch };
    updated = memory.projects[idx];
  }

  return updated ? projectShape(updated) : null;
}

async function deleteProject(userId, projectId, { force = false } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return null;

  let projectDoc = null;
  if (storeMode === 'mongodb') {
    projectDoc = await mongoDb.collection('researchops_projects').findOne({ id, userId: uid });
  } else {
    projectDoc = memory.projects.find((item) => item.id === id && item.userId === uid) || null;
  }
  if (!projectDoc) return null;

  const activeRunStatuses = ACTIVE_RUN_STATUSES.slice();
  let activeRuns = [];
  let runDocs = [];

  if (storeMode === 'mongodb') {
    activeRuns = await mongoDb.collection('researchops_runs')
      .find({ userId: uid, projectId: id, status: { $in: activeRunStatuses } })
      .project({ _id: 0, id: 1, status: 1 })
      .limit(200)
      .toArray();
    if (activeRuns.length > 0 && !force) {
      const error = new Error('Project has active runs');
      error.code = 'PROJECT_HAS_ACTIVE_RUNS';
      error.activeRuns = activeRuns;
      throw error;
    }
    runDocs = await mongoDb.collection('researchops_runs')
      .find({ userId: uid, projectId: id })
      .project({ _id: 0, id: 1 })
      .toArray();
  } else {
    activeRuns = memory.runs
      .filter((item) => item.userId === uid && item.projectId === id && activeRunStatuses.includes(item.status))
      .map((item) => ({ id: item.id, status: item.status }));
    if (activeRuns.length > 0 && !force) {
      const error = new Error('Project has active runs');
      error.code = 'PROJECT_HAS_ACTIVE_RUNS';
      error.activeRuns = activeRuns;
      throw error;
    }
    runDocs = memory.runs
      .filter((item) => item.userId === uid && item.projectId === id)
      .map((item) => ({ id: item.id }));
  }

  const runIds = runDocs.map((item) => cleanString(item.id)).filter(Boolean);
  const summary = {
    projectId: id,
    projectName: cleanString(projectDoc.name) || null,
    activeRunIds: activeRuns.map((item) => item.id),
    deleted: {
      projects: 0,
      ideas: 0,
      runs: 0,
      runEvents: 0,
      runSteps: 0,
      runArtifacts: 0,
      runCheckpoints: 0,
    },
  };

  if (storeMode === 'mongodb') {
    const [projectDeleteResult, ideasDeleteResult, runsDeleteResult] = await Promise.all([
      mongoDb.collection('researchops_projects').deleteOne({ id, userId: uid }),
      mongoDb.collection('researchops_ideas').deleteMany({ userId: uid, projectId: id }),
      mongoDb.collection('researchops_runs').deleteMany({ userId: uid, projectId: id }),
    ]);
    summary.deleted.projects = Number(projectDeleteResult?.deletedCount || 0);
    summary.deleted.ideas = Number(ideasDeleteResult?.deletedCount || 0);
    summary.deleted.runs = Number(runsDeleteResult?.deletedCount || 0);

    if (runIds.length > 0) {
      const [eventsDeleteResult, stepsDeleteResult, artifactsDeleteResult, checkpointsDeleteResult] = await Promise.all([
        mongoDb.collection('researchops_run_events').deleteMany({ userId: uid, runId: { $in: runIds } }),
        mongoDb.collection('researchops_run_steps').deleteMany({ userId: uid, runId: { $in: runIds } }),
        mongoDb.collection('researchops_run_artifacts').deleteMany({ userId: uid, runId: { $in: runIds } }),
        mongoDb.collection('researchops_run_checkpoints').deleteMany({ userId: uid, runId: { $in: runIds } }),
      ]);
      summary.deleted.runEvents = Number(eventsDeleteResult?.deletedCount || 0);
      summary.deleted.runSteps = Number(stepsDeleteResult?.deletedCount || 0);
      summary.deleted.runArtifacts = Number(artifactsDeleteResult?.deletedCount || 0);
      summary.deleted.runCheckpoints = Number(checkpointsDeleteResult?.deletedCount || 0);
    }
  } else {
    const beforeCounts = {
      projects: memory.projects.length,
      ideas: memory.ideas.length,
      runs: memory.runs.length,
      runEvents: memory.runEvents.length,
      runSteps: memory.runSteps.length,
      runArtifacts: memory.runArtifacts.length,
      runCheckpoints: memory.runCheckpoints.length,
    };

    memory.projects = memory.projects.filter((item) => !(item.userId === uid && item.id === id));
    memory.ideas = memory.ideas.filter((item) => !(item.userId === uid && item.projectId === id));
    memory.runs = memory.runs.filter((item) => !(item.userId === uid && item.projectId === id));
    memory.runEvents = memory.runEvents.filter((item) => !(item.userId === uid && runIds.includes(item.runId)));
    memory.runSteps = memory.runSteps.filter((item) => !(item.userId === uid && runIds.includes(item.runId)));
    memory.runArtifacts = memory.runArtifacts.filter((item) => !(item.userId === uid && runIds.includes(item.runId)));
    memory.runCheckpoints = memory.runCheckpoints.filter((item) => !(item.userId === uid && runIds.includes(item.runId)));

    summary.deleted.projects = beforeCounts.projects - memory.projects.length;
    summary.deleted.ideas = beforeCounts.ideas - memory.ideas.length;
    summary.deleted.runs = beforeCounts.runs - memory.runs.length;
    summary.deleted.runEvents = beforeCounts.runEvents - memory.runEvents.length;
    summary.deleted.runSteps = beforeCounts.runSteps - memory.runSteps.length;
    summary.deleted.runArtifacts = beforeCounts.runArtifacts - memory.runArtifacts.length;
    summary.deleted.runCheckpoints = beforeCounts.runCheckpoints - memory.runCheckpoints.length;
  }

  return summary;
}

async function listProjectArtifactObjectKeys(userId, projectId, { limit = 20000 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(projectId);
  if (!id) return [];
  const cap = toInt(limit, 20000, 1, 100000);

  if (storeMode === 'mongodb') {
    const runDocs = await mongoDb.collection('researchops_runs')
      .find({ userId: uid, projectId: id })
      .project({ _id: 0, id: 1 })
      .toArray();
    const runIds = runDocs.map((item) => cleanString(item.id)).filter(Boolean);
    if (!runIds.length) return [];

    const artifactDocs = await mongoDb.collection('researchops_run_artifacts')
      .find({
        userId: uid,
        runId: { $in: runIds },
        objectKey: { $exists: true, $ne: null, $ne: '' },
      })
      .project({ _id: 0, objectKey: 1 })
      .limit(cap)
      .toArray();

    return Array.from(new Set(
      artifactDocs
        .map((item) => cleanString(item.objectKey))
        .filter(Boolean)
    ));
  }

  const runIdSet = new Set(
    memory.runs
      .filter((item) => item.userId === uid && item.projectId === id)
      .map((item) => cleanString(item.id))
      .filter(Boolean)
  );
  if (!runIdSet.size) return [];

  return Array.from(new Set(
    memory.runArtifacts
      .filter((item) => item.userId === uid && runIdSet.has(cleanString(item.runId)))
      .map((item) => cleanString(item.objectKey))
      .filter(Boolean)
      .slice(0, cap)
  ));
}

async function listIdeas(userId, { projectId = '', status = '', limit = 80 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const filter = { userId: uid };
  const normalizedProjectId = cleanString(projectId);
  const normalizedStatus = cleanString(status).toUpperCase();
  if (normalizedProjectId) filter.projectId = normalizedProjectId;
  if (normalizedStatus) filter.status = normalizedStatus;
  const cap = toInt(limit, 80, 1, 300);

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_ideas')
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(ideaShape);
  }

  return memory.ideas
    .filter((doc) => doc.userId === uid)
    .filter((doc) => !normalizedProjectId || doc.projectId === normalizedProjectId)
    .filter((doc) => !normalizedStatus || doc.status === normalizedStatus)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, cap)
    .map(ideaShape);
}

async function createIdea(userId, payload) {
  await initStore();
  const uid = normalizeUserId(userId);
  const projectId = cleanString(payload?.projectId);
  const title = cleanString(payload?.title);
  const hypothesis = cleanString(payload?.hypothesis);

  if (!projectId || !title || !hypothesis) {
    throw new Error('projectId, title and hypothesis are required');
  }

  const project = await getProject(uid, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  const ts = nowIso();
  const doc = {
    id: newId('idea'),
    userId: uid,
    projectId,
    title,
    hypothesis,
    expectedOutcome: cleanString(payload?.expectedOutcome) || null,
    experimentPlan: cleanString(payload?.experimentPlan) || null,
    summary: cleanString(payload?.summary) || null,
    threadId: cleanString(payload?.threadId) || null,
    status: cleanString(payload?.status).toUpperCase() || 'DRAFT',
    createdAt: ts,
    updatedAt: ts,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_ideas').insertOne(doc);
  } else {
    memory.ideas.push(doc);
  }

  return ideaShape(doc);
}

async function getIdea(userId, ideaId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(ideaId);
  if (!id) return null;

  if (storeMode === 'mongodb') {
    const doc = await mongoDb.collection('researchops_ideas').findOne({ id, userId: uid });
    return doc ? ideaShape(doc) : null;
  }

  const doc = memory.ideas.find((item) => item.id === id && item.userId === uid);
  return doc ? ideaShape(doc) : null;
}

async function updateIdea(userId, ideaId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(ideaId);
  if (!id) return null;

  const patch = {};
  if (payload && typeof payload === 'object') {
    if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
      const title = cleanString(payload.title);
      if (!title) throw new Error('title cannot be empty');
      patch.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'hypothesis')) {
      const hypothesis = cleanString(payload.hypothesis);
      if (!hypothesis) throw new Error('hypothesis cannot be empty');
      patch.hypothesis = hypothesis;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      const status = cleanString(payload.status).toUpperCase();
      if (!status) throw new Error('status cannot be empty');
      patch.status = status;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'summary')) {
      patch.summary = cleanString(payload.summary) || null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'expectedOutcome')) {
      patch.expectedOutcome = cleanString(payload.expectedOutcome) || null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'experimentPlan')) {
      patch.experimentPlan = cleanString(payload.experimentPlan) || null;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('No fields to update');
  }
  patch.updatedAt = nowIso();

  let updated = null;
  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_ideas').findOneAndUpdate(
      { id, userId: uid },
      { $set: patch },
      { returnDocument: 'after' }
    );
    updated = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.ideas.findIndex((item) => item.id === id && item.userId === uid);
    if (idx === -1) return null;
    memory.ideas[idx] = {
      ...memory.ideas[idx],
      ...patch,
    };
    updated = memory.ideas[idx];
  }

  return updated ? ideaShape(updated) : null;
}

async function enqueueRun(userId, payload) {
  await initStore();
  const uid = normalizeUserId(userId);
  const projectId = cleanString(payload?.projectId);
  const runType = cleanString(payload?.runType).toUpperCase();
  const serverId = cleanString(payload?.serverId) || 'local-default';
  const provider = cleanString(payload?.provider) || null;
  const schemaVersion = cleanString(payload?.schemaVersion) || '1.0';
  const mode = cleanString(payload?.mode) || 'interactive';
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const workflowInput = Array.isArray(payload?.workflow) ? payload.workflow : [];
  const skillRefs = Array.isArray(payload?.skillRefs) ? payload.skillRefs : [];
  const contextRefs = payload?.contextRefs && typeof payload.contextRefs === 'object' ? payload.contextRefs : {};
  const outputContract = payload?.outputContract && typeof payload.outputContract === 'object'
    ? payload.outputContract
    : {};
  const budgets = payload?.budgets && typeof payload.budgets === 'object' ? payload.budgets : {};
  const hitlPolicy = payload?.hitlPolicy && typeof payload.hitlPolicy === 'object' ? payload.hitlPolicy : {};

  if (!projectId || !runType) {
    throw new Error('projectId and runType are required');
  }
  if (!['AGENT', 'EXPERIMENT'].includes(runType)) {
    throw new Error('runType must be AGENT or EXPERIMENT');
  }
  const normalizedWorkflow = schemaVersion.startsWith('2.')
    ? workflowSchemaService.normalizeAndValidateWorkflow(workflowInput, { allowEmpty: true })
    : workflowInput;

  const project = await getProject(uid, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  const metadataKnowledgeGroupIds = normalizeKnowledgeGroupIds(metadata.knowledgeGroupIds);
  const contextKnowledgeGroupIds = normalizeKnowledgeGroupIds(contextRefs.knowledgeGroupIds);
  const projectKnowledgeGroupIds = normalizeKnowledgeGroupIds(project.knowledgeGroupIds);
  const effectiveKnowledgeGroupIds = metadataKnowledgeGroupIds.length
    ? metadataKnowledgeGroupIds
    : (contextKnowledgeGroupIds.length ? contextKnowledgeGroupIds : projectKnowledgeGroupIds);
  const runMetadata = { ...metadata };
  const runContextRefs = { ...contextRefs };
  if (effectiveKnowledgeGroupIds.length) {
    runMetadata.knowledgeGroupIds = effectiveKnowledgeGroupIds;
    runContextRefs.knowledgeGroupIds = effectiveKnowledgeGroupIds;
  } else {
    delete runMetadata.knowledgeGroupIds;
    delete runContextRefs.knowledgeGroupIds;
  }

  const ts = nowIso();
  const doc = {
    id: newId('run'),
    userId: uid,
    projectId,
    serverId,
    schemaVersion,
    runType,
    provider,
    mode,
    status: 'QUEUED',
    workflow: normalizedWorkflow,
    skillRefs,
    contextRefs: runContextRefs,
    outputContract,
    budgets,
    hitlPolicy,
    metadata: runMetadata,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    endedAt: null,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_runs').insertOne(doc);
  } else {
    memory.runs.push(doc);
  }

  await publishRunEvents(uid, doc.id, [{
    eventType: 'RUN_STATUS',
    status: 'QUEUED',
    message: 'Run enqueued',
  }]);

  return runShape(doc);
}

async function listRuns(userId, { projectId = '', status = '', limit = 80 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const normalizedProjectId = cleanString(projectId);
  const normalizedStatus = cleanString(status).toUpperCase();
  const filter = { userId: uid };
  if (normalizedProjectId) filter.projectId = normalizedProjectId;
  if (normalizedStatus) filter.status = normalizedStatus;
  const cap = toInt(limit, 80, 1, 400);

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_runs')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(runShape);
  }

  return memory.runs
    .filter((doc) => doc.userId === uid)
    .filter((doc) => !normalizedProjectId || doc.projectId === normalizedProjectId)
    .filter((doc) => !normalizedStatus || doc.status === normalizedStatus)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, cap)
    .map(runShape);
}

async function getRun(userId, runId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  if (!id) return null;

  if (storeMode === 'mongodb') {
    const doc = await mongoDb.collection('researchops_runs').findOne({ id, userId: uid });
    return doc ? runShape(doc) : null;
  }

  const doc = memory.runs.find((item) => item.id === id && item.userId === uid);
  return doc ? runShape(doc) : null;
}

async function getRawRun(userId, runId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  if (!id) return null;

  if (storeMode === 'mongodb') {
    return mongoDb.collection('researchops_runs').findOne({ id, userId: uid });
  }

  return memory.runs.find((item) => item.id === id && item.userId === uid) || null;
}

async function createRunDocument(doc = {}) {
  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_runs').insertOne(doc);
  } else {
    memory.runs.push(doc);
  }
}

function assertTransition(currentStatus, nextStatus) {
  if (!RUN_STATUS.has(nextStatus)) {
    throw new Error('Invalid run status');
  }
  if (currentStatus === nextStatus) return;
  const allowed = RUN_TRANSITIONS[currentStatus] || new Set();
  if (!allowed.has(nextStatus)) {
    throw new Error(`Invalid run status transition: ${currentStatus} -> ${nextStatus}`);
  }
}

async function updateRunStatus(userId, runId, status, message = '', payload = null) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  const nextStatus = cleanString(status).toUpperCase();
  if (!id) return null;

  const current = await getRawRun(uid, id);
  if (!current) return null;
  assertTransition(current.status, nextStatus);

  const ts = nowIso();
  const patch = {
    status: nextStatus,
    updatedAt: ts,
  };
  if (nextStatus === 'RUNNING' && !current.startedAt) patch.startedAt = ts;
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(nextStatus)) patch.endedAt = ts;
  if (message) patch.lastMessage = String(message);

  let updated;
  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_runs').findOneAndUpdate(
      { id, userId: uid },
      { $set: patch },
      { returnDocument: 'after' }
    );
    updated = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.runs.findIndex((item) => item.id === id && item.userId === uid);
    if (idx === -1) return null;
    memory.runs[idx] = { ...memory.runs[idx], ...patch };
    updated = memory.runs[idx];
  }

  if (!updated) return null;

  await publishRunEvents(uid, id, [{
    eventType: 'RUN_STATUS',
    status: nextStatus,
    message: message || `Run moved to ${nextStatus}`,
    payload: payload && typeof payload === 'object' ? payload : undefined,
  }]);

  return runShape(updated);
}

async function listQueue(userId, { serverId = '', limit = 100 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const sid = cleanString(serverId);
  const cap = toInt(limit, 100, 1, 500);

  if (storeMode === 'mongodb') {
    const filter = { userId: uid, status: 'QUEUED' };
    if (sid) filter.serverId = sid;
    const docs = await mongoDb.collection('researchops_runs')
      .find(filter)
      .sort({ createdAt: 1 })
      .limit(cap)
      .toArray();
    return docs.map(runShape);
  }

  return memory.runs
    .filter((doc) => doc.userId === uid && doc.status === 'QUEUED')
    .filter((doc) => !sid || doc.serverId === sid)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, cap)
    .map(runShape);
}

async function leaseNextRun(userId, { serverId = '', allowUnregisteredServer = false } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const sid = cleanString(serverId);
  const ts = nowIso();

  if (sid) {
    const daemon = await getRawDaemonById(uid, sid);
    if (!daemon && !allowUnregisteredServer) {
      return { leased: false, reason: 'server_not_found' };
    }

    if (daemon) {
      const concurrencyLimit = toInt(daemon?.concurrencyLimit, 1, 1, 512);
      const activeCount = await countActiveRunsForServer(uid, sid);
      if (activeCount >= concurrencyLimit) {
        return {
          leased: false,
          reason: 'capacity_reached',
          capacity: concurrencyLimit,
          activeCount,
        };
      }
    }
  }

  let doc = null;
  if (storeMode === 'mongodb') {
    const filter = { userId: uid, status: 'QUEUED' };
    if (sid) filter.serverId = sid;
    const result = await mongoDb.collection('researchops_runs').findOneAndUpdate(
      filter,
      { $set: { status: 'PROVISIONING', updatedAt: ts } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );
    doc = unwrapFindOneAndUpdate(result);
  } else {
    const idx = memory.runs
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.userId === uid && item.status === 'QUEUED' && (!sid || item.serverId === sid))
      .sort((a, b) => String(a.item.createdAt).localeCompare(String(b.item.createdAt)))[0]?.index;

    if (typeof idx === 'number') {
      memory.runs[idx] = { ...memory.runs[idx], status: 'PROVISIONING', updatedAt: ts };
      doc = memory.runs[idx];
    }
  }

  if (!doc) return { leased: false, reason: 'no_queued_runs' };

  await publishRunEvents(uid, doc.id, [{
    eventType: 'RUN_STATUS',
    status: 'PROVISIONING',
    message: `Run leased by ${sid || 'daemon'}`,
  }]);

  return { leased: true, run: runShape(doc) };
}

async function listStaleRuns(userId, { minutesStale = 20, serverId = '' } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const sid = cleanString(serverId);
  const mins = toInt(minutesStale, 20, 1, 60 * 24 * 30);
  const cutoff = new Date(Date.now() - mins * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  if (storeMode === 'mongodb') {
    const filter = {
      userId: uid,
      status: { $in: ACTIVE_RUN_STATUSES },
      startedAt: { $ne: null, $lte: cutoffIso },
    };
    if (sid) filter.serverId = sid;
    return mongoDb.collection('researchops_runs')
      .find(filter)
      .sort({ startedAt: 1 })
      .limit(500)
      .toArray();
  }

  return memory.runs
    .filter((run) => run.userId === uid)
    .filter((run) => ACTIVE_RUN_STATUSES.includes(run.status))
    .filter((run) => !sid || run.serverId === sid)
    .filter((run) => {
      if (!run.startedAt) return false;
      const runStarted = new Date(run.startedAt).getTime();
      return Number.isFinite(runStarted) && runStarted <= cutoff.getTime();
    })
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .slice(0, 500);
}

async function applyRecoveryAction(userId, runDoc, { minutesStale }) {
  const uid = normalizeUserId(userId);
  const runId = runDoc.id;
  const now = nowIso();
  const isProvisioning = runDoc.status === 'PROVISIONING';
  const nextStatus = isProvisioning ? 'QUEUED' : 'FAILED';
  const action = isProvisioning ? 'requeue' : 'mark_failed';

  const patch = {
    status: nextStatus,
    updatedAt: now,
  };
  if (isProvisioning) {
    patch.startedAt = null;
    patch.endedAt = null;
  } else {
    patch.endedAt = now;
  }

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_runs').updateOne(
      { id: runId, userId: uid },
      { $set: patch }
    );
  } else {
    const index = memory.runs.findIndex((run) => run.id === runId && run.userId === uid);
    if (index !== -1) {
      memory.runs[index] = { ...memory.runs[index], ...patch };
    }
  }

  await publishRunEvents(uid, runId, [{
    eventType: 'RUN_STATUS',
    status: nextStatus,
    message: action === 'requeue'
      ? `Recovery requeued stale provisioning run after ${minutesStale} minutes`
      : `Recovery marked stale running run as FAILED after ${minutesStale} minutes`,
    payload: {
      source: 'recovery',
      previousStatus: runDoc.status,
      nextStatus,
      minutesStale,
      action,
    },
  }]);

  return { runId, previousStatus: runDoc.status, nextStatus, action };
}

async function recoverStaleRuns(userId, { minutesStale = 20, serverId = '', dryRun = false } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const mins = toInt(minutesStale, 20, 1, 60 * 24 * 30);
  const staleRuns = await listStaleRuns(uid, { minutesStale: mins, serverId });
  const items = staleRuns.map((runDoc) => ({
    runId: runDoc.id,
    previousStatus: runDoc.status,
    nextStatus: runDoc.status === 'PROVISIONING' ? 'QUEUED' : 'FAILED',
    action: runDoc.status === 'PROVISIONING' ? 'requeue' : 'mark_failed',
  }));

  if (dryRun || staleRuns.length === 0) {
    return {
      inspected: staleRuns.length,
      mutated: 0,
      dryRun: !!dryRun,
      items,
    };
  }

  const mutatedItems = [];
  for (const runDoc of staleRuns) {
    const result = await applyRecoveryAction(uid, runDoc, { minutesStale: mins });
    mutatedItems.push(result);
  }

  return {
    inspected: staleRuns.length,
    mutated: mutatedItems.length,
    dryRun: false,
    items: mutatedItems,
  };
}

async function retryRun(userId, runId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  if (!id) throw new Error('runId is required');
  const source = await getRawRun(uid, id);
  if (!source) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }
  const sourceStatus = cleanString(source.status).toUpperCase();
  if (!['FAILED', 'CANCELLED', 'SUCCEEDED'].includes(sourceStatus)) {
    throw new Error(`Run ${id} is not retryable while status=${sourceStatus}`);
  }

  const ts = nowIso();
  const { _id: _ignoredObjectId, ...sourceWithoutObjectId } = source;
  const nextDoc = {
    ...sourceWithoutObjectId,
    id: newId('run'),
    status: 'QUEUED',
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    endedAt: null,
    lastMessage: null,
    metadata: {
      ...(source.metadata && typeof source.metadata === 'object' ? source.metadata : {}),
      retryOfRunId: source.id,
      retryReason: cleanString(payload.reason) || null,
    },
  };
  await createRunDocument(nextDoc);
  await publishRunEvents(uid, nextDoc.id, [{
    eventType: 'RUN_STATUS',
    status: 'QUEUED',
    message: `Run enqueued as retry of ${source.id}`,
    payload: { retryOfRunId: source.id },
  }]);
  return runShape(nextDoc);
}

async function insertRunWorkflowStep(userId, runId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  if (!rid) throw new Error('runId is required');
  const source = await getRawRun(uid, rid);
  if (!source) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }
  const status = cleanString(source.status).toUpperCase();
  if (!['QUEUED', 'PROVISIONING'].includes(status)) {
    throw new Error(`Workflow insertion is allowed only when run is QUEUED/PROVISIONING (current=${status})`);
  }
  const schemaVersion = cleanString(source.schemaVersion);
  if (!schemaVersion.startsWith('2.')) {
    throw new Error('Workflow insertion requires schemaVersion 2.x run');
  }

  const step = payload.step && typeof payload.step === 'object' ? payload.step : null;
  if (!step) throw new Error('payload.step is required');
  const currentWorkflow = Array.isArray(source.workflow) ? source.workflow : [];
  const afterStepId = cleanString(payload.afterStepId);
  const beforeStepId = cleanString(payload.beforeStepId);
  const indexRaw = Number(payload.index);

  const nextWorkflow = [...currentWorkflow];
  if (afterStepId) {
    const idx = nextWorkflow.findIndex((item) => cleanString(item?.id) === afterStepId);
    if (idx === -1) throw new Error(`afterStepId not found: ${afterStepId}`);
    nextWorkflow.splice(idx + 1, 0, step);
  } else if (beforeStepId) {
    const idx = nextWorkflow.findIndex((item) => cleanString(item?.id) === beforeStepId);
    if (idx === -1) throw new Error(`beforeStepId not found: ${beforeStepId}`);
    nextWorkflow.splice(idx, 0, step);
  } else if (Number.isFinite(indexRaw)) {
    const index = Math.max(0, Math.min(Math.floor(indexRaw), nextWorkflow.length));
    nextWorkflow.splice(index, 0, step);
  } else {
    nextWorkflow.push(step);
  }

  const normalizedWorkflow = workflowSchemaService.normalizeAndValidateWorkflow(nextWorkflow, {
    allowEmpty: false,
  });
  const ts = nowIso();
  const patch = {
    workflow: normalizedWorkflow,
    updatedAt: ts,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_runs').updateOne(
      { id: rid, userId: uid },
      { $set: patch }
    );
  } else {
    const index = memory.runs.findIndex((run) => run.id === rid && run.userId === uid);
    if (index === -1) throw new Error('Run not found');
    memory.runs[index] = { ...memory.runs[index], ...patch };
  }
  await publishRunEvents(uid, rid, [{
    eventType: 'RUN_STATUS',
    status: status,
    message: `Workflow updated with inserted step ${cleanString(step.id) || '(unnamed)'}`,
    payload: {
      action: 'insert_step',
      stepId: cleanString(step.id) || null,
      workflowSteps: normalizedWorkflow.length,
    },
  }]);

  const updated = await getRun(uid, rid);
  return updated;
}

async function registerDaemon(userId, payload) {
  await initStore();
  const uid = normalizeUserId(userId);
  const hostname = cleanString(payload?.hostname);
  if (!hostname) throw new Error('hostname is required');

  const now = nowIso();
  const concurrencyLimit = toInt(payload?.concurrencyLimit, 1, 1, 128);
  const docPatch = {
    userId: uid,
    hostname,
    status: cleanString(payload?.status).toUpperCase() || 'ONLINE',
    capacity: payload?.capacity && typeof payload.capacity === 'object' ? payload.capacity : {},
    labels: payload?.labels && typeof payload.labels === 'object' ? payload.labels : {},
    concurrencyLimit,
    heartbeatAt: now,
    updatedAt: now,
  };

  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_daemons').findOneAndUpdate(
      { userId: uid, hostname },
      {
        $set: docPatch,
        $setOnInsert: {
          id: newId('srv'),
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    const daemonDoc = unwrapFindOneAndUpdate(result);
    return daemonDoc ? daemonShape(daemonDoc) : null;
  }

  let item = memory.daemons.find((daemon) => daemon.userId === uid && daemon.hostname === hostname);
  if (!item) {
    item = { id: newId('srv'), createdAt: now };
    memory.daemons.push(item);
  }
  Object.assign(item, docPatch);
  return daemonShape(item);
}

async function heartbeatDaemon(userId, payload) {
  await initStore();
  const uid = normalizeUserId(userId);
  const serverId = cleanString(payload?.serverId);
  const hostname = cleanString(payload?.hostname);
  if (!serverId && !hostname) {
    throw new Error('serverId or hostname is required');
  }

  const now = nowIso();
  const patch = {
    status: cleanString(payload?.status).toUpperCase() || 'ONLINE',
    capacity: payload?.capacity && typeof payload.capacity === 'object' ? payload.capacity : {},
    heartbeatAt: now,
    updatedAt: now,
  };

  if (storeMode === 'mongodb') {
    const query = serverId ? { id: serverId, userId: uid } : { hostname, userId: uid };
    const result = await mongoDb.collection('researchops_daemons').findOneAndUpdate(
      query,
      { $set: patch },
      { returnDocument: 'after' }
    );
    const daemonDoc = unwrapFindOneAndUpdate(result);
    return daemonDoc ? daemonShape(daemonDoc) : null;
  }

  const item = memory.daemons.find((daemon) => daemon.userId === uid && (serverId ? daemon.id === serverId : daemon.hostname === hostname));
  if (!item) return null;
  Object.assign(item, patch);
  return daemonShape(item);
}

async function listDaemons(userId, { limit = 100 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const cap = toInt(limit, 100, 1, 500);

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_daemons')
      .find({ userId: uid })
      .sort({ heartbeatAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(daemonShape);
  }

  return memory.daemons
    .filter((doc) => doc.userId === uid)
    .sort((a, b) => String(b.heartbeatAt).localeCompare(String(a.heartbeatAt)))
    .slice(0, cap)
    .map(daemonShape);
}

async function reserveRunSequences(runId, count) {
  const n = toInt(count, 1, 1, 5000);
  if (storeMode === 'mongodb') {
    // Allocate a contiguous sequence range atomically for this run.
    // The counter stores the next sequence number to assign.
    const result = await mongoDb.collection('researchops_run_event_counters').findOneAndUpdate(
      { _id: runId },
      { $inc: { value: n } },
      {
        upsert: true,
        returnDocument: 'before',
      }
    );
    const doc = unwrapFindOneAndUpdate(result);
    const start = Number.isFinite(Number(doc?.value)) ? Number(doc.value) : 0;
    return Array.from({ length: n }, (_, idx) => start + idx);
  }

  const latest = memory.runEvents
    .filter((item) => item.runId === runId)
    .sort((a, b) => b.sequence - a.sequence)[0];
  const start = (latest?.sequence || -1) + 1;
  return Array.from({ length: n }, (_, idx) => start + idx);
}

async function publishRunEvents(userId, runId, events) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  if (!id) throw new Error('runId is required');
  if (!Array.isArray(events) || events.length === 0) return [];

  const run = await getRun(uid, id);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  const sequences = await reserveRunSequences(id, events.length);
  const docs = [];
  const created = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const eventType = cleanString(event?.eventType).toUpperCase();
    if (!RUN_EVENT_TYPES.has(eventType)) {
      throw new Error(`Invalid eventType: ${eventType}`);
    }
    const sequence = sequences[index];
    const doc = {
      id: newId('evt'),
      userId: uid,
      runId: id,
      sequence,
      eventType,
      status: cleanString(event?.status).toUpperCase() || null,
      message: typeof event?.message === 'string' ? event.message : null,
      progress: typeof event?.progress === 'number' ? event.progress : null,
      payload: event?.payload && typeof event.payload === 'object' ? event.payload : null,
      timestamp: nowIso(),
    };
    docs.push(doc);
    created.push(runEventShape(doc));
  }

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_run_events').insertMany(docs, { ordered: true });
  } else {
    memory.runEvents.push(...docs);
  }

  return created;
}

async function listRunEvents(userId, runId, { afterSequence = -1, limit = 200 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const id = cleanString(runId);
  if (!id) return { items: [], latestSequence: -1 };

  const run = await getRun(uid, id);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  const seq = Number.isFinite(Number(afterSequence)) ? Number(afterSequence) : -1;
  const cap = toInt(limit, 200, 1, 1000);

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_run_events')
      .find({ userId: uid, runId: id, sequence: { $gt: seq } })
      .sort({ sequence: 1 })
      .limit(cap)
      .toArray();
    const items = docs.map(runEventShape);
    return {
      items,
      latestSequence: items.length ? items[items.length - 1].sequence : seq,
    };
  }

  const items = memory.runEvents
    .filter((doc) => doc.userId === uid && doc.runId === id && doc.sequence > seq)
    .sort((a, b) => a.sequence - b.sequence)
    .slice(0, cap)
    .map(runEventShape);

  return {
    items,
    latestSequence: items.length ? items[items.length - 1].sequence : seq,
  };
}

function runStepShape(doc) {
  return {
    id: doc.id,
    runId: doc.runId,
    stepId: doc.stepId,
    moduleType: doc.moduleType || null,
    status: doc.status || null,
    order: Number.isFinite(Number(doc.order)) ? Number(doc.order) : null,
    message: doc.message || null,
    metrics: doc.metrics && typeof doc.metrics === 'object' ? doc.metrics : {},
    outputs: doc.outputs && typeof doc.outputs === 'object' ? doc.outputs : {},
    startedAt: doc.startedAt || null,
    endedAt: doc.endedAt || null,
    updatedAt: doc.updatedAt || null,
    createdAt: doc.createdAt || null,
  };
}

function runArtifactShape(doc) {
  return {
    id: doc.id,
    runId: doc.runId,
    stepId: doc.stepId || null,
    kind: doc.kind || 'artifact',
    title: doc.title || null,
    path: doc.path || null,
    mimeType: doc.mimeType || null,
    objectKey: doc.objectKey || null,
    objectUrl: doc.objectUrl || null,
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
    createdAt: doc.createdAt || null,
  };
}

function runCheckpointShape(doc) {
  return {
    id: doc.id,
    runId: doc.runId,
    stepId: doc.stepId || null,
    status: doc.status || 'PENDING',
    title: doc.title || null,
    message: doc.message || null,
    reasonCode: doc.reasonCode || null,
    requestedActions: Array.isArray(doc.requestedActions) ? doc.requestedActions : [],
    payload: doc.payload && typeof doc.payload === 'object' ? doc.payload : {},
    decision: doc.decision && typeof doc.decision === 'object' ? doc.decision : null,
    decidedAt: doc.decidedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function upsertRunStep(userId, runId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const stepId = cleanString(payload.stepId);
  if (!rid || !stepId) throw new Error('runId and stepId are required');

  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  const ts = nowIso();
  const patch = {
    moduleType: cleanString(payload.moduleType) || null,
    status: cleanString(payload.status).toUpperCase() || null,
    order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : null,
    message: typeof payload.message === 'string' ? payload.message : null,
    metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {},
    outputs: payload.outputs && typeof payload.outputs === 'object' ? payload.outputs : {},
    startedAt: payload.startedAt || null,
    endedAt: payload.endedAt || null,
    updatedAt: ts,
  };

  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_run_steps').findOneAndUpdate(
      { userId: uid, runId: rid, stepId },
      {
        $set: patch,
        $setOnInsert: {
          id: newId('step'),
          userId: uid,
          runId: rid,
          stepId,
          createdAt: ts,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );
    const doc = unwrapFindOneAndUpdate(result);
    return doc ? runStepShape(doc) : null;
  }

  const index = memory.runSteps.findIndex((item) => item.userId === uid && item.runId === rid && item.stepId === stepId);
  if (index === -1) {
    const doc = {
      id: newId('step'),
      userId: uid,
      runId: rid,
      stepId,
      createdAt: ts,
      ...patch,
    };
    memory.runSteps.push(doc);
    return runStepShape(doc);
  }
  memory.runSteps[index] = { ...memory.runSteps[index], ...patch };
  return runStepShape(memory.runSteps[index]);
}

async function listRunSteps(userId, runId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  if (!rid) return [];
  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  if (storeMode === 'mongodb') {
    const docs = await mongoDb.collection('researchops_run_steps')
      .find({ userId: uid, runId: rid })
      .sort({ order: 1, createdAt: 1 })
      .toArray();
    return docs.map(runStepShape);
  }

  return memory.runSteps
    .filter((item) => item.userId === uid && item.runId === rid)
    .sort((a, b) => {
      const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    })
    .map(runStepShape);
}

async function createRunArtifact(userId, runId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  if (!rid) throw new Error('runId is required');

  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  const ts = nowIso();
  const doc = {
    id: newId('art'),
    userId: uid,
    runId: rid,
    stepId: cleanString(payload.stepId) || null,
    kind: cleanString(payload.kind) || 'artifact',
    title: cleanString(payload.title) || null,
    path: cleanString(payload.path) || null,
    mimeType: cleanString(payload.mimeType) || null,
    objectKey: cleanString(payload.objectKey) || null,
    objectUrl: cleanString(payload.objectUrl) || null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    createdAt: ts,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_run_artifacts').insertOne(doc);
  } else {
    memory.runArtifacts.push(doc);
  }
  return runArtifactShape(doc);
}

async function listRunArtifacts(userId, runId, { kind = '', limit = 200 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const normalizedKind = cleanString(kind).toLowerCase();
  const cap = toInt(limit, 200, 1, 1000);
  if (!rid) return [];

  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  if (storeMode === 'mongodb') {
    const filter = { userId: uid, runId: rid };
    if (normalizedKind) filter.kind = normalizedKind;
    const docs = await mongoDb.collection('researchops_run_artifacts')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(runArtifactShape);
  }

  return memory.runArtifacts
    .filter((item) => item.userId === uid && item.runId === rid)
    .filter((item) => !normalizedKind || String(item.kind || '').toLowerCase() === normalizedKind)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, cap)
    .map(runArtifactShape);
}

async function getRunArtifact(userId, runId, artifactId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const aid = cleanString(artifactId);
  if (!rid || !aid) return null;

  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  if (storeMode === 'mongodb') {
    const doc = await mongoDb.collection('researchops_run_artifacts')
      .findOne({ userId: uid, runId: rid, id: aid });
    return doc ? runArtifactShape(doc) : null;
  }

  const found = memory.runArtifacts.find(
    (item) => item.userId === uid && item.runId === rid && item.id === aid
  );
  return found ? runArtifactShape(found) : null;
}

async function createRunCheckpoint(userId, runId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  if (!rid) throw new Error('runId is required');
  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  const ts = nowIso();
  const doc = {
    id: newId('chk'),
    userId: uid,
    runId: rid,
    stepId: cleanString(payload.stepId) || null,
    status: cleanString(payload.status).toUpperCase() || 'PENDING',
    title: cleanString(payload.title) || 'Approval required',
    message: cleanString(payload.message) || null,
    reasonCode: cleanString(payload.reasonCode) || null,
    requestedActions: Array.isArray(payload.requestedActions) ? payload.requestedActions : [],
    payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
    decision: payload.decision && typeof payload.decision === 'object' ? payload.decision : null,
    decidedAt: payload.decidedAt || null,
    createdAt: ts,
    updatedAt: ts,
  };

  if (storeMode === 'mongodb') {
    await mongoDb.collection('researchops_run_checkpoints').insertOne(doc);
  } else {
    memory.runCheckpoints.push(doc);
  }
  return runCheckpointShape(doc);
}

async function listRunCheckpoints(userId, runId, { status = '', limit = 200 } = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const normalizedStatus = cleanString(status).toUpperCase();
  const cap = toInt(limit, 200, 1, 1000);
  if (!rid) return [];

  const run = await getRun(uid, rid);
  if (!run) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    throw error;
  }

  if (storeMode === 'mongodb') {
    const filter = { userId: uid, runId: rid };
    if (normalizedStatus) filter.status = normalizedStatus;
    const docs = await mongoDb.collection('researchops_run_checkpoints')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(cap)
      .toArray();
    return docs.map(runCheckpointShape);
  }

  return memory.runCheckpoints
    .filter((item) => item.userId === uid && item.runId === rid)
    .filter((item) => !normalizedStatus || item.status === normalizedStatus)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, cap)
    .map(runCheckpointShape);
}

async function getRunCheckpoint(userId, runId, checkpointId) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const cid = cleanString(checkpointId);
  if (!rid || !cid) return null;
  const run = await getRun(uid, rid);
  if (!run) return null;

  if (storeMode === 'mongodb') {
    const doc = await mongoDb.collection('researchops_run_checkpoints').findOne({ userId: uid, runId: rid, id: cid });
    return doc ? runCheckpointShape(doc) : null;
  }
  const doc = memory.runCheckpoints.find((item) => item.userId === uid && item.runId === rid && item.id === cid);
  return doc ? runCheckpointShape(doc) : null;
}

async function decideRunCheckpoint(userId, runId, checkpointId, payload = {}) {
  await initStore();
  const uid = normalizeUserId(userId);
  const rid = cleanString(runId);
  const cid = cleanString(checkpointId);
  const decision = cleanString(payload.decision).toUpperCase();
  if (!rid || !cid) throw new Error('runId and checkpointId are required');
  if (!['APPROVED', 'REJECTED', 'EDIT', 'EDITED'].includes(decision)) {
    throw new Error('decision must be APPROVED, REJECTED, or EDIT');
  }
  const checkpointStatus = decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';

  const ts = nowIso();
  const decisionPayload = {
    decision: checkpointStatus,
    action: decision,
    note: cleanString(payload.note) || null,
    decidedBy: cleanString(payload.decidedBy) || uid,
    edits: payload.edits && typeof payload.edits === 'object' ? payload.edits : null,
    decidedAt: ts,
  };

  if (storeMode === 'mongodb') {
    const result = await mongoDb.collection('researchops_run_checkpoints').findOneAndUpdate(
      { userId: uid, runId: rid, id: cid },
      {
        $set: {
          status: checkpointStatus,
          decision: decisionPayload,
          decidedAt: ts,
          updatedAt: ts,
        },
      },
      { returnDocument: 'after' }
    );
    const doc = unwrapFindOneAndUpdate(result);
    return doc ? runCheckpointShape(doc) : null;
  }

  const index = memory.runCheckpoints.findIndex((item) => item.userId === uid && item.runId === rid && item.id === cid);
  if (index === -1) return null;
  memory.runCheckpoints[index] = {
    ...memory.runCheckpoints[index],
    status: checkpointStatus,
    decision: decisionPayload,
    decidedAt: ts,
    updatedAt: ts,
  };
  return runCheckpointShape(memory.runCheckpoints[index]);
}

function normalizeSkillId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `skill_${slug || 'unnamed'}`;
}

function getSkillCatalogKey(userId) {
  const uid = normalizeUserId(userId);
  return `${SKILLS_CATALOG_PREFIX}/${uid}/index.json`;
}

function getSkillObjectPrefix(skillId, version) {
  return `${SKILLS_OBJECT_PREFIX}/${skillId}/${version}`;
}

function getSkillFileContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') return 'text/markdown';
  if (ext === '.json') return 'application/json';
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.sh') return 'text/x-shellscript';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'application/javascript';
  if (ext === '.ts') return 'text/plain';
  if (ext === '.py') return 'text/x-python';
  return 'application/octet-stream';
}

function extractSkillDescription(markdown = '') {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('```')) continue;
    if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('>')) continue;
    return line.slice(0, 220);
  }
  return '';
}

function isMissingObjectError(error) {
  const name = String(error?.name || '');
  const code = String(error?.code || '');
  const statusCode = Number(error?.$metadata?.httpStatusCode || 0);
  return (
    name === 'NoSuchKey'
    || name === 'NotFound'
    || code === 'NoSuchKey'
    || code === 'NotFound'
    || statusCode === 404
  );
}

async function walkSkillFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === '.git' || entry.name === 'node_modules') continue;
    const absPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await walkSkillFiles(rootDir, absPath);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

function mapSkillSummary(raw = {}, sourceOverride = '') {
  const id = cleanString(raw.id) || normalizeSkillId(raw.name);
  const name = cleanString(raw.name) || id.replace(/^skill_/, '');
  return {
    id,
    name,
    version: cleanString(raw.version) || null,
    description: cleanString(raw.description) || null,
    standard: cleanString(raw.standard) || SKILL_OBJECT_STANDARD,
    schemaVersion: cleanString(raw.schemaVersion) || SKILL_OBJECT_SCHEMA_VERSION,
    entrypoint: cleanString(raw.entrypoint) || 'SKILL.md',
    manifestKey: cleanString(raw.manifestKey || raw.objectStorage?.manifestKey) || null,
    source: sourceOverride || cleanString(raw.source) || 'object-storage',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    updatedAt: raw.updatedAt || null,
  };
}

async function listLocalSkillSummaries() {
  try {
    const entries = await fs.readdir(SKILLS_ROOT_DIR, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_ROOT_DIR, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let skillMd = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        skillMd = await fs.readFile(skillMdPath, 'utf8');
      } catch (_) {
        // Skill standard requires SKILL.md entrypoint; skip non-skill folders.
        continue;
      }
      const stat = await fs.stat(skillMdPath).catch(() => null);
      items.push({
        id: normalizeSkillId(entry.name),
        name: entry.name,
        version: null,
        description: extractSkillDescription(skillMd) || null,
        standard: SKILL_OBJECT_STANDARD,
        schemaVersion: SKILL_OBJECT_SCHEMA_VERSION,
        entrypoint: 'SKILL.md',
        manifestKey: null,
        source: 'repo-skills-local',
        tags: [],
        updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
      });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return [];
  }
}

async function readRemoteSkillCatalog(userId) {
  const indexKey = getSkillCatalogKey(userId);
  try {
    const buffer = await s3Service.downloadBuffer(indexKey);
    const parsed = JSON.parse(buffer.toString('utf8'));
    const rawSkills = Array.isArray(parsed?.skills) ? parsed.skills : [];
    return {
      indexKey,
      updatedAt: parsed?.updatedAt || null,
      skills: rawSkills.map((item) => mapSkillSummary(item, 'object-storage')),
    };
  } catch (error) {
    if (isMissingObjectError(error)) {
      return { indexKey, updatedAt: null, skills: [] };
    }
    throw error;
  }
}

async function buildLocalSkillPackage(entry) {
  if (!entry?.isDirectory()) return null;
  const skillDir = path.join(SKILLS_ROOT_DIR, entry.name);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  let skillMdContent = '';
  try {
    skillMdContent = await fs.readFile(skillMdPath, 'utf8');
  } catch (_) {
    return null;
  }

  const absoluteFiles = await walkSkillFiles(skillDir);
  const fileRecords = [];
  for (const absPath of absoluteFiles) {
    const relativePath = path.relative(skillDir, absPath).split(path.sep).join('/');
    const buffer = await fs.readFile(absPath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    fileRecords.push({
      absPath,
      relativePath,
      buffer,
      sizeBytes: buffer.length,
      sha256,
      contentType: getSkillFileContentType(relativePath),
    });
  }
  fileRecords.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  if (fileRecords.length === 0) return null;

  const digestInput = fileRecords.map((item) => `${item.relativePath}:${item.sha256}`).join('\n');
  const version = crypto.createHash('sha256').update(digestInput).digest('hex').slice(0, 12);
  const skillId = normalizeSkillId(entry.name);
  const objectPrefix = getSkillObjectPrefix(skillId, version);
  const filesPrefix = `${objectPrefix}/files`;
  const manifestKey = `${objectPrefix}/skill.json`;
  const stat = await fs.stat(skillMdPath).catch(() => null);
  const updatedAt = stat ? new Date(stat.mtimeMs).toISOString() : nowIso();

  const files = fileRecords.map((item) => ({
    path: item.relativePath,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
    contentType: item.contentType,
    storageKey: `${filesPrefix}/${item.relativePath}`,
  }));

  const skillObject = {
    schemaVersion: SKILL_OBJECT_SCHEMA_VERSION,
    standard: SKILL_OBJECT_STANDARD,
    id: skillId,
    name: entry.name,
    version,
    description: extractSkillDescription(skillMdContent) || null,
    entrypoint: 'SKILL.md',
    compatibility: {
      agents: ['claude-code', 'codex'],
      format: 'SKILL.md',
    },
    source: 'object-storage',
    updatedAt,
    tags: [],
    fileCount: files.length,
    files,
    objectStorage: {
      manifestKey,
      filesPrefix,
    },
  };

  return {
    skillObject,
    uploads: fileRecords.map((item) => ({
      key: `${filesPrefix}/${item.relativePath}`,
      buffer: item.buffer,
      contentType: item.contentType,
    })),
    manifestKey,
  };
}

async function syncLocalSkillsToRemote(userId) {
  const uid = normalizeUserId(userId);
  const entries = await fs.readdir(SKILLS_ROOT_DIR, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const pack = await buildLocalSkillPackage(entry);
    if (pack) packages.push(pack);
  }

  const synced = [];
  for (const pack of packages) {
    for (const upload of pack.uploads) {
      // eslint-disable-next-line no-await-in-loop
      await s3Service.uploadBuffer(upload.buffer, upload.key, upload.contentType);
    }
    // eslint-disable-next-line no-await-in-loop
    await s3Service.uploadBuffer(
      Buffer.from(JSON.stringify(pack.skillObject, null, 2), 'utf8'),
      pack.manifestKey,
      'application/json'
    );
    synced.push(mapSkillSummary({
      ...pack.skillObject,
      manifestKey: pack.manifestKey,
    }, 'object-storage'));
  }

  const catalog = {
    schemaVersion: SKILL_OBJECT_SCHEMA_VERSION,
    standard: SKILL_CATALOG_STANDARD,
    ownerUserId: uid,
    updatedAt: nowIso(),
    skills: synced.map((skill) => ({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      standard: skill.standard,
      schemaVersion: skill.schemaVersion,
      entrypoint: skill.entrypoint,
      manifestKey: skill.manifestKey,
      tags: skill.tags,
      updatedAt: skill.updatedAt,
      source: 'object-storage',
    })),
  };

  const indexKey = getSkillCatalogKey(uid);
  await s3Service.uploadBuffer(
    Buffer.from(JSON.stringify(catalog, null, 2), 'utf8'),
    indexKey,
    'application/json'
  );

  return {
    indexKey,
    count: synced.length,
    updatedAt: catalog.updatedAt,
    items: synced,
  };
}

async function listSkills(userId = 'czk') {
  const uid = normalizeUserId(userId);
  const localItems = await listLocalSkillSummaries();
  try {
    const remoteCatalog = await readRemoteSkillCatalog(uid);
    const remoteItems = Array.isArray(remoteCatalog.skills) ? remoteCatalog.skills : [];
    if (remoteItems.length === 0) return localItems;

    const merged = [...remoteItems];
    const seen = new Set(remoteItems.map((item) => item.id));
    for (const local of localItems) {
      if (!seen.has(local.id)) {
        merged.push({ ...local, source: 'repo-skills-local-unsynced' });
      }
    }
    return merged;
  } catch (error) {
    console.error('[ResearchOps] Failed to read remote skills catalog:', error.message);
    return localItems;
  }
}

function getStoreMode() {
  return storeMode;
}

module.exports = {
  initStore,
  getStoreMode,
  listProjects,
  createProject,
  getProject,
  setProjectKnowledgeGroups,
  setProjectKnowledgeBaseFolder,
  updateProject,
  deleteProject,
  listProjectArtifactObjectKeys,
  listIdeas,
  createIdea,
  getIdea,
  updateIdea,
  enqueueRun,
  listRuns,
  getRun,
  updateRunStatus,
  listQueue,
  leaseNextRun,
  recoverStaleRuns,
  retryRun,
  insertRunWorkflowStep,
  registerDaemon,
  heartbeatDaemon,
  listDaemons,
  publishRunEvents,
  listRunEvents,
  upsertRunStep,
  listRunSteps,
  createRunArtifact,
  getRunArtifact,
  listRunArtifacts,
  createRunCheckpoint,
  listRunCheckpoints,
  getRunCheckpoint,
  decideRunCheckpoint,
  listSkills,
  syncLocalSkillsToRemote,
};
