import { buildContinuationChip } from './runPresentation.js';

function addContinuationChip(chips = [], run = {}) {
  const nextChip = buildContinuationChip(run);
  if (!nextChip) return Array.isArray(chips) ? chips : [];
  return [nextChip];
}

function buildPayloadWithContinuation(payload = {}, chips = []) {
  const basePayload = payload && typeof payload === 'object' ? payload : {};
  const list = Array.isArray(chips) ? chips : [];
  const runIds = list.map((item) => String(item?.runId || '').trim()).filter(Boolean);
  if (runIds.length === 0) return basePayload;
  return {
    ...basePayload,
    contextRefs: {
      ...(basePayload.contextRefs && typeof basePayload.contextRefs === 'object' ? basePayload.contextRefs : {}),
      continueRunIds: runIds,
    },
    metadata: {
      ...(basePayload.metadata && typeof basePayload.metadata === 'object' ? basePayload.metadata : {}),
      parentRunId: runIds[0],
      continuationOfRunId: runIds[0],
    },
  };
}

export {
  addContinuationChip,
  buildPayloadWithContinuation,
};
