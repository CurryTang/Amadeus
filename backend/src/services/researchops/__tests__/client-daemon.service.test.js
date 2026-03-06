'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startClientDaemon } = require('../client-daemon.service');

test('startClientDaemon registers, executes a claimed task, and reports completion', async () => {
  const requests = [];
  let claimCount = 0;

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      body,
    });

    if (String(url).endsWith('/researchops/daemons/register')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ serverId: 'srv_client_1' }),
      };
    }

    if (String(url).endsWith('/researchops/daemons/heartbeat')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      };
    }

    if (String(url).endsWith('/researchops/daemons/tasks/claim')) {
      claimCount += 1;
      if (claimCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            task: {
              id: 'task_1',
              taskType: 'project.checkPath',
              payload: { projectPath: '/Users/alice/project' },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 204,
        headers: { get: () => '' },
        text: async () => '',
      };
    }

    if (String(url).endsWith('/researchops/daemons/tasks/task_1/complete')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const daemon = startClientDaemon({
      apiBaseUrl: 'http://127.0.0.1:3000/api',
      adminToken: 'token',
      hostname: 'client-host',
      heartbeatMs: 5000,
      pollMs: 1,
      handlers: {
        'project.checkPath': async (task) => ({
          normalizedPath: task.payload.projectPath,
          exists: true,
          isDirectory: true,
        }),
      },
      logger: { log() {}, error() {} },
    });

    assert.equal(daemon.enabled, true);

    while (!requests.some((request) => request.url.endsWith('/researchops/daemons/tasks/task_1/complete'))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await daemon.stop();
    await Promise.race([
      daemon.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('daemon did not stop')), 800)),
    ]);

    assert.ok(requests.some((request) => request.url.endsWith('/researchops/daemons/register')));
    assert.ok(requests.some((request) => request.url.endsWith('/researchops/daemons/heartbeat')));

    const completion = requests.find((request) => request.url.endsWith('/researchops/daemons/tasks/task_1/complete'));
    assert.deepEqual(completion.body, {
      ok: true,
      result: {
        normalizedPath: '/Users/alice/project',
        exists: true,
        isDirectory: true,
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('startClientDaemon includes bootstrap credentials during registration', async () => {
  const requests = [];

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      method: options.method || 'GET',
      body,
    });

    if (String(url).endsWith('/researchops/daemons/register')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ serverId: 'srv_client_2' }),
      };
    }

    if (String(url).endsWith('/researchops/daemons/heartbeat')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      };
    }

    if (String(url).endsWith('/researchops/daemons/tasks/claim')) {
      return {
        ok: true,
        status: 204,
        headers: { get: () => '' },
        text: async () => '',
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const daemon = startClientDaemon({
      apiBaseUrl: 'http://127.0.0.1:3000/api',
      bootstrapId: 'dbt_123',
      bootstrapSecret: 'secret-value',
      hostname: 'client-host',
      heartbeatMs: 5000,
      pollMs: 1,
      logger: { log() {}, error() {} },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await daemon.stop();
    await Promise.race([
      daemon.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('daemon did not stop')), 800)),
    ]);

    const register = requests.find((request) => request.url.endsWith('/researchops/daemons/register'));
    assert.equal(register.body.bootstrapId, 'dbt_123');
    assert.equal(register.body.bootstrapSecret, 'secret-value');
  } finally {
    global.fetch = originalFetch;
  }
});
