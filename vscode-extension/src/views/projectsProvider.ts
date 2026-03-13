import type { ArisStore } from '../state/store';

export type TreeViewItem = {
  id: string;
  label: string;
  description?: string;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
};

export class ProjectsProvider {
  constructor(private readonly store: ArisStore) {}

  async getChildren(): Promise<TreeViewItem[]> {
    const projects = this.store.context?.projects || [];
    return projects.map((project) => ({
      id: project.id,
      label: project.name,
      description: project.id === this.store.selectedProjectId ? 'selected' : undefined,
    }));
  }
}
