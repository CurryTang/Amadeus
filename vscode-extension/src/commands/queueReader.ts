import type { LibraryClient } from '../library/client';
import type { LibraryStore } from '../library/store';

type QueueReaderDeps = {
  client: Pick<LibraryClient, 'queueReader'>;
  store: Pick<LibraryStore, 'selectedPaperId' | 'refresh'>;
};

export async function runQueueReaderCommand(deps: QueueReaderDeps): Promise<void> {
  if (!deps.store.selectedPaperId) return;
  await deps.client.queueReader(deps.store.selectedPaperId);
  await deps.store.refresh();
}
