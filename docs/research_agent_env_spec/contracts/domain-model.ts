// contracts/domain-model.ts
// v0.2
// 说明：优先对齐当前 researchops 实现。Attempt 保留为语义层概念，Run 是当前真实执行对象。

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  locationType: string;
  serverId?: string | null;
  projectPath?: string | null;
  kbFolderPath?: string | null;
  gitBranch?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreeNode {
  id: string;
  parent?: string;
  title: string;
  kind: string;
  assumption: string[];
  target: string[];
  commands: Array<string | { name?: string; run?: string }>;
  checks: Array<Record<string, unknown>>;
  evidenceDeps: string[];
  resources: Record<string, unknown>;
  on_fail?: Record<string, unknown>;
  git?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  tags: string[];
  activeChild?: string;
  search?: Record<string, unknown>;
}

export type TreeNodeStatus =
  | "PLANNED"
  | "BLOCKED"
  | "RUNNING"
  | "PASSED"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED"
  | "STALE";

export interface TreeNodeState {
  status?: TreeNodeStatus;
  blockedBy?: string[];
  manualApproved?: boolean;
  lastRunId?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TreeState {
  nodes: Record<string, TreeNodeState>;
  runs: Record<string, unknown>;
  queue: {
    paused: boolean;
    pausedReason: string;
    updatedAt?: string | null;
    items: unknown[];
  };
  search: Record<string, unknown>;
  updatedAt: string;
}

export interface AttemptConcept {
  id: string;
  projectId: string;
  nodeId?: string;
  status: string;
}

export type RunStatus = "QUEUED" | "PROVISIONING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface Run {
  id: string;
  userId: string;
  schemaVersion: string;
  projectId: string;
  serverId: string;
  runType: string;
  provider?: string | null;
  status: RunStatus;
  mode: string;
  workflow: unknown[];
  skillRefs: string[];
  contextRefs: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  budgets: Record<string, unknown>;
  hitlPolicy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  projectId: string;
  title?: string | null;
  status: string;
  provider: string;
  model?: string | null;
  reasoningEffort?: string | null;
  serverId: string;
  activeRunId?: string | null;
  lastRunId?: string | null;
  lastRunStatus?: string | null;
  lastMessage?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ObservedSession {
  id: string;
  sessionId?: string;
  provider: string;
  agentType?: string;
  gitRoot?: string;
  cwd?: string;
  sessionFile: string;
  title: string;
  promptDigest?: string;
  latestProgressDigest?: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  contentHash?: string;
  classification?: Record<string, unknown>;
}

export interface RunArtifact {
  id: string;
  runId: string;
  stepId?: string | null;
  kind: string;
  title?: string | null;
  path?: string | null;
  mimeType?: string | null;
  objectKey?: string | null;
  objectUrl?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeContextPack {
  projectId: string;
  runId?: string;
  groups: unknown[];
  documents: unknown[];
  assets: unknown[];
  resourceHints?: {
    query?: string;
    paths?: string[];
  };
  generatedAt: string;
}

export interface RoutedRunContext {
  selected_items: unknown[];
  budget_report: {
    total_budget_tokens: number;
    role_budget_tokens: Record<string, number>;
    bucket_counts: Record<string, number>;
  };
  context_for_runner?: unknown;
  context_for_coder?: unknown;
  context_for_analyst?: unknown;
  context_for_writer?: unknown;
}

export interface RunReport {
  runId: string;
  summary?: string | null;
  runWorkspacePath?: string | null;
  artifacts: RunArtifact[];
  manifest?: Record<string, unknown>;
  highlights?: Record<string, unknown>;
}
