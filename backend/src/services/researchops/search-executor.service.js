const crypto = require('crypto');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback, min = 1, max = 1000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function defaultSearchConfig(search = {}) {
  const budget = search?.budget && typeof search.budget === 'object' ? search.budget : {};
  const worktree = search?.worktree && typeof search.worktree === 'object' ? search.worktree : {};
  return {
    algorithm: cleanString(search?.algorithm) || 'mcts',
    budget: {
      max_trials: toInt(budget.max_trials, 24, 1, 500),
      parallel: toInt(budget.parallel, 4, 1, 32),
      max_depth: toInt(budget.max_depth, 3, 1, 16),
      max_gpu_hours: Number.isFinite(Number(budget.max_gpu_hours)) ? Number(budget.max_gpu_hours) : 2,
    },
    worktree: {
      root: cleanString(worktree.root) || '.worktrees',
      strategy: cleanString(worktree.strategy) || 'per_trial',
      keep: worktree.keep && typeof worktree.keep === 'object'
        ? worktree.keep
        : { policy: 'keep_best_and_failures_with_new_signal', topk: 3 },
    },
    actions: Array.isArray(search?.actions) ? search.actions : [],
    rollout: search?.rollout && typeof search.rollout === 'object' ? search.rollout : { stages: [] },
    reward: search?.reward && typeof search.reward === 'object' ? search.reward : {
      type: 'weighted',
      terms: [
        { kind: 'check', name: 'exit_code_zero', weight: 5 },
        { kind: 'cost', key: 'walltime_min', weight: -0.1 },
      ],
    },
    promote: search?.promote && typeof search.promote === 'object' ? search.promote : {
      policy: 'best_passed',
    },
  };
}

function extractCommandCandidates(node = {}) {
  const commands = [];
  const rolloutStages = Array.isArray(node?.search?.rollout?.stages) ? node.search.rollout.stages : [];
  rolloutStages.forEach((stage) => {
    const stageCommands = Array.isArray(stage?.commands) ? stage.commands : [];
    stageCommands.forEach((command) => {
      const text = cleanString(command);
      if (text) commands.push(text);
    });
  });

  if (commands.length > 0) return commands;

  const nodeCommands = Array.isArray(node.commands) ? node.commands : [];
  nodeCommands.forEach((item) => {
    if (typeof item === 'string') {
      const text = cleanString(item);
      if (text) commands.push(text);
      return;
    }
    const text = cleanString(item?.run);
    if (text) commands.push(text);
  });

  return commands;
}

function buildTrialId(nodeId = '') {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `trial_${cleanString(nodeId) || 'node'}_${token}`;
}

function buildFingerprint({ baseCommit = '', command = '', trialId = '', env = {} } = {}) {
  const serialized = JSON.stringify({
    baseCommit: cleanString(baseCommit),
    command: cleanString(command),
    trialId: cleanString(trialId),
    env,
  });
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

async function enqueueSearchTrials({
  userId,
  project,
  node,
  searchState,
  store,
  runner,
  count = 1,
}) {
  const searchConfig = defaultSearchConfig(node.search || {});
  const commands = extractCommandCandidates(node);
  const requested = toInt(count, 1, 1, searchConfig.budget.parallel);
  const queuedTrials = [];

  for (let i = 0; i < requested; i += 1) {
    const command = commands[i % Math.max(commands.length, 1)] || 'echo "search trial noop"';
    const trialId = buildTrialId(node.id);
    const runMetadata = {
      nodeId: node.id,
      searchNodeId: node.id,
      trialId,
      runIntentSource: 'search',
      experimentCommand: command,
      searchAlgorithm: searchConfig.algorithm,
      baseCommit: cleanString(node?.git?.base) || 'HEAD',
    };

    // Queue an EXPERIMENT run for each trial. Keep command in metadata for runner compatibility.
    // The existing runner uses metadata.command + metadata.args for EXPERIMENT.
    // eslint-disable-next-line no-await-in-loop
    const run = await store.enqueueRun(userId, {
      projectId: project.id,
      serverId: cleanString(project.serverId) || 'local-default',
      runType: 'EXPERIMENT',
      schemaVersion: '2.0',
      metadata: {
        ...runMetadata,
        command: 'bash',
        args: ['-lc', command],
      },
    });

    // Best-effort immediate execution for interactive behavior.
    // eslint-disable-next-line no-await-in-loop
    await runner.executeRun(userId, run).catch(() => {});

    const trial = {
      id: trialId,
      nodeId: node.id,
      runId: run.id,
      status: 'QUEUED',
      command,
      reward: null,
      startedAt: null,
      endedAt: null,
      createdAt: nowIso(),
      worktree: {
        root: searchConfig.worktree.root,
        path: `${searchConfig.worktree.root}/${node.id}/${trialId}`,
        strategy: searchConfig.worktree.strategy,
      },
      fingerprint: {
        base_commit: cleanString(node?.git?.base) || 'HEAD',
        patch_hash: buildFingerprint({ baseCommit: node?.git?.base, command, trialId }),
        command_hash: buildFingerprint({ command }),
        env_hash: buildFingerprint({ env: {} }),
        dataset_version: cleanString(node?.search?.dataset_version) || 'unknown',
      },
    };
    queuedTrials.push(trial);
  }

  const existingTrials = Array.isArray(searchState?.trials) ? searchState.trials : [];
  const mergedTrials = [...existingTrials, ...queuedTrials].slice(-2000);

  return {
    searchNodeId: node.id,
    algorithm: searchConfig.algorithm,
    budget: searchConfig.budget,
    worktree: searchConfig.worktree,
    trials: mergedTrials,
    updatedAt: nowIso(),
  };
}

function computeTrialReward(trial = {}, run = null) {
  const base = {
    execSuccess: run?.status === 'SUCCEEDED' ? 1 : 0,
    walltimeMin: (() => {
      const started = Date.parse(run?.startedAt || trial?.startedAt || '');
      const ended = Date.parse(run?.endedAt || trial?.endedAt || '');
      if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return 0;
      return (ended - started) / 60000;
    })(),
  };

  let reward = 0;
  reward += base.execSuccess * 5;
  reward += -0.1 * base.walltimeMin;
  if (run?.status === 'FAILED') reward -= 2;
  return Number(reward.toFixed(4));
}

async function refreshSearchNodeTrials({ userId, searchNode = {}, store }) {
  const trials = Array.isArray(searchNode.trials) ? searchNode.trials : [];
  const refreshed = [];
  for (const trial of trials) {
    // eslint-disable-next-line no-await-in-loop
    const run = trial.runId ? await store.getRun(userId, trial.runId).catch(() => null) : null;
    const status = cleanString(run?.status || trial.status || 'UNKNOWN').toUpperCase();
    const reward = computeTrialReward(trial, run);
    refreshed.push({
      ...trial,
      status,
      reward,
      startedAt: run?.startedAt || trial.startedAt || null,
      endedAt: run?.endedAt || trial.endedAt || null,
      lastMessage: run?.lastMessage || trial.lastMessage || '',
    });
  }

  const best = refreshed
    .filter((item) => item.status === 'SUCCEEDED' || item.status === 'PASSED')
    .sort((a, b) => (b.reward || 0) - (a.reward || 0))[0]
    || refreshed.sort((a, b) => (b.reward || 0) - (a.reward || 0))[0]
    || null;

  return {
    ...searchNode,
    trials: refreshed,
    bestTrialId: best?.id || null,
    updatedAt: nowIso(),
  };
}

function buildPromotionPatch({ searchNode = {}, trial = {}, promotedNodeId = '' }) {
  const newId = cleanString(promotedNodeId) || `${cleanString(searchNode.id)}_promoted_${cleanString(trial.id)}`;
  return {
    op: 'add_node',
    node: {
      id: newId,
      parent: cleanString(searchNode.parent) || cleanString(searchNode.id),
      kind: 'experiment',
      title: `Promoted: ${cleanString(searchNode.title) || cleanString(searchNode.id)}`,
      assumption: Array.isArray(searchNode.assumption) ? searchNode.assumption : [],
      target: Array.isArray(searchNode.target) ? searchNode.target : [],
      commands: [
        {
          name: 'promoted_trial',
          run: cleanString(trial.command) || 'echo "promoted trial"',
        },
      ],
      checks: Array.isArray(searchNode.checks) ? searchNode.checks : [],
      git: {
        base: cleanString(searchNode?.git?.base) || 'HEAD',
      },
      tags: ['promoted', `from:${cleanString(searchNode.id)}`],
      ui: {
        promotedFromTrialId: cleanString(trial.id),
      },
    },
  };
}

module.exports = {
  defaultSearchConfig,
  enqueueSearchTrials,
  refreshSearchNodeTrials,
  buildPromotionPatch,
};
