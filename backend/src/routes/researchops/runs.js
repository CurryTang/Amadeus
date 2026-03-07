'use strict';

const express = require('express');
const router = express.Router();
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promises: fsPromises } = require('fs');
const { requireAuth } = require('../../middleware/auth');
const s3Service = require('../../services/s3.service');
const researchOpsStore = require('../../services/researchops/store');
const researchOpsRunner = require('../../services/researchops/runner');
const workflowSchemaService = require('../../services/researchops/workflow-schema.service');
const contextPackService = require('../../services/researchops/context-pack.service');
const treePlanService = require('../../services/researchops/tree-plan.service');
const treeStateService = require('../../services/researchops/tree-state.service');
const contextRouterService = require('../../services/researchops/context-router.service');
const { buildContextPackPayload } = require('../../services/researchops/context-pack-payload.service');
const { normalizeEnqueueRunPayload } = require('../../services/researchops/enqueue-run-payload.service');
const { buildRunListPayload, deriveResultSnippet } = require('../../services/researchops/run-list-payload.service');
const { buildRunPayload } = require('../../services/researchops/run-payload.service');
const { findRunReportHighlights } = require('../../services/researchops/run-report-view');
const { buildBridgeRunReportPayload } = require('../../services/researchops/bridge-run-report-payload.service');
const {
  buildBridgeNoteArtifactInput,
  buildBridgeNotePayload,
} = require('../../services/researchops/bridge-note-payload.service');
const { buildRunComparePayload } = require('../../services/researchops/run-compare-payload.service');
const {
  fetchRunBridgeReportViaDaemon,
  fetchRunContextPackViaDaemon,
  submitRunBridgeNoteViaDaemon,
} = require('../../services/researchops/bridge-daemon-rpc.service');
const {
  fetchRunBridgeReportViaRustDaemon,
  fetchRunContextPackViaRustDaemon,
  submitRunBridgeNoteViaRustDaemon,
} = require('../../services/researchops/rust-daemon-bridge.service');
const { dispatchBridgeTransport } = require('../../services/researchops/bridge-route-dispatch.service');
const { buildRunArtifactListPayload } = require('../../services/researchops/run-artifact-list-payload.service');
const {
  buildRunCheckpointDecisionPayload,
  buildRunCheckpointListPayload,
} = require('../../services/researchops/run-checkpoint-payload.service');
const { buildRunEventListPayload } = require('../../services/researchops/run-event-list-payload.service');
const { buildRunReportPayload } = require('../../services/researchops/run-report-payload.service');
const { buildRunObservabilityPayload } = require('../../services/researchops/run-observability-payload.service');
const {
  loadRunReportInlineData,
  loadRunReportResources,
} = require('../../services/researchops/run-report-resource.service');
const { buildRunStepListPayload } = require('../../services/researchops/run-step-list-payload.service');
const { buildQueueListPayload } = require('../../services/researchops/queue-payload.service');
const {
  buildRunDeletePayload,
  buildProjectRunClearPayload,
  buildRunEventMutationPayload,
} = require('../../services/researchops/run-mutation-payload.service');
const { buildHorizonCancelPayload } = require('../../services/researchops/horizon-payload.service');
const { buildHorizonStatusPayload } = require('../../services/researchops/horizon-status-payload.service');
const {
  buildSchedulerLeasePayload,
  buildSchedulerRecoveryPayload,
  buildSchedulerStatusPayload,
} = require('../../services/researchops/scheduler-payload.service');
const { buildRunnerRunningPayload } = require('../../services/researchops/runner-status-payload.service');
const { loadProjectBridgeRuntimeForRun } = require('../../services/researchops/project-bridge-runtime.service');
const { getDb } = require('../../db');
const {
  buildResearchOpsSshArgs,
  classifySshError,
} = require('../../services/ssh-auth.service');
const { assertProjectExecutionAllowed } = require('../../services/researchops/project-location.service');
const {
  parseLimit, parseOffset, parseBoolean, cleanString,
  getUserId, sanitizeError, withArtifactDownloadUrl, expandHome,
} = require('./shared');

// ---------------------------------------------------------------------------
// Helper functions (copied verbatim from monolith)
// ---------------------------------------------------------------------------

function runCommand(command, args = [], { timeoutMs = 15000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on('error', () => {
      // Ignore EPIPE if remote process exits before reading stdin.
    });
    child.stdin.end(input);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Command timeout after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr, code });
      return reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function toErrorPayload(error, fallback = 'Request failed') {
  const code = String(error?.code || '').trim();
  const message = sanitizeError(error, fallback);
  if (!code) {
    const mapped = classifySshError(error);
    if (mapped?.code) {
      if (mapped.code === 'SSH_COMMAND_FAILED') {
        const lower = String(message || '').toLowerCase();
        if (
          lower.includes('connection closed')
          || lower.includes('broken pipe')
          || lower.includes('kex_exchange_identification')
        ) {
          return { code: 'SSH_HOST_UNREACHABLE', error: message };
        }
      }
      return { code: mapped.code, error: mapped.message || message };
    }
    if (typeof message === 'string' && message.toLowerCase().includes('permission denied')) {
      return { code: 'SSH_AUTH_FAILED', error: message };
    }
    if (
      typeof message === 'string'
      && (
        message.toLowerCase().includes('connection refused')
        || message.toLowerCase().includes('no route to host')
        || message.toLowerCase().includes('network is unreachable')
      )
    ) {
      return { code: 'SSH_HOST_UNREACHABLE', error: message };
    }
    return { error: message };
  }
  return { code, error: message };
}

function buildSshArgs(server, { connectTimeout = 12 } = {}) {
  return buildResearchOpsSshArgs(server, { connectTimeout });
}

async function getSshServerById(serverId) {
  const sid = String(serverId || '').trim();
  if (!sid) return null;
  const db = getDb();
  let result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE id = ?`,
    args: [sid],
  });
  if (result.rows?.[0]) return result.rows[0];
  result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE name = ?`,
    args: [sid],
  });
  return result.rows?.[0] || null;
}

function normalizePosixPathForPolicy(inputPath = '') {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function isPathWithinBase(targetPath = '', basePath = '') {
  const target = normalizePosixPathForPolicy(targetPath);
  const base = normalizePosixPathForPolicy(basePath);
  if (!target || !base) return false;
  return target === base || target.startsWith(`${base}/`);
}

const CHATDSE_ENFORCED_HOST = 'compute.example.edu';
const CHATDSE_PROJECT_ROOT = '/egr/research-dselab/testuser';

function enforceSshProjectPathPolicy(server = null, projectPath = '') {
  const host = String(server?.host || '').trim().toLowerCase();
  if (host !== CHATDSE_ENFORCED_HOST) return;
  if (!isPathWithinBase(projectPath, CHATDSE_PROJECT_ROOT)) {
    throw new Error(`For ${CHATDSE_ENFORCED_HOST}, projectPath must be under ${CHATDSE_PROJECT_ROOT}`);
  }
}

async function resolveProjectContext(userId, projectId) {
  const project = await researchOpsStore.getProject(userId, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }
  if (project.locationType === 'client' && project.clientMode === 'browser') {
    assertProjectExecutionAllowed(project, 'run execution');
  }
  if (!project.projectPath && !project.kbFolderPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  if (project.locationType === 'ssh') {
    const server = await getSshServerById(project.serverId);
    if (!server) {
      const error = new Error(`SSH server ${project.serverId} not found`);
      error.code = 'SSH_SERVER_NOT_FOUND';
      throw error;
    }
    return { project, server };
  }

  return { project, server: null };
}

async function enforceExperimentProjectPathPolicy(userId, projectId, runType = '') {
  if (String(runType || '').trim().toUpperCase() !== 'EXPERIMENT') return;
  const { project, server } = await resolveProjectContext(userId, projectId);
  if (String(project.locationType || '').toLowerCase() !== 'ssh') return;
  enforceSshProjectPathPolicy(server, project.projectPath);
}

// Horizon helpers
function buildHorizonSshArgs(server, { connectTimeout = 12 } = {}) {
  return buildSshArgs(server, { connectTimeout });
}

async function getHorizonServer(serverId) {
  if (!serverId || ['local', 'local-default', 'self'].includes(String(serverId).trim())) return null;
  const db = getDb();
  let r = await db.execute({ sql: 'SELECT * FROM ssh_servers WHERE id = ?', args: [serverId] });
  if (r.rows?.length) return r.rows[0];
  r = await db.execute({ sql: 'SELECT * FROM ssh_servers WHERE name = ?', args: [serverId] });
  return r.rows?.[0] || null;
}

async function sshReadFile(server, remotePath) {
  const sshTarget = `${server.user}@${server.host}`;
  return runCommand('ssh', [
    ...buildHorizonSshArgs(server),
    sshTarget,
    `cat ${remotePath} 2>/dev/null || echo '{"status":"unknown"}'`,
  ], { timeoutMs: 15000 });
}

async function sshTailFile(server, remotePath, lines = 80) {
  const sshTarget = `${server.user}@${server.host}`;
  return runCommand('ssh', [
    ...buildHorizonSshArgs(server),
    sshTarget,
    `tail -${lines} ${remotePath} 2>/dev/null || echo ''`,
  ], { timeoutMs: 15000 });
}

async function sshCheckTmux(server, session) {
  const sshTarget = `${server.user}@${server.host}`;
  try {
    await runCommand('ssh', [
      ...buildHorizonSshArgs(server),
      sshTarget,
      `tmux has-session -t '${session}' 2>/dev/null && echo alive || echo dead`,
    ], { timeoutMs: 12000 });
    return true;
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Run lifecycle routes
// ---------------------------------------------------------------------------

router.post('/runs/enqueue-v2', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const runPayload = normalizeEnqueueRunPayload(
      body.run && typeof body.run === 'object' ? body.run : body
    );
    const projectId = String(runPayload.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const workflowInput = Array.isArray(runPayload.workflow) ? runPayload.workflow : [];
    const workflow = workflowSchemaService.normalizeAndValidateWorkflow(workflowInput, {
      allowEmpty: true,
    });
    const runType = String(runPayload.runType || 'AGENT').trim().toUpperCase() || 'AGENT';
    await enforceExperimentProjectPathPolicy(getUserId(req), projectId, runType);

    const serverId = String(runPayload.serverId || '').trim() || 'local-default';
    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId,
      runType,
      provider: String(runPayload.provider || 'codex_cli').trim() || 'codex_cli',
      schemaVersion: '2.0',
      mode: runPayload.mode,
      workflow,
      skillRefs: Array.isArray(runPayload.skillRefs) ? runPayload.skillRefs : [],
      contextRefs: runPayload.contextRefs && typeof runPayload.contextRefs === 'object'
        ? runPayload.contextRefs
        : {},
      outputContract: runPayload.outputContract && typeof runPayload.outputContract === 'object'
        ? runPayload.outputContract
        : {},
      budgets: runPayload.budgets && typeof runPayload.budgets === 'object'
        ? runPayload.budgets
        : {},
      hitlPolicy: runPayload.hitlPolicy && typeof runPayload.hitlPolicy === 'object'
        ? runPayload.hitlPolicy
        : {},
      metadata: runPayload.metadata,
    });

    // BUG-3 FIX: trigger immediate dispatch
    const userId = getUserId(req);
    setImmediate(() => {
      researchOpsRunner.leaseAndExecuteNext(userId, serverId, { allowUnregisteredServer: true })
        .catch((err) => console.error('[runs/enqueue-v2] immediate dispatch failed:', err.message));
    });

    return res.status(201).json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] enqueueRunV2 failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to enqueue v2 run') });
  }
});

router.post('/runs/enqueue', async (req, res) => {
  try {
    const payload = normalizeEnqueueRunPayload(req.body && typeof req.body === 'object' ? req.body : {});
    const runType = String(payload.runType || '').trim().toUpperCase();
    const projectId = String(payload.projectId || '').trim();
    if (projectId && runType) {
      await enforceExperimentProjectPathPolicy(getUserId(req), projectId, runType);
    }
    const run = await researchOpsStore.enqueueRun(getUserId(req), payload);
    res.status(201).json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] enqueueRun failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to enqueue run') });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 300);
    const cursor = String(req.query.cursor || '').trim();
    const page = await researchOpsStore.listRunsPage(getUserId(req), {
      projectId: String(req.query.projectId || '').trim(),
      status: String(req.query.status || '').trim().toUpperCase(),
      limit,
      cursor,
    });
    res.json(buildRunListPayload({ page, limit, cursor }));
  } catch (error) {
    console.error('[ResearchOps] listRuns failed:', error);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] getRun failed:', error);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

router.post('/runs/:runId/status', async (req, res) => {
  try {
    const run = await researchOpsStore.updateRunStatus(
      getUserId(req),
      req.params.runId,
      req.body?.status,
      req.body?.message,
      req.body?.payload
    );
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] updateRunStatus failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update run status') });
  }
});

router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const run = await researchOpsRunner.cancelRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] cancelRun failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to cancel run') });
  }
});

router.post('/runs/:runId/retry', async (req, res) => {
  try {
    const run = await researchOpsStore.retryRun(getUserId(req), req.params.runId, {
      reason: req.body?.reason,
    });
    return res.status(201).json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] retryRun failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to retry run') });
  }
});

router.delete('/runs/:runId', async (req, res) => {
  try {
    const result = await researchOpsStore.deleteRun(getUserId(req), req.params.runId);
    if (!result.deleted) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return res.status(status).json({ error: result.reason === 'active_run' ? 'Cannot delete an active run' : 'Run not found' });
    }
    return res.json(buildRunDeletePayload({
      runId: req.params.runId,
      deleted: true,
    }));
  } catch (error) {
    console.error('[ResearchOps] deleteRun failed:', error);
    res.status(500).json({ error: 'Failed to delete run' });
  }
});

router.delete('/projects/:projectId/runs', async (req, res) => {
  try {
    const status = req.query.status || '';
    const result = await researchOpsStore.clearProjectRuns(getUserId(req), req.params.projectId, {
      status,
    });
    return res.json(buildProjectRunClearPayload({
      projectId: req.params.projectId,
      status,
      result,
    }));
  } catch (error) {
    console.error('[ResearchOps] clearProjectRuns failed:', error);
    res.status(500).json({ error: 'Failed to clear run history' });
  }
});

// ---------------------------------------------------------------------------
// Workflow, events, steps, artifacts
// ---------------------------------------------------------------------------

router.post('/runs/:runId/workflow/insert', async (req, res) => {
  try {
    const run = await researchOpsStore.insertRunWorkflowStep(getUserId(req), req.params.runId, {
      step: req.body?.step,
      afterStepId: req.body?.afterStepId,
      beforeStepId: req.body?.beforeStepId,
      index: req.body?.index,
    });
    return res.json(buildRunPayload({ run }));
  } catch (error) {
    console.error('[ResearchOps] insertRunWorkflowStep failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to insert workflow step') });
  }
});

router.post('/runs/:runId/events', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!events.length) return res.status(400).json({ error: 'events must be a non-empty array' });
    const items = await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, events);
    return res.status(201).json(buildRunEventMutationPayload({
      runId: req.params.runId,
      result: { items },
    }));
  } catch (error) {
    console.error('[ResearchOps] publishRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to publish run events') });
  }
});

router.get('/runs/:runId/events', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const afterSequence = String(req.query.afterSequence || '').trim();
    const result = await researchOpsStore.listRunEvents(getUserId(req), req.params.runId, {
      afterSequence,
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json(buildRunEventListPayload({ runId, afterSequence, result }));
  } catch (error) {
    console.error('[ResearchOps] listRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run events') });
  }
});

router.get('/runs/:runId/steps', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const items = await researchOpsStore.listRunSteps(getUserId(req), req.params.runId);
    return res.json(buildRunStepListPayload({ runId, items }));
  } catch (error) {
    console.error('[ResearchOps] listRunSteps failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run steps') });
  }
});

router.get('/runs/:runId/artifacts', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const kind = String(req.query.kind || '').trim();
    const items = await researchOpsStore.listRunArtifacts(getUserId(req), req.params.runId, {
      kind,
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json(buildRunArtifactListPayload({
      runId,
      kind,
      items: items.map((item) => withArtifactDownloadUrl(item, runId)),
    }));
  } catch (error) {
    console.error('[ResearchOps] listRunArtifacts failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run artifacts') });
  }
});

// BUG-4 FIX: default behavior proxies download through backend (no redirect).
// Only redirect to presigned URL when ?redirect=true is explicitly set.
router.get('/runs/:runId/artifacts/:artifactId/download', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const artifactId = String(req.params.artifactId || '').trim();
    if (!runId || !artifactId) return res.status(400).json({ error: 'runId and artifactId are required' });

    const artifact = await researchOpsStore.getRunArtifact(userId, runId, artifactId);
    if (!artifact) return res.status(404).json({ error: 'Artifact not found' });

    const preferRedirect = parseBoolean(req.query.redirect, false) || parseBoolean(req.query.presign, false);
    if (artifact.objectKey) {
      if (preferRedirect) {
        try {
          const signedUrl = await s3Service.generatePresignedDownloadUrl(artifact.objectKey);
          return res.redirect(302, signedUrl);
        } catch (_) {
          // Fall through to proxied mode for browsers that cannot follow cross-origin presigned redirects.
        }
      }
      const buffer = await s3Service.downloadBuffer(artifact.objectKey);
      const filename = String(artifact.path || artifact.title || `${artifact.id}`).split('/').pop() || `${artifact.id}`;
      const mimeType = String(artifact.mimeType || 'application/octet-stream');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
      return res.send(buffer);
    }

    const inlineText = String(artifact.metadata?.inlinePreview || '');
    if (inlineText) {
      res.setHeader('Content-Type', String(artifact.mimeType || 'text/plain; charset=utf-8'));
      return res.send(inlineText);
    }
    return res.status(404).json({ error: 'No downloadable content for this artifact' });
  } catch (error) {
    console.error('[ResearchOps] downloadRunArtifact failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to download artifact') });
  }
});

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

router.get('/runs/:runId/checkpoints', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const limit = parseLimit(req.query.limit, 200, 1000);
    const items = await researchOpsStore.listRunCheckpoints(getUserId(req), req.params.runId, {
      status,
      limit,
    });
    return res.json(buildRunCheckpointListPayload({
      runId: req.params.runId,
      status,
      items,
    }));
  } catch (error) {
    console.error('[ResearchOps] listRunCheckpoints failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run checkpoints') });
  }
});

router.post('/runs/:runId/checkpoints/:checkpointId/decision', async (req, res) => {
  try {
    const requestedDecision = String(req.body?.decision || '').trim().toUpperCase();
    const normalizedDecision = requestedDecision === 'EDITED' ? 'EDIT' : requestedDecision;
    const checkpoint = await researchOpsStore.decideRunCheckpoint(
      getUserId(req),
      req.params.runId,
      req.params.checkpointId,
      {
        decision: normalizedDecision,
        note: req.body?.note,
        edits: req.body?.edits,
        decidedBy: getUserId(req),
      }
    );
    if (!checkpoint) return res.status(404).json({ error: 'Checkpoint not found' });

    await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, [{
      eventType: 'CHECKPOINT_DECIDED',
      status: checkpoint.status,
      message: `Checkpoint ${checkpoint.id} ${checkpoint.status.toLowerCase()}`,
      payload: {
        checkpointId: checkpoint.id,
        decision: checkpoint.decision || null,
      },
    }]);
    await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, [{
      eventType: 'REVIEW_ACTION',
      status: checkpoint.status,
      message: `Review action ${normalizedDecision || 'UNKNOWN'} for checkpoint ${checkpoint.id}`,
      payload: {
        checkpointId: checkpoint.id,
        action: normalizedDecision || null,
        note: req.body?.note || null,
        edits: req.body?.edits && typeof req.body.edits === 'object' ? req.body.edits : null,
        decidedBy: getUserId(req),
      },
    }]);

    if (checkpoint.status === 'REJECTED') {
      const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
      if (run?.status === 'RUNNING') {
        await researchOpsStore.updateRunStatus(
          getUserId(req),
          req.params.runId,
          'FAILED',
          `Checkpoint ${checkpoint.id} rejected`
        ).catch(() => {});
      }
    }

    return res.json(buildRunCheckpointDecisionPayload({
      runId: req.params.runId,
      checkpoint,
    }));
  } catch (error) {
    console.error('[ResearchOps] decideRunCheckpoint failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to decide checkpoint') });
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

router.get('/runs/:runId/report', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const { run, steps, artifacts, checkpoints } = await loadRunReportResources({
      userId,
      runId,
      store: researchOpsStore,
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const bridgeRuntime = await loadProjectBridgeRuntimeForRun({
      userId,
      run,
      store: researchOpsStore,
    });

    const { summaryText, manifest } = await loadRunReportInlineData({
      artifacts,
      includeInline: req.query.inline === 'true',
      downloadBuffer: (objectKey) => s3Service.downloadBuffer(objectKey),
    });

    return res.json(buildRunReportPayload({
      run,
      steps,
      artifacts,
      checkpoints,
      summaryText,
      manifest,
      bridgeRuntime,
      mapArtifact: (item) => withArtifactDownloadUrl(item, runId),
    }));
  } catch (error) {
    console.error('[ResearchOps] getRunReport failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch run report') });
  }
});

router.get('/runs/:runId/observability', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const { run, steps, artifacts, checkpoints } = await loadRunReportResources({
      userId,
      runId,
      store: researchOpsStore,
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const bridgeRuntime = await loadProjectBridgeRuntimeForRun({
      userId,
      run,
      store: researchOpsStore,
    });
    const { summaryText, manifest } = await loadRunReportInlineData({
      artifacts,
      includeInline: req.query.inline === 'true',
      downloadBuffer: (objectKey) => s3Service.downloadBuffer(objectKey),
    });
    const report = buildRunReportPayload({
      run,
      steps,
      artifacts,
      checkpoints,
      summaryText,
      manifest,
      bridgeRuntime,
      mapArtifact: (item) => withArtifactDownloadUrl(item, runId),
    });
    return res.json(buildRunObservabilityPayload({ report }));
  } catch (error) {
    console.error('[ResearchOps] getRunObservability failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch run observability') });
  }
});

router.get('/runs/:runId/bridge-report', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const { run, steps, artifacts, checkpoints } = await loadRunReportResources(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const bridgeRuntime = await loadProjectBridgeRuntimeForRun({
      userId,
      run,
      store: researchOpsStore,
    });
    const payload = await dispatchBridgeTransport({
      transport: req.query.transport,
      bridgeRuntime,
      viaDaemon: ({ serverId }) => fetchRunBridgeReportViaDaemon({
        userId,
        serverId,
        runId,
      }),
      viaRust: async () => fetchRunBridgeReportViaRustDaemon({
        runId,
      }),
      viaHttp: async () => {
        const report = buildRunReportPayload({
          run,
          steps,
          artifacts,
          checkpoints,
          summaryText: null,
          manifest: null,
          mapArtifact: (item) => withArtifactDownloadUrl(item, runId),
        });
        return buildBridgeRunReportPayload({ report, bridgeRuntime });
      },
    });
    return res.json(payload);
  } catch (error) {
    console.error('[ResearchOps] getBridgeRunReport failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch bridge run report') });
  }
});

router.get('/runs/:runId/compare', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const otherRunId = String(req.query.otherRunId || '').trim();
    if (!runId || !otherRunId) {
      return res.status(400).json({ error: 'runId and otherRunId are required' });
    }
    const [baseResources, otherResources] = await Promise.all([
      loadRunReportResources(userId, runId),
      loadRunReportResources(userId, otherRunId),
    ]);
    if (!baseResources.run || !otherResources.run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const baseReport = buildRunReportPayload({
      ...baseResources,
      summaryText: null,
      manifest: null,
      mapArtifact: (item) => withArtifactDownloadUrl(item, runId),
    });
    const otherReport = buildRunReportPayload({
      ...otherResources,
      summaryText: null,
      manifest: null,
      mapArtifact: (item) => withArtifactDownloadUrl(item, otherRunId),
    });
    return res.json(buildRunComparePayload({
      run: baseResources.run,
      otherRun: otherResources.run,
      report: baseReport,
      otherReport,
      requestedOtherRunId: otherRunId,
    }));
  } catch (error) {
    console.error('[ResearchOps] getRunCompare failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to compare runs') });
  }
});

router.post('/runs/:runId/bridge-note', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    if (!content.trim()) return res.status(400).json({ error: 'content is required' });
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const bridgeRuntime = await loadProjectBridgeRuntimeForRun({
      userId,
      run,
      store: researchOpsStore,
    });
    const payload = await dispatchBridgeTransport({
      transport: req.body?.transport,
      bridgeRuntime,
      viaDaemon: ({ serverId }) => submitRunBridgeNoteViaDaemon({
        userId,
        serverId,
        runId,
        title: req.body?.title,
        content,
        noteType: req.body?.noteType,
      }),
      viaRust: async () => submitRunBridgeNoteViaRustDaemon({
        runId,
        title: req.body?.title,
        content,
        noteType: req.body?.noteType,
      }),
      viaHttp: async () => {
        const artifact = await researchOpsStore.createRunArtifact(
          userId,
          runId,
          buildBridgeNoteArtifactInput({
            title: req.body?.title,
            content,
            noteType: req.body?.noteType,
          })
        );
        return buildBridgeNotePayload({
          runId,
          artifact: withArtifactDownloadUrl(artifact, runId),
        });
      },
    });
    return res.json(payload);
  } catch (error) {
    console.error('[ResearchOps] createBridgeNote failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create bridge note') });
  }
});

// ---------------------------------------------------------------------------
// Context pack (run-scoped)
// ---------------------------------------------------------------------------

router.post('/runs/:runId/context-pack/preview', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const run = await researchOpsStore.getRun(getUserId(req), runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const pack = await contextPackService.buildContextPack(getUserId(req), {
      runId: run.id,
      projectId: run.projectId,
      contextRefs: run.contextRefs || run.metadata?.contextRefs || req.body?.contextRefs || {},
      explicitAssetIds: req.body?.assetIds,
    });
    return res.json(buildContextPackPayload({ pack, mode: 'legacy' }));
  } catch (error) {
    console.error('[ResearchOps] preview context-pack failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to preview context pack') });
  }
});

router.get('/runs/:runId/context-pack', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    const userId = getUserId(req);
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const bridgeRuntime = await loadProjectBridgeRuntimeForRun({
      userId,
      run,
      store: researchOpsStore,
    });
    const payload = await dispatchBridgeTransport({
      transport: req.query.transport,
      bridgeRuntime,
      viaDaemon: ({ serverId }) => fetchRunContextPackViaDaemon({
        userId,
        serverId,
        runId,
      }),
      viaRust: async () => fetchRunContextPackViaRustDaemon({
        runId,
      }),
      viaHttp: async () => {
        const project = await researchOpsStore.getProject(userId, run.projectId);
        if (!project) {
          const error = new Error('Project not found');
          error.code = 'PROJECT_NOT_FOUND';
          throw error;
        }
        const nodeId = String(run?.metadata?.nodeId || run?.metadata?.treeNodeId || '').trim();
        let node = {
          id: nodeId || 'adhoc',
          title: 'Run context',
          kind: 'experiment',
          commands: [{ run: String(run?.metadata?.experimentCommand || '').trim() }],
          checks: [],
          assumption: [],
          target: [],
          git: { base: String(run?.metadata?.baseCommit || 'HEAD').trim() },
        };
        try {
          const { project: resolvedProject, server } = await resolveProjectContext(userId, run.projectId);
          const [{ plan }, { state }] = await Promise.all([
            treePlanService.readProjectPlan({ project: resolvedProject, server }),
            treeStateService.readProjectState({ project: resolvedProject, server }),
          ]);
          if (nodeId) {
            const planNode = (Array.isArray(plan?.nodes) ? plan.nodes : []).find((item) => String(item?.id || '').trim() === nodeId);
            if (planNode) node = planNode;
          }
          const runIntent = contextRouterService.buildRunIntent({
            project,
            node,
            state,
            run,
          });
          const routedContext = await contextRouterService.routeContextForIntent({
            userId,
            project,
            runIntent,
            store: researchOpsStore,
          });
          const pack = await contextPackService.buildRoutedContextPack(userId, {
            runId: run.id,
            projectId: project.id,
            runIntent,
            routedContext,
          });
          return buildContextPackPayload({ pack });
        } catch (innerError) {
          console.warn('[ResearchOps] routed context pack fallback to legacy builder:', innerError?.message || innerError);
          const pack = await contextPackService.buildContextPack(userId, {
            runId: run.id,
            projectId: project.id,
            contextRefs: run.contextRefs || run.metadata?.contextRefs || {},
          });
          return buildContextPackPayload({ pack, mode: 'legacy' });
        }
      },
    });
    return res.json(payload);
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    return res.status(400).json(toErrorPayload(error, 'Failed to build context pack'));
  }
});

// ---------------------------------------------------------------------------
// Scheduler routes
// ---------------------------------------------------------------------------

router.get('/scheduler/queue', async (req, res) => {
  try {
    const serverId = String(req.query.serverId || '').trim();
    const limit = parseLimit(req.query.limit, 100, 300);
    const items = await researchOpsStore.listQueue(getUserId(req), {
      serverId,
      limit,
    });
    res.json(buildQueueListPayload({
      items,
      serverId,
      limit,
    }));
  } catch (error) {
    console.error('[ResearchOps] listQueue failed:', error);
    res.status(500).json({ error: 'Failed to list queue' });
  }
});

router.post('/scheduler/lease-next', async (req, res) => {
  try {
    const serverId = String(req.body?.serverId || '').trim();
    const leased = await researchOpsStore.leaseNextRun(getUserId(req), {
      serverId,
    });
    return res.json(buildSchedulerLeasePayload({
      mode: 'lease-next',
      serverId,
      result: leased,
    }));
  } catch (error) {
    console.error('[ResearchOps] leaseNext failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease run') });
  }
});

router.post('/scheduler/lease-and-execute', async (req, res) => {
  try {
    const serverId = String(req.body?.serverId || '').trim() || 'local-default';
    const result = await researchOpsRunner.leaseAndExecuteNext(
      getUserId(req),
      serverId
    );
    return res.json(buildSchedulerLeasePayload({
      mode: 'lease-and-execute',
      serverId,
      result,
    }));
  } catch (error) {
    console.error('[ResearchOps] leaseAndExecute failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease and execute') });
  }
});

router.post('/scheduler/recover-stale', async (req, res) => {
  try {
    const minutesStale = req.body?.minutesStale;
    const serverId = String(req.body?.serverId || '').trim();
    const dryRun = req.body?.dryRun === true;
    const result = await researchOpsRunner.recoverStaleRuns(getUserId(req), {
      minutesStale,
      serverId,
      dryRun,
    });
    return res.json(buildSchedulerRecoveryPayload({
      minutesStale,
      serverId,
      dryRun,
      result,
    }));
  } catch (error) {
    console.error('[ResearchOps] recoverStale failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to recover stale runs') });
  }
});

router.get('/scheduler/dispatcher/status', (req, res) => {
  res.json(buildSchedulerStatusPayload({
    dispatcher: researchOpsRunner.getDispatcherState(),
    runner: {
      running: researchOpsRunner.getRunningState(),
    },
    refreshedAt: new Date().toISOString(),
  }));
});

router.get('/runner/running', (req, res) => {
  res.json(buildRunnerRunningPayload({
    items: researchOpsRunner.getRunningState(),
  }));
});

// ---------------------------------------------------------------------------
// Horizon routes
// ---------------------------------------------------------------------------

// GET /api/researchops/runs/:runId/horizon-status
// Returns current status from the watchdog status file + tmux alive check.
router.get('/runs/:runId/horizon-status', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const meta = run.metadata || {};
    const serverId = String(meta.horizonServerId || run.serverId || '').trim();
    const statusFile = String(meta.horizonStatusFile || `~/.researchops/horizon/${runId}.json`);
    const logFile = String(meta.horizonLogFile || `~/.researchops/horizon/${runId}.log`);
    const session = String(meta.horizonSessionName || `hz_${runId.slice(0, 10)}`);

    const server = await getHorizonServer(serverId);

    let statusJson = {};
    let recentLog = '';
    let tmuxAlive = null;

    if (server) {
      const [statusResult, logResult] = await Promise.allSettled([
        sshReadFile(server, statusFile),
        sshTailFile(server, logFile, 60),
      ]);
      if (statusResult.status === 'fulfilled') {
        try { statusJson = JSON.parse(statusResult.value.stdout.trim()); } catch (_) {}
      }
      if (logResult.status === 'fulfilled') {
        recentLog = logResult.value.stdout;
      }
      // check tmux alive (only if status isn't terminal)
      if (!['done', 'timeout'].includes(statusJson.status)) {
        tmuxAlive = await sshCheckTmux(server, session);
      }
    } else {
      // local
      try {
        const raw = await fsPromises.readFile(expandHome(statusFile), 'utf8');
        statusJson = JSON.parse(raw.trim());
      } catch (_) {}
      try {
        recentLog = await new Promise((resolve) => {
          execFile('tail', ['-60', expandHome(logFile)], (e, out) => resolve(out || ''));
        });
      } catch (_) {}
    }

    return res.json(buildHorizonStatusPayload({
      runId,
      status: statusJson.status || 'unknown',
      message: statusJson.message || '',
      lastCheck: statusJson.lastCheck || null,
      nextCheck: statusJson.nextCheck || null,
      wakeups: statusJson.wakeups || 0,
      tmuxAlive,
      recentLog: recentLog.slice(-4000),
      session,
      serverId,
    }));
  } catch (error) {
    console.error('[ResearchOps] horizon-status failed:', error);
    return res.status(500).json({ error: 'Failed to fetch horizon status' });
  }
});

// POST /api/researchops/runs/:runId/horizon-cancel
// Kills the tmux session on the target server.
router.post('/runs/:runId/horizon-cancel', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const meta = run.metadata || {};
    const serverId = String(meta.horizonServerId || run.serverId || '').trim();
    const session = String(meta.horizonSessionName || `hz_${runId.slice(0, 10)}`);
    const server = await getHorizonServer(serverId);

    if (server) {
      const sshTarget = `${server.user}@${server.host}`;
      await runCommand('ssh', [
        ...buildHorizonSshArgs(server),
        sshTarget,
        `tmux kill-session -t '${session}' 2>/dev/null; echo ok`,
      ], { timeoutMs: 15000 });
    } else {
      try {
        await new Promise((resolve) => {
          execFile('tmux', ['kill-session', '-t', session], () => resolve());
        });
      } catch (_) {}
    }

    return res.json(buildHorizonCancelPayload({
      runId,
      session,
      message: `Killed tmux session '${session}'`,
    }));
  } catch (error) {
    console.error('[ResearchOps] horizon-cancel failed:', error);
    return res.status(500).json({ error: 'Failed to cancel horizon session' });
  }
});

router.deriveResultSnippet = deriveResultSnippet;
router.findRunReportHighlights = findRunReportHighlights;

module.exports = router;
