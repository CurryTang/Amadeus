import type { ArisClient } from '../aris/client';
import type { ArisContext, ArisRunDetail, ArisRunSummary } from '../aris/types';

type StoreListener = () => void;

type ArisStoreDeps = {
  client: Pick<ArisClient, 'getContext' | 'listRuns' | 'getRun' | 'createRun' | 'retryRun'>;
};

export class ArisStore {
  readonly client: ArisStoreDeps['client'];

  context: ArisContext | null = null;

  runs: ArisRunSummary[] = [];

  selectedProjectId: string | null = null;

  selectedRunId: string | null = null;

  selectedRunDetail: ArisRunDetail | null = null;

  private readonly listeners = new Set<StoreListener>();

  constructor(deps: ArisStoreDeps) {
    this.client = deps.client;
  }

  subscribe(listener: StoreListener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async refresh(): Promise<void> {
    const [context, runs] = await Promise.all([
      this.client.getContext(),
      this.client.listRuns(),
    ]);
    this.context = context;
    this.runs = runs;

    if (!this.selectedProjectId) {
      this.selectedProjectId = context.projects[0]?.id || null;
    } else if (!context.projects.some((project) => project.id === this.selectedProjectId)) {
      this.selectedProjectId = context.projects[0]?.id || null;
    }

    if (this.selectedRunId) {
      const stillExists = runs.some((run) => run.id === this.selectedRunId);
      if (stillExists) {
        this.selectedRunDetail = await this.client.getRun(this.selectedRunId);
      }
    }

    this.emitChange();
  }

  selectProject(projectId: string | null): void {
    this.selectedProjectId = projectId;
    this.emitChange();
  }

  async selectRun(runId: string | null): Promise<void> {
    this.selectedRunId = runId;
    this.selectedRunDetail = runId ? await this.client.getRun(runId) : null;
    this.emitChange();
  }

  get visibleRuns(): ArisRunSummary[] {
    if (!this.selectedProjectId) return this.runs;
    return this.runs.filter((run) => run.projectId === this.selectedProjectId);
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
