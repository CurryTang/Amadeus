export type LibraryPaperSummary = {
  id: number;
  title: string;
  type: string;
  originalUrl: string;
  tags: string[];
  processingStatus: string;
  read: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LibraryPaperDetail = LibraryPaperSummary & {
  downloadUrl: string;
  notesUrl: string;
  notesContent: string;
  readerMode: string;
  hasCode: boolean;
  codeUrl: string;
  readingHistory: Array<{
    id: number;
    readerName: string;
    readerMode: string;
    notes: string;
    readAt: string | null;
  }>;
};

export type LibraryReadState = {
  id: number;
  isRead: boolean;
};

export type ReaderQueueResult = {
  success: boolean;
  status: string;
  documentId: number;
  readerMode: string;
};
