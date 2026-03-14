import test from 'node:test';
import assert from 'node:assert/strict';

import { TrackerClient } from '../../tracker/client';

test('TrackerClient normalizes tracked paper summaries and explicit save requests', async () => {
  const requests: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
  const responseByRequest = new Map<string, unknown>([
    ['GET http://localhost:3000/api/tracker/feed?limit=20&offset=0', {
      data: [
        {
          itemType: 'paper',
          arxivId: '2503.00001',
          title: 'Test Paper',
          abstract: 'Summary text',
          authors: ['Ada Lovelace', 'Grace Hopper'],
          publishedAt: '2026-03-13T12:00:00.000Z',
          trackedDate: '2026-03-14T12:00:00.000Z',
          sourceType: 'arxiv',
          sourceName: 'arXiv',
          saved: false,
          isRead: false,
        },
      ],
      total: 1,
      hasMore: false,
      offset: 0,
      limit: 20,
    }],
    ['POST http://localhost:3000/api/upload/arxiv', {
      id: 42,
      title: 'Test Paper',
      processingStatus: 'idle',
      isRead: false,
    }],
  ]);

  const client = new TrackerClient({
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

  const page = await client.listTrackedPapers();
  const saved = await client.saveTrackedPaper(page.items[0]);

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'paper:2503.00001');
  assert.equal(page.items[0].title, 'Test Paper');
  assert.equal(page.items[0].saved, false);
  assert.equal(page.items[0].sourceLabel, 'arXiv');
  assert.equal(saved.id, 42);
  assert.equal(requests[0].headers?.Authorization, 'Bearer token-123');
  assert.match(requests[1].body || '', /"paperId":"2503\.00001"/);
});
