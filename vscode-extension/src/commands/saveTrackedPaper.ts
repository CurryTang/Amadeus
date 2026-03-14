import type { SavedTrackedPaper } from '../tracker/types';
import type { TrackerStore } from '../tracker/store';
import type { TrackerClient } from '../tracker/client';

type SaveTrackedPaperDeps = {
  client: Pick<TrackerClient, 'saveTrackedPaper'>;
  store: Pick<TrackerStore, 'selectedPaperId' | 'selectedPaper' | 'refresh' | 'markSaved'>;
};

export async function runSaveTrackedPaperCommand(deps: SaveTrackedPaperDeps): Promise<SavedTrackedPaper | null> {
  if (!deps.store.selectedPaperId || !deps.store.selectedPaper) {
    return null;
  }
  const saved = await deps.client.saveTrackedPaper(deps.store.selectedPaper);
  deps.store.markSaved?.(saved);
  await deps.store.refresh();
  return saved;
}
