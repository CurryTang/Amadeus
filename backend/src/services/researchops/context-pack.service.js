const s3Service = require('../s3.service');
const knowledgeGroupsService = require('../knowledge-groups.service');
const knowledgeAssetsService = require('./knowledge-assets.service');

function normalizeUserId(userId) {
  const raw = String(userId || '').trim().toLowerCase();
  return raw || 'czk';
}

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeStringList(input, { max = 40 } = {}) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const value = cleanString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeIdList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const num = Number(item);
    if (!Number.isFinite(num)) continue;
    const id = Math.floor(num);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function summarizeText(text = '', max = 3000) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[truncated ${value.length - max} chars]`;
}

function toMarkdown(pack = {}) {
  const lines = [];
  lines.push(`# Knowledge Context Pack`);
  lines.push('');
  lines.push(`- projectId: ${pack.projectId || ''}`);
  lines.push(`- runId: ${pack.runId || ''}`);
  lines.push(`- generatedAt: ${pack.generatedAt || ''}`);
  lines.push('');

  if (Array.isArray(pack.groups) && pack.groups.length > 0) {
    lines.push('## Groups');
    lines.push('');
    for (const group of pack.groups) {
      lines.push(`- [${group.id}] ${group.name}${group.description ? ` - ${group.description}` : ''}`);
    }
    lines.push('');
  }

  if (Array.isArray(pack.documents) && pack.documents.length > 0) {
    lines.push('## Documents');
    lines.push('');
    for (const doc of pack.documents) {
      lines.push(`### #${doc.id} ${doc.title}`);
      if (doc.originalUrl) lines.push(`- url: ${doc.originalUrl}`);
      if (Array.isArray(doc.tags) && doc.tags.length > 0) lines.push(`- tags: ${doc.tags.join(', ')}`);
      lines.push('');
    }
  }

  if (Array.isArray(pack.assets) && pack.assets.length > 0) {
    lines.push('## Knowledge Assets');
    lines.push('');
    for (const asset of pack.assets) {
      lines.push(`### [${asset.assetType}] #${asset.id} ${asset.title}`);
      if (asset.summary) lines.push(`- summary: ${asset.summary}`);
      if (asset.sourceProvider) lines.push(`- sourceProvider: ${asset.sourceProvider}`);
      if (asset.sourceUrl) lines.push(`- sourceUrl: ${asset.sourceUrl}`);
      if (Array.isArray(asset.tags) && asset.tags.length > 0) lines.push(`- tags: ${asset.tags.join(', ')}`);
      const body = summarizeText(asset.bodyMd || '', 2500);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    }
  }

  if (Array.isArray(pack?.resourceHints?.paths) && pack.resourceHints.paths.length > 0) {
    lines.push('## Auto-located KB Resources');
    lines.push('');
    if (pack.resourceHints.query) lines.push(`- query: ${pack.resourceHints.query}`);
    pack.resourceHints.paths.slice(0, 30).forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function loadGroupSummaries(userId, groupIds = []) {
  const uid = normalizeUserId(userId);
  if (!groupIds.length) return [];
  const result = await knowledgeGroupsService.listKnowledgeGroups(uid, {
    ids: groupIds,
    limit: groupIds.length,
    offset: 0,
  });
  return result.items || [];
}

async function loadGroupDocuments(userId, groupIds = [], { limitPerGroup = 40 } = {}) {
  const uid = normalizeUserId(userId);
  const docs = [];
  const seen = new Set();
  for (const groupId of groupIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await knowledgeGroupsService.listKnowledgeGroupDocuments(uid, groupId, {
      limit: limitPerGroup,
      offset: 0,
    });
    const items = Array.isArray(result.items) ? result.items : [];
    for (const item of items) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      docs.push(item);
    }
  }
  return docs;
}

async function loadGroupAssets(userId, groupIds = [], { limitPerGroup = 60 } = {}) {
  const uid = normalizeUserId(userId);
  const assets = [];
  const seen = new Set();
  for (const groupId of groupIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await knowledgeAssetsService.listKnowledgeGroupAssets(uid, groupId, {
      limit: limitPerGroup,
      offset: 0,
      includeBody: true,
    });
    const items = Array.isArray(result.items) ? result.items : [];
    for (const item of items) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      assets.push(item);
    }
  }
  return assets;
}

function mapAssetForPack(asset = {}) {
  return {
    id: asset.id,
    assetType: asset.assetType,
    title: asset.title,
    summary: asset.summary || null,
    sourceProvider: cleanString(asset?.source?.provider),
    sourceUrl: cleanString(asset?.source?.url),
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    bodyMd: summarizeText(asset.bodyMd || '', 6000),
    file: asset.file || null,
    metadata: asset.metadata || {},
  };
}

function normalizeSelectedItem(item = {}) {
  const sourceRun = item?.item?.run || null;
  const sourceAsset = item?.item?.asset || null;
  const sourceType = sourceRun ? 'run' : (sourceAsset ? 'knowledge_asset' : String(item?.item?.type || 'unknown'));
  const sourceId = sourceRun?.id || sourceAsset?.id || item?.item?.id || '';
  return {
    bucket: cleanString(item.bucket),
    rank: Number(item.rank) || 0,
    score: Number(item.score) || 0,
    source_type: sourceType,
    source_id: String(sourceId || ''),
    reason: cleanString(item.reason || `selected from ${cleanString(item.bucket)}`),
    commit_aligned: Boolean(item.commit_aligned || false),
    preview: summarizeText(
      sourceRun?.lastMessage
      || sourceAsset?.summary
      || sourceAsset?.title
      || '',
      240
    ),
    raw: item.item || null,
  };
}

function allocateRoleContext(selectedItems = [], roleBudget = {}) {
  const topRuns = selectedItems
    .filter((item) => item.source_type === 'run')
    .slice(0, 12);
  const topAssets = selectedItems
    .filter((item) => item.source_type === 'knowledge_asset')
    .slice(0, 12);

  const contextForRunner = {
    budget_tokens: Number(roleBudget?.runner) || 0,
    focus: 'commands, checks, failure signatures, recent execution outcomes',
    items: topRuns.slice(0, 8),
  };
  const contextForCoder = {
    budget_tokens: Number(roleBudget?.coder) || 0,
    focus: 'interface hints, related files, prior code-oriented runs',
    items: [...topRuns.slice(0, 6), ...topAssets.slice(0, 4)].slice(0, 10),
  };
  const contextForAnalyst = {
    budget_tokens: Number(roleBudget?.analyst) || 0,
    focus: 'metrics interpretations, baseline comparisons, run summaries',
    items: topRuns.slice(0, 8),
  };
  const contextForWriter = {
    budget_tokens: Number(roleBudget?.writer) || 0,
    focus: 'milestones, conclusions, concise evidence snippets',
    items: topAssets.slice(0, 8),
  };

  return {
    context_for_runner: contextForRunner,
    context_for_coder: contextForCoder,
    context_for_analyst: contextForAnalyst,
    context_for_writer: contextForWriter,
  };
}

async function buildRoutedContextPack(userId, {
  runId = '',
  projectId = '',
  runIntent = {},
  routedContext = {},
} = {}) {
  const uid = normalizeUserId(userId);
  const selectedItems = Array.isArray(routedContext?.selected_items)
    ? routedContext.selected_items.map(normalizeSelectedItem)
    : [];
  const budgetReport = routedContext?.budget_report && typeof routedContext.budget_report === 'object'
    ? routedContext.budget_report
    : {
      total_budget_tokens: 12000,
      role_budget_tokens: {
        runner: 4200,
        coder: 4200,
        analyst: 2400,
        writer: 1200,
      },
      bucket_counts: {},
    };

  const roleContext = allocateRoleContext(selectedItems, budgetReport.role_budget_tokens);
  const pack = {
    schemaVersion: '2.0',
    userId: uid,
    projectId: cleanString(projectId),
    runId: cleanString(runId),
    generatedAt: new Date().toISOString(),
    run_intent: runIntent || {},
    rationale: summarizeText(
      routedContext?.rationale
      || `Context was routed for goal: ${cleanString(runIntent?.goal?.title || runIntent?.goal?.summary || '')}`,
      800
    ),
    selected_items: selectedItems,
    budget_report: budgetReport,
    trace: routedContext?.trace && typeof routedContext.trace === 'object'
      ? routedContext.trace
      : {},
    ...roleContext,
  };

  const markdownLines = [
    '# Routed Context Pack',
    '',
    `- projectId: ${pack.projectId}`,
    `- runId: ${pack.runId}`,
    `- generatedAt: ${pack.generatedAt}`,
    '',
    '## Goal',
    '',
    `- nodeId: ${cleanString(pack.run_intent?.goal?.nodeId)}`,
    `- title: ${cleanString(pack.run_intent?.goal?.title)}`,
    `- summary: ${cleanString(pack.run_intent?.goal?.summary)}`,
    '',
    '## Rationale',
    '',
    pack.rationale || '(none)',
    '',
    '## Selected Items',
    '',
  ];
  selectedItems.slice(0, 50).forEach((item) => {
    markdownLines.push(`- [${item.bucket}] ${item.source_type}:${item.source_id} (score=${item.score})`);
    if (item.preview) markdownLines.push(`  - ${item.preview}`);
  });
  markdownLines.push('');

  const markdown = `${markdownLines.join('\n')}\n`;
  const uploaded = await uploadPackArtifacts(runId, pack, markdown);
  return {
    ...pack,
    markdown,
    storage: uploaded,
  };
}

async function uploadPackArtifacts(runId, jsonPack, markdownPack) {
  const run = cleanString(runId);
  if (!run) return { json: null, markdown: null };
  const base = `runs/${run}/context`;
  const jsonKey = `${base}/knowledge-pack.json`;
  const mdKey = `${base}/knowledge-pack.md`;
  try {
    const [jsonUpload, mdUpload] = await Promise.all([
      s3Service.uploadBuffer(Buffer.from(JSON.stringify(jsonPack, null, 2), 'utf8'), jsonKey, 'application/json'),
      s3Service.uploadBuffer(Buffer.from(markdownPack, 'utf8'), mdKey, 'text/markdown'),
    ]);
    return {
      json: { key: jsonUpload.key, url: jsonUpload.location },
      markdown: { key: mdUpload.key, url: mdUpload.location },
    };
  } catch (error) {
    console.warn('[ContextPack] Upload failed, continuing without object storage links:', error.message);
    return { json: null, markdown: null };
  }
}

async function buildContextPack(userId, {
  runId = '',
  projectId = '',
  contextRefs = {},
  explicitAssetIds = [],
} = {}) {
  const uid = normalizeUserId(userId);
  const groupIds = normalizeIdList(contextRefs?.knowledgeGroupIds);
  const knowledgeAssetIds = normalizeIdList(contextRefs?.knowledgeAssetIds);
  const insightAssetIds = normalizeIdList(contextRefs?.insightAssetIds);
  const additionalAssetIds = normalizeIdList(explicitAssetIds);
  const mergedAssetIds = normalizeIdList([
    ...knowledgeAssetIds,
    ...insightAssetIds,
    ...additionalAssetIds,
  ]);
  const kbResourcePaths = normalizeStringList(contextRefs?.kbResourcePaths, { max: 40 });
  const kbResourceQuery = cleanString(contextRefs?.kbResourceQuery);

  const [groups, groupDocs, groupAssets, directAssets] = await Promise.all([
    loadGroupSummaries(uid, groupIds),
    loadGroupDocuments(uid, groupIds),
    loadGroupAssets(uid, groupIds),
    knowledgeAssetsService.listAssetsByIds(uid, mergedAssetIds, { includeBody: true }),
  ]);

  const assetById = new Map();
  for (const item of [...groupAssets, ...directAssets]) {
    if (!item?.id) continue;
    assetById.set(Number(item.id), item);
  }
  const assets = Array.from(assetById.values()).map(mapAssetForPack);

  const pack = {
    projectId: cleanString(projectId),
    runId: cleanString(runId),
    generatedAt: new Date().toISOString(),
    groups: (groups || []).map((group) => ({
      id: Number(group.id),
      name: group.name,
      description: group.description || null,
      documentCount: Number(group.documentCount || 0),
    })),
    documents: (groupDocs || []).map((doc) => ({
      id: Number(doc.id),
      title: doc.title,
      originalUrl: doc.originalUrl || null,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      isRead: Boolean(doc.isRead),
      linkedAt: doc.linkedAt || null,
    })),
    assets,
    refs: {
      knowledgeGroupIds: groupIds,
      knowledgeAssetIds: mergedAssetIds,
      kbResourceQuery,
      kbResourcePaths,
    },
  };

  if (kbResourcePaths.length > 0) {
    pack.resourceHints = {
      query: kbResourceQuery,
      paths: kbResourcePaths,
    };
  }

  const markdown = toMarkdown(pack);
  const uploaded = await uploadPackArtifacts(runId, pack, markdown);
  return {
    ...pack,
    markdown,
    storage: uploaded,
  };
}

module.exports = {
  buildContextPack,
  buildRoutedContextPack,
};
