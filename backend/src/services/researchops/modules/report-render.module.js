const BaseModule = require('./base-module');
const observabilityAdapters = require('../observability-adapters.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((item) => cleanString(item)).filter(Boolean);
}

function normalizePathSuffix(pathValue = '') {
  return cleanString(pathValue).toLowerCase();
}

function isTableArtifact(artifact = {}) {
  const kind = cleanString(artifact.kind).toLowerCase();
  const mime = cleanString(artifact.mimeType).toLowerCase();
  const path = normalizePathSuffix(artifact.path);
  if (kind.includes('table')) return true;
  if (mime.includes('csv') || mime.includes('tab-separated-values')) return true;
  return path.endsWith('.csv') || path.endsWith('.tsv');
}

function isFigureArtifact(artifact = {}) {
  const kind = cleanString(artifact.kind).toLowerCase();
  const mime = cleanString(artifact.mimeType).toLowerCase();
  const path = normalizePathSuffix(artifact.path);
  if (kind.includes('figure') || kind.includes('plot') || kind.includes('chart')) return true;
  if (mime.startsWith('image/')) return true;
  return (
    path.endsWith('.png')
    || path.endsWith('.jpg')
    || path.endsWith('.jpeg')
    || path.endsWith('.gif')
    || path.endsWith('.svg')
    || path.endsWith('.webp')
  );
}

function isMetricArtifact(artifact = {}) {
  const kind = cleanString(artifact.kind).toLowerCase();
  const path = normalizePathSuffix(artifact.path);
  if (kind.includes('metric') || kind.includes('observability')) return true;
  return path.startsWith('metrics/') || path.includes('/metrics/');
}

function artifactDigest(artifact = {}) {
  return {
    id: artifact.id,
    stepId: artifact.stepId || null,
    kind: artifact.kind || 'artifact',
    title: artifact.title || null,
    path: artifact.path || null,
    mimeType: artifact.mimeType || null,
    objectUrl: artifact.objectUrl || null,
    inlinePreview: artifact?.metadata?.inlinePreview || null,
  };
}

function summarizeArtifacts(artifacts = []) {
  const digest = artifacts.map((item) => artifactDigest(item));
  return {
    digest,
    tables: digest.filter((item) => isTableArtifact(item)),
    figures: digest.filter((item) => isFigureArtifact(item)),
    metrics: digest.filter((item) => isMetricArtifact(item)),
  };
}

function matchesExpected(artifact = {}, expected = '') {
  const token = cleanString(expected).toLowerCase();
  if (!token) return true;
  const haystack = [
    cleanString(artifact.kind),
    cleanString(artifact.title),
    cleanString(artifact.path),
    cleanString(artifact?.metadata?.reportKey),
  ].join(' ').toLowerCase();
  return haystack.includes(token);
}

function validateContract(outputContract = {}, artifactSummary = {}) {
  const expectedTables = normalizeArray(outputContract.tables);
  const expectedFigures = normalizeArray(outputContract.figures);
  const tables = Array.isArray(artifactSummary.tables) ? artifactSummary.tables : [];
  const figures = Array.isArray(artifactSummary.figures) ? artifactSummary.figures : [];

  const missingTables = expectedTables.filter((token) => !tables.some((item) => matchesExpected(item, token)));
  const missingFigures = expectedFigures.filter((token) => !figures.some((item) => matchesExpected(item, token)));

  return {
    expectedTables,
    expectedFigures,
    missingTables,
    missingFigures,
    ok: missingTables.length === 0 && missingFigures.length === 0,
  };
}

function toMarkdown(
  run,
  contextPack,
  stepResults = [],
  artifactSummary = {},
  observability = {},
  contractValidation = {}
) {
  const lines = [];
  const digest = Array.isArray(artifactSummary.digest) ? artifactSummary.digest : [];
  const tables = Array.isArray(artifactSummary.tables) ? artifactSummary.tables : [];
  const figures = Array.isArray(artifactSummary.figures) ? artifactSummary.figures : [];
  const metrics = Array.isArray(artifactSummary.metrics) ? artifactSummary.metrics : [];

  lines.push('# Run Summary');
  lines.push('');
  lines.push(`- runId: ${run.id}`);
  lines.push(`- projectId: ${run.projectId}`);
  lines.push(`- schemaVersion: ${run.schemaVersion || '1.0'}`);
  lines.push(`- mode: ${run.mode || 'interactive'}`);
  lines.push(`- provider: ${run.provider || 'n/a'}`);
  lines.push(`- startedAt: ${run.startedAt || ''}`);
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push('');

  if (contextPack) {
    lines.push('## Context');
    lines.push('');
    lines.push(`- groups: ${(contextPack.groups || []).length}`);
    lines.push(`- documents: ${(contextPack.documents || []).length}`);
    lines.push(`- assets: ${(contextPack.assets || []).length}`);
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const step of stepResults) {
    lines.push(`- ${step.stepId} [${step.moduleType}] => ${step.status}`);
  }
  lines.push('');

  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- total: ${digest.length}`);
  lines.push(`- tables: ${tables.length}`);
  lines.push(`- figures: ${figures.length}`);
  lines.push(`- metrics: ${metrics.length}`);
  lines.push('');
  for (const artifact of digest.slice(0, 200)) {
    lines.push(`- ${artifact.kind || 'artifact'}: ${artifact.title || artifact.path || artifact.id}`);
  }
  lines.push('');

  if (tables.length > 0) {
    lines.push('## Tables');
    lines.push('');
    for (const item of tables.slice(0, 40)) {
      lines.push(`- ${item.title || item.path || item.id}`);
    }
    lines.push('');
  }

  if (figures.length > 0) {
    lines.push('## Figures');
    lines.push('');
    for (const item of figures.slice(0, 40)) {
      lines.push(`- ${item.title || item.path || item.id}`);
    }
    lines.push('');
  }

  if (isObject(contractValidation)) {
    const missingTables = Array.isArray(contractValidation.missingTables) ? contractValidation.missingTables : [];
    const missingFigures = Array.isArray(contractValidation.missingFigures) ? contractValidation.missingFigures : [];
    if (missingTables.length || missingFigures.length) {
      lines.push('## Contract Warnings');
      lines.push('');
      if (missingTables.length) lines.push(`- missing tables: ${missingTables.join(', ')}`);
      if (missingFigures.length) lines.push(`- missing figures: ${missingFigures.join(', ')}`);
      lines.push('');
    }
  }

  const sinks = isObject(observability.sinks) ? observability.sinks : {};
  if (Object.keys(sinks).length > 0 || (Array.isArray(observability.warnings) && observability.warnings.length > 0)) {
    lines.push('## Observability');
    lines.push('');
    if (sinks.wandb) lines.push(`- wandb: ${sinks.wandb.url || 'configured'}`);
    if (sinks.tensorboard) lines.push(`- tensorboard: ${sinks.tensorboard.url || 'configured'}`);
    if (Array.isArray(observability.warnings) && observability.warnings.length > 0) {
      for (const warning of observability.warnings) {
        lines.push(`- warning: ${warning}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

class ReportRenderModule extends BaseModule {
  constructor() {
    super('report.render');
  }

  async run(step, context) {
    const run = context.run || {};
    const stepResults = context.getStepResults();
    let artifacts = await context.listArtifacts();
    const contextPack = context.contextPack || null;

    let artifactSummary = summarizeArtifacts(artifacts);
    const baseManifest = {
      schemaVersion: '1.0',
      runId: run.id,
      projectId: run.projectId,
      generatedAt: new Date().toISOString(),
      summary: {
        stepCount: stepResults.length,
        artifactCount: artifacts.length,
        contextAssetCount: Array.isArray(contextPack?.assets) ? contextPack.assets.length : 0,
        contextDocumentCount: Array.isArray(contextPack?.documents) ? contextPack.documents.length : 0,
      },
      requiredArtifacts: run?.outputContract?.requiredArtifacts || [],
      steps: stepResults,
      artifacts: artifactSummary.digest,
      tables: artifactSummary.tables,
      figures: artifactSummary.figures,
      metrics: artifactSummary.metrics,
    };

    const observability = await observabilityAdapters.publishRunObservability(step, context, baseManifest);
    artifacts = await context.listArtifacts();
    artifactSummary = summarizeArtifacts(artifacts);
    const contractValidation = validateContract(run?.outputContract, artifactSummary);

    const manifest = {
      schemaVersion: '1.0',
      runId: run.id,
      projectId: run.projectId,
      generatedAt: new Date().toISOString(),
      summary: {
        stepCount: stepResults.length,
        artifactCount: artifacts.length,
        tableCount: artifactSummary.tables.length,
        figureCount: artifactSummary.figures.length,
        metricArtifactCount: artifactSummary.metrics.length,
        contextAssetCount: Array.isArray(contextPack?.assets) ? contextPack.assets.length : 0,
        contextDocumentCount: Array.isArray(contextPack?.documents) ? contextPack.documents.length : 0,
      },
      requiredArtifacts: run?.outputContract?.requiredArtifacts || [],
      contractValidation,
      steps: stepResults,
      artifacts: artifactSummary.digest,
      tables: artifactSummary.tables,
      figures: artifactSummary.figures,
      metrics: artifactSummary.metrics,
      observability,
    };

    const summaryMd = toMarkdown(
      run,
      contextPack,
      stepResults,
      artifactSummary,
      observability,
      contractValidation
    );

    const [summaryArtifact, manifestArtifact] = await Promise.all([
      context.createArtifact(step, {
        kind: 'run_summary_md',
        title: 'Run Summary',
        mimeType: 'text/markdown',
        content: summaryMd,
        pathHint: 'report/run_summary.md',
      }),
      context.createArtifact(step, {
        kind: 'result_manifest',
        title: 'Result Manifest',
        mimeType: 'application/json',
        content: JSON.stringify(manifest, null, 2),
        pathHint: 'report/result_manifest.json',
        metadata: {
          requiredArtifacts: run?.outputContract?.requiredArtifacts || [],
          contractValidation,
        },
      }),
    ]);

    return {
      stepId: step.id,
      moduleType: this.moduleType,
      status: 'SUCCEEDED',
      metrics: {
        artifactCount: 2,
        stepCount: stepResults.length,
        tableCount: artifactSummary.tables.length,
        figureCount: artifactSummary.figures.length,
      },
      outputs: {
        manifest,
      },
      artifacts: [summaryArtifact, manifestArtifact].filter(Boolean),
    };
  }
}

module.exports = ReportRenderModule;
