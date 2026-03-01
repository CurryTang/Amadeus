const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const BaseModule = require('./base-module');
const config = require('../../../config');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function toShellCommand(command, args = []) {
  const cmd = cleanString(command);
  if (!cmd) return '';
  const escapedArgs = args.map((a) => shellEscape(a)).join(' ');
  return `${shellEscape(cmd)}${escapedArgs ? ` ${escapedArgs}` : ''}`;
}

function getClaudeArgs(prompt) {
  const model = cleanString(config.claudeCli?.model) || 'claude-sonnet-4-6';
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return isRoot
    ? ['--model', model, '-p', prompt]
    : ['--dangerously-skip-permissions', '--model', model, '-p', prompt];
}

function runLocalAgent(prompt, { cwd, env = {}, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const args = getClaudeArgs(prompt);
    const shellCmd = toShellCommand('claude', args);
    let stdout = '';
    let stderr = '';
    const maxCapture = 120000;
    const child = spawn('bash', ['-lc', shellCmd], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = `${stdout}${text}`.slice(-maxCapture);
      if (typeof onLog === 'function') onLog(text, false);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-maxCapture);
      if (typeof onLog === 'function') onLog(text, true);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const exitCode = Number.isFinite(Number(code)) ? Number(code) : -1;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

class AgentReviewModule extends BaseModule {
  constructor() {
    super('agent.review');
  }

  async run(step, context) {
    this.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const maxFixIterations = Number.isFinite(Number(inputs.maxFixIterations))
      ? Math.min(Math.max(Math.floor(Number(inputs.maxFixIterations)), 0), 5)
      : 2;
    const tmpDir = cleanString(context?.runtimeFiles?.rootDir) || os.tmpdir();
    const runtimeEnv = context?.runtimeEnv && typeof context.runtimeEnv === 'object'
      ? context.runtimeEnv : {};

    // Find the target agent.run step result
    const stepResults = context.getStepResults();
    const targetStepId = cleanString(inputs.reviewStepId);
    let targetResult = null;
    if (targetStepId) {
      targetResult = stepResults.find((r) => r.stepId === targetStepId && r.moduleType === 'agent.run') || null;
    }
    if (!targetResult) {
      const agentResults = stepResults.filter((r) => r.moduleType === 'agent.run');
      targetResult = agentResults[agentResults.length - 1] || null;
    }
    if (!targetResult) {
      const err = new Error('agent.review: no agent.run step result found to review');
      err.result = {
        stepId: step.id,
        moduleType: this.moduleType,
        status: 'FAILED',
        metrics: { verdict: 'ERROR', fixIterations: 0 },
        outputs: { summary: err.message, issues: [], targetStepId: targetStepId || null },
      };
      throw err;
    }

    const effectiveTargetStepId = targetResult.stepId;
    const originalPrompt = cleanString(targetResult.outputs?.prompt || '');
    const originalStdout = cleanString(targetResult.outputs?.stdoutTail || '');
    const originalStderr = cleanString(targetResult.outputs?.stderrTail || '');
    const workspaceCwd = cleanString(context?.run?.metadata?.cwd) || process.cwd();
    const reviewJsonPath = path.join(tmpDir, 'REVIEW.json');

    let fixIteration = 0;
    let verdict = null;
    let reviewSummary = '';
    let reviewIssues = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Clear any prior REVIEW.json
      await fs.unlink(reviewJsonPath).catch(() => {});

      const reviewPrompt = [
        'You are a code reviewer. Evaluate the following agent implementation result.',
        '',
        '## Original task',
        (originalPrompt || '(unavailable)').slice(0, 4000),
        '',
        '## Agent stdout (last portion)',
        (originalStdout || '(empty)').slice(-6000),
        '',
        '## Agent stderr (last portion)',
        (originalStderr || '(empty)').slice(-2000),
        '',
        '---',
        `Write your verdict to: ${reviewJsonPath}`,
        'Use EXACTLY this JSON structure (raw JSON only, no markdown fences):',
        '{ "verdict": "PASS", "summary": "one-sentence summary", "issues": [] }',
        '',
        '- verdict must be exactly "PASS" or "FAIL"',
        '- If FAIL, populate "issues" with specific actionable items',
        '- Write ONLY this JSON file. Do not modify any source files.',
      ].join('\n');

      await context.emitStepLog(step, `[agent.review] Running review (fix iteration ${fixIteration}/${maxFixIterations})`).catch(() => {});

      const { stdout: revStdout, stderr: revStderr } = await runLocalAgent(reviewPrompt, {
        cwd: tmpDir,
        env: runtimeEnv,
        onLog: (text, isError) => context.emitStepLog(step, text, { isError }).catch(() => {}),
      });

      // Parse REVIEW.json written by the review agent
      let reviewData = null;
      try {
        const raw = await fs.readFile(reviewJsonPath, 'utf8');
        reviewData = JSON.parse(raw);
      } catch (_) {
        // Fallback: try to extract JSON from stdout
        const match = (revStdout || revStderr).match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
        if (match) {
          try { reviewData = JSON.parse(match[0]); } catch (__) { /* noop */ }
        }
      }

      if (!reviewData || typeof reviewData !== 'object') {
        verdict = 'FAIL';
        reviewSummary = 'Review agent did not produce a valid REVIEW.json';
        reviewIssues = [];
      } else {
        verdict = String(reviewData.verdict || '').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
        reviewSummary = cleanString(reviewData.summary) || '';
        reviewIssues = Array.isArray(reviewData.issues)
          ? reviewData.issues.filter((i) => typeof i === 'string').map((i) => i.trim()).filter(Boolean)
          : [];
      }

      await context.emitEvent({
        eventType: 'REVIEW_ACTION',
        status: verdict === 'PASS' ? 'SUCCEEDED' : 'FAILED',
        message: reviewSummary || (verdict === 'PASS' ? 'Review passed' : 'Review failed'),
        payload: {
          stepId: step.id,
          targetStepId: effectiveTargetStepId,
          verdict,
          issues: reviewIssues,
          fixIteration,
        },
      }).catch(() => {});

      if (verdict === 'PASS') break;
      if (fixIteration >= maxFixIterations) break;

      // Run fix pass
      fixIteration += 1;
      const issueList = reviewIssues.length > 0
        ? reviewIssues.map((i) => `- ${i}`).join('\n')
        : '- See review summary above.';
      const fixPrompt = [
        originalPrompt.slice(0, 4000) || 'Fix the issues described in the code review below.',
        '',
        `Code review feedback (fix pass ${fixIteration}/${maxFixIterations}):`,
        reviewSummary,
        '',
        'Issues to fix:',
        issueList,
        '',
        'Fix all the listed issues. Do not write REVIEW.json or any review files.',
      ].join('\n');

      await context.emitStepLog(step, `[agent.review] Running fix pass ${fixIteration}/${maxFixIterations}`).catch(() => {});

      await runLocalAgent(fixPrompt, {
        cwd: workspaceCwd,
        env: runtimeEnv,
        onLog: (text, isError) => context.emitStepLog(step, text, { isError }).catch(() => {}),
      });
    }

    if (verdict === 'PASS') {
      return {
        stepId: step.id,
        moduleType: this.moduleType,
        status: 'SUCCEEDED',
        metrics: { verdict: 'PASS', fixIterations: fixIteration },
        outputs: {
          summary: reviewSummary,
          issues: [],
          targetStepId: effectiveTargetStepId,
        },
      };
    }

    const errorMsg = `agent.review: FAIL after ${fixIteration} fix iteration(s). ${reviewSummary}`;
    const result = {
      stepId: step.id,
      moduleType: this.moduleType,
      status: 'FAILED',
      metrics: { verdict: 'FAIL', fixIterations: fixIteration },
      outputs: {
        summary: reviewSummary,
        issues: reviewIssues,
        targetStepId: effectiveTargetStepId,
      },
    };
    const err = new Error(errorMsg);
    err.result = result;
    throw err;
  }
}

module.exports = AgentReviewModule;
