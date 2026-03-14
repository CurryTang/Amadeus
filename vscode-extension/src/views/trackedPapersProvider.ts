import type { TrackerStore } from '../tracker/store';
import type { TreeViewItem } from './types';

export class TrackedPapersProvider {
  constructor(private readonly store: TrackerStore) {}

  async getChildren(): Promise<TreeViewItem[]> {
    return this.store.items.map((item) => ({
      id: item.id,
      label: item.title,
      description: item.sourceLabel,
    }));
  }
}
