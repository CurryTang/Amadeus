import test from 'node:test';
import assert from 'node:assert/strict';

import { runNewRunCommand } from '../../commands/newRun';
import { runRetryRunCommand } from '../../commands/retryRun';
import { runCopyRunIdCommand } from '../../commands/copyRunId';

test('runNewRunCommand collects project, workflow, and prompt then refreshes the store', async () => {
  const createCalls: Array<Record<string, string>> = [];
  let refreshCalls = 0;

  await runNewRunCommand({
    client: {
      async createRun(payload: { projectId: string; workflowType: string; prompt: string }) {
        createCalls.push(payload);
        return {
          id: 'run_2',
          projectId: payload.projectId,
          workflowType: payload.workflowType,
          title: '',
          prompt: payload.prompt,
          status: 'running',
          activePhase: 'running_on_wsl',
          summary: '',
          updatedAt: null,
          startedAt: null,
          logPath: '',
          retryOfRunId: null,
          runnerHost: '',
          downstreamServerName: '',
          runDirectory: '',
        };
      },
    },
    store: {
      selectedProjectId: 'proj_1',
      context: {
        projects: [{ id: 'proj_1', name: 'Project One' }],
        runner: { id: 11, name: 'wsl-main', type: 'wsl', status: 'configured' },
        quickActions: [{ id: 'literature_review', label: 'Literature Review', workflowType: 'literature_review' }],
        continueWhenOffline: true,
      },
      async refresh() {
        refreshCalls += 1;
      },
      async selectRun() {},
    },
    ui: {
      async pickProject() {
        return 'proj_1';
      },
      async pickWorkflow() {
        return 'literature_review';
      },
      async promptForText() {
        return 'summarize the latest work';
      },
    },
  });

  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].projectId, 'proj_1');
  assert.equal(createCalls[0].workflowType, 'literature_review');
  assert.equal(refreshCalls, 1);
});

test('runRetryRunCommand retries the selected run and refreshes state', async () => {
  const retried: string[] = [];
  let refreshCalls = 0;

  await runRetryRunCommand({
    client: {
      async retryRun(runId: string) {
        retried.push(runId);
        return {
          id: 'run_retry',
          projectId: 'proj_1',
          workflowType: 'literature_review',
          title: '',
          prompt: 'review prompt',
          status: 'running',
          activePhase: 'running_on_wsl',
          summary: '',
          updatedAt: null,
          startedAt: null,
          logPath: '',
          retryOfRunId: 'run_1',
          runnerHost: '',
          downstreamServerName: '',
          runDirectory: '',
        };
      },
    },
    store: {
      selectedRunId: 'run_1',
      async refresh() {
        refreshCalls += 1;
      },
      async selectRun() {},
    },
  });

  assert.deepEqual(retried, ['run_1']);
  assert.equal(refreshCalls, 1);
});

test('runCopyRunIdCommand writes the selected run id to the clipboard', async () => {
  const clipboardWrites: string[] = [];

  await runCopyRunIdCommand({
    store: {
      selectedRunId: 'run_1',
    },
    clipboard: {
      async writeText(value: string) {
        clipboardWrites.push(value);
      },
    },
  });

  assert.deepEqual(clipboardWrites, ['run_1']);
});
