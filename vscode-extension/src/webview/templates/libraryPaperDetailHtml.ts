import type { LibraryPaperDetail } from '../../library/types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderLibraryPaperDetailHtml(item: LibraryPaperDetail): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(item.title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(item.title)}</h1>
    <p>${item.read ? 'read' : 'unread'} · ${escapeHtml(item.processingStatus)}</p>
    <pre>${escapeHtml(item.notesContent || 'No notes available')}</pre>
    <button data-action="mark-paper-read">Mark Read</button>
    <button data-action="mark-paper-unread">Mark Unread</button>
    <button data-action="queue-reader">Queue Reader</button>
  </body>
</html>`;
}
