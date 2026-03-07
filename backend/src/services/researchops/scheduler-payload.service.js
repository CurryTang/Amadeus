'use strict';

const { buildRunPayload } = require('./run-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildSchedulerActions() {
  return {
    leaseNext: {
      method: 'POST',
      path: '/researchops/scheduler/lease-next',
    },
    leaseAndExecute: {
      method: 'POST',
      path: '/researchops/scheduler/lease-and-execute',
    },
    recoverStale: {
      method: 'POST',
      path: '/researchops/scheduler/recover-stale',
    },
    dispatcherStatus: {
      method: 'GET',
      path: '/researchops/scheduler/dispatcher/status',
    },
  };
}

function buildSchedulerLeasePayload({
  mode = '',
  serverId = '',
  result = null,
} = {}) {
  const source = asObject(result);
  const runPayload = buildRunPayload({ run: source.run || null });
  const actions = buildSchedulerActions();
  if (runPayload.run?.id) {
    actions.runDetail = {
      method: 'GET',
      path: `/researchops/runs/${encodeURIComponent(String(runPayload.run.id))}`,
    };
  }
  return {
    mode: cleanString(mode) || null,
    serverId: cleanString(serverId) || null,
    leased: source.leased === true,
    reason: cleanString(source.reason) || null,
    capacity: Number.isFinite(Number(source.capacity)) ? Number(source.capacity) : null,
    activeCount: Number.isFinite(Number(source.activeCount)) ? Number(source.activeCount) : null,
    run: runPayload.run,
    attempt: runPayload.attempt,
    execution: runPayload.execution,
    followUp: runPayload.followUp,
    contract: runPayload.contract,
    actions,
  };
}

function buildSchedulerRecoveryPayload({
  serverId = '',
  minutesStale = null,
  dryRun = false,
  result = null,
} = {}) {
  const source = asObject(result);
  return {
    filters: {
      serverId: cleanString(serverId) || null,
      minutesStale: Number.isFinite(Number(minutesStale)) ? Number(minutesStale) : null,
      dryRun: Boolean(dryRun),
    },
    recovered: Number.isFinite(Number(source.recovered)) ? Number(source.recovered) : 0,
    items: Array.isArray(source.items) ? source.items : [],
    terminatedLocalProcesses: Number.isFinite(Number(source.terminatedLocalProcesses))
      ? Number(source.terminatedLocalProcesses)
      : 0,
    terminated: Array.isArray(source.terminated) ? source.terminated : [],
    actions: buildSchedulerActions(),
  };
}

function buildSchedulerStatusPayload({
  dispatcher = null,
  runner = null,
  refreshedAt = '',
} = {}) {
  return {
    dispatcher: asObject(dispatcher),
    runner: asObject(runner),
    refreshedAt: cleanString(refreshedAt) || null,
    actions: buildSchedulerActions(),
  };
}

module.exports = {
  buildSchedulerLeasePayload,
  buildSchedulerRecoveryPayload,
  buildSchedulerStatusPayload,
};
