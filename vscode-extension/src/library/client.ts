import type {
  LibraryPaperDetail,
  LibraryPaperSummary,
  LibraryReadState,
  ReaderQueueResult,
} from './types';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type LibraryClientOptions = {
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

function toBooleanValue(value: unknown): boolean {
  return Boolean(value);
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function normalizeLibrarySummary(value: unknown): LibraryPaperSummary {
  const record = toRecord(value);
  return {
    id: toNumberValue(record.id),
    title: toStringValue(record.title),
    type: toStringValue(record.type),
    originalUrl: toStringValue(record.originalUrl),
    tags: toStringArray(record.tags),
    processingStatus: toStringValue(record.processingStatus),
    read: toBooleanValue(record.isRead),
    createdAt: toNullableStringValue(record.createdAt),
    updatedAt: toNullableStringValue(record.updatedAt),
  };
}

function normalizeReadingHistory(value: unknown): LibraryPaperDetail['readingHistory'][number] {
  const record = toRecord(value);
  return {
    id: toNumberValue(record.id),
    readerName: toStringValue(record.readerName),
    readerMode: toStringValue(record.readerMode),
    notes: toStringValue(record.notes),
    readAt: toNullableStringValue(record.readAt),
  };
}

function normalizeLibraryDetail(value: unknown, id = 0): LibraryPaperDetail {
  const record = toRecord(value);
  return {
    id,
    title: toStringValue(record.title),
    type: 'paper',
    originalUrl: '',
    tags: [],
    processingStatus: toStringValue(record.processingStatus),
    read: false,
    createdAt: null,
    updatedAt: null,
    notesUrl: toStringValue(record.notesUrl),
    notesContent: toStringValue(record.notesContent),
    readerMode: toStringValue(record.readerMode),
    hasCode: toBooleanValue(record.hasCode),
    codeUrl: toStringValue(record.codeUrl),
    readingHistory: Array.isArray(record.readingHistory)
      ? record.readingHistory.map(normalizeReadingHistory)
      : [],
  };
}

export class LibraryClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: FetchLike;

  private readonly getAuthToken: (() => Promise<string | undefined>) | undefined;

  constructor(options: LibraryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.getAuthToken = options.getAuthToken;
  }

  async listLibraryPapers(limit = 20, offset = 0): Promise<LibraryPaperSummary[]> {
    const payload = toRecord(await this.request(`/documents?limit=${limit}&offset=${offset}&includeTotal=true&type=paper`));
    return Array.isArray(payload.documents) ? payload.documents.map(normalizeLibrarySummary) : [];
  }

  async getLibraryPaperDetail(id: number): Promise<LibraryPaperDetail> {
    const payload = await this.request(`/documents/${id}/notes`);
    return normalizeLibraryDetail(payload, id);
  }

  async setReadState(id: number, isRead: boolean): Promise<LibraryReadState> {
    const payload = toRecord(await this.request(`/documents/${id}/read`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead }),
    }));
    return {
      id: toNumberValue(payload.id, id),
      isRead: toBooleanValue(payload.isRead),
    };
  }

  async queueReader(id: number, readerMode = 'auto_reader_v2'): Promise<ReaderQueueResult> {
    const payload = toRecord(await this.request(`/reader/queue/${id}`, {
      method: 'POST',
      body: JSON.stringify({ readerMode }),
    }));
    return {
      success: toBooleanValue(payload.success),
      status: toStringValue(payload.status),
      documentId: toNumberValue(payload.documentId, id),
      readerMode: toStringValue(payload.readerMode),
    };
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
      throw new Error(`Library request failed with status ${response.status}`);
    }
    return response.json();
  }
}
