import type { LibraryClient } from '../library/client';
import type { LibraryStore } from '../library/store';

type MarkPaperReadDeps = {
  client: Pick<LibraryClient, 'setReadState'>;
  store: Pick<LibraryStore, 'selectedPaperId' | 'refresh'>;
};

export async function runMarkPaperReadCommand(deps: MarkPaperReadDeps): Promise<void> {
  if (!deps.store.selectedPaperId) return;
  await deps.client.setReadState(deps.store.selectedPaperId, true);
  await deps.store.refresh();
}
