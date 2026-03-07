import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNodeBridgeSummary } from './nodeBridgePresentation.js';

test('buildNodeBridgeSummary summarizes bridge runtime, transports, and task readiness', () => {
  const rows = buildNodeBridgeSummary({
    resolvedTransport: 'daemon-task',
    bridgeRuntime: {
      executionTarget: 'client-daemon',
      serverId: 'srv_client_1',
      preferredTransport: 'daemon-task',
      availableTransports: ['http', 'daemon-task', 'rust-daemon'],
      missingBridgeTaskTypes: [],
      capabilities: {
        canCaptureWorkspaceSnapshot: true,
      },
    },
    capabilities: {
      canUseLocalBridgeWorkflow: true,
      hasLastRun: true,
      hasBridgeReport: true,
      hasContextPack: true,
      hasWorkspaceSnapshot: true,
      hasLocalSnapshot: true,
      hasEnvSnapshot: true,
      hasContractFailures: true,
    },
    taskActions: {
      fetchNodeContext: { taskType: 'bridge.fetchNodeContext' },
      submitNodeRun: { taskType: 'bridge.submitNodeRun' },
    },
  });

  assert.deepEqual(rows, [
    { label: 'Runtime', value: 'client-daemon' },
    { label: 'Server', value: 'srv_client_1' },
    { label: 'Resolved Transport', value: 'daemon-task' },
    { label: 'Preferred Transport', value: 'daemon-task' },
    { label: 'Available Transports', value: 'http, daemon-task, rust-daemon' },
    { label: 'Bridge Workflow', value: 'Ready' },
    { label: 'Last Run', value: 'Available' },
    { label: 'Bridge Report', value: 'Available' },
    { label: 'Bridge Context', value: 'Context pack available' },
    { label: 'Snapshots', value: 'workspace, local, env' },
    { label: 'Snapshot Capture', value: 'Available' },
    { label: 'Contract', value: 'Failures detected' },
    { label: 'Fetch Task', value: 'bridge.fetchNodeContext' },
    { label: 'Run Task', value: 'bridge.submitNodeRun' },
  ]);
});

test('buildNodeBridgeSummary reports missing bridge tasks when workflow is not ready', () => {
  const rows = buildNodeBridgeSummary({
    bridgeRuntime: {
      availableTransports: ['http', 'rust-daemon'],
      preferredTransport: 'rust-daemon',
      missingBridgeTaskTypes: ['bridge.submitRunNote', 'bridge.fetchRunReport'],
    },
    capabilities: {
      canUseLocalBridgeWorkflow: false,
    },
  });

  assert.deepEqual(rows, [
    { label: 'Preferred Transport', value: 'rust-daemon' },
    { label: 'Available Transports', value: 'http, rust-daemon' },
    { label: 'Bridge Workflow', value: 'Missing 2 tasks' },
  ]);
});
