import type { ArisStore } from '../state/store';
import type { TreeViewItem } from './projectsProvider';

function buildRunLabel(run: { title: string; prompt: string; workflowType: string }): string {
  const label = run.title || run.prompt || run.workflowType;
  return label.length > 48 ? `${label.slice(0, 45)}...` : label;
}

export class RunsProvider {
  constructor(private readonly store: ArisStore) {}

  async getChildren(): Promise<TreeViewItem[]> {
    return this.store.visibleRuns.map((run) => ({
      id: run.id,
      label: buildRunLabel(run),
      description: run.status,
    }));
  }
}
