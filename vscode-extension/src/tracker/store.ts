import type { TrackerClient } from './client';
import type { SavedTrackedPaper, TrackerFeedPage, TrackedPaperSummary } from './types';

type StoreListener = () => void;

type TrackerStoreDeps = {
  client: Pick<TrackerClient, 'listTrackedPapers' | 'saveTrackedPaper'>;
};

export class TrackerStore {
  readonly client: TrackerStoreDeps['client'];

  page: TrackerFeedPage = {
    items: [],
    total: 0,
    hasMore: false,
    offset: 0,
    limit: 20,
  };

  selectedPaperId: string | null = null;

  private readonly listeners = new Set<StoreListener>();

  constructor(deps: TrackerStoreDeps) {
    this.client = deps.client;
  }

  subscribe(listener: StoreListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async refresh(): Promise<void> {
    this.page = await this.client.listTrackedPapers();
    if (this.selectedPaperId && !this.page.items.some((item) => item.id === this.selectedPaperId)) {
      this.selectedPaperId = null;
    }
    this.emitChange();
  }

  selectPaper(paperId: string | null): void {
    this.selectedPaperId = paperId;
    this.emitChange();
  }

  get items(): TrackedPaperSummary[] {
    return this.page.items;
  }

  get selectedPaper(): TrackedPaperSummary | null {
    return this.items.find((item) => item.id === this.selectedPaperId) || null;
  }

  markSaved(savedPaper: SavedTrackedPaper): void {
    this.page = {
      ...this.page,
      items: this.items.map((item) => (
        item.id === this.selectedPaperId
          ? { ...item, saved: true, isRead: savedPaper.isRead }
          : item
      )),
    };
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
