const PROJECT_TEMPLATE_SOURCE_TYPES = new Set(['pixi', 'requirements', 'docker']);

function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const values = [];
  for (const item of input) {
    const value = cleanString(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function normalizeTemplateTestSpec(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const pythonImports = normalizeStringArray(raw.pythonImports);
  const shellCommands = normalizeStringArray(raw.shellCommands);
  const spec = {};
  if (pythonImports.length > 0) spec.pythonImports = pythonImports;
  if (shellCommands.length > 0) spec.shellCommands = shellCommands;
  return spec;
}

function normalizeProjectTemplate(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!raw) return null;
  const id = cleanString(raw.id);
  const name = cleanString(raw.name);
  const description = cleanString(raw.description);
  const sourceType = cleanString(raw.sourceType).toLowerCase();
  const fileName = cleanString(raw.fileName);
  const fileContent = typeof raw.fileContent === 'string' ? raw.fileContent : cleanString(raw.fileContent);
  if (!id || !name || !description || !PROJECT_TEMPLATE_SOURCE_TYPES.has(sourceType) || !fileName || !fileContent) {
    return null;
  }
  return {
    id,
    name,
    description,
    sourceType,
    fileName,
    fileContent,
    testSpec: normalizeTemplateTestSpec(raw.testSpec),
  };
}

function normalizeProjectTemplates(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const templates = [];
  for (const item of input) {
    const template = normalizeProjectTemplate(item);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id);
    templates.push(template);
  }
  return templates;
}

export function normalizeUiConfig(raw) {
  return {
    simplifiedAlphaMode: raw?.simplifiedAlphaMode === true,
    projectTemplates: normalizeProjectTemplates(raw?.projectTemplates),
  };
}

export function buildUiConfigPatch(raw) {
  return {
    simplifiedAlphaMode: raw?.simplifiedAlphaMode === true,
    projectTemplates: normalizeProjectTemplates(raw?.projectTemplates),
  };
}
