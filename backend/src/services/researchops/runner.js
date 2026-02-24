const { spawn } = require('child_process');
const path = require('path');
const store = require('./store');
const orchestrator = require('./orchestrator');

const runningProcesses = new Map();

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function getProviderCommand(provider) {
  const p = asString(provider).toLowerCase();
  if (!p || p === 'codex_cli') return 'codex';
  if (p === 'gemini_cli') return 'gemini';
  if (p === 'claude_code_cli') return 'claude';
  return p;
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
    const command = asString(metadata.command) || getProviderCommand(run.provider);
    let args = asStringArray(metadata.args);
    if (args.length === 0) {
      const prompt = buildPrompt(metadata);
      if (command === 'codex') {
        args = ['exec', prompt];
      } else if (command === 'claude') {
        args = ['-p', prompt];
      } else if (command === 'gemini') {
        args = [prompt];
      } else {
        args = [prompt];
      }
    }
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

async function executeRun(userId, run) {
  const uid = String(userId || '').trim().toLowerCase() || 'czk';
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

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const processState = {
    runId: run.id,
    pid: child.pid,
    command: spec.command,
    startedAt: new Date().toISOString(),
    timer: null,
    child,
    cancel: null,
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
      await store.updateRunStatus(uid, run.id, 'FAILED', `Runner error: ${error.message}`);
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
      if (exitCode === 0) {
        await store.updateRunStatus(uid, run.id, 'SUCCEEDED', resultLine);
      } else {
        const current = await store.getRun(uid, run.id);
        if (current?.status !== 'CANCELLED') {
          await store.updateRunStatus(uid, run.id, 'FAILED', resultLine);
        }
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
      child.kill('SIGTERM');
    }, spec.timeoutMs);
    if (typeof processState.timer.unref === 'function') processState.timer.unref();
  }

  return { started: true, pid: child.pid };
}

async function cancelRun(userId, runId) {
  const uid = String(userId || '').trim().toLowerCase() || 'czk';
  const state = runningProcesses.get(runId);
  if (state) {
    if (typeof state.cancel === 'function') {
      state.cancel();
    }
    if (state.child && typeof state.child.kill === 'function') {
      state.child.kill('SIGTERM');
    }
    if (state.timer) clearTimeout(state.timer);
    runningProcesses.delete(runId);
  }
  const updated = await store.updateRunStatus(uid, runId, 'CANCELLED', 'Cancelled via API');
  return updated;
}

async function leaseAndExecuteNext(userId, serverId = 'local-default') {
  const uid = String(userId || '').trim().toLowerCase() || 'czk';
  const leased = await store.leaseNextRun(uid, { serverId, allowUnregisteredServer: true });
  if (!leased.leased || !leased.run) return leased;
  await executeRun(uid, leased.run);
  return leased;
}

function getRunningState() {
  return Array.from(runningProcesses.values()).map((item) => ({
    runId: item.runId,
    pid: item.pid,
    command: item.command,
    startedAt: item.startedAt,
  }));
}

module.exports = {
  executeRun,
  cancelRun,
  leaseAndExecuteNext,
  getRunningState,
};
