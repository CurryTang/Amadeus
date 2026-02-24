const BaseModule = require('./base-module');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function shouldAutoApprove(run = {}, inputs = {}, reasonCode = '') {
  const stepAutoApprove = inputs.autoApprove === true;
  if (stepAutoApprove) return true;

  const policy = asObject(run.hitlPolicy);
  if (policy.autoApprove === true) return true;

  const maxRisk = Number(policy.autoApproveMaxRisk);
  const riskScore = Number(inputs.riskScore);
  if (Number.isFinite(maxRisk) && Number.isFinite(riskScore) && riskScore <= maxRisk) {
    return true;
  }

  const allowedReasons = Array.isArray(policy.autoApproveReasonCodes)
    ? policy.autoApproveReasonCodes.map((item) => cleanString(item).toUpperCase()).filter(Boolean)
    : [];
  if (allowedReasons.length > 0 && allowedReasons.includes(cleanString(reasonCode).toUpperCase())) {
    return true;
  }

  return false;
}

class CheckpointModule extends BaseModule {
  constructor() {
    super('checkpoint.hitl');
  }

  validate(step) {
    super.validate(step);
  }

  async run(step, context) {
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const title = cleanString(inputs.title) || `Approval required for ${step.id}`;
    const message = cleanString(inputs.message) || 'Human approval is required to continue this run.';
    const reasonCode = cleanString(inputs.reasonCode) || 'MANUAL_APPROVAL_REQUIRED';
    const requestedActions = Array.isArray(inputs.requestedActions) ? inputs.requestedActions : [];
    const timeoutMs = Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 12 * 60 * 60 * 1000;

    const autoApproved = shouldAutoApprove(context.run || {}, inputs, reasonCode);
    const decidedAt = new Date().toISOString();

    const checkpoint = await context.createCheckpoint(step, {
      title,
      message,
      reasonCode,
      requestedActions,
      ...(autoApproved
        ? {
          status: 'APPROVED',
          decision: {
            decision: 'APPROVED',
            action: 'AUTO_APPROVE',
            note: 'Auto-approved by HITL policy',
            decidedBy: 'system',
            decidedAt,
          },
          decidedAt,
        }
        : {}),
      payload: {
        inputs,
      },
    });

    await context.emitEvent({
      eventType: 'CHECKPOINT_REQUIRED',
      status: 'WAITING_APPROVAL',
      message,
      payload: {
        stepId: step.id,
        checkpointId: checkpoint.id,
        title,
        reasonCode,
        requestedActions,
      },
    });

    const decision = autoApproved
      ? checkpoint
      : await context.waitForCheckpointDecision(checkpoint.id, timeoutMs);

    await context.emitEvent({
      eventType: 'CHECKPOINT_DECIDED',
      status: decision.status,
      message: `Checkpoint ${checkpoint.id} ${decision.status.toLowerCase()}`,
      payload: {
        stepId: step.id,
        checkpointId: checkpoint.id,
        decision,
        autoApproved,
      },
    });

    const result = {
      stepId: step.id,
      moduleType: this.moduleType,
      status: decision.status === 'APPROVED' ? 'SUCCEEDED' : 'FAILED',
      metrics: {
        checkpointId: checkpoint.id,
        decision: decision.status,
      },
      outputs: {
        checkpoint: decision,
      },
    };

    if (decision.status !== 'APPROVED') {
      const error = new Error(`Checkpoint ${checkpoint.id} rejected`);
      error.result = result;
      throw error;
    }
    return result;
  }
}

module.exports = CheckpointModule;
