export type TrackedPaperSummary = {
  id: string;
  itemType: 'paper' | 'article' | 'finance';
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  trackedDate: string | null;
  sourceType: string;
  sourceName: string;
  sourceLabel: string;
  saved: boolean;
  isRead: boolean;
};

export type TrackerFeedPage = {
  items: TrackedPaperSummary[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
};

export type SavedTrackedPaper = {
  id: number;
  title: string;
  processingStatus: string;
  isRead: boolean;
};
