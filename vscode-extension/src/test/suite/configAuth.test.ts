import test from 'node:test';
import assert from 'node:assert/strict';

import { getArisConfig } from '../../config';
import { deleteAuthToken, getAuthToken, storeAuthToken } from '../../auth';

test('getArisConfig reads extension settings with fallbacks', () => {
  const fakeVscode = {
    workspace: {
      getConfiguration(section: string) {
        assert.equal(section, 'aris');
        return {
          get<T>(key: string, fallback: T): T {
            const values: Record<string, unknown> = {
              apiBaseUrl: 'https://example.com/api',
              refreshIntervalSeconds: 15,
              defaultProjectId: 'proj_1',
              defaultWorkflowType: 'auto_review_loop',
            };
            return (values[key] as T | undefined) ?? fallback;
          },
        };
      },
    },
  };

  const config = getArisConfig(fakeVscode);

  assert.equal(config.apiBaseUrl, 'https://example.com/api');
  assert.equal(config.refreshIntervalSeconds, 15);
  assert.equal(config.defaultProjectId, 'proj_1');
  assert.equal(config.defaultWorkflowType, 'auto_review_loop');
});

test('auth helpers read, write, and delete the ARIS token in secret storage', async () => {
  const operations: string[] = [];
  let storedValue: string | undefined;
  const fakeContext = {
    secrets: {
      async get(key: string) {
        operations.push(`get:${key}`);
        return storedValue;
      },
      async store(key: string, value: string) {
        operations.push(`store:${key}`);
        storedValue = value;
      },
      async delete(key: string) {
        operations.push(`delete:${key}`);
        storedValue = undefined;
      },
    },
  };

  await storeAuthToken(fakeContext, 'token-123');
  assert.equal(await getAuthToken(fakeContext), 'token-123');
  await deleteAuthToken(fakeContext);
  assert.equal(await getAuthToken(fakeContext), undefined);
  assert.deepEqual(operations, [
    'store:aris.authToken',
    'get:aris.authToken',
    'delete:aris.authToken',
    'get:aris.authToken',
  ]);
});
