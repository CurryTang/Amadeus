const DEFAULT_SYNC_EXCLUDES_TEXT = 'local/\noutputs/\ncheckpoints/';

export function createEmptyRemoteEndpointDraft() {
  return {
    id: '',
    sshServerId: '',
    remoteProjectPath: '',
    remoteDatasetRoot: '',
    remoteCheckpointRoot: '',
    remoteOutputRoot: '',
  };
}

export function createEmptyProjectSettingsDraft() {
  return {
    id: '',
    name: '',
    clientWorkspaceId: '',
    localProjectPath: '',
    localFullPath: '',
    syncExcludesText: DEFAULT_SYNC_EXCLUDES_TEXT,
    noRemote: true,
    remoteEndpoints: [createEmptyRemoteEndpointDraft()],
  };
}

export function syncExcludesTextToArray(text) {
  return String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function targetToDraft(target = {}) {
  return {
    id: target.id || '',
    sshServerId: target.sshServerId ? String(target.sshServerId) : '',
    remoteProjectPath: target.remoteProjectPath || '',
    remoteDatasetRoot: target.remoteDatasetRoot || '',
    remoteCheckpointRoot: target.remoteCheckpointRoot || '',
    remoteOutputRoot: target.remoteOutputRoot || '',
  };
}

export function projectToSettingsDraft(project = null, targets = []) {
  if (!project) return createEmptyProjectSettingsDraft();

  const nextTargets = Array.isArray(targets) && targets.length > 0
    ? targets.map((target) => targetToDraft(target))
    : [createEmptyRemoteEndpointDraft()];

  return {
    id: project.id || '',
    name: project.name || '',
    clientWorkspaceId: project.clientWorkspaceId || '',
    localProjectPath: project.localProjectPath || '',
    localFullPath: project.localFullPath || '',
    syncExcludesText: Array.isArray(project.syncExcludes) && project.syncExcludes.length > 0
      ? project.syncExcludes.join('\n')
      : DEFAULT_SYNC_EXCLUDES_TEXT,
    noRemote: !targets || targets.length === 0,
    remoteEndpoints: nextTargets,
  };
}

export function settingsDraftToPayload(draft = {}) {
  const noRemote = draft.noRemote === true;
  const remoteEndpoints = noRemote
    ? []
    : (Array.isArray(draft.remoteEndpoints) ? draft.remoteEndpoints : []).map((endpoint) => ({
      id: endpoint.id || '',
      sshServerId: endpoint.sshServerId ? Number(endpoint.sshServerId) : null,
      remoteProjectPath: String(endpoint.remoteProjectPath || '').trim(),
      remoteDatasetRoot: String(endpoint.remoteDatasetRoot || '').trim(),
      remoteCheckpointRoot: String(endpoint.remoteCheckpointRoot || '').trim(),
      remoteOutputRoot: String(endpoint.remoteOutputRoot || '').trim(),
    }));

  return {
    name: String(draft.name || '').trim(),
    clientWorkspaceId: String(draft.clientWorkspaceId || '').trim(),
    localProjectPath: String(draft.localProjectPath || '').trim(),
    localFullPath: String(draft.localFullPath || '').trim(),
    syncExcludes: syncExcludesTextToArray(draft.syncExcludesText),
    noRemote,
    remoteEndpoints,
  };
}

export function validateProjectSettingsDraft(draft = {}) {
  if (!String(draft.name || '').trim()) {
    return 'Project name is required.';
  }
  // Local workspace is optional — remote-only projects don't need it
  if (draft.noRemote === true) {
    return '';
  }

  const endpoints = Array.isArray(draft.remoteEndpoints) ? draft.remoteEndpoints : [];
  if (endpoints.length === 0) {
    return 'Add at least one remote endpoint or enable No Remote.';
  }

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index] || {};
    if (!String(endpoint.sshServerId || '').trim()) {
      return `Select an SSH server for remote endpoint ${index + 1}.`;
    }
    if (!String(endpoint.remoteProjectPath || '').trim()) {
      return `Enter a remote project path for remote endpoint ${index + 1}.`;
    }
  }

  return '';
}
