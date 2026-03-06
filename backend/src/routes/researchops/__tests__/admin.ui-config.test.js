'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adminRouter = require('../admin');

test('buildUiConfigResponse returns default simplified alpha mode', () => {
  const result = adminRouter.buildUiConfigResponse({});

  assert.deepEqual(result, {
    uiConfig: {
      simplifiedAlphaMode: false,
      projectTemplates: [],
      updatedAt: null,
    },
  });
});

test('normalizeUiConfigPatch rejects non-boolean values', () => {
  assert.throws(
    () => adminRouter.normalizeUiConfigPatch({ simplifiedAlphaMode: 'yes' }),
    /must be a boolean/i
  );
});

test('normalizeUiConfigPatch accepts boolean values', () => {
  const result = adminRouter.normalizeUiConfigPatch({ simplifiedAlphaMode: true });

  assert.deepEqual(result, { simplifiedAlphaMode: true });
});

test('normalizeUiConfigPatch accepts project templates', () => {
  const result = adminRouter.normalizeUiConfigPatch({
    projectTemplates: [
      {
        id: 'tmpl_docker',
        name: 'Docker App',
        description: 'Containerized app template',
        sourceType: 'docker',
        fileName: 'Dockerfile',
        fileContent: 'FROM python:3.11-slim\nRUN python --version\n',
        testSpec: {
          shellCommands: ['python --version'],
        },
      },
    ],
  });

  assert.equal(Array.isArray(result.projectTemplates), true);
  assert.equal(result.projectTemplates.length, 1);
  assert.equal(result.projectTemplates[0].sourceType, 'docker');
});

test('normalizeUiConfigPatch rejects invalid project template shapes', () => {
  assert.throws(
    () => adminRouter.normalizeUiConfigPatch({
      projectTemplates: [
        {
          id: 'bad_template',
          name: '',
          sourceType: 'pixi',
        },
      ],
    }),
    /template/i
  );
});
