import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRunDetailHtml } from '../../webview/templates/runDetailHtml';

test('renderRunDetailHtml includes summary fields and actions for the selected run', () => {
  const html = renderRunDetailHtml({
    id: 'run_1',
    projectId: 'proj_1',
    workflowType: 'literature_review',
    title: '',
    prompt: 'summarize the latest work',
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
  });

  assert.match(html, /summarize the latest work/);
  assert.match(html, /Retry Run/);
  assert.match(html, /Copy Run ID/);
  assert.match(html, /wsl-main/);
});
