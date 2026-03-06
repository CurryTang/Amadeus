'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../store');

test('returns default ui config when no value has been stored', async () => {
  const config = await store.getUiConfig('ui_config_default_test');

  assert.equal(config.simplifiedAlphaMode, false);
  assert.deepEqual(config.projectTemplates, []);
  assert.equal(typeof config.updatedAt, 'string');
});

test('persists simplifiedAlphaMode updates for the same user', async () => {
  const userId = 'ui_config_update_test';

  const updated = await store.updateUiConfig(userId, { simplifiedAlphaMode: true });
  const loaded = await store.getUiConfig(userId);

  assert.equal(updated.simplifiedAlphaMode, true);
  assert.equal(loaded.simplifiedAlphaMode, true);
  assert.deepEqual(updated.projectTemplates, []);
  assert.deepEqual(loaded.projectTemplates, []);
});

test('persists project templates for the same user', async () => {
  const userId = 'ui_config_template_update_test';
  const template = {
    id: 'tmpl_pixi_ds',
    name: 'Data Science Pixi',
    description: 'Bootstrap a pixi-based Python data science environment.',
    sourceType: 'pixi',
    fileName: 'pixi.toml',
    fileContent: '[project]\nname = "demo"\nchannels = ["conda-forge"]\nplatforms = ["linux-64"]\n',
    testSpec: {
      pythonImports: ['pandas', 'numpy'],
      shellCommands: ['python -c "import pandas, numpy"'],
    },
  };

  const updated = await store.updateUiConfig(userId, {
    simplifiedAlphaMode: true,
    projectTemplates: [template],
  });
  const loaded = await store.getUiConfig(userId);

  assert.equal(updated.simplifiedAlphaMode, true);
  assert.equal(updated.projectTemplates.length, 1);
  assert.equal(updated.projectTemplates[0].id, template.id);
  assert.equal(updated.projectTemplates[0].name, template.name);
  assert.deepEqual(updated.projectTemplates[0].testSpec, template.testSpec);
  assert.equal(loaded.projectTemplates.length, 1);
  assert.equal(loaded.projectTemplates[0].fileName, template.fileName);
  assert.deepEqual(loaded.projectTemplates[0].testSpec, template.testSpec);
});

test('keeps ui config isolated per user', async () => {
  const userA = 'ui_config_user_a';
  const userB = 'ui_config_user_b';

  await store.updateUiConfig(userA, {
    simplifiedAlphaMode: true,
    projectTemplates: [
      {
        id: 'tmpl_user_a',
        name: 'User A Template',
        description: 'Private template',
        sourceType: 'requirements',
        fileName: 'requirements.txt',
        fileContent: 'numpy\npandas\n',
        testSpec: { pythonImports: ['numpy'] },
      },
    ],
  });

  const configA = await store.getUiConfig(userA);
  const configB = await store.getUiConfig(userB);

  assert.equal(configA.simplifiedAlphaMode, true);
  assert.equal(configB.simplifiedAlphaMode, false);
  assert.equal(configA.projectTemplates.length, 1);
  assert.deepEqual(configB.projectTemplates, []);
});
