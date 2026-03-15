export type ArisQuickAction = {
  id: string;
  label: string;
  workflowType: string;
};

export type ArisProject = {
  id: string;
  name: string;
};

export type ArisRunner = {
  id: number | string | null;
  name: string;
  host?: string;
  type: string;
  status: string;
};

export type ArisDownstreamServer = {
  id: number | string | null;
  name: string;
  host?: string;
  status?: string;
};

export type ArisDefaultSelections = {
  runnerServerId: number | string | null;
  downstreamServerId: number | string | null;
  remoteWorkspacePath: string;
  datasetRoot: string;
};

export type ArisContext = {
  projects: ArisProject[];
  runner: ArisRunner;
  runners?: ArisRunner[];
  downstreamServers?: ArisDownstreamServer[];
  defaultSelections?: ArisDefaultSelections;
  quickActions: ArisQuickAction[];
  continueWhenOffline: boolean;
};

export type ArisRunSummary = {
  id: string;
  projectId: string;
  workflowType: string;
  title: string;
  prompt: string;
  status: string;
  activePhase: string;
  summary: string;
  updatedAt: string | null;
  startedAt: string | null;
  logPath: string;
  retryOfRunId: string | null;
  runnerHost?: string;
  downstreamServerName?: string;
};

export type ArisRunDetail = ArisRunSummary & {
  runDirectory: string;
};

export type ArisProjectRecentRun = {
  id: string;
  title: string;
  workflowLabel: string;
  statusLabel: string;
  runnerLabel: string;
  destinationLabel: string;
  summary: string;
  startedAt: string | null;
};

export type ArisProjectDetail = {
  id: string;
  projectLabel: string;
  runnerLabel: string;
  runnerStatus: string;
  runnerSummary: string;
  workspaceLabel: string;
  datasetLabel: string;
  destinationLabel: string;
  targetSummary: string;
  quickActionLabels: string[];
  recentRuns: ArisProjectRecentRun[];
};

export type CreateArisRunInput = {
  projectId: string;
  targetId?: string;
  workflowType: string;
  prompt: string;
};

export type ArisTarget = {
  id: string;
  projectId: string;
  sshServerId: string | number;
  sshServerName: string;
  remoteProjectPath: string;
  remoteDatasetRoot: string;
  remoteCheckpointRoot: string;
  remoteOutputRoot: string;
};

export type RemoteDirEntry = {
  name: string;
  type: 'dir' | 'file';
};
