'use strict';

const researchOpsStore = require('./store');

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'PROVISIONING', 'RUNNING']);
const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

function cleanString(value) {
  return String(value || '').trim();
}

function truncate(text = '', max = 12000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[truncated ${value.length - max} chars]`;
}

function normalizeProvider(provider = '') {
  const normalized = cleanString(provider).toLowerCase();
  if (normalized === 'claude_code_cli') return 'claude_code_cli';
  return 'codex_cli';
}

function normalizeReasoningEffort(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) return normalized;
  return 'high';
}

function statusLabel(status = '') {
  const normalized = cleanString(status).toUpperCase();
  if (!normalized) return 'UNKNOWN';
  return normalized;
}

async function composeRunResultMessage(userId, run = null) {
  if (!run || !run.id) return 'Run finished, but no run details were found.';

  const runStatus = statusLabel(run.status);
  const header = `Run ${run.id} finished with status: ${runStatus}.`;
  const artifacts = await researchOpsStore.listRunArtifacts(userId, run.id, { limit: 300 }).catch(() => []);
  const summaryArtifact = artifacts.find((item) => (
    cleanString(item?.kind).toLowerCase() === 'run_summary_md'
    && typeof item?.metadata?.inlinePreview === 'string'
    && item.metadata.inlinePreview.trim()
  ));
  if (summaryArtifact?.metadata?.inlinePreview) {
    return `${header}\n\n${truncate(summaryArtifact.metadata.inlinePreview, 14000)}`;
  }

  const agentOutputArtifact = artifacts.find((item) => (
    cleanString(item?.kind).toLowerCase() === 'agent-output'
    && typeof item?.metadata?.inlinePreview === 'string'
    && item.metadata.inlinePreview.trim()
  ));
  if (agentOutputArtifact?.metadata?.inlinePreview) {
    return `${header}\n\n${truncate(agentOutputArtifact.metadata.inlinePreview, 14000)}`;
  }

  const steps = await researchOpsStore.listRunSteps(userId, run.id).catch(() => []);
  const latestAgentStep = [...steps].reverse().find((item) => cleanString(item?.moduleType).toLowerCase() === 'agent.run');
  const stdoutTail = cleanString(latestAgentStep?.outputs?.stdoutTail);
  const stderrTail = cleanString(latestAgentStep?.outputs?.stderrTail);
  if (stdoutTail) return `${header}\n\n${truncate(stdoutTail, 12000)}`;
  if (stderrTail) return `${header}\n\nstderr:\n${truncate(stderrTail, 12000)}`;

  const fallbackMessage = cleanString(run.lastMessage);
  return fallbackMessage
    ? `${header}\n\n${truncate(fallbackMessage, 6000)}`
    : header;
}

function attachmentPromptLines(attachments = []) {
  const lines = [];
  for (const attachment of attachments) {
    const mimeType = cleanString(attachment?.mimeType);
    const filename = cleanString(attachment?.filename) || 'image';
    const objectUrl = cleanString(attachment?.objectUrl);
    const note = cleanString(attachment?.note);
    const sizeBytes = Number.isFinite(Number(attachment?.sizeBytes)) ? Number(attachment.sizeBytes) : null;
    const sizeLabel = sizeBytes !== null ? `${sizeBytes} bytes` : '';
    const descriptor = [mimeType, sizeLabel].filter(Boolean).join(', ');
    if (objectUrl) {
      lines.push(`- ${filename}${descriptor ? ` (${descriptor})` : ''}: ${objectUrl}`);
    } else {
      lines.push(`- ${filename}${descriptor ? ` (${descriptor})` : ''}`);
    }
    if (note) lines.push(`  note: ${note}`);
  }
  return lines;
}

function buildSessionPrompt({
  project = null,
  messages = [],
  latestUserMessage = null,
}) {
  const projectPath = cleanString(project?.projectPath);
  const transcript = [];
  const sourceMessages = Array.isArray(messages) ? messages.slice(-20) : [];
  for (const message of sourceMessages) {
    const role = cleanString(message?.role || 'user').toUpperCase();
    const createdAt = cleanString(message?.createdAt);
    const content = truncate(String(message?.content || ''), 2000);
    const entry = [`[${role}]${createdAt ? ` (${createdAt})` : ''}`];
    if (content) entry.push(content);
    const attachmentLines = attachmentPromptLines(message?.attachments);
    if (attachmentLines.length > 0) {
      entry.push('Attachments:');
      entry.push(...attachmentLines);
    }
    transcript.push(entry.join('\n'));
  }

  const latestContent = truncate(String(latestUserMessage?.content || ''), 6000);
  const latestAttachmentLines = attachmentPromptLines(latestUserMessage?.attachments);

  const parts = [
    'You are an interactive coding + bash agent running in headless mode for this project.',
    'Use terminal commands and code edits to complete the user request directly in the repository.',
    'At the end, provide a concise execution summary with: what changed, what commands/tests ran, and final status.',
    projectPath ? `Project path: ${projectPath}` : '',
    '',
    'Conversation context (latest first matters most):',
    transcript.length > 0 ? transcript.join('\n\n') : '(no previous messages)',
    '',
    'Current user request:',
    latestContent || '(empty)',
  ];

  if (latestAttachmentLines.length > 0) {
    parts.push('');
    parts.push('Current request attachments:');
    parts.push(...latestAttachmentLines);
  }

  return parts.filter(Boolean).join('\n');
}

async function syncSessionState(userId, sessionId) {
  const session = await researchOpsStore.getAgentSession(userId, sessionId);
  if (!session) return null;
  const activeRunId = cleanString(session.activeRunId);
  if (!activeRunId) return session;

  const run = await researchOpsStore.getRun(userId, activeRunId);
  if (!run) {
    const updated = await researchOpsStore.updateAgentSession(userId, session.id, {
      status: 'FAILED',
      activeRunId: null,
      lastRunId: activeRunId,
      lastRunStatus: 'FAILED',
      lastMessage: `Run ${activeRunId} was not found during sync.`,
    });
    return updated || session;
  }

  const runStatus = statusLabel(run.status);
  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    if (session.status !== 'RUNNING' || session.lastRunStatus !== runStatus) {
      const updated = await researchOpsStore.updateAgentSession(userId, session.id, {
        status: 'RUNNING',
        activeRunId: run.id,
        lastRunId: run.id,
        lastRunStatus: runStatus,
      });
      return updated || session;
    }
    return session;
  }

  if (!TERMINAL_RUN_STATUSES.has(runStatus)) {
    return session;
  }

  const existingAssistantMessage = await researchOpsStore.findAgentSessionMessageByRun(
    userId,
    session.id,
    run.id,
    { role: 'assistant' }
  );
  if (!existingAssistantMessage) {
    const resultContent = await composeRunResultMessage(userId, run);
    await researchOpsStore.createAgentSessionMessage(userId, session.id, {
      role: 'assistant',
      runId: run.id,
      status: runStatus,
      content: resultContent,
      metadata: {
        source: 'interactive-agent-run-complete',
      },
    });
  }

  const updated = await researchOpsStore.updateAgentSession(userId, session.id, {
    status: runStatus === 'SUCCEEDED' ? 'IDLE' : 'FAILED',
    activeRunId: null,
    lastRunId: run.id,
    lastRunStatus: runStatus,
    lastMessage: cleanString(run.lastMessage) || `Run ${run.id} ${runStatus}`,
  });
  return updated || session;
}

async function createSession(userId, projectId, payload = {}) {
  const session = await researchOpsStore.createAgentSession(userId, {
    projectId,
    title: payload.title,
    provider: payload.provider,
    model: payload.model,
    reasoningEffort: payload.reasoningEffort,
    serverId: payload.serverId,
    metadata: {
      source: 'interactive-agent-bash',
    },
  });
  await researchOpsStore.createAgentSessionMessage(userId, session.id, {
    role: 'system',
    content: 'Interactive agent session created. Send a prompt to start a headless coding run.',
    metadata: { type: 'session-created' },
  });
  return researchOpsStore.getAgentSession(userId, session.id);
}

async function listProjectSessions(userId, projectId, { limit = 80 } = {}) {
  const sessions = await researchOpsStore.listAgentSessions(userId, { projectId, limit });
  const updated = [];
  for (const session of sessions) {
    // eslint-disable-next-line no-await-in-loop
    const synced = await syncSessionState(userId, session.id);
    updated.push(synced || session);
  }
  return updated.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function getSession(userId, sessionId) {
  const session = await syncSessionState(userId, sessionId);
  if (!session) return null;
  const activeRunId = cleanString(session.activeRunId);
  const activeRun = activeRunId ? await researchOpsStore.getRun(userId, activeRunId) : null;
  return { session, activeRun };
}

async function listSessionMessages(userId, sessionId, { afterSequence = -1, limit = 300 } = {}) {
  await syncSessionState(userId, sessionId);
  return researchOpsStore.listAgentSessionMessages(userId, sessionId, {
    afterSequence,
    limit,
  });
}

async function sendUserMessage(userId, sessionId, payload = {}) {
  let session = await syncSessionState(userId, sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.code = 'SESSION_NOT_FOUND';
    throw error;
  }

  if (cleanString(session.activeRunId) || cleanString(session.status).toUpperCase() === 'RUNNING') {
    throw new Error('Session is already running. Wait for the current run to finish.');
  }

  const project = await researchOpsStore.getProject(userId, session.projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  const content = typeof payload.content === 'string' ? payload.content : '';
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (!content.trim() && attachments.length === 0) {
    throw new Error('Message content or attachments are required');
  }

  const userMessage = await researchOpsStore.createAgentSessionMessage(userId, session.id, {
    role: 'user',
    content,
    attachments,
    metadata: {
      source: 'interactive-agent-ui',
    },
  });

  const history = await researchOpsStore.listAgentSessionMessages(userId, session.id, {
    afterSequence: -1,
    limit: 200,
  });
  const latestUserMessage = history.items.find((item) => item.id === userMessage.id) || userMessage;
  const prompt = buildSessionPrompt({
    project,
    messages: history.items,
    latestUserMessage,
  });

  const requestedProvider = normalizeProvider(payload.provider || session.provider);
  const requestedModel = cleanString(payload.model || session.model);
  const requestedServerId = cleanString(payload.serverId || session.serverId || project.serverId) || 'local-default';
  const requestedReasoning = requestedProvider === 'codex_cli'
    ? normalizeReasoningEffort(payload.reasoningEffort || session.reasoningEffort)
    : null;
  const cwd = cleanString(project.projectPath);

  const run = await researchOpsStore.enqueueRun(userId, {
    projectId: project.id,
    serverId: requestedServerId,
    runType: 'AGENT',
    provider: requestedProvider,
    schemaVersion: '2.0',
    mode: 'headless',
    workflow: [
      {
        id: 'agent_main',
        type: 'agent.run',
        inputs: {
          prompt,
          provider: requestedProvider,
          ...(requestedModel ? { model: requestedModel } : {}),
          ...(requestedProvider === 'codex_cli' && requestedReasoning ? { reasoningEffort: requestedReasoning } : {}),
        },
      },
      {
        id: 'report',
        type: 'report.render',
        inputs: { format: 'md+json' },
      },
    ],
    contextRefs: { knowledgeGroupIds: project.knowledgeGroupIds || [] },
    metadata: {
      prompt: content.trim() || '(attachment-only message)',
      agentSkill: 'interactive-bash',
      interactiveAgentSessionId: session.id,
      interactiveAgentMessageId: userMessage.id,
      interactiveMode: true,
      ...(cwd ? { cwd } : {}),
      attachments: attachments.map((item) => ({
        kind: cleanString(item?.kind) || 'image',
        filename: cleanString(item?.filename) || null,
        mimeType: cleanString(item?.mimeType) || null,
        objectUrl: cleanString(item?.objectUrl) || null,
      })),
    },
  });

  session = await researchOpsStore.updateAgentSession(userId, session.id, {
    status: 'RUNNING',
    provider: requestedProvider,
    model: requestedModel || null,
    reasoningEffort: requestedProvider === 'codex_cli' ? requestedReasoning : null,
    serverId: requestedServerId,
    activeRunId: run.id,
    lastRunId: run.id,
    lastRunStatus: run.status,
    lastMessage: content.trim().slice(0, 300) || '(attachment message)',
  });

  return {
    session,
    run,
    userMessage,
  };
}

module.exports = {
  createSession,
  listProjectSessions,
  getSession,
  listSessionMessages,
  sendUserMessage,
  syncSessionState,
};
