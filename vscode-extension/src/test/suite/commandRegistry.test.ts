import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_IDS, registerCommandDefinitions } from '../../core/commandRegistry';

test('registerCommandDefinitions registers the ARIS command set', async () => {
  const registered: string[] = [];
  const fakeContext = {
    subscriptions: [] as { dispose(): void }[],
  };
  const fakeVscode = {
    commands: {
      registerCommand(commandId: string, handler: (...args: unknown[]) => unknown) {
        assert.equal(typeof handler, 'function');
        registered.push(commandId);
        return {
          dispose() {},
        };
      },
    },
  };

  registerCommandDefinitions(fakeVscode, fakeContext, {
    newRun: async () => undefined,
    refresh: async () => undefined,
    retryRun: async () => undefined,
    copyRunId: async () => undefined,
  });

  assert.deepEqual(registered, [
    COMMAND_IDS.newRun,
    COMMAND_IDS.refresh,
    COMMAND_IDS.retryRun,
    COMMAND_IDS.copyRunId,
  ]);
});
