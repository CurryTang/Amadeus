function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function slugifyTemplateName(value = '') {
  const slug = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'template';
}

function splitUniqueLines(value = '', separators = /\n+/) {
  const seen = new Set();
  const values = [];
  for (const item of String(value || '').split(separators)) {
    const normalized = cleanString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

function inferDefaultFileName(sourceType = 'pixi') {
  if (sourceType === 'docker') return 'Dockerfile';
  if (sourceType === 'requirements') return 'requirements.txt';
  return 'pixi.toml';
}

export function createProjectTemplateDraft(template = {}) {
  const sourceType = cleanString(template.sourceType).toLowerCase() || 'pixi';
  return {
    id: cleanString(template.id),
    name: cleanString(template.name),
    description: cleanString(template.description),
    sourceType,
    fileName: cleanString(template.fileName) || inferDefaultFileName(sourceType),
    fileContent: typeof template.fileContent === 'string' ? template.fileContent : '',
    pythonImportsText: Array.isArray(template?.testSpec?.pythonImports)
      ? template.testSpec.pythonImports.join(', ')
      : '',
    shellCommandsText: Array.isArray(template?.testSpec?.shellCommands)
      ? template.testSpec.shellCommands.join('\n')
      : '',
  };
}

export function addProjectTemplateDraft(drafts = []) {
  return [...drafts, createProjectTemplateDraft()];
}

export function updateProjectTemplateDraft(drafts = [], index, patch = {}) {
  return drafts.map((draft, draftIndex) => {
    if (draftIndex !== index) return draft;
    const sourceType = cleanString(patch.sourceType || draft.sourceType).toLowerCase() || 'pixi';
    const next = {
      ...draft,
      ...patch,
      sourceType,
    };
    if (!cleanString(patch.fileName) && patch.sourceType && inferDefaultFileName(sourceType) === draft.fileName) {
      next.fileName = inferDefaultFileName(sourceType);
    }
    return next;
  });
}

export function removeProjectTemplateDraft(drafts = [], index) {
  return drafts.filter((_, draftIndex) => draftIndex !== index);
}

export function serializeProjectTemplateDrafts(drafts = []) {
  return drafts.map((draft, index) => {
    const name = cleanString(draft.name);
    const description = cleanString(draft.description);
    const sourceType = cleanString(draft.sourceType).toLowerCase() || 'pixi';
    const fileName = cleanString(draft.fileName) || inferDefaultFileName(sourceType);
    const fileContent = typeof draft.fileContent === 'string' ? draft.fileContent : '';
    const pythonImports = splitUniqueLines(draft.pythonImportsText, /[\n,]+/);
    const shellCommands = splitUniqueLines(draft.shellCommandsText, /\n+/);
    const testSpec = {};
    if (pythonImports.length > 0) testSpec.pythonImports = pythonImports;
    if (shellCommands.length > 0) testSpec.shellCommands = shellCommands;
    return {
      id: cleanString(draft.id) || `template_${slugifyTemplateName(name || `item_${index + 1}`)}`,
      name,
      description,
      sourceType,
      fileName,
      fileContent,
      testSpec,
    };
  });
}

export function validateProjectTemplateDrafts(drafts = []) {
  for (const [index, draft] of drafts.entries()) {
    if (!cleanString(draft.name)) return `Template ${index + 1} is missing a name.`;
    if (!cleanString(draft.description)) return `Template ${index + 1} is missing a description.`;
    if (!cleanString(draft.fileName)) return `Template ${index + 1} is missing a file name.`;
    if (!cleanString(draft.fileContent)) return `Template ${index + 1} is missing file content.`;
  }
  return '';
}
