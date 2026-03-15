import type { ArisStore } from '../state/store';
import type { TreeViewItem } from './types';

export class ProjectsProvider {
  constructor(private readonly store: ArisStore) {}

  async getChildren(): Promise<TreeViewItem[]> {
    const projects = this.store.context?.projects || [];
    return projects.map((project) => ({
      id: project.id,
      label: project.name,
      description: project.id === this.store.selectedProjectId
        ? this.store.selectedProjectDetail?.runnerLabel.replace('WSL runner: ', 'WSL: ')
        : undefined,
    }));
  }
}
