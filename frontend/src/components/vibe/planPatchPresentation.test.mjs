import test from 'node:test';
import assert from 'node:assert/strict';

import { getPlanPatchFeedback } from './planPatchPresentation.js';

test('getPlanPatchFeedback formats immutable-node patch conflicts', () => {
  const feedback = getPlanPatchFeedback({
    response: {
      data: {
        code: 'PLAN_PATCH_CONFLICT',
        error: 'Node node_eval is immutable because status=RUNNING',
        details: {
          nodeId: 'node_eval',
          status: 'RUNNING',
        },
      },
    },
  });

  assert.deepEqual(feedback, {
    message: 'PLAN_PATCH_CONFLICT: Node node_eval is immutable because status=RUNNING',
    validation: null,
  });
});

test('getPlanPatchFeedback formats schema invalid payloads with the first validation error', () => {
  const feedback = getPlanPatchFeedback({
    response: {
      data: {
        code: 'PLAN_SCHEMA_INVALID',
        error: 'Plan schema invalid',
        validation: {
          errors: [
            {
              message: 'Node child references missing parent missing_parent',
            },
          ],
          warnings: [],
        },
      },
    },
  });

  assert.deepEqual(feedback, {
    message: 'PLAN_SCHEMA_INVALID: Plan schema invalid (Node child references missing parent missing_parent)',
    validation: {
      errors: [
        {
          message: 'Node child references missing parent missing_parent',
        },
      ],
      warnings: [],
    },
  });
});

test('getPlanPatchFeedback falls back to a plain message when no structured payload exists', () => {
  const feedback = getPlanPatchFeedback(new Error('Network unavailable'));

  assert.deepEqual(feedback, {
    message: 'Network unavailable',
    validation: null,
  });
});
