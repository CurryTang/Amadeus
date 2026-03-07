'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContextPackPayload } = require('../context-pack-payload.service');

test('buildContextPackPayload exposes routed context packs through a stable payload shape', () => {
  const pack = {
    runId: 'run_123',
    run_intent: {
      goal: {
        nodeId: 'node_eval',
        title: 'Evaluation branch',
      },
    },
    selected_items: [
      { bucket: 'same_step_history', source_type: 'run', source_id: 'run_old' },
    ],
  };

  const payload = buildContextPackPayload({ pack });

  assert.equal(payload.pack, pack);
  assert.equal(payload.mode, 'routed');
  assert.equal(payload.view.mode, 'routed');
  assert.equal(payload.view.nodeId, 'node_eval');
  assert.equal('bundle' in payload, false);
});

test('buildContextPackPayload keeps legacy mode explicit for fallback context packs', () => {
  const pack = {
    runId: 'run_legacy',
    groups: [{ id: 1 }],
  };

  const payload = buildContextPackPayload({ pack, mode: 'legacy' });

  assert.equal(payload.pack, pack);
  assert.equal(payload.mode, 'legacy');
  assert.equal(payload.view.mode, 'legacy');
  assert.equal(payload.view.groupCount, 1);
});
