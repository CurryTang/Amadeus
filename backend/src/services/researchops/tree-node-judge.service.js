'use strict';

const codexCliService = require('../codex-cli.service');
const llmService = require('../llm.service');
const { normalizeJudgeState } = require('./tree-state.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampInt(value, fallback = 0, min = 0, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function parseJsonObject(text = '') {
  const raw = cleanString(text);
  if (!raw) return null;
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {
    // noop
  }
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {
    return null;
  }
  return null;
}

function normalizeVerdict(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (['pass', 'revise', 'fail'].includes(normalized)) return normalized;
  return 'fail';
}

function parseJudgeResponse(rawText = '') {
  const raw = String(rawText || '').trim();
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      verdict: 'fail',
      summary: 'Judge failed to parse structured output.',
      issues: [],
      refinementPrompt: '',
      confidence: 0,
      rawText: raw,
      technicalFailure: true,
    };
  }

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const confidenceValue = Number(parsed.confidence);
  return {
    verdict: normalizeVerdict(parsed.verdict),
    summary: cleanString(parsed.summary),
    issues,
    refinementPrompt: cleanString(parsed.refinementPrompt),
    confidence: Number.isFinite(confidenceValue) ? confidenceValue : 0,
    rawText: raw,
    technicalFailure: false,
  };
}

function decideJudgeNextAction({
  verdict = '',
  mode = 'manual',
  iteration = 0,
  maxIterations = 5,
} = {}) {
  const normalizedVerdict = normalizeVerdict(verdict);
  const normalizedMode = normalizeJudgeState({ mode }).mode;
  const nextIteration = clampInt(iteration, 0, 0, 100);
  const max = clampInt(maxIterations, 5, 1, 100);
  if (normalizedVerdict === 'pass') {
    return { action: 'complete', needsReview: false };
  }
  if (normalizedVerdict === 'revise' && normalizedMode === 'auto' && nextIteration < max) {
    return { action: 'retry', needsReview: false };
  }
  return { action: 'needs_review', needsReview: true };
}

function buildJudgePrompt({ node = {}, run = {}, judgeState = {}, reportSummary = '' } = {}) {
  const normalizedJudgeState = normalizeJudgeState(judgeState);
  const assumption = Array.isArray(node.assumption) ? node.assumption.map((item) => cleanString(item)).filter(Boolean) : [];
  const target = Array.isArray(node.target) ? node.target.map((item) => cleanString(item)).filter(Boolean) : [];
  const checks = Array.isArray(node.checks) ? node.checks : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  const content = [
    `Node: ${cleanString(node.title) || cleanString(node.id) || 'Untitled node'}`,
    `Kind: ${cleanString(node.kind) || 'experiment'}`,
    `Run status: ${cleanString(run.status).toUpperCase() || 'UNKNOWN'}`,
    assumption.length > 0 ? `Assumptions:\n- ${assumption.join('\n- ')}` : '',
    target.length > 0 ? `Targets:\n- ${target.join('\n- ')}` : '',
    checks.length > 0 ? `Checks:\n- ${checks.map((item) => `${cleanString(item.name || item.type)} (${cleanString(item.type)})`).join('\n- ')}` : '',
    commands.length > 0 ? `Commands:\n- ${commands.map((item) => cleanString(item?.cmd || item?.run || item)).filter(Boolean).join('\n- ')}` : '',
    reportSummary ? `Run report summary:\n${reportSummary}` : '',
    normalizedJudgeState.history?.length
      ? `Prior judge history:\n${normalizedJudgeState.history.map((item) => `- ${cleanString(item.verdict)}: ${cleanString(item.summary)}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const prompt = [
    'You are the post-run judge for a research tree node.',
    'Evaluate whether the run output is acceptable for this node.',
    'Return ONLY raw JSON with this exact shape:',
    '{"verdict":"pass|revise|fail","summary":"one sentence","issues":["specific issue"],"refinementPrompt":"next-run guidance","confidence":0.0}',
    'Use "pass" only when the output is good enough to proceed.',
    'Use "revise" when another run could fix the problems.',
    'Use "fail" when the output should stop for human review.',
  ].join('\n');

  return { content, prompt };
}

async function callJudgeModel(content = '', prompt = '') {
  if (await codexCliService.isAvailable()) {
    const result = await codexCliService.readMarkdown(content, prompt, { timeout: 120000 });
    return String(result?.text || '').trim();
  }
  const result = await llmService.generateWithFallback(content, prompt, ['anthropic', 'openai', 'gemini']);
  return String(result?.text || '').trim();
}

async function judgeNodeRun({
  node = {},
  run = {},
  reportSummary = '',
  judgeState = {},
} = {}) {
  const { content, prompt } = buildJudgePrompt({ node, run, judgeState, reportSummary });
  const rawText = await callJudgeModel(content, prompt);
  return parseJudgeResponse(rawText);
}

module.exports = {
  parseJudgeResponse,
  decideJudgeNextAction,
  buildJudgePrompt,
  judgeNodeRun,
};
