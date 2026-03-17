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

const PLAN_STATUS_ICONS = {
  completed: '\u2705',
  running: '\u23F3',
  failed: '\u274C',
  needs_redo: '\uD83D\uDD04',
  skipped: '\u23ED\uFE0F',
  pending: '\u25CB',
};

const PLAN_STATUS_LABELS = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  needs_redo: 'Needs Redo',
  skipped: 'Skipped',
  pending: 'Pending',
};

function PlanNodeRow({ node, depth, selectedNodeKey, onSelectNode }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isStep = node.nodeKey.startsWith('Step-');
  const icon = PLAN_STATUS_ICONS[node.status] || PLAN_STATUS_ICONS.pending;
  const parallel = node.canParallel && !isStep;
  const isSelected = selectedNodeKey === node.nodeKey;
  const isLeaf = !hasChildren;

  const handleClick = () => {
    if (isLeaf) {
      onSelectNode(node);
    } else {
      setExpanded((prev) => !prev);
    }
  };

  return (
    <div className="aris-plan-node-group">
      <div
        className={`aris-plan-node aris-plan-node--${node.status}${isStep ? ' is-step' : ''}${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
      >
        {hasChildren && (
          <span className="aris-plan-chevron">{expanded ? '\u25BE' : '\u25B8'}</span>
        )}
        <span className="aris-plan-icon">{icon}</span>
        <span className="aris-plan-key">{node.nodeKey}</span>
        <span className="aris-plan-title">{node.title}</span>
        {parallel && <span className="aris-plan-parallel-badge">parallel</span>}
        {node.dependsOn?.length > 0 && !isStep && (
          <span className="aris-plan-deps" title={`Depends on: ${node.dependsOn.join(', ')}`}>
            {'\u2190'} {node.dependsOn.length}
          </span>
        )}
      </div>
      {expanded && hasChildren && node.children.map((child) => (
        <PlanNodeRow
          key={child.nodeKey}
          node={child}
          depth={depth + 1}
          selectedNodeKey={selectedNodeKey}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
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

  // Loop config (for auto_review_loop and similar skill-based workflows)
  const [maxIterations, setMaxIterations] = useState(4);
  const [reviewerModel, setReviewerModel] = useState('gpt-4o');

  const [actionType, setActionType] = useState('continue');
  const [actionPrompt, setActionPrompt] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [retryingRun, setRetryingRun] = useState(false);
  const [runOutputs, setRunOutputs] = useState(null);
  const [loadingOutputs, setLoadingOutputs] = useState(false);
  const [outputBrowsePath, setOutputBrowsePath] = useState(''); // current browsed dir path
  const [outputBreadcrumbs, setOutputBreadcrumbs] = useState([]); // [{label, path}]

  // File previewer state
  const [previewFile, setPreviewFile] = useState(null); // {filePath, content, size, mimeType, isBinary, isTruncated}
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // GPU Status panel state
  const [gpuStatus, setGpuStatus] = useState(null); // {projectId, projectName, servers: [...]}
  const [loadingGpu, setLoadingGpu] = useState(false);
  const [showGpuPanel, setShowGpuPanel] = useState(false);

  // Import Papers modal state
  // Plan DAG state
  const [planTree, setPlanTree] = useState(null); // {roots: [...], stats: {...}}
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [selectedPlanNode, setSelectedPlanNode] = useState(null);
  const [rejectingNode, setRejectingNode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [showImportPapers, setShowImportPapers] = useState(false);
  const [importTag, setImportTag] = useState('');
  const [importSourceType, setImportSourceType] = useState('pdf');
  const [importIncludeCode, setImportIncludeCode] = useState(true);
  const [importingPapers, setImportingPapers] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [availableTags, setAvailableTags] = useState([]);

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

  const fetchPlanTree = async (runId) => {
    if (!runId) { setPlanTree(null); return; }
    setLoadingPlan(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/runs/${runId}/plan`, {
        headers: getAuthHeaders(),
      });
      const plan = response.data?.plan || null;
      setPlanTree(plan && plan.roots?.length > 0 ? plan : null);
    } catch {
      setPlanTree(null);
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleRejectNode = async () => {
    if (!selectedRunId || !selectedPlanNode) return;
    setRejectingNode(true);
    try {
      const response = await axios.post(
        `${apiUrl}/aris/runs/${selectedRunId}/plan/${selectedPlanNode.nodeKey}/reject`,
        { reason: rejectReason },
        { headers: getAuthHeaders() }
      );
      const updatedPlan = response.data?.plan || null;
      if (updatedPlan) setPlanTree(updatedPlan);
      setSelectedPlanNode(null);
      setRejectReason('');
    } catch (err) {
      console.error('Failed to reject node:', err);
    } finally {
      setRejectingNode(false);
    }
  };

  const handleApprovePlanNode = async () => {
    if (!selectedRunId || !selectedPlanNode) return;
    try {
      await axios.patch(
        `${apiUrl}/aris/runs/${selectedRunId}/plan/${selectedPlanNode.nodeKey}`,
        { status: 'completed' },
        { headers: getAuthHeaders() }
      );
      await fetchPlanTree(selectedRunId);
      setSelectedPlanNode(null);
    } catch (err) {
      console.error('Failed to approve node:', err);
    }
  };

  const fetchRunDetail = async (runId, { silent = false } = {}) => {
    if (!runId) {
      setSelectedRunDetail(null);
      setPlanTree(null);
      setSelectedPlanNode(null);
      return null;
    }
    if (!silent) setLoadingDetail(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/runs/${runId}`, {
        headers: getAuthHeaders(),
      });
      const detail = response.data?.run || null;
      setSelectedRunDetail(detail);
      // Also fetch plan tree for this run
      fetchPlanTree(runId);
      return detail;
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  };

  const fetchRunOutputs = async (run, browsePath = '') => {
    if (!run?.runDirectory || !run?.runnerServerId) {
      setRunOutputs(null);
      return;
    }
    setLoadingOutputs(true);
    try {
      const basePath = browsePath || run.runDirectory;
      const response = await axios.post(`${apiUrl}/ssh-servers/${run.runnerServerId}/ls`, {
        path: basePath + '/',
      }, { headers: getAuthHeaders() });
      const entries = response.data?.entries || [];

      // If first load (no browsePath set yet) and no entries, try outputs/ subdir
      if (!browsePath && entries.length === 0) {
        const outputsResponse = await axios.post(`${apiUrl}/ssh-servers/${run.runnerServerId}/ls`, {
          path: run.runDirectory + '/outputs/',
        }, { headers: getAuthHeaders() });
        const outputEntries = outputsResponse.data?.entries || [];
        if (outputEntries.length > 0) {
          setRunOutputs(outputEntries);
          setOutputBrowsePath(run.runDirectory + '/outputs');
          setOutputBreadcrumbs([
            { label: 'run', path: run.runDirectory },
            { label: 'outputs', path: run.runDirectory + '/outputs' },
          ]);
          return;
        }
      }

      setRunOutputs(entries);
      setOutputBrowsePath(basePath);

      // Build breadcrumbs from runDirectory to current path
      if (!browsePath || basePath === run.runDirectory) {
        setOutputBreadcrumbs([{ label: 'run', path: run.runDirectory }]);
      }
    } catch {
      setRunOutputs(null);
    } finally {
      setLoadingOutputs(false);
    }
  };

  const handleOutputEntryClick = async (entry) => {
    if (!selectedRunDetail?.runnerServerId) return;

    const currentPath = outputBrowsePath || selectedRunDetail.runDirectory;
    const fullPath = `${currentPath}/${entry.name}`;

    if (entry.type === 'dir') {
      // Navigate into directory
      setOutputBreadcrumbs((prev) => [...prev, { label: entry.name, path: fullPath }]);
      await fetchRunOutputs(selectedRunDetail, fullPath);
    } else {
      // Open file preview
      setLoadingPreview(true);
      setPreviewError('');
      setPreviewFile(null);
      try {
        const response = await axios.post(
          `${apiUrl}/ssh-servers/${selectedRunDetail.runnerServerId}/read-file`,
          { path: fullPath, maxBytes: 512 * 1024 },
          { headers: getAuthHeaders() }
        );
        setPreviewFile(response.data);
      } catch (err) {
        setPreviewError(err?.response?.data?.error || err.message || 'Failed to read file');
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const handleBreadcrumbClick = async (crumb, index) => {
    setOutputBreadcrumbs((prev) => prev.slice(0, index + 1));
    await fetchRunOutputs(selectedRunDetail, crumb.path);
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewError('');
  };

  const handleOpenImportPapers = async () => {
    setShowImportPapers(true);
    setImportResult(null);
    setImportTag('');
    try {
      const response = await axios.get(`${apiUrl}/tags`, { headers: getAuthHeaders() });
      setAvailableTags(response.data?.tags || []);
    } catch {
      setAvailableTags([]);
    }
  };

  const handleImportPapers = async () => {
    if (!importTag || !selectedProjectId) return;
    setImportingPapers(true);
    setImportResult(null);
    setError('');
    try {
      const response = await axios.post(
        `${apiUrl}/aris/projects/${selectedProjectId}/import-papers`,
        { tag: importTag, sourceType: importSourceType, includeCode: importIncludeCode },
        { headers: getAuthHeaders(), timeout: 600000 }
      );
      setImportResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to import papers');
    } finally {
      setImportingPapers(false);
    }
  };

  const handleFetchGpuStatus = async () => {
    if (!selectedProjectId) return;
    setLoadingGpu(true);
    setShowGpuPanel(true);
    setGpuStatus(null);
    setError('');
    try {
      const response = await axios.get(
        `${apiUrl}/aris/projects/${selectedProjectId}/gpu-status`,
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      setGpuStatus(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to fetch GPU status');
    } finally {
      setLoadingGpu(false);
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

  // Auto-poll runs list when any run is active (running/queued)
  const hasActiveRuns = useMemo(() => runs.some((r) => r.status === 'running' || r.status === 'queued'), [runs]);
  useEffect(() => {
    if (!hasActiveRuns) return undefined;
    const interval = setInterval(() => {
      fetchRuns().catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [hasActiveRuns, apiUrl, getAuthHeaders]);

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
    }, 8000);

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
        localFullPath: prev.localFullPath.startsWith('/') ? prev.localFullPath : '',
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
      const runPayload = {
        projectId: selectedProjectId,
        targetId: selectedTargetId,
        workflowType: selectedWorkflow,
        prompt: trimmedPrompt,
      };
      // Attach loop config for skill-based workflows
      if (selectedWorkflow === 'auto_review_loop' || selectedWorkflow === 'full_pipeline') {
        runPayload.maxIterations = maxIterations;
        runPayload.reviewerModel = reviewerModel;
      }
      const response = await axios.post(
        `${apiUrl}/aris/runs`,
        runPayload,
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
            <div className="aris-panel-header-actions">
              <button
                className="aris-gpu-status-btn"
                onClick={handleFetchGpuStatus}
                type="button"
                disabled={!selectedProjectId || loadingGpu}
                title="Check GPU availability across all project servers"
              >
                {loadingGpu ? 'Checking GPUs…' : 'GPU Status'}
              </button>
              <button
                className="aris-import-papers-btn"
                onClick={handleOpenImportPapers}
                type="button"
                disabled={!selectedProjectId}
                title="Import papers from library by tag into project resource/ folder"
              >
                Import Papers
              </button>
              <span className="aris-status-pill">{selectedTarget ? 'Target Ready' : 'Project Setup Needed'}</span>
              {selectedProject && (selectedProject.clientWorkspaceId || selectedProject.localProjectPath) && (() => {
                const rawPath = selectedProject.localFullPath || selectedProject.localProjectPath || '';
                const vscodePath = rawPath.startsWith('/') ? rawPath : '';
                return (
                  <>
                    <button
                      className={`aris-vscode-btn${vscodePath ? '' : ' is-disabled'}`}
                      onClick={async () => {
                        if (!vscodePath) return;
                        // Fetch and download CLAUDE.md before opening VSCode
                        try {
                          const resp = await axios.get(`${apiUrl}/aris/projects/${selectedProject.id}/claude-md`, { headers: getAuthHeaders() });
                          if (resp.data?.content) {
                            const blob = new Blob([resp.data.content], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'CLAUDE.md';
                            a.click();
                            URL.revokeObjectURL(url);
                          }
                        } catch (err) {
                          console.warn('[ARIS] Failed to fetch CLAUDE.md:', err);
                        }
                        // Open VSCode after a small delay to let download start
                        setTimeout(() => window.open(`vscode://file${vscodePath}`, '_blank'), 300);
                      }}
                      type="button"
                      title={vscodePath ? `Download CLAUDE.md & open ${vscodePath} in VS Code` : 'Set the full local path in project settings first'}
                      disabled={!vscodePath}
                    >
                      Open in VS Code
                    </button>
                    {vscodePath && (
                      <button
                        className="aris-vscode-btn aris-sync-claude-md-btn"
                        onClick={async () => {
                          try {
                            const resp = await axios.get(`${apiUrl}/aris/projects/${selectedProject.id}/claude-md`, { headers: getAuthHeaders() });
                            if (resp.data?.content) {
                              const blob = new Blob([resp.data.content], { type: 'text/markdown' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = 'CLAUDE.md';
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          } catch (err) {
                            console.warn('[ARIS] Failed to fetch CLAUDE.md:', err);
                          }
                        }}
                        type="button"
                        title="Download CLAUDE.md for this project"
                      >
                        ↓ CLAUDE.md
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
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

            {(selectedWorkflow === 'auto_review_loop' || selectedWorkflow === 'full_pipeline') && (
              <div className="aris-loop-config" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label className="aris-field" style={{ flex: '0 0 auto' }}>
                  <span>Max Iterations</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxIterations}
                    onChange={(event) => setMaxIterations(Number(event.target.value) || 4)}
                    style={{ width: '80px' }}
                  />
                </label>
                <label className="aris-field" style={{ flex: '1 1 180px' }}>
                  <span>Reviewer Model</span>
                  <select value={reviewerModel} onChange={(event) => setReviewerModel(event.target.value)}>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4.1">GPT-4.1</option>
                    <option value="o3">o3</option>
                    <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                    <option value="deepseek-chat">DeepSeek Chat</option>
                  </select>
                </label>
              </div>
            )}

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

      {showGpuPanel && (
        <section className="aris-gpu-panel">
          <div className="aris-panel-header">
            <h3>GPU Availability{gpuStatus?.projectName ? ` — ${gpuStatus.projectName}` : ''}</h3>
            <div className="aris-panel-header-actions">
              <button className="aris-gpu-refresh-btn" onClick={handleFetchGpuStatus} disabled={loadingGpu || !selectedProjectId} type="button">
                {loadingGpu ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="aris-gpu-close-btn" onClick={() => setShowGpuPanel(false)} type="button">Close</button>
            </div>
          </div>
          {loadingGpu && <div className="aris-gpu-loading">Querying servers via SSH…</div>}
          {!loadingGpu && gpuStatus && gpuStatus.servers.length === 0 && (
            <div className="aris-empty-card">No remote targets configured for this project.</div>
          )}
          {!loadingGpu && gpuStatus && gpuStatus.servers.length > 0 && (
            <div className="aris-gpu-results">
              {gpuStatus.servers.map((srv) => (
                <div key={srv.serverId} className="aris-gpu-server-block">
                  <h4>
                    <span className={`aris-status-dot aris-status-dot--${srv.status === 'ok' ? 'green' : srv.status === 'no_gpu' ? 'yellow' : 'red'}`} />
                    {srv.serverName}
                    {srv.status === 'unreachable' && <span className="aris-gpu-tag aris-gpu-tag--error">unreachable</span>}
                    {srv.status === 'no_gpu' && <span className="aris-gpu-tag aris-gpu-tag--warn">no GPU</span>}
                  </h4>
                  {srv.error && <div className="aris-gpu-error">{srv.error}</div>}
                  {srv.gpus.length > 0 && (
                    <table className="aris-gpu-table">
                      <thead>
                        <tr>
                          <th>GPU</th>
                          <th>Model</th>
                          <th>VRAM Used</th>
                          <th>VRAM Total</th>
                          <th>Util %</th>
                          <th>Temp</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {srv.gpus.map((gpu) => (
                          <tr key={gpu.index} className={`aris-gpu-row--${gpu.availability}`}>
                            <td>{gpu.index}</td>
                            <td>{gpu.name}</td>
                            <td>{gpu.memoryUsed}</td>
                            <td>{gpu.memoryTotal}</td>
                            <td>{gpu.utilization}</td>
                            <td>{gpu.temperature}</td>
                            <td>
                              <span className={`aris-gpu-badge aris-gpu-badge--${gpu.availability}`}>
                                {gpu.availability === 'free' ? 'Free' : gpu.availability === 'partial' ? 'Partial' : 'Busy'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
              <div className="aris-gpu-summary">
                {(() => {
                  const totals = gpuStatus.servers.reduce((acc, srv) => {
                    acc.free += srv.gpus.filter((g) => g.availability === 'free').length;
                    acc.partial += srv.gpus.filter((g) => g.availability === 'partial').length;
                    acc.busy += srv.gpus.filter((g) => g.availability === 'busy').length;
                    return acc;
                  }, { free: 0, partial: 0, busy: 0 });
                  return (
                    <span>
                      <strong>{totals.free}</strong> free, <strong>{totals.partial}</strong> partial, <strong>{totals.busy}</strong> busy
                      — <strong>{totals.free + totals.partial + totals.busy}</strong> GPUs total
                    </span>
                  );
                })()}
              </div>
            </div>
          )}
        </section>
      )}

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
                    <div className="aris-run-card-title-row">
                      <span className={`aris-status-dot aris-status-dot--${run.statusColor}`} />
                      <h4>{run.workflowLabel || run.title}</h4>
                      {run.isCliRun && <span className="aris-source-badge aris-source-badge--cli">CLI</span>}
                    </div>
                    <div className="aris-run-card-status">
                      <span className={`aris-status-badge aris-status-badge--${run.statusColor}`}>
                        {run.statusLabel}
                      </span>
                      {run.scoreLabel && <span className="aris-run-score">{run.scoreLabel}</span>}
                    </div>
                  </div>
                  {run.resultSummary && (
                    <div className="aris-run-result-preview">
                      {run.resultSummary.length > 120
                        ? run.resultSummary.slice(-120).replace(/^[^\n]*\n/, '') + '…'
                        : run.resultSummary}
                    </div>
                  )}
                  <div className="aris-run-meta">
                    {run.destinationLabel && <span>{run.destinationLabel}</span>}
                    {run.startedAt && <span>{new Date(run.startedAt).toLocaleString()}</span>}
                    {run.elapsedLabel && <span className="aris-elapsed">{run.elapsedLabel}</span>}
                  </div>
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
                  <div className="aris-run-card-title-row">
                    <span className={`aris-status-dot aris-status-dot--${selectedRunCard.statusColor}`} />
                    <h4>{selectedRunCard.workflowLabel}</h4>
                  </div>
                  <div className="aris-detail-status-row">
                    <span className={`aris-status-badge aris-status-badge--${selectedRunCard.statusColor}`}>
                      {selectedRunCard.statusLabel}
                    </span>
                    {selectedRunCard.isActive && selectedRunCard.elapsedLabel && (
                      <span className="aris-elapsed">{selectedRunCard.elapsedLabel}</span>
                    )}
                    {!selectedRunCard.isActive && selectedRunCard.startedAt && (
                      <span className="aris-elapsed">
                        {new Date(selectedRunCard.startedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
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
                  <dt>Prompt</dt>
                  <dd className="aris-detail-copy">{selectedRunCard.prompt || 'No prompt captured.'}</dd>
                </div>
                <div>
                  <dt>Log Path</dt>
                  <dd className="aris-detail-copy">
                    {selectedRunCard.logPath ? (
                      <button
                        className="aris-inline-preview-btn"
                        type="button"
                        onClick={async () => {
                          setLoadingPreview(true);
                          setPreviewError('');
                          setPreviewFile(null);
                          try {
                            const response = await axios.post(
                              `${apiUrl}/ssh-servers/${selectedRunDetail.runnerServerId}/read-file`,
                              { path: selectedRunCard.logPath, maxBytes: 512 * 1024 },
                              { headers: getAuthHeaders() }
                            );
                            setPreviewFile(response.data);
                          } catch (err) {
                            setPreviewError(err?.response?.data?.error || err.message || 'Failed to read log');
                          } finally {
                            setLoadingPreview(false);
                          }
                        }}
                      >
                        {selectedRunCard.logPath}
                      </button>
                    ) : 'No log path yet'}
                  </dd>
                </div>
                <div>
                  <dt>Run Directory</dt>
                  <dd className="aris-detail-copy">{selectedRunCard.runDirectory || 'No run directory yet'}</dd>
                </div>
                {selectedRunDetail?.maxIterations && (
                  <div>
                    <dt>Loop Config</dt>
                    <dd>Max {selectedRunDetail.maxIterations} iterations, reviewer: {selectedRunDetail.reviewerModel || 'gpt-4o'}</dd>
                  </div>
                )}
                {selectedRunCard.isCliRun && (
                  <div>
                    <dt>Source</dt>
                    <dd><span className="aris-source-badge aris-source-badge--cli">CLI</span> Registered from Claude Code</dd>
                  </div>
                )}
              </dl>

              {selectedRunCard.resultSummary && (
                <div className="aris-result-summary">
                  <div className="aris-panel-header">
                    <h3>Result Output</h3>
                  </div>
                  <pre className="aris-result-summary-content">{selectedRunCard.resultSummary}</pre>
                </div>
              )}

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
                          <span className={`aris-status-badge aris-status-badge--${action.statusColor}`}>
                            {action.isActive && <span className={`aris-status-dot aris-status-dot--${action.statusColor}`} />}
                            {action.statusLabel}
                          </span>
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
                    onClick={() => {
                      setOutputBrowsePath('');
                      setOutputBreadcrumbs([]);
                      fetchRunOutputs(selectedRunDetail);
                    }}
                    disabled={loadingOutputs}
                  >
                    {loadingOutputs ? 'Loading…' : runOutputs ? 'Refresh' : 'Browse Files'}
                  </button>
                </div>

                {outputBreadcrumbs.length > 1 && (
                  <div className="aris-output-breadcrumbs">
                    {outputBreadcrumbs.map((crumb, index) => (
                      <span key={crumb.path}>
                        {index > 0 && <span className="aris-breadcrumb-sep">/</span>}
                        <button
                          className={`aris-breadcrumb-btn${index === outputBreadcrumbs.length - 1 ? ' is-current' : ''}`}
                          onClick={() => handleBreadcrumbClick(crumb, index)}
                          disabled={index === outputBreadcrumbs.length - 1}
                          type="button"
                        >
                          {crumb.label}
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {runOutputs === null ? (
                  <div className="aris-empty-card">
                    Click &ldquo;Browse Files&rdquo; to list files in the run directory.
                  </div>
                ) : runOutputs.length === 0 ? (
                  <div className="aris-empty-card">No output files found in this directory.</div>
                ) : (
                  <div className="aris-output-list">
                    {runOutputs.map((entry) => (
                      <div
                        key={entry.name}
                        className={`aris-output-entry${entry.type === 'dir' ? ' is-dir' : ''} is-clickable`}
                        onClick={() => handleOutputEntryClick(entry)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => { if (event.key === 'Enter') handleOutputEntryClick(entry); }}
                      >
                        <span className="aris-output-icon">{entry.type === 'dir' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                        <span className="aris-output-name">{entry.name}</span>
                        {entry.type !== 'dir' && <span className="aris-output-preview-hint">Preview</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {planTree && (
                <div className="aris-plan-tree">
                  <div className="aris-panel-header">
                    <h3>Execution Plan</h3>
                    <div className="aris-plan-stats">
                      <span className="aris-plan-stat aris-plan-stat--done">{planTree.stats.completed} done</span>
                      <span className="aris-plan-stat aris-plan-stat--running">{planTree.stats.running} running</span>
                      <span className="aris-plan-stat aris-plan-stat--pending">{planTree.stats.pending} pending</span>
                      {planTree.stats.failed > 0 && (
                        <span className="aris-plan-stat aris-plan-stat--failed">{planTree.stats.failed} failed</span>
                      )}
                    </div>
                  </div>
                  <div className="aris-plan-progress-bar">
                    <div
                      className="aris-plan-progress-fill"
                      style={{ width: `${planTree.stats.total > 0 ? (planTree.stats.completed / planTree.stats.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="aris-plan-layout">
                    <div className="aris-plan-nodes">
                      {planTree.roots.map((root) => (
                        <PlanNodeRow
                          key={root.nodeKey}
                          node={root}
                          depth={0}
                          selectedNodeKey={selectedPlanNode?.nodeKey}
                          onSelectNode={setSelectedPlanNode}
                        />
                      ))}
                    </div>

                    {selectedPlanNode && (
                      <div className="aris-plan-detail">
                        <div className="aris-plan-detail-header">
                          <div>
                            <span className="aris-plan-icon">{PLAN_STATUS_ICONS[selectedPlanNode.status] || '\u25CB'}</span>
                            <strong>{selectedPlanNode.nodeKey}</strong>
                            <span className={`aris-status-badge aris-status-badge--${selectedPlanNode.status === 'needs_redo' ? 'failed' : selectedPlanNode.status}`}>
                              {PLAN_STATUS_LABELS[selectedPlanNode.status] || selectedPlanNode.status}
                            </span>
                          </div>
                          <button className="aris-refresh-btn" onClick={() => setSelectedPlanNode(null)} type="button">Close</button>
                        </div>

                        <h4 className="aris-plan-detail-title">{selectedPlanNode.title}</h4>

                        {selectedPlanNode.dependsOn?.length > 0 && (
                          <div className="aris-plan-detail-deps">
                            Depends on: {selectedPlanNode.dependsOn.map((dep) => (
                              <span key={dep} className="aris-plan-dep-chip">{dep}</span>
                            ))}
                          </div>
                        )}

                        {selectedPlanNode.description && (
                          <div className="aris-plan-detail-section">
                            <h5>Plan Description</h5>
                            <pre className="aris-plan-detail-description">{selectedPlanNode.description}</pre>
                          </div>
                        )}

                        {selectedPlanNode.resultSummary && (
                          <div className="aris-plan-detail-section">
                            <h5>Codex Review</h5>
                            <pre className="aris-plan-detail-review">{selectedPlanNode.resultSummary}</pre>
                          </div>
                        )}

                        {selectedPlanNode.startedAt && (
                          <div className="aris-plan-detail-meta">
                            <span>Started: {new Date(selectedPlanNode.startedAt).toLocaleString()}</span>
                            {selectedPlanNode.completedAt && (
                              <span>Finished: {new Date(selectedPlanNode.completedAt).toLocaleString()}</span>
                            )}
                          </div>
                        )}

                        <div className="aris-plan-detail-actions">
                          {(selectedPlanNode.status === 'completed' || selectedPlanNode.status === 'failed') && (
                            <>
                              <div className="aris-plan-reject-form">
                                <textarea
                                  rows={2}
                                  value={rejectReason}
                                  onChange={(e) => setRejectReason(e.target.value)}
                                  placeholder="Reason for rejection (optional) — what needs to be redone?"
                                />
                              </div>
                              <div className="aris-plan-detail-buttons">
                                {selectedPlanNode.status !== 'completed' && (
                                  <button className="aris-run-btn" onClick={handleApprovePlanNode} type="button">
                                    Mark Complete
                                  </button>
                                )}
                                <button
                                  className="aris-secondary-btn aris-reject-btn"
                                  onClick={handleRejectNode}
                                  disabled={rejectingNode}
                                  type="button"
                                >
                                  {rejectingNode ? 'Rejecting...' : 'Reject & Redo'}
                                </button>
                              </div>
                              <p className="aris-plan-reject-hint">
                                Rejecting will reset this node and all its dependents back to pending.
                              </p>
                            </>
                          )}
                          {selectedPlanNode.status === 'needs_redo' && (
                            <div className="aris-plan-detail-redo-badge">
                              This item was rejected and needs to be re-implemented by the agent.
                            </div>
                          )}
                          {selectedPlanNode.status === 'pending' && (
                            <div className="aris-plan-detail-redo-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
                              Waiting for prerequisites to complete before this item can start.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
                          {row.hasWorkspace && (
                            <button
                              className={`aris-vscode-btn${row.localFullPath ? '' : ' is-disabled'}`}
                              onClick={async (event) => {
                                event.stopPropagation();
                                if (!row.localFullPath) return;
                                try {
                                  const resp = await axios.get(`${apiUrl}/aris/projects/${row.id}/claude-md`, { headers: getAuthHeaders() });
                                  if (resp.data?.content) {
                                    const blob = new Blob([resp.data.content], { type: 'text/markdown' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'CLAUDE.md';
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  }
                                } catch (err) {
                                  console.warn('[ARIS] Failed to fetch CLAUDE.md:', err);
                                }
                                setTimeout(() => window.open(`vscode://file${row.localFullPath}`, '_blank'), 300);
                              }}
                              type="button"
                              title={row.localFullPath ? `Download CLAUDE.md & open ${row.localFullPath} in VS Code` : 'Set the full local path in project settings first'}
                              disabled={!row.localFullPath}
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
                          placeholder="Absolute path for VS Code, e.g. /Users/czk/my-project"
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

      {/* Import Papers Modal */}
      {showImportPapers && (
        <div className="aris-modal-backdrop" onClick={() => setShowImportPapers(false)}>
          <div className="aris-import-papers-modal" onClick={(event) => event.stopPropagation()}>
            <div className="aris-panel-header">
              <h3>Import Papers to Resource Folder</h3>
              <button className="aris-refresh-btn" onClick={() => setShowImportPapers(false)}>Close</button>
            </div>

            <p className="aris-import-description">
              Select a tag to import all matching papers from the library. Each paper gets its own subfolder
              inside <code>resource/</code> with PDF, LaTeX source (if arXiv), and source code (if available).
            </p>

            <label className="aris-field">
              <span>Tag</span>
              <select value={importTag} onChange={(event) => setImportTag(event.target.value)}>
                <option value="">Select a tag</option>
                {availableTags.map((tag) => (
                  <option key={tag.id} value={tag.name}>{tag.name}</option>
                ))}
              </select>
            </label>

            <label className="aris-field">
              <span>Source Type</span>
              <select value={importSourceType} onChange={(event) => setImportSourceType(event.target.value)}>
                <option value="pdf">PDF only</option>
                <option value="latex">PDF + LaTeX source (arXiv papers)</option>
              </select>
            </label>

            <label className="aris-manager-toggle" htmlFor="aris-import-code-toggle">
              <input
                id="aris-import-code-toggle"
                type="checkbox"
                checked={importIncludeCode}
                onChange={(event) => setImportIncludeCode(event.target.checked)}
              />
              <span>Include source code repositories</span>
            </label>

            <div className="aris-import-target-info">
              Target: <code>{selectedProject?.localFullPath || selectedProject?.localProjectPath || '(no local path)'}/resource/</code>
            </div>

            {importResult && (
              <div className="aris-import-result">
                <strong>{importResult.message}</strong>
                <div className="aris-import-paper-list">
                  {importResult.papers?.map((paper) => (
                    <div key={paper.id} className="aris-import-paper-item">
                      <span className="aris-import-paper-title">{paper.title}</span>
                      <span className="aris-import-paper-files">{paper.files.length} file{paper.files.length !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="aris-launch-footer">
              <button
                className="aris-run-btn"
                onClick={handleImportPapers}
                disabled={importingPapers || !importTag || !selectedProjectId}
              >
                {importingPapers ? 'Importing...' : 'Import Papers'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {(previewFile || loadingPreview || previewError) && (
        <div className="aris-modal-backdrop" onClick={closePreview}>
          <div className="aris-file-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="aris-preview-header">
              <div className="aris-preview-title-row">
                <h3>{previewFile?.filePath ? previewFile.filePath.split('/').pop() : 'File Preview'}</h3>
                <button className="aris-refresh-btn" onClick={closePreview} type="button">Close</button>
              </div>
              {previewFile && (
                <div className="aris-preview-meta">
                  <span>{formatFileSize(previewFile.size)}</span>
                  <span>{previewFile.mimeType}</span>
                  {previewFile.isTruncated && <span className="aris-preview-truncated">Truncated</span>}
                  <span className="aris-preview-path" title={previewFile.filePath}>{previewFile.filePath}</span>
                </div>
              )}
            </div>
            <div className="aris-preview-body">
              {loadingPreview && <div className="aris-empty-card">Loading file contents...</div>}
              {previewError && <div className="aris-empty-card" style={{ color: '#a3302a' }}>{previewError}</div>}
              {previewFile && !loadingPreview && !previewError && (
                previewFile.isBinary ? (
                  <div className="aris-empty-card">
                    Binary file ({previewFile.mimeType}, {formatFileSize(previewFile.size)}). Preview not available.
                  </div>
                ) : (
                  <pre className={`aris-preview-content ${getPreviewLang(previewFile.filePath)}`}>
                    <code>{previewFile.content}</code>
                  </pre>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getPreviewLang(filePath) {
  if (!filePath) return 'lang-text';
  const ext = filePath.split('.').pop().toLowerCase();
  const langMap = {
    py: 'lang-python', js: 'lang-javascript', jsx: 'lang-javascript',
    ts: 'lang-typescript', tsx: 'lang-typescript',
    json: 'lang-json', yaml: 'lang-yaml', yml: 'lang-yaml',
    toml: 'lang-toml', md: 'lang-markdown',
    sh: 'lang-bash', bash: 'lang-bash', zsh: 'lang-bash',
    tex: 'lang-latex', bib: 'lang-bibtex',
    css: 'lang-css', html: 'lang-html', xml: 'lang-xml',
    csv: 'lang-csv', tsv: 'lang-csv',
    log: 'lang-log', txt: 'lang-text',
    r: 'lang-r', R: 'lang-r',
    c: 'lang-c', cpp: 'lang-cpp', h: 'lang-c',
    java: 'lang-java', rs: 'lang-rust', go: 'lang-go',
  };
  return langMap[ext] || 'lang-text';
}
