import type { ArisClient } from '../aris/client';
import type {
  ArisContext,
  ArisProjectDetail,
  ArisRunDetail,
  ArisRunSummary,
} from '../aris/types';

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

  get selectedProjectDetail(): ArisProjectDetail | null {
    if (!this.context) return null;
    const project = this.context.projects.find((item) => item.id === this.selectedProjectId) || this.context.projects[0];
    if (!project) return null;

    const defaultSelections = this.context.defaultSelections || {
      runnerServerId: null,
      downstreamServerId: null,
      remoteWorkspacePath: '',
      datasetRoot: '',
    };
    const runners = this.context.runners?.length ? this.context.runners : [this.context.runner];
    const runner = runners.find((item) => String(item.id) === String(defaultSelections.runnerServerId))
      || this.context.runner
      || runners[0];
    const downstreamServer = (this.context.downstreamServers || []).find(
      (item) => String(item.id) === String(defaultSelections.downstreamServerId)
    ) || this.context.downstreamServers?.[0];

    return {
      id: project.id,
      projectLabel: project.name || 'Default Project',
      runnerLabel: runner?.name ? `WSL runner: ${runner.name}` : 'WSL runner pending',
      runnerStatus: runner?.status || 'unknown',
      runnerSummary: runner?.host ? `Runner host: ${runner.host}` : 'Runner host pending',
      workspaceLabel: defaultSelections.remoteWorkspacePath || 'Workspace pending',
      datasetLabel: defaultSelections.datasetRoot
        ? `Remote dataset: ${defaultSelections.datasetRoot}`
        : 'Remote dataset not set',
      destinationLabel: downstreamServer?.name
        ? `Experiment target: ${downstreamServer.name}`
        : 'Experiment target: not selected',
      targetSummary: `${(this.context.downstreamServers || []).length} available target${(this.context.downstreamServers || []).length === 1 ? '' : 's'}`,
      quickActionLabels: (this.context.quickActions || []).map((action) => action.label).filter(Boolean),
      recentRuns: this.visibleRuns.map((run) => ({
        id: run.id,
        title: normalizeString(run.title) || normalizeString(run.prompt) || labelWorkflow(run.workflowType, this.context),
        workflowLabel: labelWorkflow(run.workflowType, this.context),
        statusLabel: labelStatus(run.status, run.activePhase),
        runnerLabel: run.runnerHost ? `WSL: ${run.runnerHost}` : 'WSL runner pending',
        destinationLabel: run.downstreamServerName ? `Compute: ${run.downstreamServerName}` : 'No downstream server',
        summary: normalizeString(run.summary),
        startedAt: run.startedAt,
      })),
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function normalizeString(value: string | null | undefined): string {
  return String(value || '').trim();
}

function labelWorkflow(workflowType: string | null | undefined, context: ArisContext | null): string {
  const key = normalizeString(workflowType) || 'custom_run';
  const match = context?.quickActions?.find((action) => action.workflowType === key || action.id === key);
  if (match?.label) return match.label;
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function labelStatus(status: string | null | undefined, activePhase: string | null | undefined): string {
  const normalizedStatus = normalizeString(status) || 'queued';
  const phase = normalizeString(activePhase);
  if (normalizedStatus === 'completed') return 'Completed';
  if (normalizedStatus === 'failed') return 'Failed';
  if (normalizedStatus === 'running') {
    if (phase === 'dispatch_experiment') return 'Dispatching experiment';
    if (phase === 'wait_results') return 'Waiting for results';
    if (phase === 'review') return 'Reviewing';
    return 'Running on WSL';
  }
  return 'Queued';
}
