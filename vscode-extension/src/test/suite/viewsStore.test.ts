import test from 'node:test';
import assert from 'node:assert/strict';

import { ArisStore } from '../../state/store';
import { ProjectsProvider } from '../../views/projectsProvider';
import { RunsProvider } from '../../views/runsProvider';

test('ArisStore refreshes data, preserves selection, and exposes compact project/run views', async () => {
  const store = new ArisStore({
    client: {
      async getContext() {
        return {
          projects: [
            { id: 'proj_1', name: 'Project One' },
            { id: 'proj_2', name: 'Project Two' },
          ],
          runner: { id: 11, name: 'wsl-main', type: 'wsl', status: 'configured' },
          quickActions: [],
          continueWhenOffline: true,
        };
      },
      async listRuns() {
        return [
          {
            id: 'run_1',
            projectId: 'proj_1',
            workflowType: 'literature_review',
            title: '',
            prompt: 'review prompt',
            status: 'running',
            activePhase: 'running_on_wsl',
            summary: '',
            updatedAt: '2026-03-13T12:05:00.000Z',
            startedAt: '2026-03-13T12:00:00.000Z',
            logPath: '',
            retryOfRunId: null,
          },
          {
            id: 'run_2',
            projectId: 'proj_2',
            workflowType: 'auto_review_loop',
            title: 'Auto Review',
            prompt: 'review until score improves',
            status: 'queued',
            activePhase: 'queued',
            summary: '',
            updatedAt: '2026-03-13T12:10:00.000Z',
            startedAt: '2026-03-13T12:08:00.000Z',
            logPath: '',
            retryOfRunId: null,
          },
        ];
      },
      async getRun(runId: string) {
        return {
          id: runId,
          projectId: 'proj_1',
          workflowType: 'literature_review',
          title: '',
          prompt: 'review prompt',
          status: 'running',
          activePhase: 'running_on_wsl',
          summary: 'Remote log: /tmp/run.log',
          updatedAt: '2026-03-13T12:05:00.000Z',
          startedAt: '2026-03-13T12:00:00.000Z',
          logPath: '/tmp/run.log',
          retryOfRunId: null,
          runnerHost: 'wsl-main',
          downstreamServerName: 'gpu-a100-1',
          runDirectory: '/srv/aris/run_1',
        };
      },
      async createRun() {
        throw new Error('not used');
      },
      async retryRun() {
        throw new Error('not used');
      },
    },
  });

  await store.refresh();
  store.selectProject('proj_1');
  await store.selectRun('run_1');

  const projectItems = await new ProjectsProvider(store).getChildren();
  const runItems = await new RunsProvider(store).getChildren();

  assert.equal(store.selectedProjectId, 'proj_1');
  assert.equal(store.selectedRunId, 'run_1');
  assert.equal(store.selectedRunDetail?.logPath, '/tmp/run.log');
  assert.equal(projectItems.length, 2);
  assert.equal(runItems.length, 1);
  assert.equal(projectItems[0].label, 'Project One');
  assert.equal(runItems[0].label, 'review prompt');
  assert.equal(runItems[0].description, 'running');
});
