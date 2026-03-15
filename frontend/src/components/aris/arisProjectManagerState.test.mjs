import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyProjectSettingsDraft,
  createEmptyRemoteEndpointDraft,
  projectToSettingsDraft,
  settingsDraftToPayload,
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
