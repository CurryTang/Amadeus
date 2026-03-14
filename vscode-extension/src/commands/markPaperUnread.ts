import type { LibraryClient } from '../library/client';
import type { LibraryStore } from '../library/store';

type MarkPaperUnreadDeps = {
  client: Pick<LibraryClient, 'setReadState'>;
  store: Pick<LibraryStore, 'selectedPaperId' | 'refresh'>;
};

export async function runMarkPaperUnreadCommand(deps: MarkPaperUnreadDeps): Promise<void> {
  if (!deps.store.selectedPaperId) return;
  await deps.client.setReadState(deps.store.selectedPaperId, false);
  await deps.store.refresh();
}
