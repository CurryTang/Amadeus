import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAgentSessionMessageActionFromApiResponse,
  getAgentSessionMessagesFromApiResponse,
} from './agentSessionMessageApiResponse.js';

test('getAgentSessionMessagesFromApiResponse returns normalized message arrays', () => {
  const items = [{ id: 'msg_1', role: 'user' }];
  const response = { items, total: 1 };

  assert.equal(getAgentSessionMessagesFromApiResponse(response), items);
});

test('getAgentSessionMessageActionFromApiResponse keeps session, run, attempt, and userMessage together', () => {
  const response = {
    session: { id: 'sess_1', status: 'RUNNING' },
    run: { id: 'run_123', status: 'QUEUED' },
    attempt: { id: 'run_123', treeNodeTitle: 'Baseline Root' },
    userMessage: { id: 'msg_1', role: 'user' },
  };

  assert.deepEqual(getAgentSessionMessageActionFromApiResponse(response), response);
});
