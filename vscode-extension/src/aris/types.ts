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
  type: string;
  status: string;
};

export type ArisContext = {
  projects: ArisProject[];
  runner: ArisRunner;
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
};

export type ArisRunDetail = ArisRunSummary & {
  runnerHost: string;
  downstreamServerName: string;
  runDirectory: string;
};

export type CreateArisRunInput = {
  projectId: string;
  workflowType: string;
  prompt: string;
};
