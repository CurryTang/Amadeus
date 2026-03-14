import type { LibraryClient } from './client';
import type { LibraryPaperDetail, LibraryPaperSummary } from './types';

type StoreListener = () => void;

type LibraryStoreDeps = {
  client: Pick<LibraryClient, 'listLibraryPapers' | 'getLibraryPaperDetail' | 'setReadState' | 'queueReader'>;
};

export class LibraryStore {
  readonly client: LibraryStoreDeps['client'];

  items: LibraryPaperSummary[] = [];

  selectedPaperId: number | null = null;

  selectedPaperDetail: LibraryPaperDetail | null = null;

  private readonly listeners = new Set<StoreListener>();

  constructor(deps: LibraryStoreDeps) {
    this.client = deps.client;
  }

  subscribe(listener: StoreListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async refresh(): Promise<void> {
    this.items = await this.client.listLibraryPapers();
    if (this.selectedPaperId && this.items.some((item) => item.id === this.selectedPaperId)) {
      this.selectedPaperDetail = await this.client.getLibraryPaperDetail(this.selectedPaperId);
    } else if (this.selectedPaperId) {
      this.selectedPaperId = null;
      this.selectedPaperDetail = null;
    }
    this.emitChange();
  }

  async selectPaper(paperId: number | null): Promise<void> {
    this.selectedPaperId = paperId;
    this.selectedPaperDetail = paperId ? await this.client.getLibraryPaperDetail(paperId) : null;
    this.emitChange();
  }

  get selectedPaper(): LibraryPaperSummary | null {
    return this.items.find((item) => item.id === this.selectedPaperId) || null;
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
