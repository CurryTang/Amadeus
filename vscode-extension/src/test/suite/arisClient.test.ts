import test from 'node:test';
import assert from 'node:assert/strict';

import { ArisClient } from '../../aris/client';

test('ArisClient normalizes context, run list, run detail, create, and retry responses', async () => {
  const requests: Array<{ url: string; method: string; headers: Record<string, string> | undefined; body?: string }> = [];
  const responseByRequest = new Map<string, unknown>([
    ['GET http://localhost:3000/api/aris/context', {
      projects: [{ id: 'proj_1', name: 'Project One' }],
      runner: { id: 11, name: 'wsl-main', host: '127.0.0.1', type: 'wsl', status: 'configured' },
      runners: [{ id: 11, name: 'wsl-main', host: '127.0.0.1', type: 'wsl', status: 'configured' }],
      downstreamServers: [{ id: 12, name: 'gpu-a100-1', host: '10.0.0.8', status: 'configured' }],
      defaultSelections: {
        runnerServerId: 11,
        downstreamServerId: 12,
        remoteWorkspacePath: '/srv/aris/proj_1',
        datasetRoot: '/mnt/data/dataset',
      },
      quickActions: [{ id: 'literature_review', label: 'Literature Review', workflowType: 'literature_review' }],
      continueWhenOffline: true,
    }],
    ['GET http://localhost:3000/api/aris/runs', {
      runs: [{
        id: 'run_1',
        projectId: 'proj_1',
        workflowType: 'literature_review',
        status: 'running',
        summary: 'Remote log: /tmp/run.log',
        updatedAt: '2026-03-13T12:05:00.000Z',
      }],
    }],
    ['GET http://localhost:3000/api/aris/runs/run_1', {
      run: {
        id: 'run_1',
        projectId: 'proj_1',
        workflowType: 'literature_review',
        prompt: 'summarize the latest work',
        status: 'running',
        activePhase: 'running_on_wsl',
        updatedAt: '2026-03-13T12:05:00.000Z',
        logPath: '/tmp/run.log',
      },
    }],
    ['POST http://localhost:3000/api/aris/runs', {
      run: {
        id: 'run_2',
        projectId: 'proj_1',
        workflowType: 'run_experiment',
        prompt: 'run the ablation suite',
        status: 'running',
      },
    }],
    ['POST http://localhost:3000/api/aris/runs/run_1/retry', {
      run: {
        id: 'run_3',
        projectId: 'proj_1',
        workflowType: 'literature_review',
        prompt: 'summarize the latest work',
        status: 'running',
        retryOfRunId: 'run_1',
      },
    }],
  ]);

  const client = new ArisClient({
    baseUrl: 'http://localhost:3000/api',
    getAuthToken: async () => 'token-123',
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const url = String(input);
      const key = `${method} ${url}`;
      requests.push({
        url,
        method,
        headers: init?.headers as Record<string, string> | undefined,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      const payload = responseByRequest.get(key);
      assert.ok(payload, `Unexpected request: ${key}`);

      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    },
  });

  const context = await client.getContext();
  const runs = await client.listRuns();
  const run = await client.getRun('run_1');
  const created = await client.createRun({
    projectId: 'proj_1',
    workflowType: 'run_experiment',
    prompt: 'run the ablation suite',
  });
  const retried = await client.retryRun('run_1');

  assert.equal(context.projects[0].id, 'proj_1');
  assert.equal(context.runner.host, '127.0.0.1');
  assert.equal(context.runners?.[0]?.id, 11);
  assert.equal(context.downstreamServers?.[0]?.id, 12);
  assert.equal(context.defaultSelections?.remoteWorkspacePath, '/srv/aris/proj_1');
  assert.equal(runs[0].id, 'run_1');
  assert.equal(run.logPath, '/tmp/run.log');
  assert.equal(created.workflowType, 'run_experiment');
  assert.equal(retried.retryOfRunId, 'run_1');
  assert.equal(requests.length, 5);
  assert.equal(requests[0].headers?.Authorization, 'Bearer token-123');
  assert.match(requests[3].body || '', /"workflowType":"run_experiment"/);
});
