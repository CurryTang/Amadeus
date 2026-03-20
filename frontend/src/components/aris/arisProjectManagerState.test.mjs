import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyProjectSettingsDraft,
  createEmptyRemoteEndpointDraft,
  createEmptyRunLaunchDraft,
  createEmptyWorkItemDraft,
  projectToSettingsDraft,
  runLaunchDraftToPayload,
  settingsDraftToPayload,
  validateRunLaunchDraft,
  validateWorkItemDraft,
  workItemDraftToPayload,
  workItemToDraft,
  validateProjectSettingsDraft,
} from './arisProjectManagerState.js';

test('projectToSettingsDraft loads no-remote projects with disabled endpoint editing state', () => {
  const draft = projectToSettingsDraft({
    id: 'proj_1',
    name: 'AutoRDL',
    clientWorkspaceId: 'cw_1',
    localProjectPath: 'AutoRDL',
    syncExcludes: ['local/', 'outputs/'],
  }, []);

  assert.equal(draft.id, 'proj_1');
  assert.equal(draft.noRemote, true);
  assert.deepEqual(draft.remoteEndpoints, [createEmptyRemoteEndpointDraft()]);
});

test('projectToSettingsDraft loads existing remote endpoints for editing', () => {
  const draft = projectToSettingsDraft({
    id: 'proj_1',
    name: 'AutoRDL',
    clientWorkspaceId: 'cw_1',
    localProjectPath: 'AutoRDL',
    syncExcludes: ['local/'],
  }, [
    {
      id: 'target_1',
      sshServerId: 12,
      remoteProjectPath: '/srv/aris/autorDl',
      remoteDatasetRoot: '/mnt/data/autorDl',
      remoteCheckpointRoot: '/mnt/checkpoints/autorDl',
      remoteOutputRoot: '/mnt/outputs/autorDl',
    },
  ]);

  assert.equal(draft.noRemote, false);
  assert.equal(draft.remoteEndpoints.length, 1);
  assert.equal(draft.remoteEndpoints[0].sshServerId, '12');
});

test('settingsDraftToPayload strips remote endpoints when no-remote is enabled', () => {
  const payload = settingsDraftToPayload({
    ...createEmptyProjectSettingsDraft(),
    name: 'AutoRDL',
    clientWorkspaceId: 'cw_1',
    localProjectPath: 'AutoRDL',
    syncExcludesText: 'local/\noutputs/',
    noRemote: true,
    remoteEndpoints: [
      {
        id: 'target_1',
        sshServerId: '12',
        remoteProjectPath: '/srv/aris/autorDl',
        remoteDatasetRoot: '/mnt/data/autorDl',
        remoteCheckpointRoot: '',
        remoteOutputRoot: '',
      },
    ],
  });

  assert.equal(payload.noRemote, true);
  assert.deepEqual(payload.remoteEndpoints, []);
  assert.deepEqual(payload.syncExcludes, ['local/', 'outputs/']);
});

test('validateProjectSettingsDraft requires ssh server and remote path when no-remote is disabled', () => {
  const message = validateProjectSettingsDraft({
    ...createEmptyProjectSettingsDraft(),
    name: 'AutoRDL',
    clientWorkspaceId: 'cw_1',
    localProjectPath: 'AutoRDL',
    noRemote: false,
    remoteEndpoints: [createEmptyRemoteEndpointDraft()],
  });

  assert.equal(message, 'Select an SSH server for remote endpoint 1.');
});

test('createEmptyWorkItemDraft starts with a blank dispatch packet', () => {
  const draft = createEmptyWorkItemDraft();

  assert.equal(draft.title, '');
  assert.equal(draft.status, 'backlog');
  assert.equal(draft.actorType, 'unknown');
  assert.deepEqual(draft.wakeups, [createEmptyRunLaunchDraft().wakeups[0]]);
});

test('workItemToDraft and workItemDraftToPayload preserve structured packet fields', () => {
  const draft = workItemToDraft({
    id: 'wi_1',
    title: 'Launch review loop',
    summary: 'Track the current async pass',
    type: 'research',
    status: 'ready',
    priority: 3,
    actorType: 'agent',
    goal: 'Validate outputs',
    whyItMatters: 'Keeps the thread alive',
    contextMd: 'Context',
    constraintsMd: 'Constraints',
    deliverableMd: 'Deliverable',
    verificationMd: 'Verification',
    blockedBehaviorMd: 'Do not auto-close',
    outputFormatMd: 'Markdown',
    nextBestAction: 'Create run',
    nextCheckAt: '2026-03-22T09:00:00.000Z',
    blockedReason: '',
    dueAt: '2026-03-25T12:00:00.000Z',
    archivedAt: '',
    wakeups: [{ reason: 'Check output', scheduledFor: '2026-03-22T09:00:00.000Z', status: 'scheduled' }],
  });

  assert.equal(draft.id, 'wi_1');
  assert.equal(draft.title, 'Launch review loop');
  assert.equal(draft.goal, 'Validate outputs');
  assert.equal(draft.wakeups.length, 1);
  assert.equal(validateWorkItemDraft(draft), '');

  const payload = workItemDraftToPayload(draft);
  assert.equal(payload.type, 'research');
  assert.equal(payload.actorType, 'agent');
  assert.equal(payload.nextCheckAt, '2026-03-22T09:00:00.000Z');
  assert.equal(payload.wakeups.length, 1);
});

test('validateWorkItemDraft requires a title and goal', () => {
  const message = validateWorkItemDraft(createEmptyWorkItemDraft());

  assert.equal(message, 'Work item title is required.');
});

test('validateRunLaunchDraft requires wakeup data before launching a run', () => {
  const draft = createEmptyRunLaunchDraft();
  const message = validateRunLaunchDraft(draft);

  assert.equal(message, 'Add at least one wake-up before launching a run.');

  const validMessage = validateRunLaunchDraft({
    ...draft,
    projectId: 'proj_1',
    workItemId: 'wi_1',
    wakeups: [
      {
        reason: 'Check results',
        scheduledFor: '2026-03-22T09:00:00.000Z',
      },
    ],
  });

  assert.equal(validMessage, '');
});

test('runLaunchDraftToPayload strips empty wakeups and keeps scheduled checks', () => {
  const payload = runLaunchDraftToPayload({
    ...createEmptyRunLaunchDraft(),
    projectId: 'proj_1',
    workItemId: 'wi_1',
    prompt: 'Review the latest output',
    wakeups: [
      { reason: 'Check output', scheduledFor: '2026-03-22T09:00:00.000Z', status: 'scheduled' },
      { reason: '', scheduledFor: '', status: 'scheduled' },
    ],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.workItemId, 'wi_1');
  assert.equal(payload.wakeups.length, 1);
  assert.equal(payload.wakeups[0].reason, 'Check output');
});
