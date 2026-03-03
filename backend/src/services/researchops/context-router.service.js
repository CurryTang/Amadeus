const path = require('path');
const knowledgeAssetsService = require('./knowledge-assets.service');
const failureSignatureService = require('./failure-signature.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function pickCommandStrings(commands = []) {
  const out = [];
  toArray(commands).forEach((item) => {
    if (typeof item === 'string') {
      const text = cleanString(item);
      if (text) out.push(text);
      return;
    }
    const text = cleanString(item?.run);
    if (text) out.push(text);
  });
  return out;
}

function inferTouchesFromCommands(commands = []) {
  const touches = new Set();
  const regex = /([\w./-]+\.(?:py|ts|tsx|js|jsx|sh|yaml|yml|toml|json|md))/g;
  commands.forEach((command) => {
    let match = regex.exec(command);
    while (match) {
      const token = cleanString(match[1]);
      if (token && !token.startsWith('-')) touches.add(token);
      match = regex.exec(command);
    }
  });
  return [...touches].slice(0, 40);
}

function normalizeChecks(checks = []) {
  return toArray(checks)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        name: cleanString(item.name) || cleanString(item.type),
        type: cleanString(item.type),
        key: cleanString(item.key),
        threshold: Number.isFinite(Number(item.gte)) ? Number(item.gte) : null,
        path: cleanString(item.path || item.file),
      };
    })
    .filter(Boolean);
}

function buildRunIntent({
  project = {},
  node = {},
  state = {},
  run = null,
  failureSignature = null,
} = {}) {
  const commands = pickCommandStrings(node.commands);
  const assumption = toArray(node.assumption).map((item) => cleanString(item)).filter(Boolean);
  const target = toArray(node.target).map((item) => cleanString(item)).filter(Boolean);
  const checks = normalizeChecks(node.checks);
  const touches = inferTouchesFromCommands(commands);
  const deps = [cleanString(node.parent), ...toArray(node.evidenceDeps).map((item) => cleanString(item))]
    .filter(Boolean);

  return {
    goal: {
      nodeId: cleanString(node.id),
      title: cleanString(node.title),
      summary: target[0] || cleanString(node.title),
      kind: cleanString(node.kind) || 'experiment',
    },
    assumptions: assumption,
    commands,
    touches,
    acceptance_checks: checks,
    deps,
    failure_signature: failureSignature || failureSignatureService.normalizeFailureSignature({
      run,
      node,
      state,
    }),
    base_commit: cleanString(node?.git?.base) || cleanString(run?.metadata?.gitAppliedCommit) || 'HEAD',
    config_fingerprint: cleanString(run?.metadata?.configFingerprint) || '',
    data_version: cleanString(run?.metadata?.dataVersion) || '',
    project_id: cleanString(project.id),
    generated_at: new Date().toISOString(),
  };
}

function scoreRunItem(run = {}, runIntent = {}) {
  let score = 0;
  if (cleanString(run?.metadata?.nodeId) === cleanString(runIntent?.goal?.nodeId)) score += 3;
  if (cleanString(run?.metadata?.experimentCommand) && runIntent.commands.some((c) => cleanString(run.metadata.experimentCommand).includes(c.slice(0, 20)))) {
    score += 2;
  }
  if (cleanString(run.status).toUpperCase() === 'SUCCEEDED') score += 1.5;
  if (cleanString(run.status).toUpperCase() === 'FAILED') score += 0.4;
  return score;
}

function uniqueTop(items = [], { key = 'id', limit = 8 } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const token = cleanString(item?.[key]) || JSON.stringify(item);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function collectRunBuckets(userId, projectId, runIntent, { store }) {
  const runs = await store.listRuns(userId, { projectId, limit: 400 });
  const withScore = runs
    .map((run) => ({
      id: run.id,
      type: 'run',
      run,
      score: scoreRunItem(run, runIntent),
    }))
    .sort((a, b) => b.score - a.score);

  const sameStep = uniqueTop(withScore.filter((item) => cleanString(item.run?.metadata?.nodeId) === cleanString(runIntent.goal.nodeId)), {
    key: 'id',
    limit: 8,
  });

  const sameCommand = uniqueTop(withScore.filter((item) => {
    const cmd = cleanString(item.run?.metadata?.experimentCommand || item.run?.metadata?.command || '');
    if (!cmd) return false;
    return runIntent.commands.some((token) => cmd.includes(token.slice(0, 30)));
  }), {
    key: 'id',
    limit: 8,
  });

  const sameFailure = uniqueTop(withScore.filter((item) => {
    if (cleanString(item.run?.status).toUpperCase() !== 'FAILED') return false;
    const sig = failureSignatureService.normalizeFailureSignature({ run: item.run });
    return sig.signature && sig.signature === runIntent.failure_signature?.signature;
  }), {
    key: 'id',
    limit: 8,
  });

  return {
    same_step_history: sameStep,
    same_command_or_script: sameCommand,
    same_failure_signature: sameFailure,
  };
}

async function collectKnowledgeBuckets(userId, project, runIntent) {
  const groupIds = Array.isArray(project?.knowledgeGroupIds) ? project.knowledgeGroupIds : [];
  if (groupIds.length === 0) {
    return {
      relevant_papers_and_notes: [],
      relevant_interfaces: [],
    };
  }

  const bucket = [];
  for (const groupId of groupIds.slice(0, 3)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await knowledgeAssetsService.listKnowledgeGroupAssets(userId, groupId, {
      limit: 120,
      offset: 0,
      includeBody: true,
    }).catch(() => ({ items: [] }));
    const items = Array.isArray(result.items) ? result.items : [];
    bucket.push(...items);
  }

  const touchesSet = new Set(runIntent.touches.map((item) => path.basename(item)));
  const scored = bucket.map((asset) => {
    const title = cleanString(asset?.title).toLowerCase();
    const body = cleanString(asset?.bodyMd || '').toLowerCase();
    let score = 0;
    runIntent.commands.forEach((command) => {
      const needle = cleanString(command).toLowerCase().slice(0, 32);
      if (!needle) return;
      if (title.includes(needle) || body.includes(needle)) score += 1.5;
    });
    touchesSet.forEach((touchName) => {
      const needle = cleanString(touchName).toLowerCase();
      if (!needle) return;
      if (title.includes(needle) || body.includes(needle)) score += 1;
    });
    return {
      id: String(asset.id),
      type: 'knowledge_asset',
      score,
      asset,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    relevant_papers_and_notes: uniqueTop(scored.filter((item) => item.score > 0), {
      key: 'id',
      limit: 10,
    }),
    relevant_interfaces: uniqueTop(scored.filter((item) => {
      const tags = Array.isArray(item.asset?.tags) ? item.asset.tags.map((tag) => String(tag).toLowerCase()) : [];
      return tags.some((tag) => tag.includes('interface') || tag.includes('api') || tag.includes('schema'));
    }), {
      key: 'id',
      limit: 10,
    }),
  };
}

function mergeBucketsWithBudget(buckets = {}, {
  totalBudget = 12000,
  roleWeights = {
    runner: 0.35,
    coder: 0.35,
    analyst: 0.2,
    writer: 0.1,
  },
} = {}) {
  const selectedItems = [];
  Object.entries(buckets).forEach(([bucketName, items]) => {
    const list = Array.isArray(items) ? items : [];
    list.forEach((item, index) => {
      selectedItems.push({
        bucket: bucketName,
        rank: index + 1,
        score: Number(item.score || 0),
        item,
      });
    });
  });

  const roleBudget = {
    runner: Math.floor(totalBudget * roleWeights.runner),
    coder: Math.floor(totalBudget * roleWeights.coder),
    analyst: Math.floor(totalBudget * roleWeights.analyst),
    writer: Math.floor(totalBudget * roleWeights.writer),
  };

  return {
    selected_items: selectedItems,
    budget_report: {
      total_budget_tokens: totalBudget,
      role_budget_tokens: roleBudget,
      bucket_counts: Object.fromEntries(
        Object.entries(buckets).map(([name, items]) => [name, Array.isArray(items) ? items.length : 0])
      ),
    },
  };
}

async function routeContextForIntent({ userId, project = {}, runIntent = {}, store }) {
  const [runBuckets, knowledgeBuckets] = await Promise.all([
    collectRunBuckets(userId, cleanString(project.id), runIntent, { store }),
    collectKnowledgeBuckets(userId, project, runIntent),
  ]);

  const buckets = {
    ...runBuckets,
    ...knowledgeBuckets,
  };
  const merged = mergeBucketsWithBudget(buckets);

  return {
    run_intent: runIntent,
    buckets,
    ...merged,
    trace: {
      rerank_features: ['commit_proximity', 'config_match', 'recent_success_rate', 'freshness_decay'],
      dedupe_rules: ['same_source_keep_highest_score', 'max_two_same_class_cross_bucket'],
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  buildRunIntent,
  routeContextForIntent,
};
