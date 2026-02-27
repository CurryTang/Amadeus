'use strict';

/**
 * AutopilotService — fully automatic vibe research loop.
 *
 * Given a proposal (and optional max iterations), the loop runs:
 *   design task → enqueue implement run → (enqueue bash run) → analyze results → repeat
 *
 * Stops when:
 *   - The analyze step declares goal_achieved: true
 *   - currentIteration >= maxIterations
 *   - The session is manually stopped via stopSession()
 *   - An unrecoverable error occurs
 */

const crypto = require('crypto');
const codexCliService = require('../codex-cli.service');
const geminiCliService = require('../gemini-cli.service');
const llmService = require('../llm.service');
const researchOpsStore = require('./store');

const DESIGN_TIMEOUT_MS = 90_000;
const ANALYZE_TIMEOUT_MS = 90_000;
const RUN_POLL_INTERVAL_MS = 5_000;
const RUN_MAX_WAIT_MS = 30 * 60_000; // 30 min per run

/** @type {Map<string, AutopilotSession>} */
const sessions = new Map();

function newId() {
  return `ap_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run LLM text generation with codex → gemini → llm fallback. */
async function callLlm(content, prompt, timeoutMs = 90_000) {
  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('LLM timeout')), timeoutMs)),
  ]);

  if (await codexCliService.isAvailable()) {
    const r = await withTimeout(codexCliService.readMarkdown(content, prompt, { timeout: timeoutMs }));
    return String(r?.text || '').trim();
  }
  if (await geminiCliService.isAvailable()) {
    const r = await withTimeout(geminiCliService.readMarkdown(content, prompt, { timeout: timeoutMs }));
    return String(r?.text || '').trim();
  }
  const r = await withTimeout(llmService.generateWithFallback(content, prompt));
  return String(r?.text || '').trim();
}

/** Parse JSON object from potentially noisy model output. */
function parseJsonObject(text) {
  const src = String(text || '').trim();
  // Strip markdown code fences
  const stripped = src.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    const val = JSON.parse(stripped);
    if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  } catch {
    // try to extract first {...} block
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const val = JSON.parse(m[0]);
        if (val && typeof val === 'object') return val;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * Design the next task given the proposal and iteration history.
 * @returns {{ task_title, task_description, implementation_prompt, test_command, goal_achieved, reason }}
 */
async function designNextTask(proposal, history, iteration, maxIterations) {
  const historySummary = history.length > 0
    ? history.map((h, i) => `Iteration ${i + 1}: ${h.task} — ${h.summary}`).join('\n')
    : 'No iterations completed yet.';

  const content = [
    `Proposal:\n${proposal}`,
    `\nCompleted work:\n${historySummary}`,
    `\nCurrent iteration: ${iteration} of ${maxIterations}`,
  ].join('\n');

  const prompt = [
    'You are a research project planner. Based on the proposal and progress, design the NEXT concrete implementation task.',
    'Return ONLY a JSON object (no markdown, no explanation):',
    '{',
    '  "task_title": "Short title (<= 80 chars)",',
    '  "task_description": "What needs to be done and why",',
    '  "implementation_prompt": "Detailed prompt for an AI coding agent to implement this task. Include file paths, expected outputs, and success criteria.",',
    '  "test_command": "bash command to run/test the result (empty string if not applicable)",',
    '  "goal_achieved": false,',
    '  "reason": "Why this is the right next step"',
    '}',
    'If the proposal goal is already achieved based on completed work, set goal_achieved to true and leave other fields empty.',
  ].join('\n');

  const raw = await callLlm(content, prompt, DESIGN_TIMEOUT_MS);
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      task_title: `Iteration ${iteration} task`,
      task_description: `Continue working on: ${proposal.slice(0, 200)}`,
      implementation_prompt: `Continue implementing the research goal.\n\nProposal: ${proposal}`,
      test_command: '',
      goal_achieved: false,
      reason: 'Auto-generated fallback task',
    };
  }
  return {
    task_title: String(parsed.task_title || `Iteration ${iteration} task`).trim(),
    task_description: String(parsed.task_description || '').trim(),
    implementation_prompt: String(parsed.implementation_prompt || parsed.task_description || '').trim(),
    test_command: String(parsed.test_command || '').trim(),
    goal_achieved: parsed.goal_achieved === true,
    reason: String(parsed.reason || '').trim(),
  };
}

/**
 * Analyze iteration results and determine goal status.
 * @returns {{ summary, goal_achieved, next_suggestion }}
 */
async function analyzeIteration(proposal, task, runStatus, bashOutput) {
  const runSummary = runStatus === 'SUCCEEDED'
    ? 'Run completed successfully.'
    : `Run ended with status: ${runStatus}.`;

  const content = [
    `Proposal: ${proposal}`,
    `\nTask: ${task.task_title} — ${task.task_description}`,
    `\nImplementation result: ${runSummary}`,
    bashOutput ? `\nTest/bash output:\n${String(bashOutput).slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n');

  const prompt = [
    'You are a research progress analyzer. Review the implementation results.',
    'Return ONLY a JSON object (no markdown, no explanation):',
    '{',
    '  "summary": "1-2 sentence summary of what was accomplished",',
    '  "goal_achieved": false,',
    '  "next_suggestion": "What should be done in the next iteration"',
    '}',
    'Set goal_achieved to true only if the proposal goal is fully satisfied by the completed work.',
  ].join('\n');

  const raw = await callLlm(content, prompt, ANALYZE_TIMEOUT_MS);
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      summary: `Iteration completed. Run status: ${runStatus}.`,
      goal_achieved: false,
      next_suggestion: 'Continue working on the proposal.',
    };
  }
  return {
    summary: String(parsed.summary || `Iteration completed. Run status: ${runStatus}.`).trim(),
    goal_achieved: parsed.goal_achieved === true,
    next_suggestion: String(parsed.next_suggestion || '').trim(),
  };
}

/**
 * Poll until the run reaches a terminal state.
 * @returns {Promise<{status: string}>}
 */
async function waitForRun(userId, runId, stopRef) {
  const deadline = Date.now() + RUN_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (stopRef.stop) throw new Error('Autopilot stopped by user');
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) return run;
    await sleep(RUN_POLL_INTERVAL_MS);
  }
  throw new Error(`Run ${runId} exceeded maximum wait time`);
}

/**
 * Enqueue an AGENT run for a single iteration's implementation step.
 */
async function enqueueImplementRun(userId, projectId, task, serverId, skill) {
  return researchOpsStore.enqueueRun(userId, {
    projectId,
    runType: 'AGENT',
    serverId,
    schemaVersion: '2.0',
    mode: 'headless',
    workflow: [{
      id: `impl_step`,
      type: 'agent.run',
      inputs: {
        prompt: task.implementation_prompt || task.task_description,
        skill: skill || 'implement',
      },
    }],
    metadata: {
      autopilot: true,
      taskTitle: task.task_title,
    },
  });
}

/**
 * Enqueue a BASH run for testing/experiments.
 */
async function enqueueBashRun(userId, projectId, command, serverId) {
  return researchOpsStore.enqueueRun(userId, {
    projectId,
    runType: 'EXPERIMENT',
    serverId,
    schemaVersion: '2.0',
    mode: 'headless',
    workflow: [{
      id: `bash_step`,
      type: 'bash.run',
      inputs: { command },
    }],
    metadata: { autopilot: true },
  });
}

/**
 * The main autopilot loop. Runs in the background.
 */
async function runAutopilotLoop(session) {
  const { userId, projectId, proposal, maxIterations, serverId, skill } = session;
  const stopRef = { stop: false };
  session._stopRef = stopRef;

  try {
    while (session.currentIteration < maxIterations && !stopRef.stop) {
      session.currentIteration += 1;
      session.currentPhase = 'designing';
      session.updatedAt = new Date().toISOString();

      // --- Design ---
      let task;
      try {
        task = await designNextTask(proposal, session.history, session.currentIteration, maxIterations);
      } catch (err) {
        session.log.push(`[iter ${session.currentIteration}] Design failed: ${err.message}`);
        break;
      }

      if (task.goal_achieved) {
        session.goalAchieved = true;
        session.log.push(`[iter ${session.currentIteration}] Goal achieved (design phase)`);
        break;
      }

      session.log.push(`[iter ${session.currentIteration}] Task: ${task.task_title}`);
      session.currentTask = task.task_title;

      // --- Implement ---
      session.currentPhase = 'implementing';
      session.updatedAt = new Date().toISOString();
      let implRun;
      try {
        implRun = await enqueueImplementRun(userId, projectId, task, serverId, skill);
        session.currentRunId = implRun.id;
        session.log.push(`[iter ${session.currentIteration}] Enqueued implement run ${implRun.id}`);
      } catch (err) {
        session.log.push(`[iter ${session.currentIteration}] Failed to enqueue run: ${err.message}`);
        break;
      }

      let implResult;
      try {
        implResult = await waitForRun(userId, implRun.id, stopRef);
      } catch (err) {
        if (stopRef.stop) break;
        session.log.push(`[iter ${session.currentIteration}] Run wait failed: ${err.message}`);
        implResult = { status: 'FAILED' };
      }
      if (stopRef.stop) break;

      // --- Bash (optional) ---
      let bashOutput = '';
      if (task.test_command && implResult.status === 'SUCCEEDED') {
        session.currentPhase = 'running';
        session.updatedAt = new Date().toISOString();
        try {
          const bashRun = await enqueueBashRun(userId, projectId, task.test_command, serverId);
          session.currentRunId = bashRun.id;
          session.log.push(`[iter ${session.currentIteration}] Enqueued bash run ${bashRun.id}`);
          const bashResult = await waitForRun(userId, bashRun.id, stopRef);
          if (stopRef.stop) break;
          bashOutput = bashResult.status;
        } catch (err) {
          if (stopRef.stop) break;
          session.log.push(`[iter ${session.currentIteration}] Bash run failed: ${err.message}`);
        }
      }

      // --- Analyze ---
      session.currentPhase = 'analyzing';
      session.updatedAt = new Date().toISOString();
      let analysis;
      try {
        analysis = await analyzeIteration(proposal, task, implResult.status, bashOutput);
      } catch (err) {
        session.log.push(`[iter ${session.currentIteration}] Analysis failed: ${err.message}`);
        analysis = { summary: `Iteration ${session.currentIteration} completed.`, goal_achieved: false, next_suggestion: '' };
      }

      session.history.push({
        iteration: session.currentIteration,
        task: task.task_title,
        summary: analysis.summary,
        goalAchieved: analysis.goal_achieved,
        runId: implRun.id,
      });
      session.log.push(`[iter ${session.currentIteration}] ${analysis.summary}`);

      if (analysis.goal_achieved) {
        session.goalAchieved = true;
        session.log.push(`[iter ${session.currentIteration}] Goal achieved (analyze phase)`);
        break;
      }
    }
  } catch (err) {
    session.log.push(`Autopilot loop error: ${err.message}`);
    session.status = 'failed';
    session.error = err.message;
  }

  if (session.status === 'running') {
    session.status = stopRef.stop ? 'stopped' : (session.goalAchieved ? 'completed' : 'completed');
  }
  session.currentPhase = 'idle';
  session.currentRunId = null;
  session.endedAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start an autopilot session for a project.
 */
async function startSession(userId, projectId, {
  proposal,
  maxIterations = 10,
  serverId = 'local-default',
  skill = 'implement',
} = {}) {
  if (!proposal || !projectId) throw new Error('proposal and projectId are required');

  const id = newId();
  const session = {
    id,
    userId,
    projectId,
    proposal,
    maxIterations: Math.min(Math.max(1, Number(maxIterations) || 10), 50),
    currentIteration: 0,
    status: 'running',
    currentPhase: 'idle',
    currentTask: '',
    currentRunId: null,
    goalAchieved: false,
    history: [],
    log: [],
    serverId,
    skill,
    startedAt: new Date().toISOString(),
    endedAt: null,
    updatedAt: new Date().toISOString(),
    _stopRef: null,
  };

  sessions.set(id, session);

  // Fire-and-forget background loop
  runAutopilotLoop(session).catch((err) => {
    console.error('[Autopilot] Unhandled loop error:', err);
    session.status = 'failed';
    session.error = String(err.message);
    session.endedAt = new Date().toISOString();
  });

  return serializeSession(session);
}

/**
 * Stop a running session.
 */
async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session._stopRef) session._stopRef.stop = true;
  if (session.status === 'running') {
    session.status = 'stopped';
    session.endedAt = new Date().toISOString();
  }
  return serializeSession(session);
}

/**
 * Get a session by id.
 */
function getSession(sessionId) {
  const s = sessions.get(sessionId);
  return s ? serializeSession(s) : null;
}

/**
 * List all sessions for a project (most recent first).
 */
function listProjectSessions(userId, projectId) {
  const result = [];
  for (const s of sessions.values()) {
    if (s.userId === userId && s.projectId === projectId) {
      result.push(serializeSession(s));
    }
  }
  return result.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Strip internal fields before returning to caller. */
function serializeSession(s) {
  const { _stopRef, ...rest } = s;
  return { ...rest };
}

module.exports = {
  startSession,
  stopSession,
  getSession,
  listProjectSessions,
};
