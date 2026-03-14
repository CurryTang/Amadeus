import type { SavedTrackedPaper, TrackerFeedPage, TrackedPaperSummary } from './types';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TrackerClientOptions = {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  fetchImpl?: FetchLike;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toNullableStringValue(value: unknown): string | null {
  const stringValue = toStringValue(value);
  return stringValue ? stringValue : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function toBooleanValue(value: unknown): boolean {
  return Boolean(value);
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeTrackedPaper(value: unknown): TrackedPaperSummary {
  const record = toRecord(value);
  const arxivId = toStringValue(record.arxivId);
  const itemType = toStringValue(record.itemType) || (arxivId ? 'paper' : 'article');

  return {
    id: arxivId ? `paper:${arxivId}` : toStringValue(record.externalId || record.id),
    itemType: itemType === 'finance' ? 'finance' : itemType === 'article' ? 'article' : 'paper',
    arxivId,
    title: toStringValue(record.title),
    abstract: toStringValue(record.abstract || record.summary),
    authors: toStringArray(record.authors),
    publishedAt: toNullableStringValue(record.publishedAt),
    trackedDate: toNullableStringValue(record.trackedDate),
    sourceType: toStringValue(record.sourceType),
    sourceName: toStringValue(record.sourceName),
    sourceLabel: toStringValue(record.sourceName || record.sourceType),
    saved: toBooleanValue(record.saved),
    isRead: toBooleanValue(record.isRead),
  };
}

function normalizeSavedTrackedPaper(value: unknown): SavedTrackedPaper {
  const record = toRecord(value);
  return {
    id: toNumberValue(record.id),
    title: toStringValue(record.title),
    processingStatus: toStringValue(record.processingStatus),
    isRead: toBooleanValue(record.isRead),
  };
}

export class TrackerClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: FetchLike;

  private readonly getAuthToken: (() => Promise<string | undefined>) | undefined;

  constructor(options: TrackerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.getAuthToken = options.getAuthToken;
  }

  async listTrackedPapers(limit = 20, offset = 0): Promise<TrackerFeedPage> {
    const payload = toRecord(await this.request(`/tracker/feed?limit=${limit}&offset=${offset}`));
    return {
      items: Array.isArray(payload.data) ? payload.data.map(normalizeTrackedPaper) : [],
      total: toNumberValue(payload.total),
      hasMore: toBooleanValue(payload.hasMore),
      offset: toNumberValue(payload.offset),
      limit: toNumberValue(payload.limit, limit),
    };
  }

  async saveTrackedPaper(paper: TrackedPaperSummary): Promise<SavedTrackedPaper> {
    if (!paper.arxivId) {
      throw new Error('Only tracked papers with an arXiv id can be saved right now.');
    }

    const payload = await this.request('/upload/arxiv', {
      method: 'POST',
      body: JSON.stringify({
        paperId: paper.arxivId,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        publishedAt: paper.publishedAt,
      }),
    });
    return normalizeSavedTrackedPaper(payload);
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    const authToken = await this.getAuthToken?.();
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(`Tracker request failed with status ${response.status}`);
    }
    return response.json();
  }
}
