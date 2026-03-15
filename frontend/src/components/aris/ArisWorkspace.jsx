'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  clearWorkspaceContents,
  getWorkspaceLink,
  linkClientWorkspace,
  materializeProjectFiles,
  removeWorkspaceLink,
} from '../../hooks/useClientWorkspaceRegistry.js';
import {
  ARIS_QUICK_ACTIONS,
  buildArisProjectRow,
  buildArisRunDetail,
  buildArisRunCard,
  buildArisWorkspaceContext,
} from './arisWorkspacePresentation.js';
import {
  createEmptyProjectSettingsDraft,
  createEmptyRemoteEndpointDraft,
  projectToSettingsDraft,
  settingsDraftToPayload,
  validateProjectSettingsDraft,
} from './arisProjectManagerState.js';

// ─── Path Autocomplete Input ────────────────────────────────────────────────

function PathAutocompleteInput({ value, onChange, placeholder, apiUrl, getAuthHeaders, sshServerId }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const fetchSuggestions = useCallback(async (prefix) => {
    if (!sshServerId || !prefix || prefix.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await axios.post(
        `${apiUrl}/ssh-servers/${sshServerId}/ls`,
        { path: prefix },
        { headers: getAuthHeaders() }
      );
      const entries = response.data?.entries || [];
      const parent = response.data?.parent || '/';
      const mapped = entries.map((entry) => ({
        label: entry.name,
        value: `${parent.replace(/\/$/, '')}/${entry.name}${entry.type === 'dir' ? '/' : ''}`,
        isDir: entry.type === 'dir',
      }));
      setSuggestions(mapped);
      setSelectedIndex(0);
      setShowSuggestions(mapped.length > 0);
    } catch {
      setSuggestions([]);
    }
  }, [apiUrl, getAuthHeaders, sshServerId]);

  const handleChange = (event) => {
    const nextValue = event.target.value;
    onChange(nextValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(nextValue), 300);
  };

  const handleSelect = (suggestion) => {
    onChange(suggestion.value);
    setShowSuggestions(false);
    if (suggestion.isDir) {
      setTimeout(() => fetchSuggestions(suggestion.value), 100);
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (suggestions[selectedIndex]) {
        event.preventDefault();
        handleSelect(suggestions[selectedIndex]);
      }
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="aris-path-autocomplete" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul className="aris-autocomplete-dropdown">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.value}
              className={`aris-autocomplete-item${index === selectedIndex ? ' is-selected' : ''}${suggestion.isDir ? ' is-dir' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); handleSelect(suggestion); }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="aris-autocomplete-icon">{suggestion.isDir ? '/' : ' '}</span>
              <span>{suggestion.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── @ Mention Textarea ─────────────────────────────────────────────────────

function MentionTextarea({ value, onChange, placeholder, rows, apiUrl, getAuthHeaders, sshServerId, projectPath }) {
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionFiles, setMentionFiles] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchFiles = useCallback(async (query) => {
    if (!sshServerId || !projectPath) {
      setMentionFiles([]);
      return;
    }
    try {
      const response = await axios.post(
        `${apiUrl}/ssh-servers/${sshServerId}/ls-files`,
        { projectPath, query, maxFiles: 30 },
        { headers: getAuthHeaders() }
      );
      const files = (response.data?.files || []).map((filePath) => ({
        label: filePath,
        value: filePath,
      }));
      setMentionFiles(files);
      setMentionIndex(0);
    } catch {
      setMentionFiles([]);
    }
  }, [apiUrl, getAuthHeaders, sshServerId, projectPath]);

  const handleChange = (event) => {
    const nextValue = event.target.value;
    const cursorPos = event.target.selectionStart;
    onChange(nextValue);

    // Detect @ trigger: look backward from cursor for an unescaped @
    const textBeforeCursor = nextValue.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex >= 0 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
      const query = textBeforeCursor.slice(atIndex + 1);
      // Only activate if no space in query (file path fragment)
      if (!/\s/.test(query) && query.length <= 80) {
        setMentionActive(true);
        setMentionStart(atIndex);
        setMentionQuery(query);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchFiles(query), 250);
        return;
      }
    }

    setMentionActive(false);
    setMentionFiles([]);
  };

  const handleSelect = (file) => {
    const before = value.slice(0, mentionStart);
    const after = value.slice(textareaRef.current?.selectionStart || mentionStart);
    const inserted = `@${file.value} `;
    const nextValue = before + inserted + after;
    onChange(nextValue);
    setMentionActive(false);
    setMentionFiles([]);
    // Restore cursor position after the inserted text
    const cursorPos = before.length + inserted.length;
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  };

  const handleKeyDown = (event) => {
    if (!mentionActive || mentionFiles.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIndex((prev) => Math.min(prev + 1, mentionFiles.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (mentionFiles[mentionIndex]) {
        event.preventDefault();
        handleSelect(mentionFiles[mentionIndex]);
      }
    } else if (event.key === 'Escape') {
      setMentionActive(false);
      setMentionFiles([]);
    }
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="aris-mention-textarea">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { setTimeout(() => setMentionActive(false), 200); }}
        placeholder={placeholder}
      />
      {mentionActive && mentionFiles.length > 0 && (
        <ul className="aris-mention-dropdown" ref={dropdownRef}>
          {mentionFiles.map((file, index) => (
            <li
              key={file.value}
              className={`aris-autocomplete-item${index === mentionIndex ? ' is-selected' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); handleSelect(file); }}
              onMouseEnter={() => setMentionIndex(index)}
            >
              <span className="aris-autocomplete-icon">@</span>
              <span>{file.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prefillPromptForAction(action) {
  if (!action || action.workflowType === 'custom_run') return '';
  return `${action.prefillPrompt} `;
}

const FOLLOW_UP_ACTIONS = [
  { value: 'continue', label: 'Continue Run' },
  { value: 'run_experiment', label: 'Run Experiment' },
  { value: 'monitor', label: 'Monitor Run' },
  { value: 'review', label: 'Review Outputs' },
  { value: 'retry', label: 'Retry Run' },
];

export default function ArisWorkspace({ apiUrl, getAuthHeaders }) {
  const [contextData, setContextData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState('custom_run');
  const [prompt, setPrompt] = useState(prefillPromptForAction(ARIS_QUICK_ACTIONS[0]));

  const [showProjectManager, setShowProjectManager] = useState(false);
  const [projectSettingsDraft, setProjectSettingsDraft] = useState(createEmptyProjectSettingsDraft());
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [linkingWorkspace, setLinkingWorkspace] = useState(false);

  const [actionType, setActionType] = useState('continue');
  const [actionPrompt, setActionPrompt] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [retryingRun, setRetryingRun] = useState(false);
  const [runOutputs, setRunOutputs] = useState(null);
  const [loadingOutputs, setLoadingOutputs] = useState(false);

  const quickActions = contextData?.quickActions?.length ? contextData.quickActions : ARIS_QUICK_ACTIONS;

  const refreshContext = async () => {
    const response = await axios.get(`${apiUrl}/aris/context`, {
      headers: getAuthHeaders(),
    });
    const payload = response.data || {};
    setContextData(payload);
    const defaultSelections = payload.defaultSelections || {};
    setSelectedProjectId((prev) => {
      if (prev && (payload.projects || []).some((project) => project.id === prev)) return prev;
      return defaultSelections.projectId || payload.projects?.[0]?.id || '';
    });
    setSelectedTargetId((prev) => {
      if (prev && (payload.targets || []).some((target) => target.id === prev)) return prev;
      return defaultSelections.targetId || '';
    });
    return payload;
  };

  const fetchRunDetail = async (runId, { silent = false } = {}) => {
    if (!runId) {
      setSelectedRunDetail(null);
      return null;
    }
    if (!silent) setLoadingDetail(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/runs/${runId}`, {
        headers: getAuthHeaders(),
      });
      const detail = response.data?.run || null;
      setSelectedRunDetail(detail);
      return detail;
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  };

  const fetchRunOutputs = async (run) => {
    if (!run?.runDirectory || !run?.runnerServerId) {
      setRunOutputs(null);
      return;
    }
    setLoadingOutputs(true);
    try {
      const response = await axios.post(`${apiUrl}/ssh-servers/${run.runnerServerId}/ls`, {
        path: run.runDirectory + '/outputs/',
      }, { headers: getAuthHeaders() });
      const entries = response.data?.entries || [];
      if (entries.length === 0) {
        const rootResponse = await axios.post(`${apiUrl}/ssh-servers/${run.runnerServerId}/ls`, {
          path: run.runDirectory + '/',
        }, { headers: getAuthHeaders() });
        setRunOutputs(rootResponse.data?.entries || []);
      } else {
        setRunOutputs(entries);
      }
    } catch {
      setRunOutputs(null);
    } finally {
      setLoadingOutputs(false);
    }
  };

  const fetchRuns = async () => {
    const response = await axios.get(`${apiUrl}/aris/runs`, {
      headers: getAuthHeaders(),
    });
    const nextRuns = response.data?.runs || [];
    setRuns(nextRuns);
    setSelectedRunId((prev) => {
      if (prev && nextRuns.some((run) => run.id === prev)) return prev;
      return nextRuns[0]?.id || '';
    });
    return nextRuns;
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadingRuns(true);
      setError('');
      try {
        const [contextResponse, runsResponse] = await Promise.all([
          axios.get(`${apiUrl}/aris/context`, { headers: getAuthHeaders() }),
          axios.get(`${apiUrl}/aris/runs`, { headers: getAuthHeaders() }),
        ]);
        if (!active) return;
        const payload = contextResponse.data || {};
        const nextRuns = runsResponse.data?.runs || [];
        setContextData(payload);
        const defaultSelections = payload.defaultSelections || {};
        setSelectedProjectId(defaultSelections.projectId || payload.projects?.[0]?.id || '');
        setSelectedTargetId(defaultSelections.targetId || '');
        setRuns(nextRuns);
        setSelectedRunId(nextRuns[0]?.id || '');
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load ARIS workspace');
      } finally {
        if (!active) return;
        setLoading(false);
        setLoadingRuns(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [apiUrl, getAuthHeaders]);

  const selectedProject = useMemo(
    () => (contextData?.projects || []).find((project) => project.id === selectedProjectId) || null,
    [contextData, selectedProjectId]
  );

  const projectTargets = useMemo(
    () => (contextData?.targets || []).filter((target) => String(target.projectId) === String(selectedProjectId)),
    [contextData, selectedProjectId]
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedTargetId('');
      return;
    }
    if (projectTargets.length === 0) {
      setSelectedTargetId('');
      return;
    }
    if (!projectTargets.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId(projectTargets[0].id);
    }
  }, [projectTargets, selectedProjectId, selectedTargetId]);

  const selectedTarget = useMemo(
    () => projectTargets.find((target) => target.id === selectedTargetId) || null,
    [projectTargets, selectedTargetId]
  );

  useEffect(() => {
    let active = true;
    if (!selectedRunId) {
      setSelectedRunDetail(null);
      return undefined;
    }

    const loadDetail = async () => {
      try {
        const response = await axios.get(`${apiUrl}/aris/runs/${selectedRunId}`, {
          headers: getAuthHeaders(),
        });
        if (!active) return;
        setSelectedRunDetail(response.data?.run || null);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load ARIS run detail');
      } finally {
        if (!active) return;
        setLoadingDetail(false);
      }
    };

    setLoadingDetail(true);
    loadDetail();
    const interval = setInterval(() => {
      loadDetail().catch(() => {});
    }, 20000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [apiUrl, getAuthHeaders, selectedRunId]);

  useEffect(() => {
    setRunOutputs(null);
  }, [selectedRunId]);

  const workspaceContext = useMemo(() => buildArisWorkspaceContext({
    project: selectedProject || {},
    target: selectedTarget || {},
  }), [selectedProject, selectedTarget]);

  const projectRows = useMemo(
    () => (contextData?.projects || []).map((project) => buildArisProjectRow(project)),
    [contextData]
  );
  const runCards = useMemo(() => runs.map((run) => buildArisRunCard(run)), [runs]);
  const selectedRunCard = useMemo(
    () => buildArisRunDetail(selectedRunDetail || runs.find((run) => run.id === selectedRunId) || {}),
    [runs, selectedRunDetail, selectedRunId]
  );

  const resetProjectSettingsDraft = (project = null) => {
    const targets = project
      ? (contextData?.targets || []).filter((target) => String(target.projectId) === String(project.id))
      : [];
    setProjectSettingsDraft(projectToSettingsDraft(project, targets));
  };

  const updateRemoteEndpointDraft = (index, patch) => {
    setProjectSettingsDraft((prev) => ({
      ...prev,
      remoteEndpoints: prev.remoteEndpoints.map((endpoint, endpointIndex) => (
        endpointIndex === index ? { ...endpoint, ...patch } : endpoint
      )),
    }));
  };

  const handleQuickAction = (action) => {
    setSelectedWorkflow(action.workflowType);
    setPrompt(prefillPromptForAction(action));
  };

  const handleOpenProjectManager = () => {
    setShowProjectManager(true);
    setProjectSettingsDraft(createEmptyProjectSettingsDraft());
  };

  const handleLinkWorkspace = async () => {
    setLinkingWorkspace(true);
    setError('');
    try {
      const linked = await linkClientWorkspace();
      const folderName = linked.meta?.displayName || linked.handle?.name || '';
      setProjectSettingsDraft((prev) => ({
        ...prev,
        clientWorkspaceId: linked.workspaceId,
        localProjectPath: folderName || prev.localProjectPath,
        localFullPath: prev.localFullPath || folderName || '',
        name: prev.name || folderName || '',
      }));
    } catch (err) {
      setError(err?.message || 'Failed to link local workspace');
    } finally {
      setLinkingWorkspace(false);
    }
  };

  const handleSelectManagerProject = (projectId) => {
    const project = (contextData?.projects || []).find((item) => item.id === projectId) || null;
    if (!project) return;
    setSelectedProjectId(project.id);
    setProjectSettingsDraft((prev) => (
      prev.id === project.id
        ? createEmptyProjectSettingsDraft()
        : projectToSettingsDraft(
          project,
          (contextData?.targets || []).filter((target) => String(target.projectId) === String(project.id))
        )
    ));
  };

  const handleAddRemoteEndpoint = () => {
    setProjectSettingsDraft((prev) => {
      const existing = prev.remoteEndpoints || [];
      const lastEndpoint = existing[existing.length - 1];
      const newEndpoint = createEmptyRemoteEndpointDraft();
      // Inherit paths from the last endpoint as defaults
      if (lastEndpoint) {
        newEndpoint.remoteProjectPath = lastEndpoint.remoteProjectPath || '';
        newEndpoint.remoteDatasetRoot = lastEndpoint.remoteDatasetRoot || '';
        newEndpoint.remoteCheckpointRoot = lastEndpoint.remoteCheckpointRoot || '';
        newEndpoint.remoteOutputRoot = lastEndpoint.remoteOutputRoot || '';
      }
      return {
        ...prev,
        noRemote: false,
        remoteEndpoints: [...existing, newEndpoint],
      };
    });
  };

  const handleDeleteRemoteEndpoint = (index) => {
    const endpoint = projectSettingsDraft.remoteEndpoints[index];
    const confirmation = window.confirm(
      endpoint?.id
        ? 'Delete this remote server endpoint from the project settings? Remote files will not be changed.'
        : 'Remove this unsaved remote server endpoint from the form?'
    );
    if (!confirmation) return;

    setProjectSettingsDraft((prev) => {
      const remainingEndpoints = prev.remoteEndpoints.filter((_, endpointIndex) => endpointIndex !== index);
      if (remainingEndpoints.length === 0) {
        return {
          ...prev,
          noRemote: true,
          remoteEndpoints: [createEmptyRemoteEndpointDraft()],
        };
      }
      return {
        ...prev,
        remoteEndpoints: remainingEndpoints,
      };
    });
  };

  const handleSaveSettings = async () => {
    const validationError = validateProjectSettingsDraft(projectSettingsDraft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSettingsSaving(true);
    setError('');
    try {
      const payload = settingsDraftToPayload(projectSettingsDraft);
      let project = null;
      if (projectSettingsDraft.id) {
        const response = await axios.patch(`${apiUrl}/aris/projects/${projectSettingsDraft.id}`, payload, {
          headers: getAuthHeaders(),
        });
        project = response.data?.project || null;
      } else {
        const response = await axios.post(`${apiUrl}/aris/projects`, payload, {
          headers: getAuthHeaders(),
        });
        project = response.data?.project || null;
      }
      if (project?.projectFiles?.length) {
        try {
          const linkedWorkspace = await getWorkspaceLink(project.clientWorkspaceId || projectSettingsDraft.clientWorkspaceId);
          if (linkedWorkspace?.handle) {
            await materializeProjectFiles(linkedWorkspace.handle, project.projectFiles);
          }
        } catch {
          // Non-fatal — project saved successfully, local files can be materialized later
        }
      }
      const refreshed = await refreshContext();
      if (project?.id) {
        setSelectedProjectId(project.id);
        const savedProject = (refreshed.projects || []).find((item) => item.id === project.id) || project;
        const savedTargets = (refreshed.targets || []).filter((target) => String(target.projectId) === String(project.id));
        setSelectedTargetId(savedTargets[0]?.id || '');
        setProjectSettingsDraft(projectToSettingsDraft(savedProject, savedTargets));
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to save ARIS project settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectSettingsDraft.id) return;
    const confirmed = window.confirm(
      `Delete project "${projectSettingsDraft.name || projectSettingsDraft.id}" and remove its local files from this machine? Remote servers will not be changed.`
    );
    if (!confirmed) return;

    setDeletingProject(true);
    setError('');
    try {
      await clearWorkspaceContents(projectSettingsDraft.clientWorkspaceId);
      await axios.delete(`${apiUrl}/aris/projects/${projectSettingsDraft.id}`, {
        headers: getAuthHeaders(),
      });
      await removeWorkspaceLink(projectSettingsDraft.clientWorkspaceId);
      const refreshed = await refreshContext();
      setProjectSettingsDraft(createEmptyProjectSettingsDraft());
      setSelectedProjectId(refreshed.defaultSelections?.projectId || refreshed.projects?.[0]?.id || '');
      if (!refreshed.projects?.length) {
        setSelectedTargetId('');
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to delete ARIS project');
    } finally {
      setDeletingProject(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!selectedProjectId) {
      setError('Create or select a project before launching ARIS.');
      return;
    }
    if (!selectedTargetId) {
      setError('Select a saved deployment target before launching ARIS.');
      return;
    }
    if (!trimmedPrompt) {
      setError('Enter what you want ARIS to do.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await axios.post(
        `${apiUrl}/aris/runs`,
        {
          projectId: selectedProjectId,
          targetId: selectedTargetId,
          workflowType: selectedWorkflow,
          prompt: trimmedPrompt,
        },
        { headers: getAuthHeaders() }
      );
      const createdRun = response.data?.run;
      if (createdRun) {
        setRuns((prev) => [createdRun, ...prev.filter((run) => run.id !== createdRun.id)]);
        setSelectedRunId(createdRun.id);
        await fetchRunDetail(createdRun.id, { silent: true });
      } else {
        await fetchRuns();
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to launch ARIS run');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setError('');
    setLoadingRuns(true);
    try {
      await Promise.all([refreshContext(), fetchRuns()]);
      if (selectedRunId) {
        await fetchRunDetail(selectedRunId, { silent: true });
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to refresh ARIS workspace');
    } finally {
      setLoadingRuns(false);
    }
  };

  const handleRunAction = async () => {
    if (!selectedRunId) {
      setError('Select a run before sending a follow-up action.');
      return;
    }
    const trimmedPrompt = actionPrompt.trim();
    if (!trimmedPrompt) {
      setError('Enter a follow-up instruction for the selected run.');
      return;
    }

    setSubmittingAction(true);
    setError('');
    try {
      await axios.post(
        `${apiUrl}/aris/runs/${selectedRunId}/actions`,
        {
          actionType,
          prompt: trimmedPrompt,
        },
        { headers: getAuthHeaders() }
      );
      setActionPrompt('');
      await Promise.all([fetchRuns(), fetchRunDetail(selectedRunId, { silent: true })]);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to create follow-up action');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRetryRun = async () => {
    if (!selectedRunId) return;
    setRetryingRun(true);
    setError('');
    try {
      const response = await axios.post(`${apiUrl}/aris/runs/${selectedRunId}/retry`, {}, {
        headers: getAuthHeaders(),
      });
      const retriedRun = response.data?.run;
      if (retriedRun) {
        setRuns((prev) => [retriedRun, ...prev.filter((run) => run.id !== retriedRun.id)]);
        setSelectedRunId(retriedRun.id);
        await fetchRunDetail(retriedRun.id, { silent: true });
      } else {
        await fetchRuns();
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to retry ARIS run');
    } finally {
      setRetryingRun(false);
    }
  };

  if (loading) {
    return (
      <section className="aris-workspace aris-workspace--loading">
        <div className="aris-empty-card">Loading ARIS workspace…</div>
      </section>
    );
  }

  return (
    <section className="aris-workspace">
      <div className="aris-hero">
        <div className="aris-hero-copy">
          <span className="aris-kicker">Project-Centric ARIS</span>
          <h2>ARIS Researcher</h2>
          <p>
            Create a project once, link the local workspace with the browser directory picker, save
            reusable SSH deployment targets, and then launch ARIS runs with project + target + workflow + prompt.
          </p>
        </div>
        <div className="aris-hero-actions">
          <button className="aris-refresh-btn" onClick={handleRefresh} disabled={loadingRuns}>
            {loadingRuns ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="aris-secondary-btn" onClick={handleOpenProjectManager}>
            Manage Projects
          </button>
        </div>
      </div>

      {error && <div className="error-banner"><span>{error}</span></div>}

      <div className="aris-grid">
        <section className="aris-launch-panel">
          <div className="aris-panel-header">
            <h3>Launch</h3>
            <span className="aris-status-pill">{selectedTarget ? 'Target Ready' : 'Project Setup Needed'}</span>
            {selectedProject?.localFullPath && (
              <button
                className="aris-vscode-btn"
                onClick={() => window.open(`vscode://file${selectedProject.localFullPath}`, '_blank')}
                type="button"
                title={`Open ${selectedProject.localFullPath} in VS Code`}
              >
                Open in VS Code
              </button>
            )}
          </div>

          <div className="aris-launch-fields">
            <label className="aris-field">
              <span>Project</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                <option value="">Select a project</option>
                {(contextData?.projects || []).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>

            <label className="aris-field">
              <span>Deployment Target</span>
              <select value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)} disabled={!selectedProjectId}>
                <option value="">Select a saved target</option>
                {projectTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.sshServerName} · {target.remoteProjectPath}
                  </option>
                ))}
              </select>
            </label>

            <label className="aris-field">
              <span>Workflow</span>
              <select value={selectedWorkflow} onChange={(event) => setSelectedWorkflow(event.target.value)}>
                {quickActions.map((action) => (
                  <option key={action.id} value={action.workflowType}>{action.label}</option>
                ))}
              </select>
            </label>

            <div className="aris-field aris-field--prompt">
              <span>Prompt</span>
              <MentionTextarea
                rows={6}
                value={prompt}
                onChange={setPrompt}
                placeholder="Describe exactly what you want ARIS to do on the selected project target. Type @ to reference project files."
                apiUrl={apiUrl}
                getAuthHeaders={getAuthHeaders}
                sshServerId={selectedTarget?.sshServerId || ''}
                projectPath={selectedTarget?.remoteProjectPath || ''}
              />
            </div>
          </div>

          <div className="aris-quick-actions">
            {quickActions.map((action) => (
              <button
                key={action.id}
                className={`aris-action-chip${selectedWorkflow === action.workflowType ? ' is-active' : ''}`}
                onClick={() => handleQuickAction(action)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="aris-launch-footer">
            <div className="aris-launch-note">
              The selected target stores the SSH server, remote project path, and remote dataset/checkpoint roots.
              Sync uses the project’s linked local workspace and skips unchanged files.
            </div>
            <button className="aris-run-btn" onClick={handleSubmit} disabled={submitting || !selectedProjectId || !selectedTargetId}>
              {submitting ? 'Launching…' : 'Launch Run'}
            </button>
          </div>
        </section>

        <section className="aris-context-panel">
          <div className="aris-panel-header">
            <h3>Launch Context</h3>
          </div>
          <dl className="aris-context-list">
            <div>
              <dt>Project</dt>
              <dd>{workspaceContext.projectLabel}</dd>
            </div>
            <div>
              <dt>Local Workspace</dt>
              <dd>{workspaceContext.localPathLabel}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{workspaceContext.targetLabel}</dd>
            </div>
            <div>
              <dt>Remote Path</dt>
              <dd>{workspaceContext.workspaceLabel}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{workspaceContext.datasetLabel}</dd>
            </div>
            <div>
              <dt>Checkpoints</dt>
              <dd>{workspaceContext.checkpointLabel}</dd>
            </div>
            <div>
              <dt>Outputs</dt>
              <dd>{workspaceContext.outputLabel}</dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd>{workspaceContext.syncLabel}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="aris-runs-detail-grid">
        <section className="aris-runs-panel">
          <div className="aris-panel-header">
            <h3>Recent Runs</h3>
          </div>

          {runCards.length === 0 ? (
            <div className="aris-empty-card">
              No ARIS runs yet. Create a project, add a target, and launch a custom run or preset workflow.
            </div>
          ) : (
            <div className="aris-run-list">
              {runCards.map((run) => (
                <button
                  key={run.id}
                  className={`aris-run-card${selectedRunId === run.id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedRunId(run.id)}
                  type="button"
                >
                  <div className="aris-run-card-header">
                    <div>
                      <h4>{run.workflowLabel || run.title}</h4>
                      <p>{run.statusLabel}</p>
                    </div>
                    <span className="aris-run-score">{run.scoreLabel}</span>
                  </div>
                  <div className="aris-run-meta">
                    <span>{run.runnerLabel}</span>
                    <span>{run.destinationLabel}</span>
                    {run.startedAt && <span>{new Date(run.startedAt).toLocaleString()}</span>}
                  </div>
                  {run.summary && <p className="aris-run-summary">{run.summary}</p>}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="aris-context-panel aris-run-detail-panel">
          <div className="aris-panel-header">
            <h3>Selected Run</h3>
            {selectedRunId && (
              <button className="aris-refresh-btn" onClick={() => fetchRunDetail(selectedRunId)} disabled={loadingDetail}>
                {loadingDetail ? 'Loading…' : 'Refresh Detail'}
              </button>
            )}
          </div>

          {!selectedRunId ? (
            <div className="aris-empty-card">
              Select a run to inspect its workspace, sync summary, log path, and follow-up actions.
            </div>
          ) : (
            <div className="aris-run-detail">
              <div className="aris-run-detail-top">
                <div>
                  <h4>{selectedRunCard.workflowLabel}</h4>
                  <p>{selectedRunCard.statusLabel}</p>
                </div>
                <button className="aris-secondary-btn" onClick={handleRetryRun} disabled={retryingRun}>
                  {retryingRun ? 'Retrying…' : 'Retry Run'}
                </button>
              </div>

              <dl className="aris-context-list">
                <div>
                  <dt>Server</dt>
                  <dd>{selectedRunCard.runnerLabel}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{selectedRunCard.destinationLabel}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{selectedRunCard.workspaceLabel}</dd>
                </div>
                <div>
                  <dt>Dataset</dt>
                  <dd>{selectedRunCard.datasetLabel}</dd>
                </div>
                <div>
                  <dt>Prompt</dt>
                  <dd className="aris-detail-copy">{selectedRunCard.prompt || 'No prompt captured.'}</dd>
                </div>
                <div>
                  <dt>Log Path</dt>
                  <dd className="aris-detail-copy">{selectedRunCard.logPath || 'No log path yet'}</dd>
                </div>
                <div>
                  <dt>Run Directory</dt>
                  <dd className="aris-detail-copy">{selectedRunCard.runDirectory || 'No run directory yet'}</dd>
                </div>
              </dl>

              <div className="aris-follow-up">
                <div className="aris-panel-header">
                  <h3>Further Actions</h3>
                </div>
                <label className="aris-field">
                  <span>Action Type</span>
                  <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
                    {FOLLOW_UP_ACTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="aris-field aris-field--prompt">
                  <span>Next Instruction</span>
                  <textarea
                    rows={4}
                    value={actionPrompt}
                    onChange={(event) => setActionPrompt(event.target.value)}
                    placeholder="Tell ARIS what to do next on this run."
                  />
                </label>

                <div className="aris-launch-footer aris-launch-footer--detail">
                  <div className="aris-launch-note">
                    Follow-up actions stay attached to the selected run and reuse its saved project target context.
                  </div>
                  <button className="aris-run-btn" onClick={handleRunAction} disabled={submittingAction}>
                    {submittingAction ? 'Sending…' : 'Send Action'}
                  </button>
                </div>
              </div>

              <div className="aris-action-history">
                <div className="aris-panel-header">
                  <h3>Action History</h3>
                </div>
                {selectedRunCard.actionRows.length === 0 ? (
                  <div className="aris-empty-card">
                    No follow-up actions yet. Use the form above to continue this run.
                  </div>
                ) : (
                  <div className="aris-action-list">
                    {selectedRunCard.actionRows.map((action) => (
                      <article key={action.id} className="aris-action-row">
                        <div className="aris-action-row-top">
                          <strong>{action.actionLabel}</strong>
                          <span>{action.statusLabel}</span>
                        </div>
                        <p>{action.prompt}</p>
                        <div className="aris-run-meta">
                          <span>{action.targetLabel}</span>
                          {action.createdAt && <span>{new Date(action.createdAt).toLocaleString()}</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="aris-run-outputs">
                <div className="aris-panel-header">
                  <h3>Run Outputs</h3>
                  <button
                    className="aris-secondary-btn"
                    onClick={() => fetchRunOutputs(selectedRunDetail)}
                    disabled={loadingOutputs}
                  >
                    {loadingOutputs ? 'Loading…' : runOutputs ? 'Refresh' : 'Browse Files'}
                  </button>
                </div>
                {runOutputs === null ? (
                  <div className="aris-empty-card">
                    Click &ldquo;Browse Files&rdquo; to list files in the run directory.
                  </div>
                ) : runOutputs.length === 0 ? (
                  <div className="aris-empty-card">No output files found in run directory.</div>
                ) : (
                  <div className="aris-output-list">
                    {runOutputs.map((entry) => (
                      <div key={entry.name} className={`aris-output-entry${entry.type === 'dir' ? ' is-dir' : ''}`}>
                        <span className="aris-output-icon">{entry.type === 'dir' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                        <span className="aris-output-name">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {showProjectManager && (
        <div className="aris-modal-backdrop" onClick={() => setShowProjectManager(false)}>
          <div className="aris-project-manager" onClick={(event) => event.stopPropagation()}>
            <div className="aris-panel-header">
              <h3>Manage Projects</h3>
              <button className="aris-refresh-btn" onClick={() => setShowProjectManager(false)}>Close</button>
            </div>

            <div className="aris-project-manager-grid">
              <section className="aris-manager-column">
                <div className="aris-manager-section-head">
                  <strong>Projects</strong>
                  <button
                    className="aris-secondary-btn"
                    onClick={() => setProjectSettingsDraft(createEmptyProjectSettingsDraft())}
                    type="button"
                  >
                    New Project
                  </button>
                </div>
                <div className="aris-manager-list">
                  {projectRows.length === 0 ? (
                    <div className="aris-empty-card">No projects yet. Use the settings panel to link a folder and save one.</div>
                  ) : (
                    projectRows.map((row) => (
                      <div
                        key={row.id}
                        className={`aris-manager-card${projectSettingsDraft.id === row.id ? ' is-selected' : ''}`}
                        onClick={() => handleSelectManagerProject(row.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => { if (event.key === 'Enter') handleSelectManagerProject(row.id); }}
                      >
                        <div className="aris-manager-card-top">
                          <strong>{row.title}</strong>
                          {row.localFullPath && (
                            <button
                              className="aris-vscode-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                window.open(`vscode://file${row.localFullPath}`, '_blank');
                              }}
                              type="button"
                              title={`Open ${row.localFullPath} in VS Code`}
                            >
                              Open in VS Code
                            </button>
                          )}
                        </div>
                        <span>{row.localPathLabel}</span>
                        <span>{row.targetCountLabel}</span>
                        <span>{row.remoteModeLabel}</span>
                        <span>{row.excludeSummary}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="aris-manager-column">
                <div className="aris-manager-form">
                  <div className="aris-manager-editor-head">
                    <div>
                      <strong>{projectSettingsDraft.id ? 'Project Settings' : 'Create Project'}</strong>
                      <p>Click a project on the left to edit it, or fill this form to create a new one.</p>
                    </div>
                    <button
                      className="aris-close-icon-btn"
                      onClick={handleDeleteProject}
                      disabled={!projectSettingsDraft.id || deletingProject}
                      type="button"
                      aria-label="Delete project"
                      title="Delete project"
                    >
                      ×
                    </button>
                  </div>

                  <label className="aris-field">
                    <span>Project Name</span>
                    <input
                      type="text"
                      value={projectSettingsDraft.name}
                      onChange={(event) => setProjectSettingsDraft((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Paper Agent"
                    />
                  </label>

                  <div className="aris-field">
                    <span>Local Workspace</span>
                    <div className="aris-linked-workspace">
                      <div className="aris-linked-workspace-info">
                        <strong>{projectSettingsDraft.localProjectPath || 'No local folder linked yet'}</strong>
                        <p>{projectSettingsDraft.clientWorkspaceId || 'Use Chrome/Edge and link a writable project directory.'}</p>
                        <input
                          type="text"
                          className="aris-local-path-input"
                          value={projectSettingsDraft.localFullPath}
                          onChange={(event) => setProjectSettingsDraft((prev) => ({ ...prev, localFullPath: event.target.value }))}
                          placeholder="Full path, e.g. /Users/you/AutoRDL"
                        />
                      </div>
                      <button className="aris-secondary-btn" onClick={handleLinkWorkspace} disabled={linkingWorkspace} type="button">
                        {linkingWorkspace ? 'Linking…' : (projectSettingsDraft.clientWorkspaceId ? 'Relink Folder' : 'Link Folder')}
                      </button>
                    </div>
                  </div>

                  <label className="aris-field aris-field--prompt">
                    <span>Sync Excludes</span>
                    <textarea
                      rows={5}
                      value={projectSettingsDraft.syncExcludesText}
                      onChange={(event) => setProjectSettingsDraft((prev) => ({ ...prev, syncExcludesText: event.target.value }))}
                      placeholder={'local/\noutputs/\ncheckpoints/'}
                    />
                  </label>

                  <div className="aris-manager-editor-head">
                    <div>
                      <strong>Remote Servers</strong>
                      <p>Set this project to local-only or attach one or more saved remote endpoints.</p>
                    </div>
                  </div>

                  <label className="aris-manager-toggle" htmlFor="aris-no-remote-toggle">
                    <input
                      id="aris-no-remote-toggle"
                      type="checkbox"
                      checked={projectSettingsDraft.noRemote}
                      onChange={(event) => setProjectSettingsDraft((prev) => ({
                        ...prev,
                        noRemote: event.target.checked,
                        remoteEndpoints: prev.remoteEndpoints.length > 0
                          ? prev.remoteEndpoints
                          : [createEmptyRemoteEndpointDraft()],
                      }))}
                    />
                    <span>No Remote</span>
                  </label>

                  <div className={`aris-endpoint-stack${projectSettingsDraft.noRemote ? ' is-disabled' : ''}`}>
                    {projectSettingsDraft.noRemote ? (
                      <div className="aris-empty-card">Remote fields are disabled while No Remote is enabled.</div>
                    ) : (
                      projectSettingsDraft.remoteEndpoints.map((endpoint, index) => (
                        <article key={endpoint.id || `endpoint-${index}`} className="aris-endpoint-card">
                          <div className="aris-endpoint-card-head">
                            <div>
                              <strong>Remote Server {index + 1}</strong>
                              <p>{endpoint.id ? 'Saved endpoint' : 'New endpoint'}</p>
                            </div>
                            <button
                              className="aris-close-icon-btn"
                              onClick={() => handleDeleteRemoteEndpoint(index)}
                              type="button"
                              aria-label={`Delete remote server ${index + 1}`}
                              title="Delete remote server"
                            >
                              ×
                            </button>
                          </div>

                          <label className="aris-field">
                            <span>SSH Server</span>
                            <select
                              value={endpoint.sshServerId}
                              onChange={(event) => updateRemoteEndpointDraft(index, { sshServerId: event.target.value })}
                            >
                              <option value="">Select a server</option>
                              {(contextData?.availableSshServers || []).map((server) => (
                                <option key={server.id} value={server.id}>{server.name}</option>
                              ))}
                            </select>
                          </label>

                          <div className="aris-field">
                            <span>Remote Project Path</span>
                            <PathAutocompleteInput
                              value={endpoint.remoteProjectPath}
                              onChange={(val) => updateRemoteEndpointDraft(index, { remoteProjectPath: val })}
                              placeholder="/srv/aris/project-name"
                              apiUrl={apiUrl}
                              getAuthHeaders={getAuthHeaders}
                              sshServerId={endpoint.sshServerId}
                            />
                          </div>

                          <div className="aris-field">
                            <span>Remote Dataset Root</span>
                            <PathAutocompleteInput
                              value={endpoint.remoteDatasetRoot}
                              onChange={(val) => updateRemoteEndpointDraft(index, { remoteDatasetRoot: val })}
                              placeholder="/mnt/data/project-name"
                              apiUrl={apiUrl}
                              getAuthHeaders={getAuthHeaders}
                              sshServerId={endpoint.sshServerId}
                            />
                          </div>

                          <div className="aris-field">
                            <span>Remote Checkpoint Root</span>
                            <PathAutocompleteInput
                              value={endpoint.remoteCheckpointRoot}
                              onChange={(val) => updateRemoteEndpointDraft(index, { remoteCheckpointRoot: val })}
                              placeholder="/mnt/checkpoints/project-name"
                              apiUrl={apiUrl}
                              getAuthHeaders={getAuthHeaders}
                              sshServerId={endpoint.sshServerId}
                            />
                          </div>

                          <div className="aris-field">
                            <span>Remote Output Root</span>
                            <PathAutocompleteInput
                              value={endpoint.remoteOutputRoot}
                              onChange={(val) => updateRemoteEndpointDraft(index, { remoteOutputRoot: val })}
                              placeholder="/mnt/outputs/project-name"
                              apiUrl={apiUrl}
                              getAuthHeaders={getAuthHeaders}
                              sshServerId={endpoint.sshServerId}
                            />
                          </div>
                        </article>
                      ))
                    )}
                  </div>

                  <div className="aris-manager-actions">
                    <button
                      className="aris-secondary-btn"
                      onClick={handleAddRemoteEndpoint}
                      disabled={projectSettingsDraft.noRemote}
                      type="button"
                    >
                      Add Server Endpoint
                    </button>
                    <button className="aris-run-btn" onClick={handleSaveSettings} disabled={settingsSaving || deletingProject} type="button">
                      {settingsSaving ? 'Saving…' : 'Save Settings'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
