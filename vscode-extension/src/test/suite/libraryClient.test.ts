import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryClient } from '../../library/client';

test('LibraryClient normalizes library summaries, detail, read state, and reader queue actions', async () => {
  const requests: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
  const responseByRequest = new Map<string, unknown>([
    ['GET http://localhost:3000/api/documents?limit=20&offset=0&includeTotal=true&type=paper', {
      documents: [
        {
          id: 42,
          title: 'Saved Paper',
          type: 'paper',
          originalUrl: 'https://arxiv.org/abs/2503.00001',
          tags: ['ml'],
          processingStatus: 'idle',
          isRead: false,
          createdAt: '2026-03-13T12:00:00.000Z',
          updatedAt: '2026-03-14T12:00:00.000Z',
        },
      ],
      total: 1,
    }],
    ['GET http://localhost:3000/api/documents/42/notes', {
      id: 42,
      title: 'Saved Paper',
      notesUrl: '',
      notesContent: 'Detailed notes',
      processingStatus: 'idle',
      readerMode: 'auto_reader_v2',
      hasCode: false,
      codeUrl: '',
      readingHistory: [],
    }],
    ['PATCH http://localhost:3000/api/documents/42/read', {
      id: 42,
      isRead: true,
    }],
    ['POST http://localhost:3000/api/reader/queue/42', {
      success: true,
      status: 'queued',
      documentId: 42,
      readerMode: 'auto_reader_v2',
    }],
  ]);

  const client = new LibraryClient({
    baseUrl: 'http://localhost:3000/api',
    getAuthToken: async () => 'token-123',
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const url = String(input);
      const key = `${method} ${url}`;
      requests.push({
        url,
        method,
        body: typeof init?.body === 'string' ? init.body : undefined,
        headers: init?.headers as Record<string, string> | undefined,
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

  const papers = await client.listLibraryPapers();
  const detail = await client.getLibraryPaperDetail(42);
  const readState = await client.setReadState(42, true);
  const queued = await client.queueReader(42);

  assert.equal(papers[0].id, 42);
  assert.equal(papers[0].read, false);
  assert.equal(papers[0].processingStatus, 'idle');
  assert.equal(detail.notesContent, 'Detailed notes');
  assert.equal(readState.isRead, true);
  assert.equal(queued.status, 'queued');
  assert.equal(requests[0].headers?.Authorization, 'Bearer token-123');
  assert.match(requests[2].body || '', /"isRead":true/);
});
