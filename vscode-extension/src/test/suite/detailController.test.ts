import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDetailView } from '../../webview/detailController';

test('buildDetailView routes tracked papers, library papers, ARIS projects, and ARIS runs to the correct renderer', () => {
  const tracked = buildDetailView({
    kind: 'tracked-paper',
    item: {
      id: 'paper:2503.00001',
      itemType: 'paper',
      arxivId: '2503.00001',
      title: 'Tracked Paper',
      abstract: 'Summary',
      authors: [],
      publishedAt: null,
      trackedDate: null,
      sourceType: 'arxiv',
      sourceName: 'arXiv',
      sourceLabel: 'arXiv',
      saved: false,
      isRead: false,
    },
  });
  const library = buildDetailView({
    kind: 'library-paper',
    item: {
      id: 42,
      title: 'Library Paper',
      type: 'paper',
      originalUrl: '',
      downloadUrl: '',
      tags: [],
      processingStatus: 'idle',
      read: false,
      createdAt: null,
      updatedAt: null,
      notesUrl: '',
      notesContent: 'Notes',
      readerMode: 'auto_reader_v2',
      hasCode: false,
      codeUrl: '',
      readingHistory: [],
    },
  });
  const project = buildDetailView({
    kind: 'aris-project',
    item: {
      id: 'proj_1',
      projectLabel: 'Project One',
      runnerLabel: 'WSL runner: wsl-main',
      runnerStatus: 'configured',
      runnerSummary: 'Runner host: 127.0.0.1',
      workspaceLabel: '/srv/aris/proj_1',
      datasetLabel: 'Remote dataset: /mnt/data/set-a',
      destinationLabel: 'Experiment target: gpu-a100-1',
      targetSummary: '1 available target',
      quickActionLabels: ['Literature Review', 'Run Experiment'],
      recentRuns: [
        {
          id: 'run_1',
          title: 'Literature Review',
          workflowLabel: 'Literature Review',
          statusLabel: 'Running on WSL',
          runnerLabel: 'WSL: wsl-main',
          destinationLabel: 'Compute: gpu-a100-1',
          summary: 'Remote log: /tmp/run.log',
          startedAt: '2026-03-13T12:00:00.000Z',
        },
      ],
    },
  });
  const run = buildDetailView({
    kind: 'aris-run',
    item: {
      id: 'run_1',
      projectId: 'proj_1',
      workflowType: 'literature_review',
      title: '',
      prompt: 'Run prompt',
      status: 'running',
      activePhase: 'running_on_wsl',
      summary: 'Remote log',
      updatedAt: null,
      startedAt: null,
      logPath: '',
      retryOfRunId: null,
      runnerHost: 'wsl-main',
      downstreamServerName: '',
      runDirectory: '',
    },
  });

  assert.match(tracked.html, /Save to Library/);
  assert.match(library.html, /Mark Read/);
  assert.match(library.html, /Open PDF/);
  assert.match(project.html, /Project One/);
  assert.match(project.html, /Run Context/);
  assert.match(project.html, /Recent Runs/);
  assert.match(run.html, /Retry Run/);
  assert.equal(tracked.title, 'Tracked Paper');
  assert.equal(library.title, 'Library Paper');
  assert.equal(project.title, 'ARIS Project Project One');
  assert.equal(run.title, 'ARIS Run run_1');
});
