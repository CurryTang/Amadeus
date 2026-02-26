function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeObservability(run = {}) {
  const metadata = isPlainObject(run.metadata) ? run.metadata : {};
  const cfg = isPlainObject(metadata.observability) ? metadata.observability : {};
  const rawSinks = Array.isArray(cfg.sinks) ? cfg.sinks : [];
  const sinks = unique(rawSinks.map((item) => cleanString(item).toLowerCase()));

  if (sinks.length === 0) {
    if (cleanString(cfg.wandbUrl) || cleanString(cfg.wandbProject) || cleanString(cfg.wandbEntity)) {
      sinks.push('wandb');
    }
    if (cleanString(cfg.tensorboardUrl) || cleanString(cfg.tensorboardLogDir)) {
      sinks.push('tensorboard');
    }
  }

  return {
    ...cfg,
    sinks: sinks.filter((name) => name === 'wandb' || name === 'tensorboard'),
    strict: toBoolean(cfg.strict, false),
  };
}

function collectScalars(manifest = {}) {
  const scalars = [];
  const summary = isPlainObject(manifest.summary) ? manifest.summary : {};
  for (const [name, value] of Object.entries(summary)) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      scalars.push({ step: 0, tag: `summary.${name}`, value: num });
    }
  }

  const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = isPlainObject(steps[index]) ? steps[index] : {};
    const metrics = isPlainObject(step.metrics) ? step.metrics : {};
    const stepName = cleanString(step.stepId || step.id) || `step_${index + 1}`;
    for (const [name, value] of Object.entries(metrics)) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        scalars.push({
          step: index + 1,
          tag: `${stepName}.${name}`,
          value: num,
        });
      }
    }
  }

  return scalars;
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function renderScalarsCsv(scalars = []) {
  const lines = ['step,tag,value'];
  for (const row of scalars) {
    lines.push([
      escapeCsvCell(row.step),
      escapeCsvCell(row.tag),
      escapeCsvCell(row.value),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

function renderTensorboardTsv(scalars = []) {
  const now = Date.now() / 1000;
  const lines = ['wall_time\tstep\ttag\tvalue'];
  for (const row of scalars) {
    lines.push(`${now}\t${row.step}\t${row.tag}\t${row.value}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildWandbUrl(cfg = {}, run = {}) {
  const explicit = cleanString(cfg.wandbUrl);
  if (explicit) return explicit;
  const entity = cleanString(cfg.wandbEntity);
  const project = cleanString(cfg.wandbProject || cfg.project);
  const runName = cleanString(cfg.wandbRunName || cfg.runName || run.id);
  if (entity && project && runName) {
    return `https://wandb.ai/${encodeURIComponent(entity)}/${encodeURIComponent(project)}/runs/${encodeURIComponent(runName)}`;
  }
  return null;
}

function buildTensorboardUrl(cfg = {}, run = {}) {
  const explicit = cleanString(cfg.tensorboardUrl);
  if (explicit) return explicit;
  const base = cleanString(cfg.tensorboardBaseUrl);
  const runName = cleanString(cfg.tensorboardRunName || cfg.runName || run.id);
  if (base && runName) {
    return `${base.replace(/\/+$/, '')}/#scalars&run=${encodeURIComponent(runName)}`;
  }
  return null;
}

async function writeWandbArtifacts(step, context, manifest, cfg) {
  const run = context.run || {};
  const scalars = collectScalars(manifest);
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
  const figures = Array.isArray(manifest.figures) ? manifest.figures : [];
  const payload = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      projectId: run.projectId,
      provider: run.provider || null,
      mode: run.mode || null,
    },
    scalars,
    tables,
    figures,
  };

  const [jsonArtifact, csvArtifact] = await Promise.all([
    context.createArtifact(step, {
      kind: 'observability_wandb',
      title: 'W&B Summary Payload',
      mimeType: 'application/json',
      content: JSON.stringify(payload, null, 2),
      pathHint: 'metrics/wandb_summary.json',
    }),
    context.createArtifact(step, {
      kind: 'metrics_table',
      title: 'W&B Scalars Table',
      mimeType: 'text/csv',
      content: renderScalarsCsv(scalars),
      pathHint: 'tables/wandb_scalars.csv',
      metadata: { tableColumns: ['step', 'tag', 'value'], tableRowCount: scalars.length },
    }),
  ]);

  return {
    provider: 'wandb',
    url: buildWandbUrl(cfg, run),
    artifacts: [jsonArtifact, csvArtifact].filter(Boolean).map((item) => ({
      id: item.id,
      kind: item.kind,
      path: item.path,
      objectUrl: item.objectUrl || null,
    })),
  };
}

async function writeTensorboardArtifacts(step, context, manifest, cfg) {
  const run = context.run || {};
  const scalars = collectScalars(manifest);
  const tsvArtifact = await context.createArtifact(step, {
    kind: 'observability_tensorboard',
    title: 'TensorBoard Scalars',
    mimeType: 'text/tab-separated-values',
    content: renderTensorboardTsv(scalars),
    pathHint: 'metrics/tensorboard_scalars.tsv',
  });

  return {
    provider: 'tensorboard',
    url: buildTensorboardUrl(cfg, run),
    artifacts: tsvArtifact ? [{
      id: tsvArtifact.id,
      kind: tsvArtifact.kind,
      path: tsvArtifact.path,
      objectUrl: tsvArtifact.objectUrl || null,
    }] : [],
  };
}

async function publishRunObservability(step, context, manifest = {}) {
  const run = context.run || {};
  const cfg = normalizeObservability(run);
  if (!cfg.sinks.length) {
    return {
      sinks: {},
      strict: cfg.strict,
      warnings: [],
      artifacts: [],
    };
  }

  const warnings = [];
  const sinkResults = {};
  const createdArtifacts = [];
  for (const sink of cfg.sinks) {
    try {
      let result = null;
      if (sink === 'wandb') {
        // eslint-disable-next-line no-await-in-loop
        result = await writeWandbArtifacts(step, context, manifest, cfg);
      } else if (sink === 'tensorboard') {
        // eslint-disable-next-line no-await-in-loop
        result = await writeTensorboardArtifacts(step, context, manifest, cfg);
      }
      if (result) {
        sinkResults[sink] = { url: result.url || null };
        createdArtifacts.push(...(result.artifacts || []));
      }
    } catch (error) {
      const message = `${sink} adapter failed: ${error.message}`;
      warnings.push(message);
      if (cfg.strict) {
        throw new Error(message);
      }
    }
  }

  return {
    sinks: sinkResults,
    strict: cfg.strict,
    warnings,
    artifacts: createdArtifacts,
  };
}

module.exports = {
  publishRunObservability,
};
