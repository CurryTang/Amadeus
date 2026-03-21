'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MarkdownContent from '../shared/MarkdownRenderer';
import {
  clearWorkspaceContents,
  getWorkspaceLink,
  linkClientWorkspace,
  materializeProjectFiles,
  removeWorkspaceLink,
} from '../../hooks/useClientWorkspaceRegistry.js';
import {
  ARIS_QUICK_ACTIONS,
  DAILY_TASK_CATEGORIES,
  DAILY_TASK_FREQUENCIES,
  buildArisControlTowerCard,
  buildArisProjectRow,
  buildArisProjectSummaryRow,
  buildArisReviewRow,
  buildArisRunDetail,
  buildArisRunCard,
  buildArisWakeupRow,
  buildArisWorkItemRow,
  buildArisWorkspaceContext,
  buildDailyTaskRow,
  buildOngoingWorkItemRow,
  buildDayPlanItem,
  categoryIcon,
} from './arisWorkspacePresentation.js';
import {
  createEmptyRunLaunchDraft,
  createEmptyProjectSettingsDraft,
  createEmptyRemoteEndpointDraft,
  createEmptyWorkItemDraft,
  createEmptyDailyTaskDraft,
  dailyTaskToDraft,
  dailyTaskDraftToPayload,
  validateDailyTaskDraft,
  projectToSettingsDraft,
  runLaunchDraftToPayload,
  settingsDraftToPayload,
  validateProjectSettingsDraft,
  validateRunLaunchDraft,
  validateWorkItemDraft,
  workItemDraftToPayload,
  workItemToDraft,
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

// Unified control tower — no more separate tabs
const CT_PANELS = { OVERVIEW: 'overview', MY_DAY: 'my_day', WORK_ITEMS: 'work_items', RUNS: 'runs', LAUNCHER: 'launcher' };

// ─── Day Scheduling Helpers ──────────────────────────────────────────────────

function buildSchedulePrompt(context) {
  const lines = [
    `Schedule my day for ${context.dayOfWeek}, ${context.date}.`,
    `Days remaining in week: ${context.daysRemainingInWeek}`,
    '',
    '## Pending Daily Tasks',
  ];
  for (const t of context.pendingDailyTasks) {
    const targetInfo = t.totalTarget != null
      ? `target: ${t.completedThisWeek}/${t.weeklyTarget}/week, need ${t.dailyQuota} today`
      : `routine: ${t.completedThisWeek}/${t.weeklyTarget}/week`;
    lines.push(`- ${t.title} (${t.category}, ~${t.estimatedMinutes}min, ${targetInfo})`);
  }
  if (context.pendingDailyTasks.length === 0) lines.push('- (none)');

  if (context.milestones?.length > 0) {
    lines.push('', '## Upcoming Milestones & Deadlines');
    for (const m of context.milestones) {
      const when = m.isToday ? 'TODAY' : `in ${m.daysUntil} days`;
      lines.push(`- [${m.projectName}] ${m.name} (${m.type}, ${when})`);
    }
  }

  lines.push('', '## Ongoing Work Items Across Projects');
  for (const item of context.ongoingWorkItems) {
    lines.push(`- [${item.projectName}] ${item.title} (${item.status}, P${item.priority}${item.dueAt ? `, due: ${item.dueAt.slice(0, 10)}` : ''}${item.nextBestAction ? ` — next: ${item.nextBestAction}` : ''})`);
  }
  if (context.ongoingWorkItems.length === 0) lines.push('- (none)');

  lines.push('', '## Weekly Progress');
  for (const t of context.weeklyProgress) {
    const status = t.isOnTrack ? 'on track' : `${t.remaining} remaining, ${t.dailyQuota}/day needed`;
    lines.push(`- ${t.title}: ${t.completedThisWeek}/${t.weeklyTarget} (${status})`);
  }
  lines.push('', 'Create a time-blocked schedule from 9am to 11pm. Distribute target-based tasks according to daily quotas. Prioritize items with approaching deadlines and targets that are behind. Include breaks every ~2 hours.');
  return lines.join('\n');
}

function generateDayPlanFromContext(context) {
  const items = [];
  let timeSlot = 9; // Start at 9am
  const uid = () => Math.random().toString(36).slice(2, 10);

  const fmt = (h) => {
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${h12}:${min.toString().padStart(2, '0')} ${ampm}`;
  };

  const addItem = (task, opts = {}) => {
    items.push({
      id: uid(), time: fmt(timeSlot),
      title: opts.title || task.title,
      description: opts.description || task.description || '',
      category: opts.category || task.category || 'general',
      estimatedMinutes: opts.estimatedMinutes || task.estimatedMinutes || 30,
      sourceType: opts.sourceType || 'daily_task',
      sourceId: opts.sourceId || task.id || '',
      isDone: false,
    });
    timeSlot += (opts.estimatedMinutes || task.estimatedMinutes || 30) / 60;
  };

  const addBreak = (title = 'Break', minutes = 15, desc = '') => {
    items.push({ id: uid(), time: fmt(timeSlot), title, description: desc, category: 'general', estimatedMinutes: minutes, sourceType: 'break', sourceId: '', isDone: false });
    timeSlot += minutes / 60;
  };

  // ── Sort tasks by urgency: behind-schedule targets first, then routines ──
  const sortedTasks = [...context.pendingDailyTasks].sort((a, b) => {
    // Tasks with targets that are behind get highest priority
    const aUrgent = a.totalTarget != null && a.remaining > 0 ? a.dailyQuota : 0;
    const bUrgent = b.totalTarget != null && b.remaining > 0 ? b.dailyQuota : 0;
    if (bUrgent !== aUrgent) return bUrgent - aUrgent;
    return (b.remaining || 0) - (a.remaining || 0);
  });

  // ── Check for deadline pressure from milestones ──
  const urgentMilestones = (context.milestones || []).filter((m) => m.daysUntil <= 3 && !m.isToday);
  const todayMilestones = (context.milestones || []).filter((m) => m.isToday);

  // ── Morning routine (exercise, reading) ──
  const morningCategories = ['exercise', 'reading'];
  const morningTasks = sortedTasks.filter((t) => morningCategories.includes(t.category));
  const nonMorningTasks = sortedTasks.filter((t) => !morningCategories.includes(t.category));

  // For target-based tasks, schedule dailyQuota repetitions
  for (const task of morningTasks) {
    const reps = task.totalTarget != null ? Math.max(1, task.dailyQuota) : 1;
    for (let i = 0; i < reps && timeSlot < 11; i++) {
      addItem(task, { title: reps > 1 ? `${task.title} (${i + 1}/${reps})` : task.title });
    }
  }

  if (morningTasks.length > 0 && timeSlot < 10.5) {
    addBreak('Break', 15);
  }

  // ── Today's milestones (meetings etc.) — fixed time blocks ──
  for (const m of todayMilestones) {
    addItem({}, {
      title: `[${m.projectName}] ${m.name}`,
      description: m.type === 'recurring' ? 'Weekly recurring' : 'Deadline today',
      category: 'general',
      estimatedMinutes: 60,
      sourceType: 'milestone',
      sourceId: m.id,
    });
  }

  // ── Work items — prioritize items with approaching deadlines ──
  const workBlocks = context.ongoingWorkItems.map((item) => {
    const blockMinutes = item.status === 'in_progress' ? 60 : item.status === 'blocked' || item.status === 'review' ? 30 : 45;
    // Boost priority for items in projects with upcoming deadlines
    const deadlineBoost = urgentMilestones.some((m) => m.projectName === item.projectName) ? 10 : 0;
    return { ...item, estimatedMinutes: blockMinutes, description: item.nextBestAction || `Work on: ${item.title}`, deadlineBoost };
  });

  workBlocks.sort((a, b) => {
    // Items with deadline pressure first
    if (a.deadlineBoost !== b.deadlineBoost) return b.deadlineBoost - a.deadlineBoost;
    const statusOrder = { blocked: 0, review: 1, in_progress: 2, waiting: 3, ready: 4 };
    const aDiff = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
    if (aDiff !== 0) return aDiff;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  let lastBreakSlot = timeSlot;
  for (const block of workBlocks) {
    if (timeSlot >= 18) break;
    addItem(block, {
      title: `[${block.projectName}] ${block.title}`,
      description: block.description,
      category: 'research',
      estimatedMinutes: block.estimatedMinutes,
      sourceType: 'work_item',
      sourceId: block.id,
    });
    if (timeSlot - lastBreakSlot >= 2 && timeSlot < 18) {
      addBreak('Break', 15, 'Rest, stretch, hydrate');
      lastBreakSlot = timeSlot;
    }
  }

  // ── Lunch ──
  if (timeSlot >= 12 && !items.some((i) => i.title === 'Lunch')) {
    const lunchIdx = items.findIndex((i) => parseTimeToHour(i.time) >= 12);
    if (lunchIdx >= 0) {
      items.splice(lunchIdx, 0, { id: uid(), time: '12:00 PM', title: 'Lunch', description: '', category: 'general', estimatedMinutes: 60, sourceType: 'break', sourceId: '', isDone: false });
    }
  }

  // ── Afternoon/evening: remaining daily tasks with quota repetitions ──
  if (timeSlot < 13) timeSlot = 13;
  for (const task of nonMorningTasks) {
    if (timeSlot >= 22) break;
    const reps = task.totalTarget != null ? Math.max(1, task.dailyQuota) : 1;
    for (let i = 0; i < reps && timeSlot < 22; i++) {
      addItem(task, { title: reps > 1 ? `${task.title} (${i + 1}/${reps})` : task.title });
    }
  }

  return items;
}

function parseTimeToHour(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h + m / 60;
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export default function ArisWorkspace({ apiUrl, getAuthHeaders }) {
  const [ctPanel, _setCtPanel] = useState(CT_PANELS.MY_DAY);
  const ctPanelHistory = useRef([]);
  const setCtPanel = useCallback((next) => {
    _setCtPanel((prev) => {
      if (prev !== next) ctPanelHistory.current.push(prev);
      if (ctPanelHistory.current.length > 20) ctPanelHistory.current.splice(0, ctPanelHistory.current.length - 20);
      return next;
    });
  }, []);
  const handleBack = useCallback(() => {
    const prev = ctPanelHistory.current.pop();
    if (prev) _setCtPanel(prev);
  }, []);
  const [contextData, setContextData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [controlTower, setControlTower] = useState(null);
  const [loadingControlTower, setLoadingControlTower] = useState(false);
  const [reviewInbox, setReviewInbox] = useState([]);
  const [loadingReviewInbox, setLoadingReviewInbox] = useState(false);
  const [projectNow, setProjectNow] = useState(null);
  const [loadingProjectNow, setLoadingProjectNow] = useState(false);
  const [workItems, setWorkItems] = useState([]);
  const [loadingWorkItems, setLoadingWorkItems] = useState(false);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const [selectedWorkItemDetail, setSelectedWorkItemDetail] = useState(null);
  const [workItemDraft, setWorkItemDraft] = useState(createEmptyWorkItemDraft());
  const [savingWorkItem, setSavingWorkItem] = useState(false);
  const [wiEditMode, setWiEditMode] = useState(false);
  const [launchingWorkItemRun, setLaunchingWorkItemRun] = useState(false);
  const [workItemRunDraft, setWorkItemRunDraft] = useState(createEmptyRunLaunchDraft());
  const [milestones, setMilestones] = useState([]);
  const [localSessions, setLocalSessions] = useState([]);
  const [localSessionsUpdatedAt, setLocalSessionsUpdatedAt] = useState(null);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [seedingPhases, setSeedingPhases] = useState(false);
  const [expandedPhaseId, setExpandedPhaseId] = useState(null);
  const [editingPhaseId, setEditingPhaseId] = useState(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [showAddMilestone, setShowAddMilestone] = useState(false);
  const [milestoneDraft, setMilestoneDraft] = useState({ name: '', type: 'deadline', dueAt: '', recurrenceDay: 5 });
  const [quickNote, setQuickNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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

  // ─── My Day state ──────────────────────────────────────────────────────
  const [dailyTasks, setDailyTasks] = useState([]);
  const [loadingDailyTasks, setLoadingDailyTasks] = useState(false);
  const [dailyCompletions, setDailyCompletions] = useState([]);
  const [ongoingItems, setOngoingItems] = useState([]);
  const [loadingOngoing, setLoadingOngoing] = useState(false);
  const [weeklyProgress, setWeeklyProgress] = useState([]);
  const [upcomingMilestones, setUpcomingMilestones] = useState([]);
  const [dayPlan, setDayPlan] = useState(null);
  const [loadingDayPlan, setLoadingDayPlan] = useState(false);
  const [schedulingDay, setSchedulingDay] = useState(false);
  const [showAddDailyTask, setShowAddDailyTask] = useState(false);
  const [dailyTaskDraft, setDailyTaskDraft] = useState(createEmptyDailyTaskDraft());
  const [savingDailyTask, setSavingDailyTask] = useState(false);
  const [editingDailyTaskId, setEditingDailyTaskId] = useState(null);

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

  const fetchControlTower = useCallback(async () => {
    setLoadingControlTower(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/control-tower`, {
        headers: getAuthHeaders(),
      });
      setControlTower(response.data?.controlTower || null);
      return response.data?.controlTower || null;
    } finally {
      setLoadingControlTower(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchReviewInbox = useCallback(async () => {
    setLoadingReviewInbox(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/review-inbox`, {
        headers: getAuthHeaders(),
      });
      const items = response.data?.reviewInbox || [];
      setReviewInbox(items);
      return items;
    } finally {
      setLoadingReviewInbox(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchProjectNow = useCallback(async (projectId) => {
    if (!projectId) {
      setProjectNow(null);
      return null;
    }
    setLoadingProjectNow(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/projects/${projectId}/now`, {
        headers: getAuthHeaders(),
      });
      const payload = response.data?.now || null;
      setProjectNow(payload);
      return payload;
    } finally {
      setLoadingProjectNow(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchProjectWorkItems = useCallback(async (projectId) => {
    if (!projectId) {
      setWorkItems([]);
      setSelectedWorkItemId('');
      setSelectedWorkItemDetail(null);
      return [];
    }
    setLoadingWorkItems(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/projects/${projectId}/work-items`, {
        headers: getAuthHeaders(),
      });
      const items = response.data?.workItems || [];
      setWorkItems(items);
      setSelectedWorkItemId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        return items[0]?.id || '';
      });
      return items;
    } finally {
      setLoadingWorkItems(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchLocalSessions = useCallback(async () => {
    try {
      const response = await axios.get(`${apiUrl}/aris/local-sessions`, { headers: getAuthHeaders() });
      setLocalSessions(response.data?.sessions || []);
      setLocalSessionsUpdatedAt(response.data?.updatedAt || null);
    } catch (_) { /* non-critical */ }
  }, [apiUrl, getAuthHeaders]);

  // Auto-poll sessions every 15s when overview is active
  useEffect(() => {
    if (ctPanel !== CT_PANELS.OVERVIEW) return;
    fetchLocalSessions();
    const interval = setInterval(fetchLocalSessions, 15000);
    return () => clearInterval(interval);
  }, [ctPanel, fetchLocalSessions]);

  // ─── My Day data fetchers ────────────────────────────────────────────────

  const fetchDailyTasks = useCallback(async () => {
    setLoadingDailyTasks(true);
    try {
      const [tasksRes, progressRes, completionsRes] = await Promise.all([
        axios.get(`${apiUrl}/aris/daily-tasks`, { headers: getAuthHeaders() }),
        axios.get(`${apiUrl}/aris/weekly-progress`, { headers: getAuthHeaders() }),
        axios.get(`${apiUrl}/aris/daily-completions?date=${new Date().toISOString().slice(0, 10)}`, { headers: getAuthHeaders() }),
      ]);
      setDailyTasks(tasksRes.data?.tasks || []);
      setWeeklyProgress(progressRes.data?.progress || []);
      setDailyCompletions(completionsRes.data?.completions || []);
    } finally {
      setLoadingDailyTasks(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchOngoingItems = useCallback(async () => {
    setLoadingOngoing(true);
    try {
      const res = await axios.get(`${apiUrl}/aris/ongoing-work-items`, { headers: getAuthHeaders() });
      setOngoingItems(res.data?.items || []);
    } finally {
      setLoadingOngoing(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchDayPlan = useCallback(async () => {
    setLoadingDayPlan(true);
    try {
      const res = await axios.get(`${apiUrl}/aris/day-plan`, { headers: getAuthHeaders() });
      setDayPlan(res.data?.plan || null);
    } finally {
      setLoadingDayPlan(false);
    }
  }, [apiUrl, getAuthHeaders]);

  const fetchUpcomingMilestones = useCallback(async () => {
    try {
      const res = await axios.get(`${apiUrl}/aris/upcoming-milestones`, { headers: getAuthHeaders() });
      setUpcomingMilestones(res.data?.milestones || []);
    } catch (_) { /* non-critical */ }
  }, [apiUrl, getAuthHeaders]);

  // Load My Day data when panel is active
  useEffect(() => {
    if (ctPanel !== CT_PANELS.MY_DAY) return;
    fetchDailyTasks();
    fetchOngoingItems();
    fetchDayPlan();
    fetchUpcomingMilestones();
  }, [ctPanel, fetchDailyTasks, fetchOngoingItems, fetchDayPlan, fetchUpcomingMilestones]);

  const handleToggleDailyCompletion = async (taskId, count) => {
    try {
      await axios.post(`${apiUrl}/aris/daily-tasks/${taskId}/toggle`, count != null ? { count } : {}, { headers: getAuthHeaders() });
      await fetchDailyTasks();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to toggle completion');
    }
  };

  const handleSaveDailyTask = async () => {
    const validationError = validateDailyTaskDraft(dailyTaskDraft);
    if (validationError) { setError(validationError); return; }
    setSavingDailyTask(true);
    try {
      const payload = dailyTaskDraftToPayload(dailyTaskDraft);
      if (editingDailyTaskId) {
        await axios.patch(`${apiUrl}/aris/daily-tasks/${editingDailyTaskId}`, payload, { headers: getAuthHeaders() });
      } else {
        await axios.post(`${apiUrl}/aris/daily-tasks`, payload, { headers: getAuthHeaders() });
      }
      setShowAddDailyTask(false);
      setEditingDailyTaskId(null);
      setDailyTaskDraft(createEmptyDailyTaskDraft());
      await fetchDailyTasks();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save daily task');
    } finally {
      setSavingDailyTask(false);
    }
  };

  const handleDeleteDailyTask = async (taskId) => {
    try {
      await axios.delete(`${apiUrl}/aris/daily-tasks/${taskId}`, { headers: getAuthHeaders() });
      await fetchDailyTasks();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to delete daily task');
    }
  };

  const handleScheduleDay = async () => {
    setSchedulingDay(true);
    try {
      const contextRes = await axios.get(`${apiUrl}/aris/day-context`, { headers: getAuthHeaders() });
      const context = contextRes.data?.context;
      if (!context) throw new Error('Failed to build day context');

      // Build a scheduling prompt for the Codex MCP
      const prompt = buildSchedulePrompt(context);

      // Call the day-plan endpoint — the backend can optionally forward to Codex
      // For now, we generate a structured plan from the context client-side
      const items = generateDayPlanFromContext(context);
      const summary = `${items.length} items scheduled for ${context.dayOfWeek}`;
      const res = await axios.post(`${apiUrl}/aris/day-plan`, { items, summary }, { headers: getAuthHeaders() });
      setDayPlan(res.data?.plan || null);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to schedule day');
    } finally {
      setSchedulingDay(false);
    }
  };

  const expandedPhaseIdRef = useRef(expandedPhaseId);
  expandedPhaseIdRef.current = expandedPhaseId;

  const fetchMilestones = useCallback(async (projectId) => {
    if (!projectId) { setMilestones([]); return []; }
    setLoadingMilestones(true);
    try {
      const response = await axios.get(`${apiUrl}/aris/projects/${projectId}/milestones`, { headers: getAuthHeaders() });
      const items = response.data?.milestones || [];
      setMilestones(items);
      if (items.length > 0 && !expandedPhaseIdRef.current) setExpandedPhaseId(items[0].id);
      return items;
    } finally { setLoadingMilestones(false); }
  }, [apiUrl, getAuthHeaders]);

  const handleSeedPhases = useCallback(async () => {
    if (!selectedProjectId || seedingPhases) return;
    setSeedingPhases(true);
    try {
      await axios.post(`${apiUrl}/aris/projects/${selectedProjectId}/seed-phases`, {}, { headers: getAuthHeaders() });
      await fetchMilestones(selectedProjectId);
    } catch (err) { setError(err.response?.data?.error || 'Failed to seed phases'); }
    finally { setSeedingPhases(false); }
  }, [apiUrl, getAuthHeaders, selectedProjectId, seedingPhases, fetchMilestones]);

  const handleRenamePhase = async (milestoneId, name) => {
    if (!name.trim()) return;
    try {
      await axios.patch(`${apiUrl}/aris/milestones/${milestoneId}`, { name: name.trim() }, { headers: getAuthHeaders() });
      await fetchMilestones(selectedProjectId);
    } catch (err) { setError(err.response?.data?.error || 'Failed to rename phase'); }
    setEditingPhaseId(null);
  };

  const handleAddPhase = async () => {
    if (!newPhaseName.trim() || !selectedProjectId) return;
    try {
      await axios.post(`${apiUrl}/aris/projects/${selectedProjectId}/milestones`, { name: newPhaseName.trim() }, { headers: getAuthHeaders() });
      setNewPhaseName('');
      setAddingPhase(false);
      await fetchMilestones(selectedProjectId);
    } catch (err) { setError(err.response?.data?.error || 'Failed to add phase'); }
  };

  const handleDeletePhase = async (milestoneId) => {
    try {
      await axios.delete(`${apiUrl}/aris/milestones/${milestoneId}`, { headers: getAuthHeaders() });
      if (expandedPhaseId === milestoneId) setExpandedPhaseId(null);
      await fetchMilestones(selectedProjectId);
    } catch (err) { setError(err.response?.data?.error || 'Failed to delete phase'); }
  };

  const handleCreateMilestone = async () => {
    if (!milestoneDraft.name.trim() || !selectedProjectId) return;
    try {
      const payload = {
        name: milestoneDraft.name.trim(),
        ...(milestoneDraft.type === 'recurring'
          ? { recurrence: 'weekly', recurrenceDay: parseInt(milestoneDraft.recurrenceDay, 10) }
          : { dueAt: milestoneDraft.dueAt || null }),
      };
      await axios.post(`${apiUrl}/aris/projects/${selectedProjectId}/milestones`, payload, { headers: getAuthHeaders() });
      setMilestoneDraft({ name: '', type: 'deadline', dueAt: '', recurrenceDay: 5 });
      setShowAddMilestone(false);
      await fetchMilestones(selectedProjectId);
    } catch (err) { setError(err.response?.data?.error || 'Failed to create milestone'); }
  };

  const handleWorkItemAction = async (itemId, action) => {
    try {
      if (action === 'done_today') {
        // Mark as waiting (done for today, will check back)
        await axios.patch(`${apiUrl}/aris/work-items/${itemId}`, { status: 'in_progress', nextBestAction: `Done for today (${new Date().toLocaleDateString()})` }, { headers: getAuthHeaders() });
      } else if (action === 'waiting') {
        await axios.patch(`${apiUrl}/aris/work-items/${itemId}`, { status: 'waiting' }, { headers: getAuthHeaders() });
      } else if (action === 'all_done') {
        await axios.patch(`${apiUrl}/aris/work-items/${itemId}`, { status: 'done' }, { headers: getAuthHeaders() });
      }
      await fetchOngoingItems();
    } catch (err) { setError(err.response?.data?.error || 'Failed to update work item'); }
  };

  const handleSaveQuickNote = async () => {
    const text = quickNote.trim();
    if (!text || !selectedProjectId || savingNote) return;
    setSavingNote(true);
    try {
      // First line becomes title, rest is content
      const lines = text.split('\n');
      const title = lines[0].substring(0, 100);
      const content = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
      await axios.post(`${apiUrl}/aris/projects/${selectedProjectId}/work-items`, {
        title,
        contextMd: content,
        type: 'note',
        status: 'done',
      }, { headers: getAuthHeaders() });
      setQuickNote('');
      // Optimistic: refresh in background
      fetchProjectWorkItems(selectedProjectId).catch(() => {});
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateFollowUp = (parentItem) => {
    const parentWi = workItems.find((w) => w.id === parentItem.id);
    handleCreateWorkItem({
      parentWorkItemId: parentItem.id,
      milestoneId: parentWi?.milestoneId || '',
    });
  };

  const fetchWorkItemDetail = useCallback(async (workItemId) => {
    if (!workItemId) {
      setSelectedWorkItemDetail(null);
      return null;
    }
    const response = await axios.get(`${apiUrl}/aris/work-items/${workItemId}`, {
      headers: getAuthHeaders(),
    });
    const detail = response.data?.workItem || null;
    setSelectedWorkItemDetail(detail);
    return detail;
  }, [apiUrl, getAuthHeaders]);

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
        const [contextResponse, runsResponse, controlTowerPayload, reviewInboxItems] = await Promise.all([
          axios.get(`${apiUrl}/aris/context`, { headers: getAuthHeaders() }),
          axios.get(`${apiUrl}/aris/runs`, { headers: getAuthHeaders() }),
          fetchControlTower(),
          fetchReviewInbox(),
        ]);
        fetchLocalSessions().catch(() => {});
        if (!active) return;
        const payload = contextResponse.data || {};
        const nextRuns = runsResponse.data?.runs || [];
        setContextData(payload);
        setControlTower(controlTowerPayload || null);
        setReviewInbox(reviewInboxItems || []);
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
  }, [apiUrl, fetchControlTower, fetchReviewInbox, getAuthHeaders]);

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

  useEffect(() => {
    fetchProjectNow(selectedProjectId).catch(() => {});
    fetchProjectWorkItems(selectedProjectId).catch(() => {});
    fetchMilestones(selectedProjectId).catch(() => {});
  }, [fetchProjectNow, fetchProjectWorkItems, fetchMilestones, selectedProjectId]);

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
  const projectSummaryRows = useMemo(
    () => ((controlTower?.projects || contextData?.projects || [])).map((project) => buildArisProjectSummaryRow({
      ...project,
      activeRunCount: project.activeRunCount ?? project.inFlightRunCount ?? 0,
      reviewReadyCount: project.reviewReadyCount ?? project.reviewReadyRunCount ?? 0,
      overdueWakeupCount: project.overdueWakeupCount ?? 0,
    })),
    [contextData, controlTower]
  );
  const controlTowerCards = useMemo(
    () => {
      const actionableItems = [
        ...(controlTower?.overdueWakeups || []).map((item) => ({ ...item, kind: 'wakeup', status: 'overdue', title: item.reason || 'Wake-up' })),
        ...(controlTower?.reviewReadyRuns || []).map((item) => ({ ...item, kind: 'review', status: 'review_ready', title: item.title || item.workflowType || 'Review-ready run', summary: item.resultSummary || item.summary || '' })),
        ...(controlTower?.blockedWorkItems || []).map((item) => ({ ...item, kind: 'work_item', status: 'blocked', title: item.title || 'Blocked work item', summary: item.blockedReason || item.summary || '' })),
        ...(controlTower?.staleRuns || []).map((item) => ({ ...item, kind: 'run', status: 'waiting', title: item.title || item.workflowType || 'Stale run', summary: item.summary || '' })),
      ];
      return actionableItems.map((item) => buildArisControlTowerCard(item));
    },
    [controlTower]
  );
  const reviewRows = useMemo(
    () => reviewInbox.map((item) => buildArisReviewRow({
      ...item,
      title: item.title || item.workflowType || 'Review-ready run',
      decision: item.decision || 'pending',
      notesMd: item.resultSummary || item.summary || '',
    })),
    [reviewInbox]
  );
  const workItemRows = useMemo(
    () => workItems
      .filter((item) => item.status !== 'canceled' && !item.archivedAt)
      .map((item) => buildArisWorkItemRow(item)),
    [workItems]
  );
  const selectedWorkItem = useMemo(
    () => selectedWorkItemDetail || workItems.find((item) => item.id === selectedWorkItemId) || null,
    [selectedWorkItemDetail, selectedWorkItemId, workItems]
  );
  const wakeupRows = useMemo(
    () => {
      const sourceWakeups = selectedWorkItem?.wakeups || workItemDraft.wakeups || [];
      return sourceWakeups.map((item) => buildArisWakeupRow(item));
    },
    [selectedWorkItem, workItemDraft]
  );
  // Group work items by milestone/phase for the unified view
  const phaseGroupedItems = useMemo(() => {
    const groups = milestones.map((m) => ({
      ...m,
      items: workItemRows.filter((item) => {
        const wi = workItems.find((w) => w.id === item.id);
        return wi && wi.milestoneId === m.id;
      }),
    }));
    const unassigned = workItemRows.filter((item) => {
      const wi = workItems.find((w) => w.id === item.id);
      return !wi?.milestoneId || !milestones.some((m) => m.id === wi.milestoneId);
    });
    if (unassigned.length > 0) {
      groups.push({ id: '__unassigned__', name: 'Unassigned', description: '', items: unassigned });
    }
    return groups;
  }, [milestones, workItemRows, workItems]);

  // Attention items count for the project sidebar
  const projectAttentionCounts = useMemo(() => {
    const counts = {};
    (controlTower?.projects || contextData?.projects || []).forEach((p) => {
      const active = p.inFlightRunCount ?? p.activeRunCount ?? 0;
      const review = p.reviewReadyRunCount ?? p.reviewReadyCount ?? 0;
      const overdue = p.overdueWakeupCount ?? 0;
      counts[p.id] = { active, review, overdue, total: active + review + overdue };
    });
    return counts;
  }, [controlTower, contextData]);

  const runCards = useMemo(() => runs.map((run) => buildArisRunCard(run)), [runs]);
  const selectedRunCard = useMemo(
    () => buildArisRunDetail(selectedRunDetail || runs.find((run) => run.id === selectedRunId) || {}),
    [runs, selectedRunDetail, selectedRunId]
  );

  useEffect(() => {
    fetchWorkItemDetail(selectedWorkItemId).catch(() => {});
  }, [fetchWorkItemDetail, selectedWorkItemId]);

  useEffect(() => {
    if (!selectedWorkItem) {
      // Don't overwrite draft if user just opened the "new item" form
      if (wiEditMode) return;
      const draft = createEmptyWorkItemDraft();
      draft.projectId = selectedProjectId;
      setWorkItemDraft(draft);
      setWorkItemRunDraft((prev) => ({ ...createEmptyRunLaunchDraft(), projectId: selectedProjectId, workItemId: '' }));
      return;
    }

    const nextDraft = workItemToDraft(selectedWorkItem);
    setWorkItemDraft(nextDraft);
    setWiEditMode(false); // existing items open in view mode
    setWorkItemRunDraft((prev) => ({
      ...createEmptyRunLaunchDraft(),
      ...prev,
      projectId: selectedProjectId,
      workItemId: selectedWorkItem.id,
      title: selectedWorkItem.title || prev.title,
      wakeups: nextDraft.wakeups?.length ? nextDraft.wakeups : prev.wakeups,
    }));
  }, [selectedProjectId, selectedWorkItem]);

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
      await Promise.all([
        refreshContext(),
        fetchRuns(),
        fetchControlTower(),
        fetchReviewInbox(),
        fetchProjectNow(selectedProjectId),
        fetchProjectWorkItems(selectedProjectId),
        fetchMilestones(selectedProjectId),
        fetchLocalSessions(),
      ]);
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

  const handleCreateWorkItem = (opts = {}) => {
    const nextDraft = createEmptyWorkItemDraft();
    nextDraft.projectId = selectedProjectId;
    if (opts.milestoneId) nextDraft.milestoneId = opts.milestoneId;
    if (opts.parentWorkItemId) nextDraft.parentWorkItemId = opts.parentWorkItemId;
    setSelectedWorkItemId('');
    setSelectedWorkItemDetail(null);
    setWorkItemDraft(nextDraft);
    setWiEditMode(true); // new items start in edit mode
    setWorkItemRunDraft({
      ...createEmptyRunLaunchDraft(),
      projectId: selectedProjectId,
      workItemId: '',
      title: '',
    });
    setCtPanel(CT_PANELS.WORK_ITEMS);
  };

  const STATUS_CYCLE = ['backlog', 'in_progress', 'done'];

  const handleToggleItemStatus = async (itemId, currentStatus) => {
    const currentIdx = STATUS_CYCLE.indexOf(currentStatus);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
    // Optimistic — instant UI update
    setWorkItems((prev) => prev.map((w) => w.id === itemId ? { ...w, status: nextStatus } : w));
    try {
      await axios.patch(`${apiUrl}/aris/work-items/${itemId}`, { status: nextStatus }, { headers: getAuthHeaders() });
    } catch (err) {
      // Revert on failure
      setWorkItems((prev) => prev.map((w) => w.id === itemId ? { ...w, status: currentStatus } : w));
      setError(err?.response?.data?.error || 'Failed to update status');
    }
  };

  const handleDeleteWorkItem = async (itemId) => {
    // Optimistic remove
    const prevItems = workItems;
    setWorkItems((prev) => prev.filter((w) => w.id !== itemId));
    if (selectedWorkItemId === itemId) { setSelectedWorkItemId(''); setSelectedWorkItemDetail(null); }
    try {
      await axios.patch(`${apiUrl}/aris/work-items/${itemId}`, { status: 'canceled', archivedAt: new Date().toISOString() }, { headers: getAuthHeaders() });
      // Background refresh
      fetchProjectWorkItems(selectedProjectId).catch(() => {});
    } catch (err) {
      setWorkItems(prevItems); // revert
      setError(err?.response?.data?.error || 'Failed to delete item');
    }
  };

  const handleWorkItemFieldChange = (field, value) => {
    setWorkItemDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleWorkItemWakeupChange = (index, field, value) => {
    setWorkItemDraft((prev) => ({
      ...prev,
      wakeups: (prev.wakeups || []).map((wakeup, wakeupIndex) => (
        wakeupIndex === index ? { ...wakeup, [field]: value } : wakeup
      )),
    }));
  };

  const handleAddWorkItemWakeup = () => {
    setWorkItemDraft((prev) => ({
      ...prev,
      wakeups: [...(prev.wakeups || []), { id: '', reason: '', scheduledFor: '', status: 'scheduled', firedAt: '', resolvedAt: '' }],
    }));
  };

  const handleSaveWorkItem = async () => {
    const validationError = validateWorkItemDraft(workItemDraft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSavingWorkItem(true);
    setError('');
    try {
      const payload = workItemDraftToPayload({
        ...workItemDraft,
        projectId: selectedProjectId,
      });
      let response;
      if (workItemDraft.id) {
        response = await axios.patch(`${apiUrl}/aris/work-items/${workItemDraft.id}`, payload, {
          headers: getAuthHeaders(),
        });
      } else {
        response = await axios.post(`${apiUrl}/aris/projects/${selectedProjectId}/work-items`, payload, {
          headers: getAuthHeaders(),
        });
      }
      // Optimistic: add/update item locally, then background refresh
      const savedItem = response.data?.workItem;
      if (savedItem) {
        setWorkItems((prev) => {
          const exists = prev.some((w) => w.id === savedItem.id);
          return exists ? prev.map((w) => w.id === savedItem.id ? savedItem : w) : [savedItem, ...prev];
        });
        setSelectedWorkItemId(savedItem.id);
        setWorkItemDraft((prev) => ({ ...prev, id: savedItem.id }));
      }
      setSavingWorkItem(false);
      // Background refreshes — don't block UI
      fetchProjectWorkItems(selectedProjectId).catch(() => {});
      fetchControlTower().catch(() => {});
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to save work item');
      setSavingWorkItem(false);
    }
  };

  const handleLaunchWorkItemRun = async () => {
    const payload = runLaunchDraftToPayload({
      ...workItemRunDraft,
      projectId: selectedProjectId,
      workItemId: selectedWorkItemId || workItemDraft.id,
      title: workItemRunDraft.title || workItemDraft.title,
      prompt: workItemRunDraft.prompt || prompt,
      wakeups: workItemDraft.wakeups,
    });
    const validationError = validateRunLaunchDraft(payload);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLaunchingWorkItemRun(true);
    setError('');
    try {
      const response = await axios.post(
        `${apiUrl}/aris/work-items/${payload.workItemId}/runs`,
        {
          ...payload,
          workflowType: selectedWorkflow,
          targetId: selectedTargetId || null,
          actorKind: selectedTargetId ? 'codex' : 'human',
        },
        { headers: getAuthHeaders() }
      );
      const createdRun = response.data?.run || null;
      if (createdRun?.id) {
        setSelectedRunId(createdRun.id);
        await fetchRunDetail(createdRun.id, { silent: true });
      }
      await Promise.all([
        fetchRuns(),
        fetchControlTower(),
        fetchReviewInbox(),
        fetchProjectWorkItems(selectedProjectId),
        fetchProjectNow(selectedProjectId),
      ]);
      setCtPanel(CT_PANELS.RUNS);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to launch run from work item');
    } finally {
      setLaunchingWorkItemRun(false);
    }
  };

  // Build tree from flat work items using parentWorkItemId
  function buildItemTree(phaseItems, allWorkItems) {
    const phaseItemIds = new Set(phaseItems.map((i) => i.id));
    const roots = [];
    const childrenMap = {};
    for (const item of phaseItems) {
      const wi = allWorkItems.find((w) => w.id === item.id);
      const parentId = wi?.parentWorkItemId;
      if (parentId && phaseItemIds.has(parentId)) {
        if (!childrenMap[parentId]) childrenMap[parentId] = [];
        childrenMap[parentId].push(item);
      } else {
        roots.push(item);
      }
    }
    function attachChildren(items) {
      return items.map((item) => ({
        ...item,
        children: attachChildren(childrenMap[item.id] || []),
      }));
    }
    return attachChildren(roots);
  }

  function renderItemTree(items, depth) {
    return items.map((item) => {
      const wi = workItems.find((w) => w.id === item.id);
      const rawStatus = wi?.status || 'backlog';
      return (
        <div key={item.id}>
          <div className="ct-wi-tree-row" style={{ paddingLeft: `${depth * 20 + 10}px` }}>
            <button
              type="button"
              className={`ct-status-toggle ct-status-toggle--${rawStatus === 'done' ? 'done' : rawStatus === 'in_progress' ? 'active' : 'idle'}`}
              title={`Status: ${item.statusLabel} — click to cycle`}
              onClick={(e) => { e.stopPropagation(); handleToggleItemStatus(item.id, rawStatus); }}
            />
            <button
              type="button"
              className={`ct-work-item-row${selectedWorkItemId === item.id ? ' is-selected' : ''}`}
              onClick={() => { setSelectedWorkItemId(item.id); setCtPanel(CT_PANELS.WORK_ITEMS); }}
            >
              <span className="ct-wi-title">{item.title}</span>
              <span className={`ct-type-badge ct-type-badge--${item.typeLabel?.toLowerCase() || 'task'}`}>{item.typeLabel}</span>
              <span className={`ct-status-label ct-status-label--${item.statusColor}`}>{item.statusLabel}</span>
            </button>
            <button className="ct-btn-ghost ct-btn-ghost--sm" title="Add follow-up" onClick={() => handleCreateFollowUp(item)}>+</button>
            <button className="ct-btn-ghost ct-btn-ghost--sm ct-btn-ghost--danger" title="Remove" onClick={(e) => { e.stopPropagation(); handleDeleteWorkItem(item.id); }}>&times;</button>
          </div>
          {item.children?.length > 0 && renderItemTree(item.children, depth + 1)}
        </div>
      );
    });
  }

  if (loading) {
    return (
      <section className="aris-workspace aris-workspace--loading">
        <div className="aris-empty-card">Loading ARIS workspace…</div>
      </section>
    );
  }

  return (
    <section className="aris-workspace ct-workspace">
      {error && <div className="error-banner"><span>{error}</span></div>}

      <div className="ct-layout">
        {/* ─── Left Sidebar: Projects ─── */}
        <aside className="ct-sidebar">
          <div className="ct-sidebar-header">
            <h2>ARIS</h2>
            <div className="ct-sidebar-actions">
              <button className="ct-btn ct-btn--icon" onClick={handleRefresh} disabled={loadingRuns} title="Refresh">
                {loadingRuns ? '...' : '\u21BB'}
              </button>
              <button className="ct-btn ct-btn--icon" onClick={handleOpenProjectManager} title="Manage Projects">+</button>
            </div>
          </div>

          <nav className="ct-project-list">
            {(contextData?.projects || []).map((project) => {
              const counts = projectAttentionCounts[project.id] || {};
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`ct-project-item${selectedProjectId === project.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <span className="ct-project-name">{project.name}</span>
                  <span className="ct-project-counts">
                    {counts.review > 0 && <span className="ct-count ct-count--review" title="Review ready">{counts.review}</span>}
                    {counts.active > 0 && <span className="ct-count ct-count--active" title="Active runs">{counts.active}</span>}
                    {counts.overdue > 0 && <span className="ct-count ct-count--overdue" title="Overdue">{counts.overdue}</span>}
                  </span>
                </button>
              );
            })}
            {(contextData?.projects || []).length === 0 && (
              <div className="ct-empty-hint">No projects yet</div>
            )}
          </nav>

          {/* Quick navigation */}
          <div className="ct-sidebar-nav">
            <button className={`ct-nav-item${ctPanel === CT_PANELS.OVERVIEW ? ' is-active' : ''}`} onClick={() => setCtPanel(CT_PANELS.OVERVIEW)}>Overview</button>
            <button className={`ct-nav-item${ctPanel === CT_PANELS.MY_DAY ? ' is-active' : ''}`} onClick={() => setCtPanel(CT_PANELS.MY_DAY)}>My Day</button>
            <button className={`ct-nav-item${ctPanel === CT_PANELS.WORK_ITEMS ? ' is-active' : ''}`} onClick={() => setCtPanel(CT_PANELS.WORK_ITEMS)}>Work Items</button>
            <button className={`ct-nav-item${ctPanel === CT_PANELS.RUNS ? ' is-active' : ''}`} onClick={() => setCtPanel(CT_PANELS.RUNS)}>Runs</button>
            <button className={`ct-nav-item${ctPanel === CT_PANELS.LAUNCHER ? ' is-active' : ''}`} onClick={() => setCtPanel(CT_PANELS.LAUNCHER)}>Launcher</button>
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="ct-main">
          {/* Attention bar */}
          {controlTowerCards.length > 0 && (
            <div className="ct-attention-bar">
              {controlTowerCards.slice(0, 5).map((card) => (
                <span key={card.id} className={`ct-attention-pill ct-attention-pill--${card.isUrgent ? 'urgent' : 'info'}`}>
                  {card.title}
                </span>
              ))}
            </div>
          )}

          {/* OVERVIEW PANEL */}
          {ctPanel === CT_PANELS.OVERVIEW && (
            <div className="ct-overview">
              <div className="ct-section-header">
                <h3>{selectedProject?.name || 'Select a Project'}</h3>
              </div>

              {/* Project progress summary */}
              {selectedProjectId && (() => {
                const visible = workItems.filter((w) => w.status !== 'canceled' && !w.archivedAt);
                const done = visible.filter((w) => w.status === 'done').length;
                const inProgress = visible.filter((w) => w.status === 'in_progress').length;
                const blocked = visible.filter((w) => w.status === 'blocked').length;
                const pending = visible.filter((w) => ['backlog', 'ready'].includes(w.status)).length;
                const review = visible.filter((w) => w.status === 'review').length;
                const projectRuns = runs.filter((r) => r.projectId === selectedProjectId);
                const activeRuns = projectRuns.filter((r) => r.status === 'running' || r.status === 'queued').length;
                const phasesWithItems = phaseGroupedItems.filter((p) => p.items.length > 0).length;
                const totalPhases = phaseGroupedItems.length;
                return (
                  <div className="ct-project-summary">
                    <div className="ct-summary-stats">
                      <div className="ct-stat">
                        <span className="ct-stat-value">{visible.length}</span>
                        <span className="ct-stat-label">Total</span>
                      </div>
                      <div className="ct-stat ct-stat--green">
                        <span className="ct-stat-value">{done}</span>
                        <span className="ct-stat-label">Done</span>
                      </div>
                      <div className="ct-stat ct-stat--blue">
                        <span className="ct-stat-value">{inProgress}</span>
                        <span className="ct-stat-label">Active</span>
                      </div>
                      <div className="ct-stat ct-stat--yellow">
                        <span className="ct-stat-value">{pending}</span>
                        <span className="ct-stat-label">Pending</span>
                      </div>
                      {blocked > 0 && (
                        <div className="ct-stat ct-stat--red">
                          <span className="ct-stat-value">{blocked}</span>
                          <span className="ct-stat-label">Blocked</span>
                        </div>
                      )}
                      {review > 0 && (
                        <div className="ct-stat ct-stat--amber">
                          <span className="ct-stat-value">{review}</span>
                          <span className="ct-stat-label">Review</span>
                        </div>
                      )}
                      <div className="ct-stat">
                        <span className="ct-stat-value">{activeRuns}</span>
                        <span className="ct-stat-label">Runs</span>
                      </div>
                    </div>
                    {visible.length > 0 && (
                      <div className="ct-summary-bar">
                        {done > 0 && <div className="ct-bar-seg ct-bar-seg--done" style={{ flex: done }} title={`${done} done`} />}
                        {inProgress > 0 && <div className="ct-bar-seg ct-bar-seg--active" style={{ flex: inProgress }} title={`${inProgress} in progress`} />}
                        {review > 0 && <div className="ct-bar-seg ct-bar-seg--review" style={{ flex: review }} title={`${review} review`} />}
                        {pending > 0 && <div className="ct-bar-seg ct-bar-seg--pending" style={{ flex: pending }} title={`${pending} pending`} />}
                        {blocked > 0 && <div className="ct-bar-seg ct-bar-seg--blocked" style={{ flex: blocked }} title={`${blocked} blocked`} />}
                      </div>
                    )}
                    <div className="ct-summary-detail">
                      {phasesWithItems}/{totalPhases} phases active &middot; {projectRuns.length} total runs
                    </div>
                  </div>
                );
              })()}

              {/* Active Claude Code Sessions — top 5 recent within 1 week */}
              {selectedProjectId && (() => {
                const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                const recent = localSessions
                  .filter((s) => !s.startedAt || new Date(s.startedAt).getTime() > oneWeekAgo)
                  .sort((a, b) => {
                    // Active sessions first, then by start time (newest first)
                    if (a.isActive && !b.isActive) return -1;
                    if (!a.isActive && b.isActive) return 1;
                    return new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
                  })
                  .slice(0, 5);
                if (recent.length === 0) return (
                  <div className="ct-sessions">
                    <div className="ct-section-header"><h4>Claude Code Sessions</h4></div>
                    <div className="ct-empty ct-empty--sm">No active sessions detected. Monitor pushes every 30s.</div>
                  </div>
                );
                const activeCount = recent.filter((s) => s.isActive).length;
                return (
                  <div className="ct-sessions">
                    <div className="ct-section-header">
                      <h4>Claude Code Sessions {activeCount > 0 && <span className="ct-active-badge">{activeCount} active</span>}</h4>
                      <span className="ct-section-meta">
                        {localSessionsUpdatedAt ? new Date(localSessionsUpdatedAt).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <div className="ct-session-list">
                      {recent.map((s) => (
                        <div key={s.pid} className={`ct-session-card${s.isActive ? ' is-active' : ''}${s.projectId === selectedProjectId ? ' is-current' : ''}`}>
                          <div className="ct-session-header">
                            <span className={`ct-session-indicator${s.isActive ? ' is-running' : ''}`} />
                            <span className="ct-session-project-name">{s.projectName || s.cwd?.split('/').pop() || 'Unknown'}</span>
                            <span className={`ct-session-model-badge ct-session-model-badge--${s.model}`}>{s.model}</span>
                            <span className={`ct-session-status${s.isActive ? ' is-active' : ''}`}>{s.isActive ? 'Running' : 'Idle'}</span>
                          </div>
                          <div className="ct-session-name">{s.sessionName || (s.startedAt ? `Session · ${new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Unnamed session')}</div>
                          <div className="ct-session-info">
                            <span title="Started">{s.startedAt ? new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : s.elapsed}</span>
                            <span title="Memory">{s.memMb}MB</span>
                            {s.cpu > 0.5 && <span className="ct-session-cpu" title="CPU">{s.cpu}%</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {localSessions.length > 5 && (
                      <div className="ct-session-overflow">{localSessions.length - 5} more sessions</div>
                    )}
                  </div>
                );
              })()}

              {/* Deadlines & Milestones */}
              {selectedProjectId && (() => {
                const deadlineMilestones = milestones.filter((m) => m.recurrence || m.dueAt);
                return (
                  <div className="ct-milestones-section">
                    <div className="ct-section-header">
                      <h4>Deadlines &amp; Milestones</h4>
                      <button className="ct-btn ct-btn--sm" onClick={() => setShowAddMilestone(true)}>+ Add</button>
                    </div>
                    {deadlineMilestones.length === 0 && !showAddMilestone && (
                      <div className="ct-empty ct-empty--sm">No deadlines or recurring milestones. Add one to help AI prioritize scheduling.</div>
                    )}
                    {deadlineMilestones.map((m) => (
                      <div key={m.id} className="ct-milestone-item">
                        <span className="ct-milestone-icon">{m.recurrence ? '🔄' : '🎯'}</span>
                        <div className="ct-milestone-info">
                          <span className="ct-milestone-name">{m.name}</span>
                          <span className="ct-milestone-meta">
                            {m.recurrence === 'weekly' ? `Every ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][m.recurrenceDay ?? 0]}` : m.dueAt ? new Date(m.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}
                          </span>
                        </div>
                        <button className="ct-btn-ghost ct-btn-ghost--sm ct-btn-ghost--danger" onClick={() => handleDeletePhase(m.id)}>&times;</button>
                      </div>
                    ))}
                    {showAddMilestone && (
                      <div className="ct-milestone-form">
                        <input type="text" placeholder="e.g. Group Meeting, Paper Deadline..." value={milestoneDraft.name} onChange={(e) => setMilestoneDraft({ ...milestoneDraft, name: e.target.value })} className="myday-form-input" autoFocus />
                        <select value={milestoneDraft.type} onChange={(e) => setMilestoneDraft({ ...milestoneDraft, type: e.target.value })} className="myday-form-select">
                          <option value="deadline">One-time Deadline</option>
                          <option value="recurring">Weekly Recurring</option>
                        </select>
                        {milestoneDraft.type === 'recurring' ? (
                          <select value={milestoneDraft.recurrenceDay} onChange={(e) => setMilestoneDraft({ ...milestoneDraft, recurrenceDay: e.target.value })} className="myday-form-select">
                            {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                              <option key={d} value={i}>{d}</option>
                            ))}
                          </select>
                        ) : (
                          <input type="date" value={milestoneDraft.dueAt} onChange={(e) => setMilestoneDraft({ ...milestoneDraft, dueAt: e.target.value })} className="myday-form-input" />
                        )}
                        <div className="ct-milestone-form-actions">
                          <button className="ct-btn ct-btn--primary ct-btn--sm" onClick={handleCreateMilestone}>Create</button>
                          <button className="ct-btn ct-btn--sm" onClick={() => setShowAddMilestone(false)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Research Phases */}
              {selectedProjectId && (
                <div className="ct-phases">
                  <div className="ct-phases-header">
                    <h4>Research Phases</h4>
                    <div className="ct-phases-header-actions">
                      {milestones.length === 0 && (
                        <button className="ct-btn ct-btn--sm" onClick={handleSeedPhases} disabled={seedingPhases}>
                          {seedingPhases ? 'Creating...' : 'Add Default Phases'}
                        </button>
                      )}
                      <button className="ct-btn ct-btn--sm" onClick={() => { setAddingPhase(true); setNewPhaseName(''); }}>+ Phase</button>
                    </div>
                  </div>

                  {/* Inline add phase */}
                  {addingPhase && (
                    <div className="ct-inline-edit">
                      <input
                        autoFocus
                        placeholder="Phase name..."
                        value={newPhaseName}
                        onChange={(e) => setNewPhaseName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') setAddingPhase(false); }}
                      />
                      <button className="ct-btn ct-btn--primary ct-btn--sm" onClick={handleAddPhase}>Add</button>
                      <button className="ct-btn ct-btn--sm" onClick={() => setAddingPhase(false)}>Cancel</button>
                    </div>
                  )}

                  {loadingMilestones ? (
                    <div className="ct-empty">Loading phases...</div>
                  ) : phaseGroupedItems.length === 0 ? (
                    <div className="ct-empty">No phases configured. Click &ldquo;Add Default Phases&rdquo; to set up ML research stages.</div>
                  ) : (
                    <div className="ct-phase-list">
                      {phaseGroupedItems.map((phase) => {
                        const isExpanded = expandedPhaseId === phase.id;
                        const isEditing = editingPhaseId === phase.id;
                        const doneCount = phase.items.filter((i) => i.statusColor === 'completed' || i.statusColor === 'green').length;
                        const totalCount = phase.items.length;
                        const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                        const phaseWorkItems = buildItemTree(phase.items, workItems);
                        return (
                          <div key={phase.id} className={`ct-phase${isExpanded ? ' is-expanded' : ''}`}>
                            <div className="ct-phase-header-row">
                              <button className="ct-phase-header" type="button" onClick={() => setExpandedPhaseId(isExpanded ? null : phase.id)}>
                                <span className="ct-phase-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                {isEditing ? (
                                  <input
                                    className="ct-phase-rename-input"
                                    autoFocus
                                    value={editingPhaseName}
                                    onChange={(e) => setEditingPhaseName(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleRenamePhase(phase.id, editingPhaseName); } if (e.key === 'Escape') setEditingPhaseId(null); }}
                                    onBlur={() => handleRenamePhase(phase.id, editingPhaseName)}
                                  />
                                ) : (
                                  <span className="ct-phase-name">{phase.name}</span>
                                )}
                                {totalCount > 0 && (
                                  <span className="ct-phase-progress">
                                    <span className="ct-progress-bar"><span className="ct-progress-fill" style={{ width: `${progressPct}%` }} /></span>
                                    <span className="ct-progress-text">{doneCount}/{totalCount}</span>
                                  </span>
                                )}
                                {totalCount === 0 && <span className="ct-phase-empty-label">No items</span>}
                              </button>
                              {phase.id !== '__unassigned__' && isExpanded && (
                                <div className="ct-phase-actions">
                                  <button className="ct-btn-ghost" title="Rename" onClick={(e) => { e.stopPropagation(); setEditingPhaseId(phase.id); setEditingPhaseName(phase.name); }}>&#9998;</button>
                                  <button className="ct-btn-ghost ct-btn-ghost--danger" title="Delete phase" onClick={(e) => { e.stopPropagation(); handleDeletePhase(phase.id); }}>&times;</button>
                                </div>
                              )}
                            </div>
                            {phase.description && isExpanded && <div className="ct-phase-desc">{phase.description}</div>}
                            {isExpanded && (
                              <div className="ct-phase-items">
                                {phaseWorkItems.length === 0 ? (
                                  <div className="ct-empty ct-empty--sm">No work items in this phase.</div>
                                ) : (
                                  renderItemTree(phaseWorkItems, 0)
                                )}
                                <button className="ct-add-item-btn" type="button" onClick={() => handleCreateWorkItem({ milestoneId: phase.id !== '__unassigned__' ? phase.id : '' })}>
                                  + Add item
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Review queue summary */}
              {reviewRows.length > 0 && (
                <div className="ct-review-summary">
                  <h4>Review Queue ({reviewRows.length})</h4>
                  <div className="ct-review-list">
                    {reviewRows.slice(0, 4).map((review) => (
                      <div key={review.id} className="ct-review-item">
                        <span className={`ct-status-dot ct-status-dot--review`} />
                        <span className="ct-review-title">{review.title}</span>
                        <span className={`ct-status-label ct-status-label--${review.statusColor}`}>{review.decisionLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Notes */}
              {selectedProjectId && (
                <div className="ct-quick-notes">
                  <h4>Quick Notes</h4>
                  <div className="ct-note-input-row">
                    <textarea
                      className="ct-note-input"
                      rows={2}
                      placeholder="Jot something down... (first line = title, Ctrl+Enter to save)"
                      value={quickNote}
                      onChange={(e) => setQuickNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveQuickNote(); } }}
                    />
                    <button className="ct-btn ct-btn--primary ct-btn--sm" onClick={handleSaveQuickNote} disabled={savingNote || !quickNote.trim()}>
                      {savingNote ? '...' : 'Save'}
                    </button>
                  </div>
                  {(() => {
                    const notes = workItemRows.filter((w) => {
                      const wi = workItems.find((x) => x.id === w.id);
                      return wi?.type === 'note';
                    }).slice(0, 5);
                    if (notes.length === 0) return null;
                    return (
                      <div className="ct-note-list">
                        {notes.map((n) => {
                          const wi = workItems.find((x) => x.id === n.id);
                          return (
                            <div key={n.id} className="ct-note-item">
                              <button type="button" className="ct-note-title" onClick={() => { setSelectedWorkItemId(n.id); setCtPanel(CT_PANELS.WORK_ITEMS); }}>
                                {n.title}
                              </button>
                              <span className="ct-note-time">{wi?.createdAt ? new Date(wi.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
                              <button className="ct-btn-ghost ct-btn-ghost--danger ct-btn-ghost--sm" onClick={() => handleDeleteWorkItem(n.id)}>&times;</button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Recent runs summary */}
              {runs.length > 0 && (
                <div className="ct-runs-summary">
                  <div className="ct-section-header">
                    <h4>Recent Runs</h4>
                    <button className="ct-btn ct-btn--sm" onClick={() => setCtPanel(CT_PANELS.RUNS)}>View All</button>
                  </div>
                  <div className="ct-run-mini-list">
                    {runCards.slice(0, 5).map((run) => (
                      <button key={run.id} type="button" className="ct-run-mini" onClick={() => { setSelectedRunId(run.id); setCtPanel(CT_PANELS.RUNS); }}>
                        <span className={`ct-status-dot ct-status-dot--${run.statusColor}`} />
                        <span className="ct-run-mini-title">{run.workflowLabel || run.title}</span>
                        <span className={`ct-status-label ct-status-label--${run.statusColor}`}>{run.statusLabel}</span>
                        {run.elapsedLabel && <span className="ct-elapsed">{run.elapsedLabel}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MY DAY PANEL */}
          {ctPanel === CT_PANELS.MY_DAY && (
            <div className="ct-my-day-panel">
              <div className="ct-section-header">
                <h3>My Day &mdash; {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
                <div className="ct-header-actions">
                  <button className="ct-btn ct-btn--sm" onClick={() => { fetchDailyTasks(); fetchOngoingItems(); fetchDayPlan(); fetchUpcomingMilestones(); }} disabled={loadingDailyTasks}>Refresh</button>
                  <button className="ct-btn ct-btn--primary ct-btn--sm" onClick={handleScheduleDay} disabled={schedulingDay}>
                    {schedulingDay ? 'Scheduling...' : 'Schedule My Day'}
                  </button>
                </div>
              </div>

              {/* ── Weekly Progress Summary ── */}
              {weeklyProgress.length > 0 && (
                <div className="myday-weekly-progress">
                  <h4 className="myday-section-title">Weekly Progress</h4>
                  <div className="myday-progress-grid">
                    {weeklyProgress.map((task) => {
                      const target = task.weeklyTarget || task.weeklyCredit || 7;
                      const pct = target > 0 ? Math.min(100, Math.round((task.completedThisWeek / target) * 100)) : 0;
                      return (
                        <div key={task.title} className={`myday-progress-card${task.isOnTrack ? ' is-on-track' : ''}`}>
                          <div className="myday-progress-header">
                            <span className="myday-progress-title">{task.title}</span>
                            <span className="myday-progress-count">
                              {task.completedThisWeek}/{target}
                              {task.totalTarget != null && task.dailyQuota > 0 && <span className="myday-daily-quota"> ({task.dailyQuota}/day)</span>}
                            </span>
                          </div>
                          <div className="myday-progress-bar-bg">
                            <div className="myday-progress-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Daily Tasks ── */}
              <div className="myday-section">
                <div className="myday-section-header">
                  <h4 className="myday-section-title">Daily Tasks</h4>
                  <button className="ct-btn ct-btn--sm" onClick={() => { setShowAddDailyTask(true); setEditingDailyTaskId(null); setDailyTaskDraft(createEmptyDailyTaskDraft()); }}>+ Add Task</button>
                </div>

                {loadingDailyTasks && <div className="ct-empty-hint">Loading...</div>}

                {!loadingDailyTasks && dailyTasks.length === 0 && (
                  <div className="ct-empty-hint">No daily tasks yet. Add tasks like reading papers, exercise, or leetcode practice.</div>
                )}

                <div className="myday-task-list">
                  {dailyTasks.map((task) => {
                    const todayCount = dailyCompletions.filter((c) => c.dailyTaskId === task.id).length;
                    const todayCompleted = todayCount > 0;
                    const progress = weeklyProgress.find((p) => p.title === task.title);
                    const hasTarget = task.totalTarget != null;
                    return (
                      <div key={task.id} className={`myday-task-row${todayCompleted ? ' is-done' : ''}`}>
                        {hasTarget ? (
                          <div className="myday-count-input">
                            <input
                              type="number"
                              className="myday-count-field"
                              min="0"
                              max={task.totalTarget || 99}
                              defaultValue={todayCount}
                              onBlur={(e) => {
                                const val = parseInt(e.target.value, 10) || 0;
                                if (val !== todayCount) handleToggleDailyCompletion(task.id, val);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                              title="How many did you complete today?"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={`myday-check${todayCompleted ? ' is-checked' : ''}`}
                            onClick={() => handleToggleDailyCompletion(task.id)}
                            title={todayCompleted ? 'Mark incomplete' : 'Mark complete'}
                          />
                        )}
                        <div className="myday-task-info">
                          <span className="myday-task-title">{task.title}</span>
                          <span className="myday-task-meta">
                            {categoryIcon(task.category)} {task.category} &middot; ~{task.estimatedMinutes}min &middot; {task.frequency}
                            {progress && hasTarget
                              ? ` · ${progress.completedThisWeek}/${progress.weeklyTarget} total (${progress.dailyQuota} today)`
                              : progress ? ` · ${progress.completedThisWeek}/${progress.weeklyTarget} this week` : ''}
                          </span>
                        </div>
                        <div className="myday-task-actions">
                          <button className="ct-btn-ghost ct-btn-ghost--sm" title="Edit" onClick={() => {
                            setEditingDailyTaskId(task.id);
                            setDailyTaskDraft(dailyTaskToDraft(task));
                            setShowAddDailyTask(true);
                          }}>Edit</button>
                          <button className="ct-btn-ghost ct-btn-ghost--sm ct-btn-ghost--danger" title="Delete" onClick={() => handleDeleteDailyTask(task.id)}>&times;</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Add/Edit Daily Task Form ── */}
              {showAddDailyTask && (
                <div className="myday-form-card">
                  <h4>{editingDailyTaskId ? 'Edit Task' : 'New Daily Task'}</h4>
                  <div className="myday-form-grid">
                    <label className="myday-form-label">
                      Title
                      <input type="text" className="myday-form-input" value={dailyTaskDraft.title} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, title: e.target.value })} placeholder="e.g. Read 2 papers" />
                    </label>
                    <label className="myday-form-label">
                      Category
                      <select className="myday-form-select" value={dailyTaskDraft.category} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, category: e.target.value })}>
                        {DAILY_TASK_CATEGORIES.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.icon} {cat.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="myday-form-label">
                      Frequency
                      <select className="myday-form-select" value={dailyTaskDraft.frequency} onChange={(e) => {
                        setDailyTaskDraft({ ...dailyTaskDraft, frequency: e.target.value });
                      }}>
                        {DAILY_TASK_FREQUENCIES.map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                    {dailyTaskDraft.frequency === 'weekly' && (
                      <label className="myday-form-label">
                        Day of Week
                        <select className="myday-form-select" value={dailyTaskDraft.weekday ?? ''} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, weekday: e.target.value === '' ? null : parseInt(e.target.value, 10) })}>
                          <option value="">Any day</option>
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                            <option key={d} value={i}>{d}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="myday-form-label">
                      Est. Minutes
                      <input type="number" className="myday-form-input" value={dailyTaskDraft.estimatedMinutes} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, estimatedMinutes: parseInt(e.target.value, 10) || 30 })} min="5" max="480" />
                    </label>
                    <label className="myday-form-label">
                      Weekly Target <span className="myday-form-hint">(optional)</span>
                      <input type="number" className="myday-form-input" value={dailyTaskDraft.totalTarget} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, totalTarget: e.target.value })} min="1" max="100" placeholder="e.g. 10 (leave empty for routine)" />
                    </label>
                    <label className="myday-form-label myday-form-label--full">
                      Description
                      <textarea className="myday-form-textarea" value={dailyTaskDraft.description} onChange={(e) => setDailyTaskDraft({ ...dailyTaskDraft, description: e.target.value })} placeholder="Optional notes..." rows={2} />
                    </label>
                  </div>
                  <div className="myday-form-actions">
                    <button className="ct-btn ct-btn--sm" onClick={() => { setShowAddDailyTask(false); setEditingDailyTaskId(null); }}>Cancel</button>
                    <button className="ct-btn ct-btn--primary ct-btn--sm" onClick={handleSaveDailyTask} disabled={savingDailyTask}>
                      {savingDailyTask ? 'Saving...' : editingDailyTaskId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Ongoing Work Items (Cross-Project) ── */}
              <div className="myday-section">
                <h4 className="myday-section-title">Ongoing Work Items</h4>
                {loadingOngoing && <div className="ct-empty-hint">Loading...</div>}
                {!loadingOngoing && ongoingItems.length === 0 && (
                  <div className="ct-empty-hint">No ongoing work items across projects.</div>
                )}
                <div className="myday-ongoing-list">
                  {ongoingItems.map((item) => {
                    const row = buildOngoingWorkItemRow(item);
                    return (
                      <div key={item.id} className="myday-ongoing-row">
                        <span className={`ct-status-dot ct-status-dot--${row.statusColor}`} />
                        <div className="myday-ongoing-info" onClick={() => { setSelectedProjectId(item.projectId); setSelectedWorkItemId(item.id); setCtPanel(CT_PANELS.WORK_ITEMS); }} style={{ cursor: 'pointer' }}>
                          <span className="myday-ongoing-title">{row.title}</span>
                          <span className="myday-ongoing-meta">
                            {row.projectName} &middot; {row.statusLabel}
                            {item.status === 'waiting' && ' (agent/experiment running)'}
                            {row.isOverdue && <span className="myday-overdue-badge">overdue</span>}
                          </span>
                        </div>
                        <div className="myday-item-actions">
                          <button className="myday-action-btn myday-action-btn--done-today" title="Done for today" onClick={(e) => { e.stopPropagation(); handleWorkItemAction(item.id, 'done_today'); }}>Today</button>
                          <button className="myday-action-btn myday-action-btn--waiting" title="Waiting (agent/experiment running)" onClick={(e) => { e.stopPropagation(); handleWorkItemAction(item.id, 'waiting'); }}>Wait</button>
                          <button className="myday-action-btn myday-action-btn--all-done" title="All finished" onClick={(e) => { e.stopPropagation(); handleWorkItemAction(item.id, 'all_done'); }}>Done</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Upcoming Milestones & Deadlines ── */}
              {upcomingMilestones.length > 0 && (
                <div className="myday-section">
                  <h4 className="myday-section-title">Upcoming Milestones</h4>
                  <div className="myday-milestone-list">
                    {upcomingMilestones.map((m) => (
                      <div key={m.id} className={`myday-milestone-row${m.isToday ? ' is-today' : ''}${m.daysUntil <= 3 && !m.isToday ? ' is-urgent' : ''}`}>
                        <span className="myday-milestone-icon">{m.type === 'recurring' ? '🔄' : '🎯'}</span>
                        <div className="myday-milestone-info">
                          <span className="myday-milestone-name">{m.name}</span>
                          <span className="myday-milestone-meta">
                            {m.projectName} &middot; {m.isToday ? 'Today' : m.daysUntil === 1 ? 'Tomorrow' : `in ${m.daysUntil} days`}
                            {m.type === 'recurring' && ` · ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][m.recurrenceDay]}s`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Day Plan (Generated Schedule) ── */}
              {dayPlan && dayPlan.items && dayPlan.items.length > 0 && (
                <div className="myday-section">
                  <div className="myday-section-header">
                    <h4 className="myday-section-title">Today&apos;s Schedule</h4>
                    <span className="myday-plan-summary">{dayPlan.summary}</span>
                  </div>
                  <div className="myday-schedule">
                    {dayPlan.items.map((item, idx) => {
                      const planItem = buildDayPlanItem(item);
                      return (
                        <div key={planItem.id || idx} className={`myday-schedule-item${planItem.sourceType === 'break' ? ' is-break' : ''}${planItem.isDone ? ' is-done' : ''}`}>
                          <div className="myday-schedule-time">{planItem.time}</div>
                          <div className="myday-schedule-content">
                            <span className="myday-schedule-title">
                              {planItem.categoryIcon} {planItem.title}
                            </span>
                            {planItem.description && <span className="myday-schedule-desc">{planItem.description}</span>}
                          </div>
                          <span className="myday-schedule-duration">{planItem.estimatedMinutes}min</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loadingDayPlan && <div className="ct-empty-hint">Loading day plan...</div>}
            </div>
          )}

          {/* WORK ITEMS PANEL */}
          {ctPanel === CT_PANELS.WORK_ITEMS && (
            <div className="ct-work-items-panel">
              <div className="ct-section-header">
                <div className="ct-header-left">
                  <button className="ct-back-btn" type="button" onClick={handleBack} title="Back">&larr;</button>
                  <h3>Work Items</h3>
                </div>
                <button className="ct-btn ct-btn--sm" type="button" onClick={handleCreateWorkItem}>+ New</button>
              </div>

              <div className="ct-wi-split">
                {/* Work item list */}
                <div className="ct-wi-list">
                  {loadingWorkItems ? (
                    <div className="ct-empty">Loading...</div>
                  ) : workItemRows.length === 0 ? (
                    <div className="ct-empty">No work items yet.</div>
                  ) : (
                    (() => {
                      const tree = buildItemTree(workItemRows, workItems);
                      return renderItemTree(tree, 0);
                    })()
                  )}
                </div>

                {/* Work item detail — view / edit mode */}
                <div className="ct-wi-detail">
                  {!workItemDraft.id && !wiEditMode ? (
                    <div className="ct-empty">Select an item or click + New</div>
                  ) : wiEditMode ? (
                    /* ── EDIT MODE ── */
                    <>
                      <div className="ct-section-header">
                        <h4>{workItemDraft.id ? 'Edit' : 'New'}</h4>
                        <div className="ct-header-actions">
                          <button className="ct-btn ct-btn--sm" type="button" onClick={() => { if (workItemDraft.id) setWiEditMode(false); }}>Cancel</button>
                          <button className="ct-btn ct-btn--primary ct-btn--sm" type="button" onClick={async () => { await handleSaveWorkItem(); setWiEditMode(false); }} disabled={savingWorkItem}>
                            {savingWorkItem ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>

                      {workItemDraft.parentWorkItemId && (
                        <div className="ct-parent-link">
                          Follow-up of: <strong>{workItems.find((w) => w.id === workItemDraft.parentWorkItemId)?.title || workItemDraft.parentWorkItemId}</strong>
                        </div>
                      )}

                      <div className="ct-form">
                        <input
                          className="ct-title-input"
                          autoFocus
                          placeholder="Item title..."
                          value={workItemDraft.title}
                          onChange={(e) => handleWorkItemFieldChange('title', e.target.value)}
                        />

                        <div className="ct-field-row ct-field-row--compact">
                          <select className="ct-inline-select" value={workItemDraft.type} onChange={(e) => handleWorkItemFieldChange('type', e.target.value)}>
                            <option value="task">Task</option>
                            <option value="experiment">Experiment</option>
                            <option value="hypothesis">Hypothesis</option>
                            <option value="analysis">Analysis</option>
                            <option value="paper">Paper</option>
                            <option value="research">Research</option>
                            <option value="bug">Bug</option>
                            <option value="note">Note</option>
                            <option value="question">Question</option>
                            <option value="decision">Decision</option>
                            <option value="ops">Ops</option>
                          </select>
                          <select className="ct-inline-select" value={workItemDraft.status} onChange={(e) => handleWorkItemFieldChange('status', e.target.value)}>
                            <option value="backlog">Backlog</option>
                            <option value="ready">Ready</option>
                            <option value="in_progress">In Progress</option>
                            <option value="waiting">Waiting</option>
                            <option value="review">Review</option>
                            <option value="blocked">Blocked</option>
                            <option value="parked">Parked</option>
                            <option value="done">Done</option>
                            <option value="canceled">Canceled</option>
                          </select>
                          <select className="ct-inline-select" value={workItemDraft.milestoneId} onChange={(e) => handleWorkItemFieldChange('milestoneId', e.target.value)}>
                            <option value="">No phase</option>
                            {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>

                        <textarea
                          className="ct-content-editor"
                          rows={14}
                          placeholder="Content (markdown supported)..."
                          value={workItemDraft.contextMd}
                          onChange={(e) => handleWorkItemFieldChange('contextMd', e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    /* ── VIEW MODE ── */
                    <>
                      <div className="ct-section-header">
                        <h4 className="ct-view-title">{workItemDraft.title}</h4>
                        <button className="ct-btn ct-btn--sm" type="button" onClick={() => setWiEditMode(true)}>Edit</button>
                      </div>

                      <div className="ct-view-meta">
                        <span className={`ct-type-badge ct-type-badge--${workItemDraft.type || 'task'}`}>
                          {workItemDraft.type ? workItemDraft.type.charAt(0).toUpperCase() + workItemDraft.type.slice(1) : 'Task'}
                        </span>
                        <span className={`ct-status-label ct-status-label--${workItemDraft.status === 'done' ? 'completed' : workItemDraft.status === 'in_progress' ? 'running' : 'queued'}`}>
                          {workItemDraft.status?.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'Backlog'}
                        </span>
                        {workItemDraft.milestoneId && (
                          <span className="ct-view-phase">{milestones.find((m) => m.id === workItemDraft.milestoneId)?.name || ''}</span>
                        )}
                      </div>

                      {workItemDraft.parentWorkItemId && (
                        <div className="ct-parent-link">
                          Follow-up of: <strong>{workItems.find((w) => w.id === workItemDraft.parentWorkItemId)?.title || ''}</strong>
                        </div>
                      )}

                      <div className="ct-view-content">
                        {workItemDraft.contextMd ? (
                          <MarkdownContent content={workItemDraft.contextMd} />
                        ) : (
                          <div className="ct-empty ct-empty--sm">No content yet. Click Edit to add details.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
      )}

      {ctPanel === CT_PANELS.LAUNCHER && (
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
      )}

      {ctPanel === CT_PANELS.LAUNCHER && showGpuPanel && (
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

      {ctPanel === CT_PANELS.RUNS && (
      <div className="aris-runs-detail-grid">
        <section className="aris-runs-panel">
          <div className="aris-panel-header">
            <div className="ct-header-left">
              <button className="ct-back-btn" type="button" onClick={handleBack} title="Back">&larr;</button>
              <h3>Recent Runs</h3>
            </div>
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
      )}

        </main>
      </div>{/* end ct-layout */}

      {showProjectManager && (
        <div className="aris-modal-backdrop" onClick={() => setShowProjectManager(false)}>
          <div className="aris-project-manager" onClick={(event) => event.stopPropagation()}>
            <button className="ct-modal-close" type="button" onClick={() => setShowProjectManager(false)} title="Close">&times;</button>
            <div className="aris-panel-header">
              <h3>Manage Projects</h3>
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
