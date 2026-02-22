const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');
const config = require('../../config');

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
const RUN_EVENT_TYPES = new Set(['RUN_STATUS', 'LOG_LINE', 'PROGRESS', 'TOOL_CALL', 'RESULT_SUMMARY']);

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
    projectId: doc.projectId,
    serverId: doc.serverId,
    runType: doc.runType,
    provider: doc.provider || null,
    status: doc.status,
    metadata: doc.metadata || {},
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

async function createProject(userId, { name, description }) {
  await initStore();
  const uid = normalizeUserId(userId);
  const normalizedName = cleanString(name);
  if (!normalizedName) throw new Error('Project name is required');

  const ts = nowIso();
  const doc = {
    id: newId('proj'),
    userId: uid,
    name: normalizedName,
    description: cleanString(description) || null,
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

async function enqueueRun(userId, payload) {
  await initStore();
  const uid = normalizeUserId(userId);
  const projectId = cleanString(payload?.projectId);
  const runType = cleanString(payload?.runType).toUpperCase();
  const serverId = cleanString(payload?.serverId) || 'local-default';
  const provider = cleanString(payload?.provider) || null;
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  if (!projectId || !runType) {
    throw new Error('projectId and runType are required');
  }
  if (!['AGENT', 'EXPERIMENT'].includes(runType)) {
    throw new Error('runType must be AGENT or EXPERIMENT');
  }

  const project = await getProject(uid, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  const ts = nowIso();
  const doc = {
    id: newId('run'),
    userId: uid,
    projectId,
    serverId,
    runType,
    provider,
    status: 'QUEUED',
    metadata,
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

async function listSkills() {
  const rootDir = path.join(__dirname, '..', '..', '..', '..', 'skills');
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: `skill_${entry.name}`,
        name: entry.name,
        source: 'repo-skills',
      }));
  } catch (_) {
    return [];
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
  listIdeas,
  createIdea,
  getIdea,
  enqueueRun,
  listRuns,
  getRun,
  updateRunStatus,
  listQueue,
  leaseNextRun,
  recoverStaleRuns,
  registerDaemon,
  heartbeatDaemon,
  listDaemons,
  publishRunEvents,
  listRunEvents,
  listSkills,
};
