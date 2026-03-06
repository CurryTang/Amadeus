import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveApiConfig } from './apiConfig.js';

test('resolveApiConfig prefers explicit production API env when running in production', () => {
  const result = resolveApiConfig({
    processEnv: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3000/api',
    },
    viteEnv: {},
  });

  assert.equal(result.isDev, false);
  assert.equal(result.apiUrl, 'http://127.0.0.1:3000/api');
});

test('resolveApiConfig falls back to dev proxy in development', () => {
  const result = resolveApiConfig({
    processEnv: {
      NODE_ENV: 'development',
    },
    viteEnv: {},
  });

  assert.equal(result.isDev, true);
  assert.equal(result.apiUrl, '/api');
  assert.equal(result.timeoutMs, 15000);
});
