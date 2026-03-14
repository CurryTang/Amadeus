import type { LibraryClient } from '../library/client';
import type { LibraryStore } from '../library/store';
import type { LibraryPaperDetail } from '../library/types';

type OpenLibraryPdfDeps = {
  client: Pick<LibraryClient, 'getLibraryPaperDetail'>;
  store: Pick<LibraryStore, 'selectedPaperId' | 'selectedPaperDetail'>;
  downloadPdf: (url: string, title: string) => Promise<string>;
  openPdf: (path: string) => Promise<void>;
  openExternalUrl?: (url: string) => Promise<void>;
};

function toArxivPdfUrl(originalUrl: string): string | null {
  const match = originalUrl.match(/^https?:\/\/arxiv\.org\/abs\/([^?#/]+)$/i);
  if (!match) return null;
  return `https://arxiv.org/pdf/${match[1]}.pdf`;
}

function resolveFallbackPdfUrl(originalUrl: string): string | null {
  if (!originalUrl) return null;
  if (/\.pdf(?:$|[?#])/i.test(originalUrl)) return originalUrl;
  return toArxivPdfUrl(originalUrl);
}

async function loadDetail(deps: OpenLibraryPdfDeps): Promise<LibraryPaperDetail | null> {
  if (!deps.store.selectedPaperId) return null;
  if (
    deps.store.selectedPaperDetail &&
    deps.store.selectedPaperDetail.id === deps.store.selectedPaperId
  ) {
    return deps.store.selectedPaperDetail;
  }
  return deps.client.getLibraryPaperDetail(deps.store.selectedPaperId);
}

export async function runOpenLibraryPdfCommand(
  deps: OpenLibraryPdfDeps
): Promise<'stored-download' | 'original-url-download' | 'external' | null> {
  const detail = await loadDetail(deps);
  if (!detail) return null;

  if (detail.downloadUrl) {
    const path = await deps.downloadPdf(detail.downloadUrl, detail.title);
    await deps.openPdf(path);
    return 'stored-download';
  }

  const fallbackPdfUrl = resolveFallbackPdfUrl(detail.originalUrl);
  if (fallbackPdfUrl) {
    const path = await deps.downloadPdf(fallbackPdfUrl, detail.title);
    await deps.openPdf(path);
    return 'original-url-download';
  }

  if (detail.originalUrl && deps.openExternalUrl) {
    await deps.openExternalUrl(detail.originalUrl);
    return 'external';
  }

  throw new Error('No stored PDF or original paper URL is available for this paper.');
}
