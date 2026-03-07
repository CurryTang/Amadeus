'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectKbAddPaperPayload } = require('../project-kb-paper-payload.service');

test('buildProjectKbAddPaperPayload preserves current roots while exposing follow-up actions', () => {
  const payload = buildProjectKbAddPaperPayload({
    projectId: 'proj_1',
    documentId: 'doc_1',
    results: {
      pdf: { ok: true, bytes: 1234 },
      latex: { ok: false, error: 'Not an arXiv paper' },
    },
    paperFolder: '/repo/resource/paper_1',
    documentTitle: 'Paper 1',
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.documentId, 'doc_1');
  assert.equal(payload.paperFolder, '/repo/resource/paper_1');
  assert.equal(payload.documentTitle, 'Paper 1');
  assert.equal(payload.results.pdf.bytes, 1234);
  assert.equal(payload.results.latex.error, 'Not an arXiv paper');
  assert.deepEqual(payload.actions.addPaper, {
    method: 'POST',
    path: '/researchops/projects/proj_1/kb/add-paper',
  });
  assert.deepEqual(payload.actions.filesTree, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/tree?scope=kb',
  });
});
