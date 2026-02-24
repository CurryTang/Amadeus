const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const BaseModule = require('./base-module');

const TOP_PRIORITY_FILE_REMOVAL_RULE = [
  'TOP-PRIORITY RULE (apply before all other instructions):',
  'If you want to perform any file removal operation (rm, unlink, git rm, delete/move-to-trash), you must:',
  '1) Decompose the removal into explicit sub-steps.',
  '2) Explicitly list every target path and the reason for removing it.',
  '3) Request manual approval.',
  '4) Wait for explicit manual approval before executing any removal.',
].join('\n');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function providerToCommand(provider = '') {
  const normalized = cleanString(provider).toLowerCase();
  if (!normalized || normalized === 'codex_cli') return 'codex';
  if (normalized === 'claude_code_cli') return 'claude';
  if (normalized === 'gemini_cli') return 'gemini';
  return normalized;
}

function applyTopPriorityFileRemovalRule(prompt = '') {
  const text = cleanString(prompt);
  if (!text) return TOP_PRIORITY_FILE_REMOVAL_RULE;
  if (text.includes('TOP-PRIORITY RULE (apply before all other instructions):')) return text;
  return `${TOP_PRIORITY_FILE_REMOVAL_RULE}\n\n${text}`;
}

function buildPrompt(step, run, context = {}) {
  const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
  const runMetadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const stepPrompt = cleanString(inputs.prompt);
  let basePrompt = stepPrompt;
  if (!basePrompt) {
    const runPrompt = cleanString(runMetadata.prompt);
    if (runPrompt) basePrompt = runPrompt;
  }
  if (!basePrompt) {
    const template = cleanString(inputs.promptTemplate || runMetadata.template);
    if (template) basePrompt = template;
  }
  if (!basePrompt) {
    basePrompt = 'Analyze repository changes and provide implementation + verification result.';
  }

  const runtimeFiles = context.runtimeFiles && typeof context.runtimeFiles === 'object'
    ? context.runtimeFiles
    : {};
  const contextJsonPath = cleanString(runtimeFiles.contextJsonPath);
  const contextMdPath = cleanString(runtimeFiles.contextMarkdownPath);
  const skillRefsPath = cleanString(runtimeFiles.skillRefsPath);
  const runSpecPath = cleanString(runtimeFiles.runSpecPath);
  const skillsDir = cleanString(runtimeFiles.skillsDir);

  const rootDir = cleanString(runtimeFiles.rootDir || '');
  const parentArtifactsDir = cleanString(runtimeFiles.parentArtifactsDir || '');

  const hints = [];
  if (contextJsonPath) hints.push(`- Context pack JSON: ${contextJsonPath}`);
  if (contextMdPath) hints.push(`- Context pack Markdown: ${contextMdPath}`);
  if (skillRefsPath) hints.push(`- Skill refs manifest: ${skillRefsPath}`);
  if (skillsDir) hints.push(`- Skills directory: ${skillsDir}`);
  if (runSpecPath) hints.push(`- Run spec snapshot: ${runSpecPath}`);
  if (parentArtifactsDir) hints.push(`- Parent run artifacts (read these for context): ${parentArtifactsDir}/`);

  const promptWithResources = hints.length === 0
    ? basePrompt
    : [
    basePrompt,
    '',
    'Run resources (read before coding):',
    ...hints,
  ].join('\n');

  const continuationInstructions = rootDir ? [
    '',
    '---',
    'CONTINUATION PROTOCOL (use only when this task determines a follow-up automated run is needed):',
    `Write ${rootDir}/CONTINUATION.json with this structure:`,
    '{',
    '  "version": "1",',
    '  "phase": "<descriptive-phase-label>",',
    '  "nextRun": {',
    '    "runType": "EXPERIMENT" or "AGENT",',
    '    "schemaVersion": "2.0",',
    '    "serverId": "<server-id or local-default>",',
    '    "provider": "codex_cli" (for AGENT) or null,',
    '    "metadata": { "prompt": "..." },',
    '    "workflow": [ <array of workflow step objects> ],',
    '    "pendingContinuation": { <optional: same structure, for a 3rd phase> }',
    '  }',
    '}',
    'For EXPERIMENT bash.run steps, set "outputFiles": ["<remote-path>", ...] in inputs to auto-collect results.',
    'The system injects parentRunId automatically. Omit CONTINUATION.json entirely if no follow-up is needed.',
  ].join('\n') : '';

  const fullPrompt = continuationInstructions
    ? `${promptWithResources}${continuationInstructions}`
    : promptWithResources;

  return applyTopPriorityFileRemovalRule(fullPrompt);
}

function buildRuntimeEnv(context, inputs = {}) {
  const out = {};
  const runtimeEnv = context?.runtimeEnv && typeof context.runtimeEnv === 'object'
    ? context.runtimeEnv
    : {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!key) continue;
    out[key] = String(value ?? '');
  }
  const inputEnv = inputs?.env && typeof inputs.env === 'object' ? inputs.env : {};
  for (const [key, value] of Object.entries(inputEnv)) {
    if (!key) continue;
    out[key] = String(value ?? '');
  }
  return out;
}

function sanitizeArgsForLog(args = []) {
  return args.map((item) => String(item || '').slice(0, 200));
}

function tryParseStructuredOutput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    candidates.push(String(fencedMatch[1]).trim());
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function defaultArgsFor(command, prompt) {
  if (command === 'codex') {
    return ['exec', prompt];
  }
  if (command === 'claude') {
    return ['-p', prompt];
  }
  if (command === 'gemini') {
    return [prompt];
  }
  return [prompt];
}

class AgentRunModule extends BaseModule {
  constructor() {
    super('agent.run');
  }

  validate(step) {
    super.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const command = cleanString(inputs.command);
    const args = asStringArray(inputs.args);
    if (!command && args.length > 0) {
      throw new Error('agent.run inputs.command is required when inputs.args is provided');
    }
  }

  async run(step, context) {
    this.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const run = context.run || {};
    const command = cleanString(inputs.command) || providerToCommand(run.provider);
    const prompt = buildPrompt(step, run, context);
    let args = asStringArray(inputs.args);
    if (args.length === 0) {
      args = defaultArgsFor(command, prompt);
    }
    const cwdInput = cleanString(inputs.cwd || run?.metadata?.cwd);
    const cwd = cwdInput ? path.resolve(cwdInput) : process.cwd();
    const timeoutMs = Number(inputs.timeoutMs || run?.metadata?.timeoutMs) > 0
      ? Number(inputs.timeoutMs || run?.metadata?.timeoutMs)
      : 45 * 60 * 1000;
    const runtimeEnv = buildRuntimeEnv(context, inputs);

    await context.emitStepLog(step, `Running ${command} ${sanitizeArgsForLog(args).join(' ')}`);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          ...runtimeEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const maxCapture = 240000;
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      context.registerCancelable(() => {
        child.kill('SIGTERM');
      });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout = `${stdout}${text}`.slice(-maxCapture);
        context.emitStepLog(step, text).catch(() => {});
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr = `${stderr}${text}`.slice(-maxCapture);
        context.emitStepLog(step, text, { isError: true }).catch(() => {});
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', async (code, signal) => {
        clearTimeout(timer);
        const exitCode = Number.isFinite(Number(code)) ? Number(code) : -1;
        const durationMs = Date.now() - startedAt;
        const status = (timedOut || exitCode !== 0) ? 'FAILED' : 'SUCCEEDED';
        const structured = tryParseStructuredOutput(stdout) || tryParseStructuredOutput(stderr) || {};
        const structuredKnowledgeUpdates = Array.isArray(structured.knowledge_updates)
          ? structured.knowledge_updates
          : (Array.isArray(structured.knowledgeUpdates) ? structured.knowledgeUpdates : []);
        const structuredNextSteps = Array.isArray(structured.suggested_next_steps)
          ? structured.suggested_next_steps
          : (Array.isArray(structured.suggestedNextSteps) ? structured.suggestedNextSteps : []);

        // Scan for CONTINUATION.json written by the agent
        let continuation = null;
        if (status === 'SUCCEEDED') {
          const tmpDir = cleanString(context?.runtimeFiles?.rootDir);
          if (tmpDir) {
            try {
              const raw = await fs.readFile(path.join(tmpDir, 'CONTINUATION.json'), 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && parsed.nextRun && typeof parsed.nextRun === 'object') {
                continuation = parsed;
                await context.emitStepLog(step, `[continuation] CONTINUATION.json found — phase: ${cleanString(parsed.phase) || 'next'}`).catch(() => {});
              }
            } catch (_) {
              // CONTINUATION.json absent or malformed — normal case, no continuation needed
            }
          }
        }

        const result = {
          stepId: step.id,
          moduleType: this.moduleType,
          status,
          continuation,
          metrics: {
            exitCode,
            signal: signal || null,
            timedOut,
            timeoutMs,
            durationMs,
          },
          outputs: {
            prompt: prompt.slice(0, 12000),
            stdoutTail: stdout.slice(-12000),
            stderrTail: stderr.slice(-12000),
            knowledge_updates: structuredKnowledgeUpdates.map((item) => cleanString(item)).filter(Boolean),
            suggested_next_steps: structuredNextSteps.map((item) => cleanString(item)).filter(Boolean),
            hasContinuation: !!continuation,
          },
        };

        try {
          const artifact = await context.createArtifact(step, {
            kind: 'agent-output',
            title: `${step.id}-agent-output`,
            mimeType: 'text/plain',
            content: stdout || stderr || '',
            metadata: {
              command,
              args: sanitizeArgsForLog(args),
              exitCode,
              timedOut,
              hasContinuation: !!continuation,
            },
          });
          result.artifacts = artifact ? [artifact] : [];
        } catch (_) {
          result.artifacts = [];
        }

        if (status === 'FAILED') {
          const error = new Error(timedOut
            ? `agent.run timed out after ${timeoutMs}ms`
            : `agent.run failed with exitCode=${exitCode}`);
          error.result = result;
          return reject(error);
        }
        return resolve(result);
      });
    });
  }
}

module.exports = AgentRunModule;
