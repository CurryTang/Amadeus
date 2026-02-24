const BaseModule = require('./base-module');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMimeType(inputs = {}) {
  const explicit = cleanString(inputs.mimeType || inputs.contentType);
  if (explicit) return explicit;
  if (inputs.contentBase64) return 'application/octet-stream';
  if (Array.isArray(inputs.tableRows)) return 'text/csv';
  if (inputs.json !== undefined || isPlainObject(inputs.content)) return 'application/json';
  return 'text/plain';
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizeTableColumns(rows = [], explicitColumns = []) {
  const ordered = [];
  const seen = new Set();
  for (const raw of explicitColumns) {
    const col = cleanString(raw);
    if (!col || seen.has(col)) continue;
    seen.add(col);
    ordered.push(col);
  }
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) {
      const col = cleanString(key);
      if (!col || seen.has(col)) continue;
      seen.add(col);
      ordered.push(col);
    }
  }
  return ordered;
}

function tableToCsv(rows = [], columns = []) {
  const lines = [];
  lines.push(columns.map((col) => escapeCsvCell(col)).join(','));
  for (const row of rows) {
    const cells = columns.map((col) => escapeCsvCell(isPlainObject(row) ? row[col] : ''));
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildArtifactPayload(inputs = {}) {
  const metadata = isPlainObject(inputs.metadata) ? { ...inputs.metadata } : {};

  if (Array.isArray(inputs.tableRows)) {
    const rows = inputs.tableRows;
    const columns = normalizeTableColumns(rows, Array.isArray(inputs.tableColumns) ? inputs.tableColumns : []);
    if (columns.length === 0) throw new Error('artifact.publish tableRows requires at least one column');
    metadata.tableColumns = columns;
    metadata.tableRowCount = rows.length;
    return {
      kind: cleanString(inputs.kind) || 'table',
      title: cleanString(inputs.title) || 'Table Artifact',
      mimeType: cleanString(inputs.mimeType) || 'text/csv',
      content: tableToCsv(rows, columns),
      metadata,
    };
  }

  if (inputs.json !== undefined) {
    return {
      kind: cleanString(inputs.kind) || 'metrics',
      title: cleanString(inputs.title) || 'JSON Artifact',
      mimeType: cleanString(inputs.mimeType) || 'application/json',
      content: JSON.stringify(inputs.json, null, 2),
      metadata,
    };
  }

  if (inputs.contentBase64) {
    return {
      kind: cleanString(inputs.kind) || 'artifact',
      title: cleanString(inputs.title) || 'Binary Artifact',
      mimeType: normalizeMimeType(inputs),
      contentBase64: String(inputs.contentBase64),
      metadata,
    };
  }

  if (isPlainObject(inputs.content)) {
    return {
      kind: cleanString(inputs.kind) || 'artifact',
      title: cleanString(inputs.title) || 'Object Artifact',
      mimeType: cleanString(inputs.mimeType) || 'application/json',
      content: JSON.stringify(inputs.content, null, 2),
      metadata,
    };
  }

  return {
    kind: cleanString(inputs.kind) || 'artifact',
    title: cleanString(inputs.title) || 'Artifact',
    mimeType: normalizeMimeType(inputs),
    content: String(inputs.content ?? ''),
    metadata,
  };
}

class ArtifactPublishModule extends BaseModule {
  constructor() {
    super('artifact.publish');
  }

  validate(step) {
    super.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const hasStructured =
      Array.isArray(inputs.tableRows)
      || inputs.json !== undefined
      || inputs.content !== undefined
      || typeof inputs.contentBase64 === 'string';
    if (!hasStructured) {
      throw new Error('artifact.publish requires tableRows/json/content/contentBase64');
    }
  }

  async run(step, context) {
    this.validate(step);
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const payload = buildArtifactPayload(inputs);
    const pathHint = cleanString(inputs.pathHint);
    const created = await context.createArtifact(step, {
      ...payload,
      pathHint: pathHint || undefined,
    });

    return {
      stepId: step.id,
      moduleType: this.moduleType,
      status: 'SUCCEEDED',
      metrics: {
        artifactCount: created ? 1 : 0,
        bytes: Number(created?.metadata?.bytes || 0),
      },
      outputs: {
        artifactId: created?.id || null,
        kind: created?.kind || payload.kind,
        path: created?.path || null,
      },
      artifacts: created ? [created] : [],
    };
  }
}

module.exports = ArtifactPublishModule;
