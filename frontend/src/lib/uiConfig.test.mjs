import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUiConfigPatch, normalizeUiConfig } from './uiConfig.js';

test('normalizeUiConfig defaults simplifiedAlphaMode to false', () => {
  assert.deepEqual(normalizeUiConfig(null), {
    simplifiedAlphaMode: false,
    projectTemplates: [],
  });
});

test('normalizeUiConfig keeps true boolean values', () => {
  assert.deepEqual(
    normalizeUiConfig({
      simplifiedAlphaMode: true,
      projectTemplates: [
        {
          id: 'tmpl_requirements',
          name: 'Requirements Template',
          description: 'requirements-based bootstrap',
          sourceType: 'requirements',
          fileName: 'requirements.txt',
          fileContent: 'fastapi\nuvicorn\n',
          testSpec: { pythonImports: ['fastapi'] },
          ignored: 'value',
        },
      ],
      ignored: 'value',
    }),
    {
      simplifiedAlphaMode: true,
      projectTemplates: [
        {
          id: 'tmpl_requirements',
          name: 'Requirements Template',
          description: 'requirements-based bootstrap',
          sourceType: 'requirements',
          fileName: 'requirements.txt',
          fileContent: 'fastapi\nuvicorn\n',
          testSpec: { pythonImports: ['fastapi'] },
        },
      ],
    }
  );
});

test('buildUiConfigPatch only emits known keys', () => {
  assert.deepEqual(
    buildUiConfigPatch({
      simplifiedAlphaMode: true,
      projectTemplates: [
        {
          id: 'tmpl_pixi',
          name: 'Pixi Template',
          description: 'pixi bootstrap',
          sourceType: 'pixi',
          fileName: 'pixi.toml',
          fileContent: '[project]\nname = "pixi-app"\n',
          testSpec: { pythonImports: ['pandas'] },
          ignored: 'value',
        },
      ],
      ignored: 'value',
    }),
    {
      simplifiedAlphaMode: true,
      projectTemplates: [
        {
          id: 'tmpl_pixi',
          name: 'Pixi Template',
          description: 'pixi bootstrap',
          sourceType: 'pixi',
          fileName: 'pixi.toml',
          fileContent: '[project]\nname = "pixi-app"\n',
          testSpec: { pythonImports: ['pandas'] },
        },
      ],
    }
  );
});
