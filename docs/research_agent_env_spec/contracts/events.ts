// contracts/events.ts
// v0.2
// 说明：当前实现里的主要事件流围绕 Run 产生，而不是完整领域事件总线。

export type RunEventType =
  | "RUN_STATUS"
  | "LOG_LINE"
  | "PROGRESS"
  | "TOOL_CALL"
  | "RESULT_SUMMARY"
  | "STEP_STARTED"
  | "STEP_LOG"
  | "STEP_RESULT"
  | "ARTIFACT_CREATED"
  | "CHECKPOINT_REQUIRED"
  | "CHECKPOINT_DECIDED"
  | "REVIEW_ACTION"
  | "RUN_SUMMARY";

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  eventType: RunEventType | string;
  status?: string | null;
  message?: string | null;
  progress?: number | null;
  payload?: unknown;
  timestamp: string;
}

export interface TreeStateTransitionNote {
  nodeId: string;
  prevStatus?: string;
  nextStatus: string;
  runId?: string;
  updatedAt: string;
}
