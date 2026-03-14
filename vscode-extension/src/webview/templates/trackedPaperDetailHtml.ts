import type { TrackedPaperSummary } from '../../tracker/types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderTrackedPaperDetailHtml(item: TrackedPaperSummary): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(item.title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(item.title)}</h1>
    <p>${escapeHtml(item.sourceLabel)}</p>
    <p>${escapeHtml(item.authors.join(', '))}</p>
    <pre>${escapeHtml(item.abstract || 'No summary available')}</pre>
    <button data-action="save-tracked-paper">${item.saved ? 'Saved' : 'Save to Library'}</button>
  </body>
</html>`;
}
