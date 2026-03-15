import {
  type ArisContext,
  type ArisDefaultSelections,
  type ArisDownstreamServer,
  type ArisProject,
  type ArisProjectDetail,
  type ArisQuickAction,
  type ArisRunDetail,
  type ArisRunSummary,
  type ArisRunner,
  type ArisTarget,
  type CreateArisRunInput,
  type RemoteDirEntry,
} from './types';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ArisClientOptions = {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  fetchImpl?: FetchLike;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toNullableStringValue(value: unknown): string | null {
  const stringValue = toStringValue(value);
  return stringValue ? stringValue : null;
}

function toBooleanValue(value: unknown): boolean {
  return Boolean(value);
}

function normalizeProject(value: unknown): ArisProject {
  const record = toRecord(value);
  return {
    id: toStringValue(record.id),
    name: toStringValue(record.name),
  };
}

function normalizeRunner(value: unknown): ArisRunner {
  const record = toRecord(value);
  return {
    id: typeof record.id === 'number' || typeof record.id === 'string' ? record.id : null,
    name: toStringValue(record.name),
    host: toStringValue(record.host),
    type: toStringValue(record.type),
    status: toStringValue(record.status),
  };
}

function normalizeDownstreamServer(value: unknown): ArisDownstreamServer {
  const record = toRecord(value);
  return {
    id: typeof record.id === 'number' || typeof record.id === 'string' ? record.id : null,
    name: toStringValue(record.name),
    host: toStringValue(record.host),
    status: toStringValue(record.status),
  };
}

function normalizeDefaultSelections(value: unknown): ArisDefaultSelections {
  const record = toRecord(value);
  return {
    runnerServerId: typeof record.runnerServerId === 'number' || typeof record.runnerServerId === 'string'
      ? record.runnerServerId
      : null,
    downstreamServerId: typeof record.downstreamServerId === 'number' || typeof record.downstreamServerId === 'string'
      ? record.downstreamServerId
      : null,
    remoteWorkspacePath: toStringValue(record.remoteWorkspacePath),
    datasetRoot: toStringValue(record.datasetRoot),
  };
}

function normalizeQuickAction(value: unknown): ArisQuickAction {
  const record = toRecord(value);
  return {
    id: toStringValue(record.id),
    label: toStringValue(record.label),
    workflowType: toStringValue(record.workflowType),
  };
}

function normalizeRunSummary(value: unknown): ArisRunSummary {
  const record = toRecord(value);
  return {
    id: toStringValue(record.id),
    projectId: toStringValue(record.projectId),
    workflowType: toStringValue(record.workflowType),
    title: toStringValue(record.title),
    prompt: toStringValue(record.prompt),
    status: toStringValue(record.status),
    activePhase: toStringValue(record.activePhase),
    summary: toStringValue(record.summary),
    updatedAt: toNullableStringValue(record.updatedAt),
    startedAt: toNullableStringValue(record.startedAt),
    logPath: toStringValue(record.logPath),
    retryOfRunId: toNullableStringValue(record.retryOfRunId),
    runnerHost: toStringValue(record.runnerHost),
    downstreamServerName: toStringValue(record.downstreamServerName),
  };
}

function normalizeTarget(value: unknown): ArisTarget {
  const record = toRecord(value);
  return {
    id: toStringValue(record.id),
    projectId: toStringValue(record.projectId),
    sshServerId: typeof record.sshServerId === 'number' ? record.sshServerId : toStringValue(record.sshServerId),
    sshServerName: toStringValue(record.sshServerName),
    remoteProjectPath: toStringValue(record.remoteProjectPath),
    remoteDatasetRoot: toStringValue(record.remoteDatasetRoot),
    remoteCheckpointRoot: toStringValue(record.remoteCheckpointRoot),
    remoteOutputRoot: toStringValue(record.remoteOutputRoot),
  };
}

function normalizeRunDetail(value: unknown): ArisRunDetail {
  const record = toRecord(value);
  const summary = normalizeRunSummary(value);
  return {
    ...summary,
    runnerHost: toStringValue(record.runnerHost),
    downstreamServerName: toStringValue(record.downstreamServerName),
    runDirectory: toStringValue(record.runDirectory),
  };
}

export class ArisClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: FetchLike;

  private readonly getAuthToken: (() => Promise<string | undefined>) | undefined;

  constructor(options: ArisClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.getAuthToken = options.getAuthToken;
  }

  async getContext(): Promise<ArisContext> {
    const payload = toRecord(await this.request('/aris/context'));
    return {
      projects: Array.isArray(payload.projects) ? payload.projects.map(normalizeProject) : [],
      runner: normalizeRunner(payload.runner),
      runners: Array.isArray(payload.runners) ? payload.runners.map(normalizeRunner) : [],
      downstreamServers: Array.isArray(payload.downstreamServers) ? payload.downstreamServers.map(normalizeDownstreamServer) : [],
      defaultSelections: normalizeDefaultSelections(payload.defaultSelections),
      quickActions: Array.isArray(payload.quickActions) ? payload.quickActions.map(normalizeQuickAction) : [],
      continueWhenOffline: toBooleanValue(payload.continueWhenOffline),
    };
  }

  async listRuns(): Promise<ArisRunSummary[]> {
    const payload = toRecord(await this.request('/aris/runs'));
    return Array.isArray(payload.runs) ? payload.runs.map(normalizeRunSummary) : [];
  }

  async getRun(runId: string): Promise<ArisRunDetail> {
    const payload = toRecord(await this.request(`/aris/runs/${encodeURIComponent(runId)}`));
    return normalizeRunDetail(payload.run);
  }

  async createRun(input: CreateArisRunInput): Promise<ArisRunDetail> {
    const payload = toRecord(await this.request('/aris/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }));
    return normalizeRunDetail(payload.run);
  }

  async retryRun(runId: string): Promise<ArisRunDetail> {
    const payload = toRecord(await this.request(`/aris/runs/${encodeURIComponent(runId)}/retry`, {
      method: 'POST',
    }));
    return normalizeRunDetail(payload.run);
  }

  async listTargets(projectId: string): Promise<ArisTarget[]> {
    const payload = toRecord(await this.request(`/aris/projects/${encodeURIComponent(projectId)}/targets`));
    return Array.isArray(payload.targets) ? payload.targets.map(normalizeTarget) : [];
  }

  async lsRemotePath(serverId: string | number, path: string): Promise<{ entries: RemoteDirEntry[]; parent: string }> {
    const payload = toRecord(await this.request(`/ssh-servers/${encodeURIComponent(String(serverId))}/ls`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }));
    const entries = Array.isArray(payload.entries)
      ? payload.entries.map((entry: unknown) => {
        const record = toRecord(entry);
        return { name: toStringValue(record.name), type: toStringValue(record.type) === 'dir' ? 'dir' as const : 'file' as const };
      })
      : [];
    return { entries, parent: toStringValue(payload.parent) || '/' };
  }

  async lsRemoteFiles(serverId: string | number, projectPath: string, query: string = ''): Promise<string[]> {
    const payload = toRecord(await this.request(`/ssh-servers/${encodeURIComponent(String(serverId))}/ls-files`, {
      method: 'POST',
      body: JSON.stringify({ projectPath, query, maxFiles: 50 }),
    }));
    return Array.isArray(payload.files) ? payload.files.map(toStringValue).filter(Boolean) : [];
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    const authToken = await this.getAuthToken?.();
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new Error(`ARIS request failed with status ${response.status}`);
    }

    return response.json();
  }
}
