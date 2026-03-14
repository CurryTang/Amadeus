import test from 'node:test';
import assert from 'node:assert/strict';

import { runMarkPaperReadCommand } from '../../commands/markPaperRead';
import { runMarkPaperUnreadCommand } from '../../commands/markPaperUnread';
import { runQueueReaderCommand } from '../../commands/queueReader';

test('library actions call backend mutations and refresh library state', async () => {
  const readCalls: Array<{ id: number; isRead: boolean }> = [];
  const queueCalls: number[] = [];
  let refreshCalls = 0;

  const store = {
    selectedPaperId: 42,
    async refresh() {
      refreshCalls += 1;
    },
  };

  const client = {
    async setReadState(id: number, isRead: boolean) {
      readCalls.push({ id, isRead });
      return { id, isRead };
    },
    async queueReader(id: number) {
      queueCalls.push(id);
      return {
        success: true,
        status: 'queued',
        documentId: id,
        readerMode: 'auto_reader_v2',
      };
    },
  };

  await runMarkPaperReadCommand({ client, store });
  await runMarkPaperUnreadCommand({ client, store });
  await runQueueReaderCommand({ client, store });

  assert.deepEqual(readCalls, [
    { id: 42, isRead: true },
    { id: 42, isRead: false },
  ]);
  assert.deepEqual(queueCalls, [42]);
  assert.equal(refreshCalls, 3);
});
