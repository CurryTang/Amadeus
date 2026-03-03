const { spawn, spawnSync } = require('child_process');
const path = require('path');
const config = require('../../config');
const store = require('./store');
const orchestrator = require('./orchestrator');
const { terminateProcessTree } = require('./process-control');
const { getDb } = require('../../db');
const {
  deriveTmuxSession,
  deriveTmuxPaths,
  buildSshArgs,
  spawnRemoteFireAndForget,
} = require('./modules/bash-run.module');
const superpowers = require('./superpowers');

const runningProcesses = new Map();

const autoDispatcher = {
  enabled: false,
  timer: null,
  tickInFlight: false,
  pendingTick: false,
  userId: 'czk',
  intervalMs: 5000,
  maxLeasesPerTick: 6,
  unregisteredConcurrency: 1,
  staleRecoveryIntervalMs: 0,
  staleMinutes: 20,
  lastTickAt: null,
  lastError: '',
  lastSummary: null,
  lastDispatchedRunIds: [],
  lastRecoveryAt: null,
  lastRecoveryResult: null,
};

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toInt(value, fallback, { min = 1, max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function normalizeUserId(userId) {
  return String(userId || '').trim().toLowerCase() || 'czk';
}

function normalizeServerId(serverId = '') {
  return asString(serverId) || 'local-default';
}

function getProviderCommand(provider) {
  const p = asString(provider).toLowerCase();
  if (!p || p === 'codex_cli') return 'codex';
  if (p === 'gemini_cli') return 'gemini';
  if (p === 'claude_code_cli') return 'claude';
  return p;
}

function defaultCodexModel() {
  return asString(process.env.RESEARCHOPS_CODEX_MODEL)
    || asString(config.codexCli?.model)
    || 'gpt-5.3-codex';
}

function defaultClaudeModel() {
  return asString(process.env.RESEARCHOPS_CLAUDE_MODEL)
    || asString(config.claudeCli?.model)
    || 'sonnet-4.6';
}

function defaultCodexReasoningEffort() {
  return asString(process.env.RESEARCHOPS_CODEX_REASONING_EFFORT || 'high').toLowerCase() || 'high';
}

function defaultArgsForProvider(command, prompt) {
  if (command === 'codex') {
    const args = ['exec', '--yolo'];
    const model = defaultCodexModel();
    if (model) args.push('-m', model);
    const reasoningEffort = defaultCodexReasoningEffort();
    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    }
    args.push(superpowers.applySuperpowersPrefix(command, prompt));
    return args;
  }
  if (command === 'claude') {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const model = defaultClaudeModel();
    // Fire-and-forget preflight: install superpowers plugin before main run.
    superpowers.runLocalClaudePreflight(model);
    const args = [];
    if (!isRoot) args.push('--dangerously-skip-permissions');
    if (model) args.push('--model', model);
    args.push('-p', prompt);
    return args;
  }
  if (command === 'gemini') {
    return [prompt];
  }
  return [prompt];
}

function isSafeCommandName(command = '') {
  return /^[A-Za-z0-9._-]+$/.test(asString(command));
}

function commandExistsLocally(command = '') {
  const normalized = asString(command).toLowerCase();
  if (!isSafeCommandName(normalized)) return false;
  const probe = spawnSync('bash', ['-lc', `command -v ${normalized} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function providerFallbacks(command = '') {
  const normalized = asString(command).toLowerCase();
  if (normalized === 'codex') return ['claude', 'gemini'];
  if (normalized === 'claude') return ['gemini', 'codex'];
  if (normalized === 'gemini') return ['claude', 'codex'];
  return [];
}

function resolveAvailableCommand(command = '', { allowFallback = true } = {}) {
  const normalized = asString(command).toLowerCase();
  if (!normalized) return normalized;
  if (commandExistsLocally(normalized)) return normalized;
  if (!allowFallback) return normalized;
  for (const candidate of providerFallbacks(normalized)) {
    if (commandExistsLocally(candidate)) return candidate;
  }
  return normalized;
}

function ensureHeadlessProviderArgs(command, args = []) {
  const normalized = asString(command).toLowerCase();
  const current = Array.isArray(args) ? [...args] : [];

  if (normalized === 'claude') {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (isRoot) {
      return current.filter((item) => String(item || '').trim() !== '--dangerously-skip-permissions');
    }
    if (current.includes('--dangerously-skip-permissions')) return current;
    return ['--dangerously-skip-permissions', ...current];
  }

  if (normalized === 'codex') {
    if (current.includes('--yolo')) return current;
    const execIndex = current.findIndex((item) => String(item).trim().toLowerCase() === 'exec');
    if (execIndex >= 0) {
      const withFlag = [...current];
      withFlag.splice(execIndex + 1, 0, '--yolo');
      return withFlag;
    }
    return ['--yolo', ...current];
  }

  return current;
}

function buildPrompt(metadata = {}) {
  const prompt = asString(metadata.prompt);
  if (prompt) return prompt;
  const template = asString(metadata.template);
  if (template) return template;
  return 'Analyze repository changes and produce a safe implementation plan.';
}

function resolveExecutionSpec(run) {
  const metadata = run.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const cwdInput = asString(metadata.cwd);
  const cwd = cwdInput ? path.resolve(cwdInput) : process.cwd();

  if (run.runType === 'AGENT') {
    const requestedCommand = asString(metadata.command) || getProviderCommand(run.provider);
    let args = asStringArray(metadata.args);
    const command = resolveAvailableCommand(requestedCommand, {
      allowFallback: args.length === 0,
    });
    if (args.length === 0) {
      const prompt = buildPrompt(metadata);
      args = defaultArgsForProvider(command, prompt);
    }
    args = ensureHeadlessProviderArgs(command, args);
    return {
      command,
      args,
      cwd,
      timeoutMs: Number(metadata.timeoutMs) > 0 ? Number(metadata.timeoutMs) : 30 * 60 * 1000,
    };
  }

  // EXPERIMENT
  const command = asString(metadata.command) || 'echo';
  const args = asStringArray(metadata.args);
  return {
    command,
    args,
    cwd,
    timeoutMs: Number(metadata.timeoutMs) > 0 ? Number(metadata.timeoutMs) : 2 * 60 * 60 * 1000,
  };
}

function lineChunks(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

async function publishLogLines(userId, runId, stream, chunk) {
  const lines = lineChunks(chunk);
  if (!lines.length) return;
  const events = lines.map((line) => ({
    eventType: 'LOG_LINE',
    message: `[${stream}] ${line}`,
  }));
  await store.publishRunEvents(userId, runId, events);
}

async function safelyMarkCancelled(userId, runId, message = 'Cancelled via API') {
  try {
    return await store.updateRunStatus(userId, runId, 'CANCELLED', message);
  } catch (error) {
    if (String(error?.message || '').includes('Invalid run status transition')) {
      return store.getRun(userId, runId);
    }
    throw error;
  }
}

async function terminateStateProcess(state, { graceMs = 5000 } = {}) {
  if (!state) {
    return {
      pid: null,
      detached: false,
      termSent: false,
      killSent: false,
      alive: false,
    };
  }
  return terminateProcessTree({
    pid: state.pid,
    child: state.child,
    detached: state.detached === true,
    graceMs,
  });
}

async function executeRun(userId, run) {
  const uid = normalizeUserId(userId);
  if (!run || !run.id) {
    throw new Error('Invalid run');
  }
  if (runningProcesses.has(run.id)) {
    return { started: false, reason: 'already_running' };
  }

  const schemaVersion = asString(run.schemaVersion || run.metadata?.schemaVersion);
  const isV2 = schemaVersion.startsWith('2.');
  if (isV2) {
    await store.updateRunStatus(uid, run.id, 'RUNNING', 'Runner started (v2 orchestrator)', {
      schemaVersion,
      workflowSteps: Array.isArray(run.workflow) ? run.workflow.length : 0,
    });

    const processState = {
      runId: run.id,
      pid: null,
      command: 'researchops-orchestrator-v2',
      startedAt: new Date().toISOString(),
      timer: null,
      child: null,
      cancel: null,
      detached: false,
      serverId: normalizeServerId(run.serverId),
      runType: asString(run.runType).toUpperCase() || 'AGENT',
      schemaVersion: schemaVersion || '2.0',
    };
    runningProcesses.set(run.id, processState);

    (async () => {
      try {
        const orchestratorResult = await orchestrator.executeV2Run(uid, run, {
          onRegisterCancel: (cancelFn) => {
            processState.cancel = cancelFn;
            return true;
          },
          onUnregisterCancel: () => {
            processState.cancel = null;
          },
        });

        const current = await store.getRun(uid, run.id).catch(() => null);
        if (current?.status === 'CANCELLED') return;

        await store.publishRunEvents(uid, run.id, [{
          eventType: 'RESULT_SUMMARY',
          message: 'V2 workflow completed successfully',
          payload: { schemaVersion, mode: run.mode || 'interactive' },
        }]);
        await store.updateRunStatus(uid, run.id, 'SUCCEEDED', 'V2 workflow completed successfully');

        // Enqueue continuation child run if agent wrote CONTINUATION.json
        const continuation = orchestratorResult?.continuation;
        const nextRunSpec = continuation?.nextRun && typeof continuation.nextRun === 'object'
          ? continuation.nextRun
          : null;
        if (nextRunSpec) {
          try {
            const pendingContinuation = nextRunSpec.pendingContinuation
              && typeof nextRunSpec.pendingContinuation === 'object'
              ? nextRunSpec.pendingContinuation
              : null;
            const childPayload = {
              projectId: asString(nextRunSpec.projectId) || run.projectId,
              runType: asString(nextRunSpec.runType).toUpperCase() || 'AGENT',
              schemaVersion: asString(nextRunSpec.schemaVersion) || '2.0',
              serverId: asString(nextRunSpec.serverId) || run.serverId || 'local-default',
              provider: asString(nextRunSpec.provider) || run.provider || null,
              mode: asString(nextRunSpec.mode) || 'interactive',
              workflow: Array.isArray(nextRunSpec.workflow) ? nextRunSpec.workflow : [],
              skillRefs: Array.isArray(nextRunSpec.skillRefs)
                ? nextRunSpec.skillRefs
                : (Array.isArray(run.skillRefs) ? run.skillRefs : []),
              contextRefs: nextRunSpec.contextRefs && typeof nextRunSpec.contextRefs === 'object'
                ? nextRunSpec.contextRefs
                : (run.contextRefs || {}),
              metadata: {
                ...(nextRunSpec.metadata && typeof nextRunSpec.metadata === 'object'
                  ? nextRunSpec.metadata
                  : {}),
                parentRunId: run.id,
                continuationPhase: asString(continuation.phase) || 'continuation',
                ...(pendingContinuation ? { pendingContinuation } : {}),
              },
            };
            const childRun = await store.enqueueRun(uid, childPayload);
            await store.publishRunEvents(uid, run.id, [{
              eventType: 'RESULT_SUMMARY',
              message: `Continuation run enqueued: ${childRun.id} (phase: ${childPayload.metadata.continuationPhase})`,
              payload: {
                childRunId: childRun.id,
                phase: childPayload.metadata.continuationPhase,
                childRunType: childPayload.runType,
              },
            }]);
          } catch (continuationError) {
            console.error('[ResearchOpsRunner] continuation enqueue failed:', continuationError);
            await store.publishRunEvents(uid, run.id, [{
              eventType: 'LOG_LINE',
              message: `[continuation-warning] Failed to enqueue child run: ${continuationError.message}`,
            }]).catch(() => {});
          }
        }

        // Handle nextRuns[] array — tree branching: one parent spawns multiple children
        const nextRunsSpec = Array.isArray(continuation?.nextRuns) ? continuation.nextRuns : [];
        for (const spec of nextRunsSpec) {
          if (!spec || typeof spec !== 'object') continue;
          try {
            const branchLabel = asString(spec.branchLabel || spec.metadata?.branchLabel) || '';
            const childPayload = {
              projectId: asString(spec.projectId) || run.projectId,
              runType: asString(spec.runType).toUpperCase() || 'AGENT',
              schemaVersion: asString(spec.schemaVersion) || '2.0',
              serverId: asString(spec.serverId) || run.serverId || 'local-default',
              provider: asString(spec.provider) || run.provider || null,
              mode: asString(spec.mode) || 'interactive',
              workflow: Array.isArray(spec.workflow) ? spec.workflow : [],
              skillRefs: Array.isArray(spec.skillRefs)
                ? spec.skillRefs
                : (Array.isArray(run.skillRefs) ? run.skillRefs : []),
              contextRefs: spec.contextRefs && typeof spec.contextRefs === 'object'
                ? spec.contextRefs
                : (run.contextRefs || {}),
              metadata: {
                ...(spec.metadata && typeof spec.metadata === 'object' ? spec.metadata : {}),
                parentRunId: run.id,
                branchLabel,
                continuationPhase: asString(continuation.phase) || 'branch',
              },
            };
            const childRun = await store.enqueueRun(uid, childPayload);
            await store.publishRunEvents(uid, run.id, [{
              eventType: 'RESULT_SUMMARY',
              message: `Branch run enqueued: ${childRun.id}${branchLabel ? ` (${branchLabel})` : ''}`,
              payload: { childRunId: childRun.id, branchLabel, childRunType: childPayload.runType },
            }]);
          } catch (branchError) {
            console.error('[ResearchOpsRunner] branch enqueue failed:', branchError);
            await store.publishRunEvents(uid, run.id, [{
              eventType: 'LOG_LINE',
              message: `[branch-warning] Failed to enqueue branch run: ${branchError.message}`,
            }]).catch(() => {});
          }
        }
      } catch (error) {
        console.error('[ResearchOpsRunner] v2 run failed:', error);
        const current = await store.getRun(uid, run.id).catch(() => null);
        if (current?.status !== 'CANCELLED') {
          await store.publishRunEvents(uid, run.id, [{
            eventType: 'RESULT_SUMMARY',
            message: `V2 workflow failed: ${error.message}`,
            payload: { schemaVersion, error: error.message },
          }]).catch(() => {});
          await store.updateRunStatus(uid, run.id, 'FAILED', `V2 workflow failed: ${error.message}`).catch(() => {});
        }
      } finally {
        runningProcesses.delete(run.id);
      }
    })();
    return { started: true, pid: null };
  }

  const spec = resolveExecutionSpec(run);
  await store.updateRunStatus(uid, run.id, 'RUNNING', `Runner started: ${spec.command} ${spec.args.join(' ')}`, {
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    schemaVersion: schemaVersion || '1.0',
  });

  const detached = process.platform !== 'win32';
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached,
  });

  const processState = {
    runId: run.id,
    pid: child.pid,
    command: spec.command,
    startedAt: new Date().toISOString(),
    timer: null,
    child,
    cancel: null,
    detached,
    serverId: normalizeServerId(run.serverId),
    runType: asString(run.runType).toUpperCase() || 'EXPERIMENT',
    schemaVersion: schemaVersion || '1.0',
  };
  runningProcesses.set(run.id, processState);

  child.stdout.on('data', (chunk) => {
    publishLogLines(uid, run.id, 'stdout', chunk.toString()).catch((error) => {
      console.error('[ResearchOpsRunner] stdout publish failed:', error);
    });
  });

  child.stderr.on('data', (chunk) => {
    publishLogLines(uid, run.id, 'stderr', chunk.toString()).catch((error) => {
      console.error('[ResearchOpsRunner] stderr publish failed:', error);
    });
  });

  child.on('error', async (error) => {
    console.error('[ResearchOpsRunner] child process error:', error);
    try {
      await store.publishRunEvents(uid, run.id, [{
        eventType: 'LOG_LINE',
        message: `[runner-error] ${error.message}`,
      }]);
      const current = await store.getRun(uid, run.id).catch(() => null);
      if (current?.status !== 'CANCELLED') {
        await store.updateRunStatus(uid, run.id, 'FAILED', `Runner error: ${error.message}`);
      }
    } catch (innerError) {
      console.error('[ResearchOpsRunner] failed to update failed status:', innerError);
    } finally {
      runningProcesses.delete(run.id);
    }
  });

  child.on('close', async (exitCode, signal) => {
    const resultLine = `Process exited with code=${exitCode} signal=${signal || 'none'}`;
    try {
      await store.publishRunEvents(uid, run.id, [{
        eventType: 'RESULT_SUMMARY',
        message: resultLine,
        payload: { exitCode, signal },
      }]);
      const current = await store.getRun(uid, run.id).catch(() => null);
      if (current?.status === 'CANCELLED') return;
      if (exitCode === 0) {
        await store.updateRunStatus(uid, run.id, 'SUCCEEDED', resultLine);
      } else {
        await store.updateRunStatus(uid, run.id, 'FAILED', resultLine);
      }
    } catch (error) {
      console.error('[ResearchOpsRunner] close handling failed:', error);
    } finally {
      const state = runningProcesses.get(run.id);
      if (state?.timer) clearTimeout(state.timer);
      runningProcesses.delete(run.id);
    }
  });

  if (Number(spec.timeoutMs) > 0) {
    processState.timer = setTimeout(async () => {
      try {
        await store.publishRunEvents(uid, run.id, [{
          eventType: 'LOG_LINE',
          message: `[runner-timeout] Killing process after ${spec.timeoutMs}ms`,
        }]);
      } catch (_) {
        // ignore
      }
      const killResult = await terminateStateProcess(processState, { graceMs: 4000 });
      await store.publishRunEvents(uid, run.id, [{
        eventType: 'LOG_LINE',
        message: `[runner-timeout] termSent=${killResult.termSent} killSent=${killResult.killSent} alive=${killResult.alive}`,
      }]).catch(() => {});
    }, spec.timeoutMs);
    if (typeof processState.timer.unref === 'function') processState.timer.unref();
  }

  return { started: true, pid: child.pid };
}

async function cancelRun(userId, runId) {
  const uid = normalizeUserId(userId);
  const id = asString(runId);
  const state = runningProcesses.get(id);
  let killResult = null;

  if (state) {
    if (typeof state.cancel === 'function') {
      try {
        state.cancel();
      } catch (_) {
        // ignore cancellation callback errors
      }
    }
    killResult = await terminateStateProcess(state, { graceMs: 4500 });
    if (state.timer) clearTimeout(state.timer);
    runningProcesses.delete(id);
    await store.publishRunEvents(uid, id, [{
      eventType: 'LOG_LINE',
      message: `[runner-cancel] termSent=${killResult.termSent} killSent=${killResult.killSent} alive=${killResult.alive}`,
      payload: {
        pid: killResult.pid,
        detached: killResult.detached,
      },
    }]).catch(() => {});
  }

  const message = killResult
    ? `Cancelled via API (termSent=${killResult.termSent}, killSent=${killResult.killSent}, alive=${killResult.alive})`
    : 'Cancelled via API';
  const updated = await safelyMarkCancelled(uid, id, message);
  return updated;
}

async function leaseAndExecuteNext(userId, serverId = 'local-default', { allowUnregisteredServer = true } = {}) {
  const uid = normalizeUserId(userId);
  const sid = normalizeServerId(serverId);
  const leased = await store.leaseNextRun(uid, { serverId: sid, allowUnregisteredServer: !!allowUnregisteredServer });
  if (!leased.leased || !leased.run) return leased;
  await executeRun(uid, leased.run);
  return leased;
}

// ─── SSH helpers for orphan reconnect ─────────────────────────────────────

function shellEscapeSimple(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

async function getSshServerById(serverId) {
  if (!serverId) return null;
  const localIds = ['local', 'local-default', 'self', 'current'];
  if (localIds.includes(String(serverId).toLowerCase())) return null;
  try {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM ssh_servers WHERE id = ? OR name = ? LIMIT 1',
      args: [serverId, serverId],
    });
    return result.rows?.[0] || null;
  } catch (_) {
    return null;
  }
}

// Run a short SSH command and return stdout (throws on error/timeout)
function sshRunCommand(server, cmd, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [
      ...buildSshArgs(server, { connectTimeout: 12 }),
      `${server.user}@${server.host}`,
      'bash', '-c', cmd,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('error', reject);

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SSH command timed out'));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout) resolve(stdout.trim());
      else reject(new Error(`SSH exited ${code}`));
    });
  });
}

// Reconnect to an orphaned SSH run by tailing its tmux log file
async function reconnectRunOnServer(userId, run, server) {
  const uid = normalizeUserId(userId);
  const runId = run.id;
  const sessionName = deriveTmuxSession(runId);
  const runDir = `/tmp/researchops-runs/${runId}`;

  // Step 1: Check what state the remote is in
  let exitFile = '';
  let logFile = '';
  try {
    const listing = await sshRunCommand(
      server,
      `ls ${shellEscapeSimple(runDir)}/*.exit 2>/dev/null | head -1; echo '---'; ls ${shellEscapeSimple(runDir)}/*.log 2>/dev/null | head -1`,
      { timeoutMs: 15000 }
    );
    const parts = listing.split('---');
    exitFile = (parts[0] || '').trim();
    logFile = (parts[1] || '').trim();
  } catch (_) {
    // SSH unreachable — let stale recovery handle it later
    return;
  }

  // Step 2a: Run already finished (exit file present)
  if (exitFile) {
    let exitCode = 1;
    let logContent = '';
    try {
      const exitRaw = await sshRunCommand(server, `cat ${shellEscapeSimple(exitFile)} 2>/dev/null || echo 1`);
      exitCode = parseInt(exitRaw, 10);
      if (!Number.isFinite(exitCode)) exitCode = 1;
    } catch (_) { /* use fallback */ }

    if (logFile) {
      try {
        logContent = await sshRunCommand(server, `cat ${shellEscapeSimple(logFile)} 2>/dev/null || true`, { timeoutMs: 30000 });
      } catch (_) { /* no log */ }
    }

    if (logContent) {
      await store.publishRunEvents(uid, runId, [{
        eventType: 'LOG_LINE',
        message: `[reconnect] Recovered output from completed tmux session:\n${logContent.slice(-20000)}`,
        payload: { source: 'tmux-reconnect', exitCode },
      }]).catch(() => {});
    }

    const nextStatus = exitCode === 0 ? 'SUCCEEDED' : 'FAILED';
    await store.updateRunStatus(uid, runId, nextStatus,
      `[reconnect] Tmux session completed (exit ${exitCode}) during backend restart`
    ).catch(() => {});

    spawnRemoteFireAndForget(server, `rm -rf ${shellEscapeSimple(runDir)} 2>/dev/null || true`);
    console.log(`[ResearchOpsRunner] reconnected run ${runId}: exit=${exitCode} → ${nextStatus}`);
    return;
  }

  // Step 2b: Still running in tmux — spawn a tail process to capture remaining output
  if (logFile) {
    // Verify tmux session is alive
    let hasTmux = false;
    try {
      await sshRunCommand(server, `tmux has-session -t ${shellEscapeSimple(sessionName)} 2>/dev/null`);
      hasTmux = true;
    } catch (_) { /* session gone */ }

    if (!hasTmux) {
      // Log file present but no tmux session — process died without writing exit file
      const logContent = await sshRunCommand(server, `cat ${shellEscapeSimple(logFile)} 2>/dev/null || true`, { timeoutMs: 30000 }).catch(() => '');
      if (logContent) {
        await store.publishRunEvents(uid, runId, [{
          eventType: 'LOG_LINE',
          message: `[reconnect] Partial output before process died:\n${logContent.slice(-20000)}`,
          payload: { source: 'tmux-reconnect' },
        }]).catch(() => {});
      }
      const derivedPaths = deriveTmuxPaths(runId, 'step');
      const exitFileDerived = derivedPaths.exitFile.replace(/\/[^/]+$/, `/${path.basename(logFile).replace('.log', '.exit')}`);
      await store.updateRunStatus(uid, runId, 'FAILED',
        '[reconnect] Tmux process died without exit code during backend restart'
      ).catch(() => {});
      spawnRemoteFireAndForget(server, `rm -rf ${shellEscapeSimple(runDir)} 2>/dev/null || true`);
      return;
    }

    // Tmux is still alive — spawn SSH to tail the log and wait for exit file
    console.log(`[ResearchOpsRunner] reconnecting to live tmux session ${sessionName} for run ${runId}`);

    // The exit file path is the log file path with .log → .exit
    const derivedExitFile = logFile.replace(/\.log$/, '.exit');
    const reconnectScript = [
      `LOG=${shellEscapeSimple(logFile)}`,
      `EXIT=${shellEscapeSimple(derivedExitFile)}`,
      'tail -n +1 -f "$LOG" &',
      'TAIL_PID=$!',
      'while ! [ -f "$EXIT" ]; do sleep 0.3; done',
      'sleep 1',
      'kill "$TAIL_PID" 2>/dev/null || true',
      'wait "$TAIL_PID" 2>/dev/null || true',
      'RC=$(cat "$EXIT" 2>/dev/null || echo 1)',
      `rm -rf ${shellEscapeSimple(runDir)} 2>/dev/null || true`,
      'exit "$RC"',
    ].join('\n');

    const proc = spawn('ssh', [
      ...buildSshArgs(server, { connectTimeout: 15 }),
      `${server.user}@${server.host}`,
      'bash', '-c', reconnectScript,
    ], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });

    runningProcesses.set(runId, {
      runId,
      pid: proc.pid,
      command: `reconnect:${sessionName}`,
      startedAt: new Date().toISOString(),
      serverId: asString(run.serverId),
    });

    let stdout = '';
    const maxCapture = 200000;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = `${stdout}${text}`.slice(-maxCapture);
      store.publishRunEvents(uid, runId, [{
        eventType: 'LOG_LINE',
        message: text,
        payload: { source: 'tmux-reconnect' },
      }]).catch(() => {});
    });

    proc.stderr.on('data', (chunk) => {
      store.publishRunEvents(uid, runId, [{
        eventType: 'LOG_LINE',
        message: chunk.toString(),
        payload: { source: 'tmux-reconnect', isError: true },
      }]).catch(() => {});
    });

    proc.on('close', async (code) => {
      runningProcesses.delete(runId);
      const exitCode = Number.isFinite(Number(code)) ? Number(code) : 1;
      const nextStatus = exitCode === 0 ? 'SUCCEEDED' : 'FAILED';
      await store.updateRunStatus(uid, runId, nextStatus,
        `[reconnect] Tmux session completed (exit ${exitCode})`
      ).catch(() => {});
      console.log(`[ResearchOpsRunner] reconnected tmux tail for ${runId}: exit=${exitCode} → ${nextStatus}`);
    });

    proc.on('error', async (err) => {
      runningProcesses.delete(runId);
      await store.updateRunStatus(uid, runId, 'FAILED', `[reconnect] SSH error: ${err.message}`).catch(() => {});
    });

    return;
  }

  // Step 2c: No log file, no exit file, no tmux — process was never started or cleaned up
  // Let the stale run recovery handle this (do nothing here)
  console.log(`[ResearchOpsRunner] run ${runId} has no tmux artefacts on ${server.host} — stale recovery will handle it`);
}

async function reconnectOrphanedRuns(userId) {
  const uid = normalizeUserId(userId);
  let runningRuns = [];
  try {
    runningRuns = await store.listRuns(uid, { status: 'RUNNING', limit: 200 });
  } catch (_) {
    return;
  }

  const localIds = new Set(['local', 'local-default', 'self', 'current', '']);
  const candidates = runningRuns.filter((run) => {
    const sid = asString(run?.serverId).toLowerCase();
    return sid && !localIds.has(sid) && !runningProcesses.has(run.id);
  });

  if (candidates.length === 0) return;
  console.log(`[ResearchOpsRunner] checking ${candidates.length} potentially orphaned remote run(s) for tmux reconnect`);

  for (const run of candidates) {
    try {
      const server = await getSshServerById(run.serverId);
      if (!server) {
        console.log(`[ResearchOpsRunner] SSH server not found for run ${run.id} (serverId=${run.serverId}), skipping reconnect`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await reconnectRunOnServer(uid, run, server);
    } catch (err) {
      console.error(`[ResearchOpsRunner] reconnect attempt for run ${run.id} failed:`, err.message);
    }
  }
}

async function recoverStaleRuns(userId, options = {}) {
  const uid = normalizeUserId(userId);
  const normalizedOptions = {
    minutesStale: options?.minutesStale,
    serverId: asString(options?.serverId),
  };

  const preview = await store.recoverStaleRuns(uid, {
    ...normalizedOptions,
    dryRun: true,
  });

  const staleIds = Array.isArray(preview?.items)
    ? preview.items.map((item) => asString(item?.runId)).filter(Boolean)
    : [];

  const terminated = [];
  for (const runId of staleIds) {
    const state = runningProcesses.get(runId);
    if (!state) continue;
    if (typeof state.cancel === 'function') {
      try {
        state.cancel();
      } catch (_) {
        // ignore
      }
    }
    // eslint-disable-next-line no-await-in-loop
    const killResult = await terminateStateProcess(state, { graceMs: 3500 });
    if (state.timer) clearTimeout(state.timer);
    runningProcesses.delete(runId);
    terminated.push({ runId, ...killResult });
    await store.publishRunEvents(uid, runId, [{
      eventType: 'LOG_LINE',
      message: `[runner-recovery] stale run kill termSent=${killResult.termSent} killSent=${killResult.killSent} alive=${killResult.alive}`,
      payload: {
        source: 'recovery',
        pid: killResult.pid,
        detached: killResult.detached,
      },
    }]).catch(() => {});
  }

  if (options?.dryRun === true) {
    return {
      ...preview,
      terminatedLocalProcesses: terminated.length,
      terminated,
    };
  }

  const applied = await store.recoverStaleRuns(uid, {
    ...normalizedOptions,
    dryRun: false,
  });

  return {
    ...applied,
    terminatedLocalProcesses: terminated.length,
    terminated,
  };
}

async function runAutoDispatchTick() {
  if (!autoDispatcher.enabled) return;
  if (autoDispatcher.tickInFlight) {
    autoDispatcher.pendingTick = true;
    return;
  }

  autoDispatcher.tickInFlight = true;
  autoDispatcher.lastTickAt = new Date().toISOString();

  try {
    const uid = normalizeUserId(autoDispatcher.userId);
    const [queuedRuns, daemons, runningRuns, provisioningRuns] = await Promise.all([
      store.listQueue(uid, { limit: 500 }),
      store.listDaemons(uid, { limit: 500 }),
      store.listRuns(uid, { status: 'RUNNING', limit: 400 }),
      store.listRuns(uid, { status: 'PROVISIONING', limit: 400 }),
    ]);

    const orderedServers = [];
    const seenServers = new Set();
    const queueByServer = new Map();
    for (const run of queuedRuns) {
      const sid = normalizeServerId(run?.serverId);
      queueByServer.set(sid, (queueByServer.get(sid) || 0) + 1);
      if (!seenServers.has(sid)) {
        seenServers.add(sid);
        orderedServers.push(sid);
      }
    }

    const daemonById = new Map(
      (Array.isArray(daemons) ? daemons : []).map((daemon) => [String(daemon?.id || ''), daemon])
    );
    const activeByServer = new Map();
    [...runningRuns, ...provisioningRuns].forEach((run) => {
      const sid = normalizeServerId(run?.serverId);
      activeByServer.set(sid, (activeByServer.get(sid) || 0) + 1);
    });

    let budget = Math.max(Number(autoDispatcher.maxLeasesPerTick) || 0, 0);
    const dispatchedRunIds = [];

    for (const sid of orderedServers) {
      if (budget <= 0) break;
      const daemon = daemonById.get(sid);
      const concurrencyLimit = daemon
        ? toInt(daemon?.concurrencyLimit, 1, { min: 1, max: 512 })
        : Math.max(Number(autoDispatcher.unregisteredConcurrency) || 1, 1);
      let availableSlots = Math.max(concurrencyLimit - (activeByServer.get(sid) || 0), 0);

      while (budget > 0 && availableSlots > 0) {
        // eslint-disable-next-line no-await-in-loop
        const leased = await leaseAndExecuteNext(uid, sid, { allowUnregisteredServer: true });
        if (!leased?.leased || !leased?.run) break;
        dispatchedRunIds.push(leased.run.id);
        budget -= 1;
        availableSlots -= 1;
        activeByServer.set(sid, (activeByServer.get(sid) || 0) + 1);
      }
    }

    autoDispatcher.lastDispatchedRunIds = dispatchedRunIds;
    autoDispatcher.lastSummary = {
      queueDepth: queuedRuns.length,
      serversSeen: orderedServers.length,
      dispatchedCount: dispatchedRunIds.length,
      runningCount: runningRuns.length,
      provisioningCount: provisioningRuns.length,
      at: new Date().toISOString(),
    };
    autoDispatcher.lastError = '';

    const shouldRecover = autoDispatcher.staleRecoveryIntervalMs > 0 && (
      !autoDispatcher.lastRecoveryAt
      || (Date.now() - Date.parse(autoDispatcher.lastRecoveryAt)) >= autoDispatcher.staleRecoveryIntervalMs
    );
    if (shouldRecover) {
      const recovery = await recoverStaleRuns(uid, {
        minutesStale: autoDispatcher.staleMinutes,
        dryRun: false,
      });
      autoDispatcher.lastRecoveryAt = new Date().toISOString();
      autoDispatcher.lastRecoveryResult = recovery;
    }
  } catch (error) {
    autoDispatcher.lastError = error?.message || String(error);
    console.error('[ResearchOpsRunner] auto dispatcher tick failed:', error);
  } finally {
    autoDispatcher.tickInFlight = false;
    if (autoDispatcher.pendingTick) {
      autoDispatcher.pendingTick = false;
      setImmediate(() => {
        runAutoDispatchTick().catch((error) => {
          console.error('[ResearchOpsRunner] pending auto dispatcher tick failed:', error);
        });
      });
    }
  }
}

function startAutoDispatch(options = {}) {
  const enabled = asBoolean(
    options.enabled,
    asBoolean(process.env.RESEARCHOPS_AUTO_DISPATCH_ENABLED, true)
  );

  stopAutoDispatch();

  autoDispatcher.enabled = enabled;
  autoDispatcher.userId = asString(options.userId)
    || asString(process.env.RESEARCHOPS_AUTO_DISPATCH_USER_ID)
    || 'czk';
  autoDispatcher.intervalMs = toInt(
    options.intervalMs ?? process.env.RESEARCHOPS_AUTO_DISPATCH_INTERVAL_MS,
    5000,
    { min: 1000, max: 120000 }
  );
  autoDispatcher.maxLeasesPerTick = toInt(
    options.maxLeasesPerTick ?? process.env.RESEARCHOPS_AUTO_DISPATCH_MAX_LEASES_PER_TICK,
    6,
    { min: 1, max: 64 }
  );
  autoDispatcher.unregisteredConcurrency = toInt(
    options.unregisteredConcurrency ?? process.env.RESEARCHOPS_AUTO_DISPATCH_UNREGISTERED_CONCURRENCY,
    1,
    { min: 1, max: 32 }
  );
  autoDispatcher.staleRecoveryIntervalMs = toInt(
    options.staleRecoveryIntervalMs ?? process.env.RESEARCHOPS_STALE_RECOVERY_INTERVAL_MS,
    0,
    { min: 0, max: 6 * 60 * 60 * 1000 }
  );
  autoDispatcher.staleMinutes = toInt(
    options.staleMinutes ?? process.env.RESEARCHOPS_STALE_RECOVERY_MINUTES,
    20,
    { min: 1, max: 60 * 24 * 30 }
  );
  autoDispatcher.lastError = '';
  autoDispatcher.lastSummary = null;
  autoDispatcher.lastDispatchedRunIds = [];

  if (!enabled) {
    return getDispatcherState();
  }

  autoDispatcher.timer = setInterval(() => {
    runAutoDispatchTick().catch((error) => {
      console.error('[ResearchOpsRunner] scheduled auto dispatch tick failed:', error);
    });
  }, autoDispatcher.intervalMs);
  if (typeof autoDispatcher.timer.unref === 'function') autoDispatcher.timer.unref();

  runAutoDispatchTick().catch((error) => {
    console.error('[ResearchOpsRunner] initial auto dispatcher tick failed:', error);
  });

  // On startup, try to reconnect any runs that were running when the backend last restarted
  reconnectOrphanedRuns(autoDispatcher.userId).catch((err) => {
    console.error('[ResearchOpsRunner] orphan reconnect scan failed:', err.message);
  });

  return getDispatcherState();
}

function stopAutoDispatch() {
  if (autoDispatcher.timer) {
    clearInterval(autoDispatcher.timer);
    autoDispatcher.timer = null;
  }
  autoDispatcher.tickInFlight = false;
  autoDispatcher.pendingTick = false;
}

function getRunningState() {
  return Array.from(runningProcesses.values()).map((item) => ({
    runId: item.runId,
    pid: item.pid,
    command: item.command,
    startedAt: item.startedAt,
    serverId: item.serverId || 'local-default',
    runType: item.runType || null,
    schemaVersion: item.schemaVersion || null,
  }));
}

function getDispatcherState() {
  return {
    enabled: autoDispatcher.enabled,
    userId: autoDispatcher.userId,
    intervalMs: autoDispatcher.intervalMs,
    maxLeasesPerTick: autoDispatcher.maxLeasesPerTick,
    unregisteredConcurrency: autoDispatcher.unregisteredConcurrency,
    staleRecoveryIntervalMs: autoDispatcher.staleRecoveryIntervalMs,
    staleMinutes: autoDispatcher.staleMinutes,
    tickInFlight: autoDispatcher.tickInFlight,
    lastTickAt: autoDispatcher.lastTickAt,
    lastError: autoDispatcher.lastError || null,
    lastSummary: autoDispatcher.lastSummary,
    lastDispatchedRunIds: autoDispatcher.lastDispatchedRunIds,
    lastRecoveryAt: autoDispatcher.lastRecoveryAt,
    lastRecoveryResult: autoDispatcher.lastRecoveryResult,
  };
}

module.exports = {
  executeRun,
  cancelRun,
  leaseAndExecuteNext,
  recoverStaleRuns,
  reconnectOrphanedRuns,
  startAutoDispatch,
  stopAutoDispatch,
  getDispatcherState,
  getRunningState,
};
