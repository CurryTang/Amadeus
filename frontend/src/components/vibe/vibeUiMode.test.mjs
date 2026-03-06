import test from 'node:test';
import assert from 'node:assert/strict';

import { getVibeUiMode } from './vibeUiMode.js';

test('default mode keeps advanced vibe surfaces visible', () => {
  const mode = getVibeUiMode({ simplifiedAlphaMode: false });

  assert.equal(mode.showSkillMenu, true);
  assert.equal(mode.showTreePlanning, true);
  assert.equal(mode.showTreeActions, true);
  assert.equal(mode.showAutopilotControls, true);
});

test('simplified mode hides advanced vibe surfaces', () => {
  const mode = getVibeUiMode({ simplifiedAlphaMode: true });

  assert.equal(mode.showSkillMenu, false);
  assert.equal(mode.showTreePlanning, false);
  assert.equal(mode.showTreeActions, false);
  assert.equal(mode.showAutopilotControls, false);
});
