import type { LibraryStore } from '../library/store';
import type { TreeViewItem } from './types';

export class LibraryProvider {
  constructor(private readonly store: LibraryStore) {}

  async getChildren(): Promise<TreeViewItem[]> {
    return this.store.items.map((item) => ({
      id: String(item.id),
      label: item.title,
      description: `${item.read ? 'read' : 'unread'} · ${item.processingStatus}`,
    }));
  }
}
