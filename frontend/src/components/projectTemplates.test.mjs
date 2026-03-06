import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addProjectTemplateDraft,
  removeProjectTemplateDraft,
  updateProjectTemplateDraft,
  serializeProjectTemplateDrafts,
  validateProjectTemplateDrafts,
} from './projectTemplates.js';

test('addProjectTemplateDraft appends a blank editable template', () => {
  const drafts = addProjectTemplateDraft([]);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].name, '');
  assert.equal(drafts[0].sourceType, 'pixi');
  assert.equal(drafts[0].fileName, 'pixi.toml');
  assert.equal(drafts[0].pythonImportsText, '');
  assert.equal(drafts[0].shellCommandsText, '');
});

test('updateProjectTemplateDraft updates only the targeted draft', () => {
  const start = addProjectTemplateDraft(addProjectTemplateDraft([]));
  const next = updateProjectTemplateDraft(start, 1, {
    name: 'Docker Service',
    sourceType: 'docker',
    fileName: 'Dockerfile',
  });

  assert.equal(next[0].name, '');
  assert.equal(next[1].name, 'Docker Service');
  assert.equal(next[1].sourceType, 'docker');
  assert.equal(next[1].fileName, 'Dockerfile');
});

test('removeProjectTemplateDraft removes the targeted draft', () => {
  const start = [
    {
      id: 'tmpl_a',
      name: 'A',
      description: 'A',
      sourceType: 'pixi',
      fileName: 'pixi.toml',
      fileContent: 'alpha',
      pythonImportsText: '',
      shellCommandsText: '',
    },
    {
      id: 'tmpl_b',
      name: 'B',
      description: 'B',
      sourceType: 'docker',
      fileName: 'Dockerfile',
      fileContent: 'beta',
      pythonImportsText: '',
      shellCommandsText: '',
    },
  ];

  const next = removeProjectTemplateDraft(start, 0);

  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'tmpl_b');
});

test('serializeProjectTemplateDrafts trims fields and builds testSpec arrays', () => {
  const serialized = serializeProjectTemplateDrafts([
    {
      id: '',
      name: '  Data Science  ',
      description: '  Pixi setup  ',
      sourceType: 'pixi',
      fileName: '  pixi.toml  ',
      fileContent: '[project]\nname = "demo"\n',
      pythonImportsText: ' pandas, numpy \n pandas ',
      shellCommandsText: 'python -c "import pandas"\n\npython -c "import numpy"',
    },
  ]);

  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].id.startsWith('template_'), true);
  assert.equal(serialized[0].name, 'Data Science');
  assert.equal(serialized[0].description, 'Pixi setup');
  assert.equal(serialized[0].fileName, 'pixi.toml');
  assert.deepEqual(serialized[0].testSpec, {
    pythonImports: ['pandas', 'numpy'],
    shellCommands: ['python -c "import pandas"', 'python -c "import numpy"'],
  });
});

test('validateProjectTemplateDrafts reports the first missing required field', () => {
  const error = validateProjectTemplateDrafts([
    {
      id: 'tmpl_missing_name',
      name: '   ',
      description: 'Missing name',
      sourceType: 'pixi',
      fileName: 'pixi.toml',
      fileContent: '[project]\nname = "demo"\n',
      pythonImportsText: '',
      shellCommandsText: '',
    },
  ]);

  assert.equal(error, 'Template 1 is missing a name.');
});
