import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDetailView } from '../../webview/detailController';

test('buildDetailView routes tracked papers, library papers, and ARIS runs to the correct renderer', () => {
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
  assert.match(run.html, /Retry Run/);
  assert.equal(tracked.title, 'Tracked Paper');
  assert.equal(library.title, 'Library Paper');
  assert.equal(run.title, 'ARIS Run run_1');
});
