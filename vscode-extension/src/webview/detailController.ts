import type { ArisRunDetail } from '../aris/types';
import type { LibraryPaperDetail } from '../library/types';
import type { TrackedPaperSummary } from '../tracker/types';
import { renderLibraryPaperDetailHtml } from './templates/libraryPaperDetailHtml';
import { renderTrackedPaperDetailHtml } from './templates/trackedPaperDetailHtml';
import { renderRunDetailHtml } from './templates/runDetailHtml';

export type DetailSelection =
  | { kind: 'tracked-paper'; item: TrackedPaperSummary }
  | { kind: 'library-paper'; item: LibraryPaperDetail }
  | { kind: 'aris-run'; item: ArisRunDetail };

export function buildDetailView(selection: DetailSelection): { title: string; html: string } {
  switch (selection.kind) {
    case 'tracked-paper':
      return {
        title: selection.item.title,
        html: renderTrackedPaperDetailHtml(selection.item),
      };
    case 'library-paper':
      return {
        title: selection.item.title,
        html: renderLibraryPaperDetailHtml(selection.item),
      };
    case 'aris-run':
      return {
        title: `ARIS Run ${selection.item.id}`,
        html: renderRunDetailHtml(selection.item),
      };
    default:
      return {
        title: 'Detail',
        html: '<html><body></body></html>',
      };
  }
}
