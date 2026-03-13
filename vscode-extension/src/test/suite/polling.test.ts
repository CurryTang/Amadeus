import test from 'node:test';
import assert from 'node:assert/strict';

import { PollingController } from '../../polling';

test('PollingController refreshes only when the ARIS surface is visible', async () => {
  let refreshCalls = 0;
  let visible = true;

  const controller = new PollingController({
    intervalMs: 50,
    isVisible: () => visible,
    refresh: async () => {
      refreshCalls += 1;
    },
    log: () => {},
    schedule: (handler: () => void | Promise<void>, _ms: number) => {
      void handler();
      return { dispose() {} };
    },
  });

  await controller.tick();
  visible = false;
  await controller.tick();

  assert.equal(refreshCalls, 1);
});
