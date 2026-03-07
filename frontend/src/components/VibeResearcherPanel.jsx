import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import GitLogEntry from '../models/GitLogEntry';
import VibeKnowledgeHubModal from './VibeKnowledgeHubModal';
import VibeHomeView from './vibe/VibeHomeView';
import VibeActivityFeedStrip from './vibe/VibeActivityFeedStrip';
import VibeRunDetailModal from './vibe/VibeRunDetailModal';
import VibeRunHistory from './vibe/VibeRunHistory';
import VibeTreeCanvas from './vibe/VibeTreeCanvas';
import VibePlanEditor from './vibe/VibePlanEditor';
import VibeNodeWorkbench from './vibe/VibeNodeWorkbench';
import QuickBashModal from './vibe/QuickBashModal';
import TodoNodeModal from './vibe/TodoNodeModal';
import JumpstartModal from './vibe/JumpstartModal';
import {
  applyOptimisticJumpstartTreeState,
  shouldShowProjectEntryGate,
} from './vibe/projectEntryGate';
import { getVibeUiMode } from './vibe/vibeUiMode';
import { DEFAULT_LAUNCHER_SKILL, getLauncherPromptPrefix } from './vibe/launcherRouting';
import { buildPayloadWithContinuation, addContinuationChip } from './vibe/launcherContinuation';
import { buildObservedSessionCards } from './vibe/observedSessionPresentation';
import { buildActivityFeed } from './vibe/activityFeedPresentation';
import { getPlanPatchFeedback } from './vibe/planPatchPresentation';
import { removeProjectRunsFromState } from './vibe/runHistoryState';
import { buildRecentRunCards, filterRunsForSelectedNode } from './vibe/runPresentation';
import { buildTreeExecutionSummary, getPrimaryTreeAction } from './vibe/treeExecutionSummary';
import { linkClientWorkspace } from '../hooks/useClientWorkspaceRegistry';

const SSH_BLOCKING_ERROR_CODES = new Set([
  'SSH_SERVER_NOT_FOUND',
  'SSH_AUTH_FAILED',
  'SSH_HOST_UNREACHABLE',
  'SSH_TIMEOUT',
  'SSH_COMMAND_FAILED',
  'REMOTE_PATH_NOT_FOUND',
  'REMOTE_NOT_DIRECTORY',
]);
const SSH_POLL_COOLDOWN_MS = 120000;
const TREE_ENDPOINT_COOLDOWN_MS = 15 * 60 * 1000;
const KB_LOCATOR_ENDPOINT_COOLDOWN_MS = 30 * 60 * 1000;
const kbLocatorEndpointCooldown = new Map();
const KB_RESOURCE_SEED_PATHS = [
  'paper_assets_index.md',
  'paper_assets_index.json',
  'notes.md',
  'research_questions.md',
  'proposal_zh.md',
];
const CODE_CHAT_SEED_PATHS = [
  'README.md',
  'docs/',
  'src/',
  'scripts/',
  'configs/',
  'tests/',
];
const KB_RESOURCE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'from',
  'about',
  'how',
  'what',
  'which',
  'when',
  'where',
  'why',
  'is',
  'are',
  'be',
  'can',
  'should',
  'could',
  'would',
  'please',
  'compare',
  'comparison',
  'differences',
  'difference',
  'scope',
  'summarize',
  'summary',
  'cite',
  'citation',
  'citations',
  'path',
  'paths',
  'file',
  'files',
  'resource',
  'resources',
  'between',
  'across',
]);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getApiErrorCode(error) {
  return cleanString(error?.response?.data?.code || '').toUpperCase();
}

function getApiStatus(error) {
  const status = Number(error?.response?.status || 0);
  return Number.isFinite(status) ? status : 0;
}

function createEmptyTreePlan(projectName = '') {
  return {
    version: 1,
    project: cleanString(projectName) || 'AutoResearch',
    vars: {},
    nodes: [],
  };
}

function createEmptyTreeState() {
  return {
    nodes: {},
    runs: {},
    queue: {
      paused: false,
      pausedReason: '',
      updatedAt: null,
      items: [],
    },
    search: {},
    updatedAt: null,
  };
}

function mapObservedSessionStatus(status = '') {
  const normalized = cleanString(status).toUpperCase();
  if (normalized === 'RUNNING') return 'RUNNING';
  if (normalized === 'FAILED') return 'FAILED';
  if (normalized === 'SUCCEEDED') return 'SUCCEEDED';
  return 'STALE';
}

function getProjectPathLabel(project = null) {
  if (!project || typeof project !== 'object') return 'linked workspace';
  return cleanString(project.projectPath)
    || cleanString(project.clientWorkspaceMeta?.displayName)
    || 'linked workspace';
}

function isTreeEndpointUnavailable(error) {
  const status = getApiStatus(error);
  if (status !== 404) return false;
  const code = getApiErrorCode(error);
  return !['PROJECT_NOT_FOUND', 'SSH_SERVER_NOT_FOUND'].includes(code);
}

function toProjectAccessDiagnostic(error, fallback) {
  const code = getApiErrorCode(error);
  const message = cleanString(error?.response?.data?.error || error?.message || fallback || 'Request failed');
  const detailByCode = {
    SSH_SERVER_NOT_FOUND: 'SSH server mapping is missing. Re-select the server by id/name in project settings.',
    SSH_AUTH_FAILED: 'SSH key authentication failed. Run SSH test and authorize the managed key on the target host.',
    SSH_HOST_UNREACHABLE: 'Remote SSH host is unreachable. Check FRP tunnel, host, and SSH port.',
    SSH_TIMEOUT: 'SSH request timed out. Verify network route and host load, then retry.',
    REMOTE_PATH_NOT_FOUND: 'Configured remote project path does not exist on the SSH host.',
    REMOTE_NOT_DIRECTORY: 'Configured remote path exists but is not a directory.',
  };
  if (!code) return message;
  const detail = detailByCode[code] || '';
  return detail ? `${code}: ${message} (${detail})` : `${code}: ${message}`;
}

function isSshAccessFailure(error) {
  const code = cleanString(error?.response?.data?.code || '').toUpperCase();
  if (code && SSH_BLOCKING_ERROR_CODES.has(code)) return true;
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 502) return true;
  const message = cleanString(error?.response?.data?.error || error?.message || '').toUpperCase();
  return message.includes('SSH_') || message.includes('REMOTE_PATH');
}

function isKbLocatorEndpointInCooldown(projectId = '') {
  const pid = cleanString(projectId);
  if (!pid) return false;
  const until = Number(kbLocatorEndpointCooldown.get(pid) || 0);
  return Number.isFinite(until) && until > Date.now();
}

function markKbLocatorEndpointCooldown(projectId = '') {
  const pid = cleanString(projectId);
  if (!pid) return;
  kbLocatorEndpointCooldown.set(pid, Date.now() + KB_LOCATOR_ENDPOINT_COOLDOWN_MS);
}

function tokenizeKbResourceQuery(query = '', maxTokens = 8) {
  const normalized = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-./\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const rawTokens = normalized
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 2)
    .filter((item) => !KB_RESOURCE_STOPWORDS.has(item));
  const out = [];
  const seen = new Set();
  for (const token of rawTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= maxTokens) break;
  }
  return out;
}

function scoreKbResourcePath(relativePath = '', query = '', tokens = []) {
  const rel = String(relativePath || '').trim();
  if (!rel) return 0;
  const relLower = rel.toLowerCase();
  const segments = relLower.split('/').filter(Boolean);
  const fileLower = segments[segments.length - 1] || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const depth = segments.length;
  const q = String(query || '').trim().toLowerCase();
  const paperIntent = /\b(paper|benchmark|bench|compare|comparison|scope|dataset|datasets|result|results|analysis|review|evidence|citation)\b/.test(q);
  const codeIntent = /\b(code|script|implementation|api|function|class|module|debug|fix|patch)\b/.test(q);
  let score = 0;
  if (q && relLower.includes(q)) score += 9;
  tokens.forEach((token) => {
    if (!token) return;
    if (relLower.includes(token)) {
      score += 2;
      if (fileLower.includes(token)) score += 1.2;
      if (fileLower.startsWith(token)) score += 0.8;
    }
  });
  if (KB_RESOURCE_SEED_PATHS.some((seed) => seed.toLowerCase() === fileLower)) score += 1.8;
  if (fileLower === 'readme.md') score += 4.6;
  if (fileLower.endsWith('meta.json')) score += 1.8;
  if (relLower.includes('/arxiv_source/meta.json')) score += 2.2;
  if (fileLower.endsWith('.pdf')) score += 3.4;
  if (fileLower === 'paper.pdf') score += 4.0;
  if (fileLower.endsWith('bench.pdf')) score += 2.0;
  if (fileLower.endsWith('.md')) score += 0.9;
  if (depth <= 2) score += 1.4;
  if (depth > 4) score -= (depth - 4) * 0.45;
  if (relLower.includes('/arxiv_source/src/')) score -= 3.4;
  if (fileLower.endsWith('.pdf') && relLower.includes('/arxiv_source/src/')) score -= 3.2;
  if (/(^|\/)(fig|figs|images|img|plots)\//.test(relLower)) score -= 3.4;
  if (fileLower.includes('favicon')) score -= 3.0;
  if (fileLower.includes('source.bundle')) score -= 4.2;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty'].includes(ext)) score -= 2.6;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) score -= 3.4;
  if (paperIntent && ['.md', '.pdf', '.json', '.txt'].includes(ext)) score += 2.2;
  if (paperIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score -= 1.6;
  if (codeIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score += 1.4;
  return Number(score.toFixed(3));
}

function isEligibleKbResourcePath(relativePath = '') {
  const rel = String(relativePath || '').trim();
  if (!rel) return false;
  const relLower = rel.toLowerCase();
  const fileLower = relLower.split('/').filter(Boolean).pop() || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  if (relLower.includes('/arxiv_source/src/')) return false;
  if (/(^|\/)(fig|figs|images|img|plots|assets)\//.test(relLower)) return false;
  if (fileLower.includes('source.bundle') || fileLower.includes('favicon')) return false;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty', '.ipynb'].includes(ext)) return false;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) return false;
  return true;
}

function rankKbResourceCandidates(paths = [], query = '', tokens = [], limit = 12) {
  const cap = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const scored = new Map();
  paths.forEach((item) => {
    const filePath = String(item || '').trim();
    if (!filePath) return;
    if (!isEligibleKbResourcePath(filePath)) return;
    const score = scoreKbResourcePath(filePath, query, tokens);
    if (score <= 0) return;
    if (!scored.has(filePath) || score > scored.get(filePath)) {
      scored.set(filePath, score);
    }
  });
  const ranked = Array.from(scored.entries())
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });
  const perFolderLimit = 3;
  const folderCount = new Map();
  const out = [];
  for (const item of ranked) {
    const topFolder = String(item.path || '').split('/')[0] || item.path;
    const used = folderCount.get(topFolder) || 0;
    if (used >= perFolderLimit) continue;
    folderCount.set(topFolder, used + 1);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

function isEligibleCodePath(relativePath = '') {
  const rel = String(relativePath || '').trim();
  if (!rel) return false;
  const relLower = rel.toLowerCase();
  const fileLower = relLower.split('/').filter(Boolean).pop() || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  if (
    relLower.startsWith('.git/')
    || relLower.startsWith('resource/')
    || relLower.startsWith('.researchops/state.json')
  ) return false;
  if (/(^|\/)(node_modules|dist|build|coverage|\.next|out|\.venv|venv|__pycache__)($|\/)/.test(relLower)) return false;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.mov', '.zip', '.tar', '.gz', '.pdf', '.bin'].includes(ext)) return false;
  return true;
}

function scoreCodePath(relativePath = '', query = '', tokens = []) {
  const rel = String(relativePath || '').trim();
  if (!rel) return 0;
  const relLower = rel.toLowerCase();
  const fileLower = relLower.split('/').filter(Boolean).pop() || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const q = String(query || '').toLowerCase();
  let score = 0;
  if (q && relLower.includes(q)) score += 8.5;
  tokens.forEach((token) => {
    if (!token) return;
    if (relLower.includes(token)) score += 2.4;
    if (fileLower.includes(token)) score += 1.1;
  });
  if (/(^|\/)(src|scripts|configs|tests|docs)\//.test(relLower)) score += 1.6;
  if (fileLower === 'readme.md') score += 3.2;
  if (fileLower === 'package.json' || fileLower === 'pyproject.toml') score += 2.4;
  if (['.py', '.ts', '.tsx', '.js', '.jsx', '.sh', '.yaml', '.yml', '.json', '.toml', '.md'].includes(ext)) score += 1.8;
  if (['.lock', '.log', '.tmp', '.cache'].includes(ext)) score -= 2.8;
  if (relLower.startsWith('resource/')) score -= 4.0;
  return Number(score.toFixed(3));
}

function rankCodePathCandidates(paths = [], query = '', tokens = [], limit = 10) {
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 40);
  const scored = new Map();
  paths.forEach((item) => {
    const filePath = String(item || '').trim();
    if (!filePath || !isEligibleCodePath(filePath)) return;
    const score = scoreCodePath(filePath, query, tokens);
    if (score <= 0) return;
    if (!scored.has(filePath) || score > scored.get(filePath)) {
      scored.set(filePath, score);
    }
  });
  return Array.from(scored.entries())
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    })
    .slice(0, cap);
}

// ─── Module-level mention search cache ───────────────────────────────────────
// Lives outside the component so it persists across re-renders and project
// switches (keyed by projectId). Max 400 entries; oldest 80 evicted when full.
const _MENTION_TTL = 5 * 60 * 1000; // 5 min
const _mentionCache = new Map(); // key: "pid:query" → { items: string[], ts: number }

function _mentionGet(pid, q) {
  const hit = _mentionCache.get(`${pid}:${q}`);
  return hit && Date.now() - hit.ts < _MENTION_TTL ? hit.items : null;
}
function _mentionSet(pid, q, items) {
  _mentionCache.set(`${pid}:${q}`, { items, ts: Date.now() });
  if (_mentionCache.size > 400) {
    const oldest = [..._mentionCache.keys()].slice(0, 80);
    oldest.forEach((k) => _mentionCache.delete(k));
  }
}
// If we have a cached result for a prefix of q, filter it client-side.
// Avoids a network round-trip when the user just typed another character.
function _mentionGetByPrefix(pid, q) {
  const ql = q.toLowerCase();
  for (let n = q.length - 1; n >= 2; n--) {
    const items = _mentionGet(pid, q.slice(0, n));
    if (items) return items.filter((p) => p.toLowerCase().includes(ql));
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

function VibeResearcherPanel({
  apiUrl,
  getAuthHeaders,
  onOpenPaperLibrary,
  isSimplifiedAlpha = false,
  projectTemplates = [],
}) {
  const [projects, setProjects] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [queue, setQueue] = useState([]);
  const [runs, setRuns] = useState([]);
  const [observedSessions, setObservedSessions] = useState([]);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingSsh, setLoadingSsh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncingSkills, setSyncingSkills] = useState(false);
  const [checkingPath, setCheckingPath] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [showCreateIdeaModal, setShowCreateIdeaModal] = useState(false);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [showKbFolderModal, setShowKbFolderModal] = useState(false);
  const [showEnqueueRunModal, setShowEnqueueRunModal] = useState(false);
  const [showKnowledgeHubModal, setShowKnowledgeHubModal] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null); // { id, name } | null
  const [skillEditorContent, setSkillEditorContent] = useState('');
  const [skillEditorLoading, setSkillEditorLoading] = useState(false);
  const [skillEditorSaving, setSkillEditorSaving] = useState(false);
  const [skillEditorError, setSkillEditorError] = useState('');
  const [showQuickBash, setShowQuickBash] = useState(false);
  const [showJumpstart, setShowJumpstart] = useState(false);
  const [todoNodeTarget, setTodoNodeTarget] = useState(null); // { todo } | null
  const [todoCardsExpanded, setTodoCardsExpanded] = useState(false);
  const [todoEditTarget, setTodoEditTarget] = useState(null); // { todo } | null
  const [todoEditTitle, setTodoEditTitle] = useState('');
  const [todoEditHypothesis, setTodoEditHypothesis] = useState('');
  const [todoEditBusy, setTodoEditBusy] = useState(false);
  const [showInsertStepModal, setShowInsertStepModal] = useState(false);
  const [insertStepJson, setInsertStepJson] = useState('');
  const [showCheckpointEditModal, setShowCheckpointEditModal] = useState(false);
  const [checkpointEditId, setCheckpointEditId] = useState(null);
  const [checkpointEditNote, setCheckpointEditNote] = useState('');
  const [checkpointEditJson, setCheckpointEditJson] = useState('');
  const [checkpointEditJsonError, setCheckpointEditJsonError] = useState('');
  const [sshServers, setSshServers] = useState([]);
  const [gitProgress, setGitProgress] = useState(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState('');
  const [gitLogLimit, setGitLogLimit] = useState(5);
  const gitLogLimitRef = useRef(5);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [changedFiles, setChangedFiles] = useState(null);
  const [changedFilesLoading, setChangedFilesLoading] = useState(false);
  const [changedFilesError, setChangedFilesError] = useState('');
  const selectedProjectRef = useRef('');
  const sshPollCooldownRef = useRef(new Map());
  const treeEndpointCooldownRef = useRef(new Map());
  const projectInsightsInFlightRef = useRef(new Set());
  const projectFileTreeInFlightRef = useRef(new Set());
  const treeWorkspaceInFlightRef = useRef(new Set());

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectLocationType, setProjectLocationType] = useState('local');
  const [projectServerId, setProjectServerId] = useState('');
  const [projectClientMode, setProjectClientMode] = useState('agent');
  const [projectClientDeviceId, setProjectClientDeviceId] = useState('');
  const [projectClientWorkspaceId, setProjectClientWorkspaceId] = useState('');
  const [projectClientWorkspaceName, setProjectClientWorkspaceName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [pathCheckResult, setPathCheckResult] = useState(null);
  const [clientDevices, setClientDevices] = useState([]);
  const [loadingClientDevices, setLoadingClientDevices] = useState(false);
  const [clientBootstrapOpen, setClientBootstrapOpen] = useState(false);
  const [clientBootstrapBusy, setClientBootstrapBusy] = useState(false);
  const [clientBootstrapData, setClientBootstrapData] = useState(null);
  const [clientBootstrapStatus, setClientBootstrapStatus] = useState('idle');
  const [clientBootstrapRequestedHostname, setClientBootstrapRequestedHostname] = useState('');
  const [clientBootstrapMessage, setClientBootstrapMessage] = useState('');

  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaHypothesis, setIdeaHypothesis] = useState('');
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDetails, setTodoDetails] = useState('');
  const [todoPrompt, setTodoPrompt] = useState('');
  const [todoBusy, setTodoBusy] = useState(false);
  const [kbSetupMode, setKbSetupMode] = useState('resource');
  const [kbSelectedGroupId, setKbSelectedGroupId] = useState('');
  const [kbSyncBusy, setKbSyncBusy] = useState(false);
  const [kbSyncJob, setKbSyncJob] = useState(null);

  const [runServerId, setRunServerId] = useState('local-default');
  const [runType, setRunType] = useState('AGENT');
  const [runPrompt, setRunPrompt] = useState('');
  const [runExperimentCommand, setRunExperimentCommand] = useState('');
  const [pinnedAssetIds, setPinnedAssetIds] = useState([]);
  const [agentSkill, setAgentSkill] = useState(DEFAULT_LAUNCHER_SKILL);
  const [runProvider, setRunProvider] = useState('codex_cli'); // codex_cli | claude_code_cli
  const [runModel, setRunModel] = useState(''); // empty = use server default
  const [runReasoningEffort, setRunReasoningEffort] = useState('high'); // low | medium | high | extra-high

  const [selectedRunId, setSelectedRunId] = useState('');
  const [runReport, setRunReport] = useState(null);
  const [runReportLoading, setRunReportLoading] = useState(false);
  const [runContextPack, setRunContextPack] = useState(null);
  const [runContextPackLoading, setRunContextPackLoading] = useState(false);
  const [showRunDetailModal, setShowRunDetailModal] = useState(false);
  const [observedSessionsLoading, setObservedSessionsLoading] = useState(false);
  const [observedSessionRefreshingId, setObservedSessionRefreshingId] = useState('');
  const [launcherContinuationChips, setLauncherContinuationChips] = useState([]);
  const [checkpointActionLoadingId, setCheckpointActionLoadingId] = useState(null);

  const [knowledgeGroups, setKnowledgeGroups] = useState([]);
  const [knowledgeGroupsLoading, setKnowledgeGroupsLoading] = useState(false);
  const [projectFileTree, setProjectFileTree] = useState(null);
  const [projectFileTreeLoading, setProjectFileTreeLoading] = useState(false);
  const [projectFileTreeError, setProjectFileTreeError] = useState('');
  const [projectFileContent, setProjectFileContent] = useState(null);
  const [projectFileContentLoading, setProjectFileContentLoading] = useState(false);
  const [projectFileContentError, setProjectFileContentError] = useState('');
  const [kbFileTree, setKbFileTree] = useState(null);
  const [kbFileTreeLoading, setKbFileTreeLoading] = useState(false);
  const [kbFileTreeError, setKbFileTreeError] = useState('');
  const [kbFileContent, setKbFileContent] = useState(null);
  const [kbFileContentLoading, setKbFileContentLoading] = useState(false);
  const [kbFileContentError, setKbFileContentError] = useState('');
  const [aiEditTarget, setAiEditTarget] = useState('');
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [fileMentionOptions, setFileMentionOptions] = useState([]);
  const [fileMentionLoading, setFileMentionLoading] = useState(false);
  const [promptMentionOptions, setPromptMentionOptions] = useState([]);
  const [promptMentionLoading, setPromptMentionLoading] = useState(false);
  const [promptMentionIdx, setPromptMentionIdx] = useState(-1);
  const [codeChatPrompt, setCodeChatPrompt] = useState('');
  const [proposalUploadBusy, setProposalUploadBusy] = useState(false);
  const [showKickoffPromptGenerate, setShowKickoffPromptGenerate] = useState(false);
  const [kickoffAiPrompt, setKickoffAiPrompt] = useState('');
  const kickoffProposalFileInputRef = useRef(null);
  const promptTextareaRef = useRef(null);
  const promptCursorRef = useRef(0);
  const [showAutopilotModal, setShowAutopilotModal] = useState(false);
  const [autopilotProposal, setAutopilotProposal] = useState('');
  const [autopilotMaxIter, setAutopilotMaxIter] = useState(10);
  const [autopilotServerId, setAutopilotServerId] = useState('local-default');
  const [autopilotSkill, setAutopilotSkill] = useState('implement');
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const [autopilotSession, setAutopilotSession] = useState(null);
  const autopilotPollRef = useRef(null);

  const [treePlan, setTreePlan] = useState(null);
  const [treeValidation, setTreeValidation] = useState(null);
  const [treeState, setTreeState] = useState(null);
  const [treeWorkspaceReady, setTreeWorkspaceReady] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [treeRootSummary, setTreeRootSummary] = useState(null);
  const [treeEnvironmentDetected, setTreeEnvironmentDetected] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const selectedNodeIdRef = useRef('');
  const [planMode, setPlanMode] = useState('view');
  const [planViewMode, setPlanViewMode] = useState('canvas');
  const [runAllScope, setRunAllScope] = useState('active_path');
  const [searchData, setSearchData] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [rootBootstrapBusy, setRootBootstrapBusy] = useState(false);

  const [runHistoryItems, setRunHistoryItems] = useState([]);
  const [runHistoryCursor, setRunHistoryCursor] = useState('');
  const [runHistoryHasMore, setRunHistoryHasMore] = useState(false);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryLoadingMore, setRunHistoryLoadingMore] = useState(false);
  const runHistoryCursorRef = useRef('');
  const runHistoryHasMoreRef = useRef(false);
  const runHistoryLoadingMoreRef = useRef(false);
  const loadProjectInsightsRef = useRef(null);
  const loadProjectFileTreeRef = useRef(null);
  const loadTreeWorkspaceRef = useRef(null);
  const loadRunHistoryPageRef = useRef(null);

  const [bottomLeftTab, setBottomLeftTab] = useState('knowledge');

  const headers = useMemo(() => getAuthHeaders?.() || {}, [getAuthHeaders]);
  const vibeUiMode = useMemo(
    () => getVibeUiMode({ simplifiedAlphaMode: isSimplifiedAlpha }),
    [isSimplifiedAlpha]
  );
  const isProjectPollingBlocked = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return false;
    const until = Number(sshPollCooldownRef.current.get(key) || 0);
    return until > Date.now();
  }, []);

  const markProjectPollingBlocked = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return;
    sshPollCooldownRef.current.set(key, Date.now() + SSH_POLL_COOLDOWN_MS);
  }, []);

  const clearProjectPollingBlock = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return;
    sshPollCooldownRef.current.delete(key);
  }, []);

  const isTreeEndpointCooldown = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return false;
    const until = Number(treeEndpointCooldownRef.current.get(key) || 0);
    return until > Date.now();
  }, []);

  const markTreeEndpointCooldown = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return;
    treeEndpointCooldownRef.current.set(key, Date.now() + TREE_ENDPOINT_COOLDOWN_MS);
  }, []);

  const clearTreeEndpointCooldown = useCallback((projectId) => {
    const key = cleanString(projectId);
    if (!key) return;
    treeEndpointCooldownRef.current.delete(key);
  }, []);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      let nextProjects = [];
      let nextIdeas = [];
      let nextQueue = [];
      let nextRuns = [];
      let nextSkills = [];

      try {
        const dashboardRes = await axios.get(`${apiUrl}/researchops/dashboard`, {
          headers,
          params: { projectLimit: 300, itemLimit: 200 },
        });
        nextProjects = dashboardRes.data?.projects || [];
        nextIdeas = dashboardRes.data?.ideas || [];
        nextQueue = dashboardRes.data?.queue || [];
        nextRuns = dashboardRes.data?.runs || [];
        nextSkills = dashboardRes.data?.skills || [];
        if (nextRuns.length === 0) {
          const runsRes = await axios.get(`${apiUrl}/researchops/runs?limit=200`, { headers });
          nextRuns = runsRes.data?.items || [];
        }
      } catch (dashboardError) {
        if (dashboardError?.response?.status !== 404) throw dashboardError;
        const [projectsRes, ideasRes, queueRes, runsRes, skillsRes] = await Promise.all([
          axios.get(`${apiUrl}/researchops/projects`, { headers, params: { limit: 200 } }),
          axios.get(`${apiUrl}/researchops/ideas?limit=50`, { headers }),
          axios.get(`${apiUrl}/researchops/scheduler/queue?limit=50`, { headers }),
          axios.get(`${apiUrl}/researchops/runs?limit=200`, { headers }),
          axios.get(`${apiUrl}/researchops/skills`, { headers }),
        ]);
        nextProjects = projectsRes.data?.items || [];
        nextIdeas = ideasRes.data?.items || [];
        nextQueue = queueRes.data?.items || [];
        nextRuns = runsRes.data?.items || [];
        nextSkills = skillsRes.data?.items || [];
      }

      const stickyProjectId = String(selectedProjectRef.current || '').trim();
      let stickyProjectMissing = false;
      if (stickyProjectId && !nextProjects.some((project) => project.id === stickyProjectId)) {
        try {
          const stickyProjectRes = await axios.get(`${apiUrl}/researchops/projects/${stickyProjectId}`, { headers });
          const stickyProject = stickyProjectRes.data?.project || null;
          if (stickyProject?.id) {
            nextProjects = [stickyProject, ...nextProjects.filter((project) => project.id !== stickyProject.id)];
          } else {
            stickyProjectMissing = true;
          }
        } catch (stickyError) {
          if (stickyError?.response?.status === 404) {
            stickyProjectMissing = true;
          } else {
            console.warn('Failed to fetch selected project fallback:', stickyError?.message || stickyError);
          }
        }
      }

      setProjects(nextProjects);
      setIdeas(nextIdeas);
      setQueue(nextQueue);
      setRuns(nextRuns);
      setSkills(nextSkills);
      setSelectedProjectId((prev) => (
        !prev
          ? ''
          : (nextProjects.some((project) => project.id === prev)
              ? prev
              : (stickyProjectMissing ? '' : prev))
      ));
      setPollPaused(false);
    } catch (err) {
      console.error('Failed to load ResearchOps data:', err);
      const status = err?.response?.status;
      if (status === 429) {
        setPollPaused(true);
        setError('Hit API rate limit. Auto-refresh has been paused; use manual actions for now.');
      } else if (status === 401 || status === 403) {
        setPollPaused(true);
        setError('Session is no longer valid. Please sign in again.');
      } else {
        setError(err?.response?.data?.error || err?.message || 'Failed to load Vibe Researcher data');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiUrl, headers]);

  useEffect(() => {
    gitLogLimitRef.current = gitLogLimit;
  }, [gitLogLimit]);

  useEffect(() => {
    runHistoryCursorRef.current = runHistoryCursor;
  }, [runHistoryCursor]);

  useEffect(() => {
    runHistoryHasMoreRef.current = runHistoryHasMore;
  }, [runHistoryHasMore]);

  useEffect(() => {
    runHistoryLoadingMoreRef.current = runHistoryLoadingMore;
  }, [runHistoryLoadingMore]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const loadProjectInsights = useCallback(async (projectId, { silent = false, gitLimit = null, force = false } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    if (!force && isProjectPollingBlocked(targetProjectId)) return;
    const normalizedGitLimitRaw = Number.isFinite(Number(gitLimit))
      ? Number(gitLimit)
      : Number(gitLogLimitRef.current);
    const normalizedGitLimit = Math.min(Math.max(Math.floor(normalizedGitLimitRaw) || 5, 1), 200);
    const inFlightKey = `${targetProjectId}:${normalizedGitLimit}`;
    if (projectInsightsInFlightRef.current.has(inFlightKey)) return;
    projectInsightsInFlightRef.current.add(inFlightKey);

    if (!silent) {
      setGitLoading(true);
      setChangedFilesLoading(true);
    }
    setGitError('');
    setChangedFilesError('');

    try {
      const [gitResult, changedFilesResult] = await Promise.allSettled([
        axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/git-log`, {
          headers,
          params: { limit: normalizedGitLimit },
        }),
        axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/changed-files`, {
          headers,
          params: { limit: 200 },
        }),
      ]);

      if (selectedProjectRef.current !== targetProjectId) return;

      if (gitResult.status === 'fulfilled') {
        const payload = gitResult.value?.data || {};
        const commits = Array.isArray(payload.commits)
          ? payload.commits.map((item) => GitLogEntry.fromApi(item))
          : [];
        setGitProgress({ ...payload, commits });
        setGitError('');
        clearProjectPollingBlock(targetProjectId);
      } else {
        const code = getApiErrorCode(gitResult.reason);
        if (!silent || !SSH_BLOCKING_ERROR_CODES.has(code)) {
          console.error('Failed to load project git progress:', gitResult.reason);
        }
        setGitProgress(null);
        setGitError(toProjectAccessDiagnostic(gitResult.reason, 'Failed to load git progress'));
        if (SSH_BLOCKING_ERROR_CODES.has(code)) {
          markProjectPollingBlocked(targetProjectId);
        }
      }

      if (changedFilesResult.status === 'fulfilled') {
        setChangedFiles(changedFilesResult.value?.data || null);
        setChangedFilesError('');
      } else {
        const code = getApiErrorCode(changedFilesResult.reason);
        if (!silent || !SSH_BLOCKING_ERROR_CODES.has(code)) {
          console.error('Failed to load project changed files:', changedFilesResult.reason);
        }
        setChangedFiles(null);
        setChangedFilesError(toProjectAccessDiagnostic(changedFilesResult.reason, 'Failed to load changed files'));
        if (SSH_BLOCKING_ERROR_CODES.has(code)) {
          markProjectPollingBlocked(targetProjectId);
        }
      }
    } finally {
      projectInsightsInFlightRef.current.delete(inFlightKey);
      if (!silent) {
        setGitLoading(false);
        setChangedFilesLoading(false);
      }
    }
  }, [
    apiUrl,
    clearProjectPollingBlock,
    headers,
    isProjectPollingBlocked,
    markProjectPollingBlocked,
  ]);

  const loadProjectFileTree = useCallback(async (
    projectId,
    relativePath = '',
    { silent = false, force = false } = {}
  ) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    if (!force && isProjectPollingBlocked(targetProjectId)) return;
    const normalizedRelativePath = cleanString(relativePath);
    const inFlightKey = `${targetProjectId}:${normalizedRelativePath}`;
    if (projectFileTreeInFlightRef.current.has(inFlightKey)) return;
    projectFileTreeInFlightRef.current.add(inFlightKey);
    if (!silent) {
      setProjectFileTreeLoading(true);
      setFilesLoading(true);
    }
    setProjectFileTreeError('');
    setFilesError('');
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/tree`, {
        headers,
        params: {
          path: relativePath || '',
          limit: 240,
        },
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      setProjectFileTree(response.data || null);
      setFilesError('');
      clearProjectPollingBlock(targetProjectId);
    } catch (err) {
      const code = getApiErrorCode(err);
      if (!silent || !SSH_BLOCKING_ERROR_CODES.has(code)) {
        console.error('Failed to load project file tree:', err);
      }
      setProjectFileTree(null);
      const diagnostic = toProjectAccessDiagnostic(err, 'Failed to load project files');
      setProjectFileTreeError(diagnostic);
      setFilesError(diagnostic);
      if (SSH_BLOCKING_ERROR_CODES.has(code)) {
        markProjectPollingBlocked(targetProjectId);
      }
    } finally {
      projectFileTreeInFlightRef.current.delete(inFlightKey);
      if (!silent) {
        setProjectFileTreeLoading(false);
        setFilesLoading(false);
      }
    }
  }, [
    apiUrl,
    clearProjectPollingBlock,
    headers,
    isProjectPollingBlocked,
    markProjectPollingBlocked,
  ]);

  const loadProjectFileContent = useCallback(async (projectId, relativePath) => {
    const targetProjectId = String(projectId || '').trim();
    const safePath = String(relativePath || '').trim();
    if (!targetProjectId || !safePath) return;
    setProjectFileContentLoading(true);
    setProjectFileContentError('');
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/content`, {
        headers,
        params: {
          path: safePath,
          maxBytes: 180000,
        },
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      setProjectFileContent(response.data || null);
      setProjectFileContentError('');
    } catch (err) {
      console.error('Failed to load project file content:', err);
      setProjectFileContent(null);
      const code = String(err?.response?.data?.code || '').trim();
      const message = err?.response?.data?.error || err?.message || 'Failed to read file';
      setProjectFileContentError(code ? `${code}: ${message}` : message);
    } finally {
      setProjectFileContentLoading(false);
    }
  }, [apiUrl, headers]);

  const loadKbFileTree = useCallback(async (projectId, relativePath = '') => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    setKbFileTreeLoading(true);
    setKbFileTreeError('');
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/tree`, {
        headers,
        params: { path: relativePath || '', scope: 'kb', limit: 240 },
      });
      setKbFileTree(response.data || null);
    } catch (err) {
      console.error('Failed to load KB file tree:', err);
      setKbFileTree(null);
      setKbFileTreeError(err?.response?.data?.error || err?.message || 'Failed to load KB files');
    } finally {
      setKbFileTreeLoading(false);
    }
  }, [apiUrl, headers]);

  const loadKbFileContent = useCallback(async (projectId, relativePath) => {
    const targetProjectId = String(projectId || '').trim();
    const safePath = String(relativePath || '').trim();
    if (!targetProjectId || !safePath) return;
    setKbFileContentLoading(true);
    setKbFileContentError('');
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/content`, {
        headers,
        params: { path: safePath, scope: 'kb', maxBytes: 180000 },
      });
      setKbFileContent(response.data || null);
    } catch (err) {
      console.error('Failed to load KB file content:', err);
      setKbFileContent(null);
      const code = String(err?.response?.data?.code || '').trim();
      const message = err?.response?.data?.error || err?.message || 'Failed to read file';
      setKbFileContentError(code ? `${code}: ${message}` : message);
    } finally {
      setKbFileContentLoading(false);
    }
  }, [apiUrl, headers]);

  const searchProjectFiles = useCallback(async (projectId, query) => {
    const targetProjectId = String(projectId || '').trim();
    const q = String(query || '').trim();
    if (!targetProjectId || !q) {
      setFileMentionOptions([]);
      return;
    }
    // Serve from cache (exact hit or prefix-filtered superset)
    const cached = _mentionGet(targetProjectId, q) ?? _mentionGetByPrefix(targetProjectId, q);
    if (cached !== null) {
      setFileMentionOptions(cached.slice(0, 12));
      return;
    }
    setFileMentionLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/search`, {
        headers,
        params: { q, limit: 20 },
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      _mentionSet(targetProjectId, q, items);
      setFileMentionOptions(items.slice(0, 12));
    } catch (err) {
      console.error('Failed to search project files:', err);
      setFileMentionOptions([]);
    } finally {
      setFileMentionLoading(false);
    }
  }, [apiUrl, headers]);

  const locateKbResourcePaths = useCallback(async (projectId, query, { limit = 12 } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    const q = String(query || '').trim();
    if (!targetProjectId || !q) return { paths: [], items: [] };
    const cap = Math.min(Math.max(Number(limit) || 12, 1), 30);
    if (!isKbLocatorEndpointInCooldown(targetProjectId)) {
      try {
        const response = await axios.get(
          `${apiUrl}/researchops/projects/${targetProjectId}/kb/resource-locate`,
          {
            headers,
            params: { q, limit: cap, includePreview: false },
            timeout: 6500,
          }
        );
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        const paths = items
          .map((item) => String(item?.path || item || '').trim())
          .filter(Boolean)
          .slice(0, cap);
        return { paths, items };
      } catch (locatorError) {
        if (Number(locatorError?.response?.status || 0) === 404) {
          markKbLocatorEndpointCooldown(targetProjectId);
        } else {
          console.warn('KB resource locator request failed, fallback to files/search:', locatorError?.message || locatorError);
        }
      }
    }

    try {
      const tokens = tokenizeKbResourceQuery(q, 8);
      const candidates = [];
      const terms = [q, ...tokens].slice(0, 6);
      for (const term of terms) {
        let response = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          response = await axios.get(
            `${apiUrl}/researchops/projects/${targetProjectId}/files/search`,
            {
              headers,
              params: {
                scope: 'kb',
                q: term,
                limit: 30,
              },
              timeout: 9000,
            }
          );
        } catch (searchError) {
          if (isSshAccessFailure(searchError)) {
            return { paths: KB_RESOURCE_SEED_PATHS.slice(0, Math.min(5, cap)), items: [] };
          }
          continue;
        }
        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        items.forEach((relativePath) => {
          const filePath = String(relativePath || '').trim();
          if (!filePath) return;
          candidates.push(filePath);
        });
      }

      const ranked = rankKbResourceCandidates(candidates, q, tokens, cap);

      let paths = ranked.map((item) => item.path);
      if (paths.length === 0) {
        paths = KB_RESOURCE_SEED_PATHS.slice(0, cap);
      }
      return { paths, items: ranked };
    } catch (fallbackError) {
      console.warn('KB resource fallback search failed:', fallbackError?.message || fallbackError);
      return { paths: KB_RESOURCE_SEED_PATHS.slice(0, Math.min(5, cap)), items: [] };
    }
  }, [apiUrl, headers]);

  const locateCodePaths = useCallback(async (projectId, query, { limit = 10 } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    const q = String(query || '').trim();
    if (!targetProjectId || !q) return { paths: [], items: [] };
    const cap = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const tokens = tokenizeKbResourceQuery(q, 8);
    const candidates = [];
    const terms = [q, ...tokens].slice(0, 6);
    try {
      for (const term of terms) {
        let response = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          response = await axios.get(
            `${apiUrl}/researchops/projects/${targetProjectId}/files/search`,
            {
              headers,
              params: {
                scope: 'project',
                q: term,
                limit: 24,
              },
              timeout: 9000,
            }
          );
        } catch (searchError) {
          if (isSshAccessFailure(searchError)) {
            return { paths: CODE_CHAT_SEED_PATHS.slice(0, Math.min(cap, 5)), items: [] };
          }
          continue;
        }
        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        items.forEach((relativePath) => {
          const filePath = String(relativePath || '').trim();
          if (!filePath) return;
          candidates.push(filePath);
        });
      }
      const ranked = rankCodePathCandidates(candidates, q, tokens, cap);
      const paths = ranked.length > 0
        ? ranked.map((item) => item.path)
        : CODE_CHAT_SEED_PATHS.slice(0, cap);
      return { paths, items: ranked };
    } catch (error) {
      console.warn('Code path auto-locate failed:', error?.message || error);
      return { paths: CODE_CHAT_SEED_PATHS.slice(0, Math.min(cap, 5)), items: [] };
    }
  }, [apiUrl, headers]);

  const loadRunReport = useCallback(async (runId, { silent = false } = {}) => {
    const targetRunId = String(runId || '').trim();
    if (!targetRunId) {
      setRunReport(null);
      return;
    }
    if (!silent) setRunReportLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/runs/${targetRunId}/report`, {
        headers,
        params: { inline: true },
      });
      setRunReport(response.data || null);
      setError('');
    } catch (err) {
      console.error('Failed to load run report:', err);
      setRunReport(null);
      setError(err?.response?.data?.error || 'Failed to load run report');
    } finally {
      if (!silent) setRunReportLoading(false);
    }
  }, [apiUrl, headers]);

  const loadRunContextPack = useCallback(async (runId, { silent = false } = {}) => {
    const targetRunId = String(runId || '').trim();
    if (!targetRunId) {
      setRunContextPack(null);
      setRunContextPackLoading(false);
      return;
    }
    if (!silent) setRunContextPackLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/runs/${targetRunId}/context-pack`, {
        headers,
      });
      setRunContextPack(response.data || null);
      setError('');
    } catch (err) {
      console.error('Failed to load run context pack:', err);
      setRunContextPack(null);
      setError(err?.response?.data?.error || 'Failed to load run context pack');
    } finally {
      if (!silent) setRunContextPackLoading(false);
    }
  }, [apiUrl, headers]);

  const loadTreeWorkspace = useCallback(async (projectId, { silent = false, force = false } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    if (!force && isProjectPollingBlocked(targetProjectId)) return;
    if (!force && isTreeEndpointCooldown(targetProjectId)) return;
    const inFlightKey = targetProjectId;
    if (!force && treeWorkspaceInFlightRef.current.has(inFlightKey)) return;
    treeWorkspaceInFlightRef.current.add(inFlightKey);
    if (!silent) setTreeLoading(true);
    setTreeError('');
    try {
      const [planRes, stateRes] = await Promise.allSettled([
        axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/tree/plan`, { headers }),
        axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/tree/state`, { headers }),
      ]);
      if (selectedProjectRef.current !== targetProjectId) return;

      const failures = [];
      if (planRes.status === 'fulfilled') {
        const planPayload = planRes.value?.data?.plan || createEmptyTreePlan();
        setTreePlan(planPayload);
        setTreeValidation(planRes.value?.data?.validation || null);
        setTreeRootSummary(planRes.value?.data?.rootSummary || null);
        if (planRes.value?.data?.environmentDetected != null) {
          setTreeEnvironmentDetected(planRes.value.data.environmentDetected);
        }
        if (!Array.isArray(planPayload?.nodes) || planPayload.nodes.length === 0) {
          setSelectedNodeId('');
        }
      } else {
        if (isTreeEndpointUnavailable(planRes.reason)) {
          setTreePlan((prev) => prev || createEmptyTreePlan());
          setTreeValidation((prev) => prev || { valid: true, errors: [], warnings: [] });
          setTreeRootSummary(null);
        }
        failures.push(planRes.reason);
      }

      if (stateRes.status === 'fulfilled') {
        setTreeState(stateRes.value?.data?.state || createEmptyTreeState());
      } else {
        if (isTreeEndpointUnavailable(stateRes.reason)) {
          setTreeState((prev) => prev || createEmptyTreeState());
        }
        failures.push(stateRes.reason);
      }

      if (failures.length === 0) {
        clearTreeEndpointCooldown(targetProjectId);
        clearProjectPollingBlock(targetProjectId);
        return;
      }

      if (failures.every((failure) => isTreeEndpointUnavailable(failure))) {
        markTreeEndpointCooldown(targetProjectId);
        setTreeError('');
        return;
      }

      const primaryFailure = failures[0];
      const code = getApiErrorCode(primaryFailure);
      setTreeError(toProjectAccessDiagnostic(primaryFailure, 'Failed to load tree workspace'));
      if (SSH_BLOCKING_ERROR_CODES.has(code)) {
        markProjectPollingBlocked(targetProjectId);
      }
    } catch (err) {
      const code = getApiErrorCode(err);
      if (!silent || !SSH_BLOCKING_ERROR_CODES.has(code)) {
        console.error('Failed to load tree workspace:', err);
      }
      if (isTreeEndpointUnavailable(err)) {
        markTreeEndpointCooldown(targetProjectId);
        setTreePlan((prev) => prev || createEmptyTreePlan());
        setTreeState((prev) => prev || createEmptyTreeState());
        setTreeValidation((prev) => prev || { valid: true, errors: [], warnings: [] });
        setTreeError('');
      } else {
        setTreeError(toProjectAccessDiagnostic(err, 'Failed to load tree workspace'));
      }
      setTreeRootSummary(null);
      if (SSH_BLOCKING_ERROR_CODES.has(code)) {
        markProjectPollingBlocked(targetProjectId);
      }
    } finally {
      if (selectedProjectRef.current === targetProjectId) {
        setTreeWorkspaceReady(true);
      }
      treeWorkspaceInFlightRef.current.delete(inFlightKey);
      if (!silent) setTreeLoading(false);
    }
  }, [
    apiUrl,
    clearProjectPollingBlock,
    clearTreeEndpointCooldown,
    headers,
    isProjectPollingBlocked,
    isTreeEndpointCooldown,
    markProjectPollingBlocked,
    markTreeEndpointCooldown,
  ]);

  const loadObservedSessions = useCallback(async (projectId, { silent = false } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    if (!silent) setObservedSessionsLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/observed-sessions`, {
        headers,
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      setObservedSessions(items);
      if (response.data?.wrotePlan) {
        await loadTreeWorkspace(targetProjectId, { silent: true, force: true });
      }
    } catch (err) {
      console.error('Failed to load observed sessions:', err);
      if (selectedProjectRef.current === targetProjectId) {
        setObservedSessions([]);
        setError(err?.response?.data?.error || err?.message || 'Failed to load observed sessions');
      }
    } finally {
      if (!silent) setObservedSessionsLoading(false);
    }
  }, [apiUrl, headers, loadTreeWorkspace]);

  const applyPlanPatches = useCallback(async (patches = []) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId || !Array.isArray(patches) || patches.length === 0) return null;
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/plan/patches`,
        { patches },
        { headers }
      );
      const nextPlan = response.data?.plan || null;
      setTreePlan(nextPlan);
      setTreeValidation(response.data?.validation || null);
      setTreeError('');
      await loadTreeWorkspace(projectId, { silent: true });
      return response.data || null;
    } catch (err) {
      const feedback = getPlanPatchFeedback(err);
      if (feedback.validation) {
        setTreeValidation(feedback.validation);
      }
      setTreeError(feedback.message);
      throw err;
    }
  }, [apiUrl, headers, loadTreeWorkspace, selectedProjectId]);

  const savePlanDsl = useCallback(async (nextPlan) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId || !nextPlan || typeof nextPlan !== 'object') return null;
    const response = await axios.put(
      `${apiUrl}/researchops/projects/${projectId}/tree/plan`,
      { plan: nextPlan },
      { headers }
    );
    setTreePlan(response.data?.plan || null);
    setTreeValidation(response.data?.validation || null);
    await loadTreeWorkspace(projectId, { silent: true });
    return response.data || null;
  }, [apiUrl, headers, loadTreeWorkspace, selectedProjectId]);

  const validatePlanDsl = useCallback(async (nextPlan) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId || !nextPlan || typeof nextPlan !== 'object') return null;
    const response = await axios.post(
      `${apiUrl}/researchops/projects/${projectId}/tree/plan/validate`,
      { plan: nextPlan },
      { headers }
    );
    setTreeValidation(response.data?.validation || null);
    return response.data || null;
  }, [apiUrl, headers, selectedProjectId]);

  const loadRunHistoryPage = useCallback(async (projectId, { reset = false } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    if (reset) {
      setRunHistoryLoading(true);
      setRunHistoryCursor('');
      runHistoryCursorRef.current = '';
      setRunHistoryHasMore(false);
      runHistoryHasMoreRef.current = false;
    } else {
      if (!runHistoryHasMoreRef.current || runHistoryLoadingMoreRef.current) return;
      setRunHistoryLoadingMore(true);
      runHistoryLoadingMoreRef.current = true;
    }
    try {
      const cursor = reset ? '' : cleanString(runHistoryCursorRef.current);
      const response = await axios.get(`${apiUrl}/researchops/runs`, {
        headers,
        params: {
          projectId: targetProjectId,
          limit: 20,
          ...(reset ? {} : (cursor ? { cursor } : {})),
        },
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      const nextCursor = String(response.data?.nextCursor || '').trim();
      const hasMore = Boolean(response.data?.hasMore);
      setRunHistoryItems((prev) => {
        if (reset) return items;
        const existing = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        items.forEach((item) => {
          if (!existing.has(item.id)) merged.push(item);
        });
        return merged;
      });
      setRunHistoryCursor(nextCursor);
      runHistoryCursorRef.current = nextCursor;
      setRunHistoryHasMore(hasMore);
      runHistoryHasMoreRef.current = hasMore;
    } catch (err) {
      console.error('Failed to load run history page:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to load run history');
    } finally {
      setRunHistoryLoading(false);
      setRunHistoryLoadingMore(false);
      runHistoryLoadingMoreRef.current = false;
    }
  }, [apiUrl, headers]);

  useEffect(() => {
    loadProjectInsightsRef.current = loadProjectInsights;
  }, [loadProjectInsights]);

  useEffect(() => {
    loadProjectFileTreeRef.current = loadProjectFileTree;
  }, [loadProjectFileTree]);

  useEffect(() => {
    loadTreeWorkspaceRef.current = loadTreeWorkspace;
  }, [loadTreeWorkspace]);

  useEffect(() => {
    loadRunHistoryPageRef.current = loadRunHistoryPage;
  }, [loadRunHistoryPage]);

  useEffect(() => {
    selectedProjectRef.current = selectedProjectId;
    if (selectedProjectId) loadSshServers();
  }, [selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (
        document.hidden
        || showCreateProjectModal
        || showCreateIdeaModal
        || showEnqueueRunModal
        || showKnowledgeHubModal
        || showSkillsModal
        || submitting
        || pollPaused
      ) return;
      loadAll({ silent: true });
      if (selectedProjectRef.current) {
        loadProjectInsights(selectedProjectRef.current, { silent: true });
        loadTreeWorkspace(selectedProjectRef.current, { silent: true });
        loadObservedSessions(selectedProjectRef.current, { silent: true });
      }
      if (selectedRunId) {
        loadRunReport(selectedRunId, { silent: true });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [
    loadAll,
    loadObservedSessions,
    loadTreeWorkspace,
    loadProjectInsights,
    loadRunReport,
    selectedRunId,
    showCreateProjectModal,
    showCreateIdeaModal,
    showEnqueueRunModal,
    showKnowledgeHubModal,
    showSkillsModal,
    submitting,
    pollPaused,
  ]);

  const loadSshServers = useCallback(async () => {
    setLoadingSsh(true);
    try {
      const res = await axios.get(`${apiUrl}/ssh-servers`, { headers });
      const servers = res.data?.servers || [];
      setSshServers(servers);
      if (!projectServerId && servers.length > 0) {
        setProjectServerId(String(servers[0].id));
      }
    } catch (err) {
      console.error('Failed to load SSH servers:', err);
      setError(err?.response?.data?.error || 'Failed to load SSH servers');
    } finally {
      setLoadingSsh(false);
    }
  }, [apiUrl, headers, projectServerId]);

  const loadClientDevices = useCallback(async () => {
    setLoadingClientDevices(true);
    try {
      const res = await axios.get(`${apiUrl}/researchops/daemons`, { headers });
      const devices = Array.isArray(res.data?.items) ? res.data.items : [];
      setClientDevices(devices);
      if (!projectClientDeviceId && devices.length > 0) {
        setProjectClientDeviceId(String(devices[0].id));
      }
    } catch (err) {
      console.error('Failed to load client devices:', err);
      setError(err?.response?.data?.error || 'Failed to load client devices');
    } finally {
      setLoadingClientDevices(false);
    }
  }, [apiUrl, headers, projectClientDeviceId]);

  const onlineClientDevices = useMemo(() => clientDevices.filter(
    (device) => String(device?.status || '').trim().toUpperCase() === 'ONLINE'
  ), [clientDevices]);

  const ensureClientBootstrapHostname = useCallback(() => {
    if (clientBootstrapRequestedHostname.trim()) return clientBootstrapRequestedHostname.trim();
    const platformHint = typeof navigator !== 'undefined'
      ? String(navigator.userAgentData?.platform || navigator.platform || 'client-device')
      : 'client-device';
    const next = platformHint.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client-device';
    setClientBootstrapRequestedHostname(next);
    return next;
  }, [clientBootstrapRequestedHostname]);

  const refreshClientBootstrapStatus = useCallback(async ({ silent = false } = {}) => {
    const bootstrapId = String(clientBootstrapData?.bootstrapId || '').trim();
    if (!bootstrapId) return null;
    if (!silent) {
      setClientBootstrapBusy(true);
    }
    try {
      const res = await axios.get(`${apiUrl}/researchops/daemons/bootstrap/${encodeURIComponent(bootstrapId)}`, { headers });
      const next = {
        ...clientBootstrapData,
        ...res.data,
      };
      setClientBootstrapData(next);
      const nextStatus = String(res.data?.status || '').trim().toUpperCase();
      if (nextStatus === 'REDEEMED' && res.data?.redeemedServerId) {
        await loadClientDevices();
        setProjectClientDeviceId(String(res.data.redeemedServerId));
        setClientBootstrapStatus('connected');
        setClientBootstrapOpen(false);
        setClientBootstrapMessage(`Connected device: ${res.data.requestedHostname || res.data.redeemedServerId}`);
      } else if (nextStatus === 'EXPIRED') {
        setClientBootstrapStatus('expired');
        setClientBootstrapMessage('Bootstrap token expired. Generate a new connect command.');
      } else {
        setClientBootstrapStatus('waiting-for-device');
        setClientBootstrapMessage('Waiting for this device to connect...');
      }
      return next;
    } catch (err) {
      console.error('Failed to refresh client bootstrap:', err);
      const message = err?.response?.data?.error || err?.message || 'Failed to refresh client bootstrap';
      setClientBootstrapMessage(message);
      if (!silent) {
        setError(message);
      }
      return null;
    } finally {
      if (!silent) {
        setClientBootstrapBusy(false);
      }
    }
  }, [apiUrl, clientBootstrapData, headers, loadClientDevices]);

  const handleStartClientBootstrap = useCallback(async () => {
    setError('');
    setClientBootstrapBusy(true);
    try {
      const requestedHostname = ensureClientBootstrapHostname();
      const res = await axios.post(`${apiUrl}/researchops/daemons/bootstrap`, {
        requestedHostname,
      }, { headers });
      setClientBootstrapData(res.data || null);
      setClientBootstrapStatus('waiting-for-device');
      setClientBootstrapOpen(true);
      setClientBootstrapMessage('Run the install command on the client device, then refresh or wait for auto-detection.');
    } catch (err) {
      console.error('Failed to start client bootstrap:', err);
      const message = err?.response?.data?.error || err?.message || 'Failed to create client bootstrap';
      setClientBootstrapMessage(message);
      setError(message);
    } finally {
      setClientBootstrapBusy(false);
    }
  }, [apiUrl, ensureClientBootstrapHostname, headers]);

  const handleCopyClientBootstrapCommand = useCallback(async () => {
    const command = String(clientBootstrapData?.installCommand || '').trim();
    if (!command) return;
    try {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        throw new Error('Clipboard is unavailable in this browser');
      }
      await navigator.clipboard.writeText(command);
      setClientBootstrapMessage('Install command copied to clipboard.');
    } catch (err) {
      setClientBootstrapMessage(err?.message || 'Failed to copy install command');
    }
  }, [clientBootstrapData]);

  const handleDownloadClientBootstrapFile = useCallback(() => {
    if (!clientBootstrapData?.bootstrapFile) return;
    const blob = new Blob([JSON.stringify(clientBootstrapData.bootstrapFile, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `researchops-client-bootstrap-${clientBootstrapData.bootstrapId || 'config'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setClientBootstrapMessage('Bootstrap file downloaded.');
  }, [clientBootstrapData]);

  const resetProjectDraft = useCallback(() => {
    setProjectName('');
    setProjectDescription('');
    setProjectLocationType('local');
    setProjectServerId('');
    setProjectClientMode('agent');
    setProjectClientDeviceId('');
    setProjectClientWorkspaceId('');
    setProjectClientWorkspaceName('');
    setProjectPath('');
    setPathCheckResult(null);
    setCheckingPath(false);
    setClientBootstrapOpen(false);
    setClientBootstrapBusy(false);
    setClientBootstrapData(null);
    setClientBootstrapStatus('idle');
    setClientBootstrapRequestedHostname('');
    setClientBootstrapMessage('');
  }, []);

  useEffect(() => {
    if (!showCreateProjectModal) return;
    if (projectLocationType !== 'client' || projectClientMode !== 'agent') return;
    if (loadingClientDevices) return;
    if (onlineClientDevices.length === 0) {
      setClientBootstrapOpen(true);
      if (!clientBootstrapRequestedHostname.trim()) {
        ensureClientBootstrapHostname();
      }
    }
  }, [
    clientBootstrapRequestedHostname,
    ensureClientBootstrapHostname,
    loadingClientDevices,
    onlineClientDevices.length,
    projectClientMode,
    projectLocationType,
    showCreateProjectModal,
  ]);

  useEffect(() => {
    if (!showCreateProjectModal) return undefined;
    if (projectLocationType !== 'client' || projectClientMode !== 'agent') return undefined;
    if (clientBootstrapStatus !== 'waiting-for-device') return undefined;
    if (!clientBootstrapData?.bootstrapId) return undefined;
    const interval = setInterval(() => {
      refreshClientBootstrapStatus({ silent: true }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [
    clientBootstrapData,
    clientBootstrapStatus,
    projectClientMode,
    projectLocationType,
    refreshClientBootstrapStatus,
    showCreateProjectModal,
  ]);

  const checkProjectPath = useCallback(async () => {
    if (projectLocationType === 'client' && projectClientMode === 'browser') {
      if (!projectClientWorkspaceId) {
        throw new Error('Please link a browser workspace folder');
      }
      const result = {
        locationType: 'client',
        clientMode: 'browser',
        clientWorkspaceId: projectClientWorkspaceId,
        canCreate: true,
        deferred: true,
        message: `Browser workspace linked: ${projectClientWorkspaceName || 'Linked workspace'}`,
      };
      setPathCheckResult(result);
      return result;
    }

    const normalizedPath = projectPath.trim();
    if (!normalizedPath) {
      throw new Error('Project path is required');
    }
    if (projectLocationType === 'ssh' && !projectServerId) {
      throw new Error('Please select an SSH server');
    }
    if (projectLocationType === 'client' && projectClientMode === 'agent' && !projectClientDeviceId) {
      throw new Error('Please select a client device');
    }
    const payload = {
      locationType: projectLocationType,
      projectPath: normalizedPath,
      serverId: projectLocationType === 'ssh' ? projectServerId : undefined,
      clientMode: projectLocationType === 'client' ? projectClientMode : undefined,
      clientDeviceId: projectLocationType === 'client' && projectClientMode === 'agent'
        ? projectClientDeviceId
        : undefined,
      clientWorkspaceId: projectLocationType === 'client' && projectClientMode === 'browser'
        ? projectClientWorkspaceId
        : undefined,
    };
    const response = await axios.post(`${apiUrl}/researchops/projects/path-check`, payload, { headers });
    const result = response.data || {};
    setPathCheckResult(result);
    return result;
  }, [
    apiUrl,
    headers,
    projectClientDeviceId,
    projectClientMode,
    projectClientWorkspaceId,
    projectClientWorkspaceName,
    projectLocationType,
    projectPath,
    projectServerId,
  ]);

  const handleCheckProjectPath = async () => {
    setError('');
    setCheckingPath(true);
    try {
      await checkProjectPath();
    } catch (err) {
      console.error('Failed to check project path:', err);
      setPathCheckResult({
        exists: false,
        isDirectory: false,
        canCreate: false,
        message: err?.response?.data?.error || err?.message || 'Failed to check project path',
      });
    } finally {
      setCheckingPath(false);
    }
  };

  const handleLinkClientWorkspace = async () => {
    setError('');
    setCheckingPath(true);
    try {
      const linked = await linkClientWorkspace();
      setProjectClientWorkspaceId(linked.workspaceId);
      setProjectClientWorkspaceName(linked.meta?.displayName || linked.handle?.name || 'Linked workspace');
      setPathCheckResult({
        locationType: 'client',
        clientMode: 'browser',
        clientWorkspaceId: linked.workspaceId,
        canCreate: true,
        deferred: true,
        message: `Browser workspace linked: ${linked.meta?.displayName || linked.handle?.name || 'Linked workspace'}`,
      });
    } catch (err) {
      console.error('Failed to link browser workspace:', err);
      setPathCheckResult({
        canCreate: false,
        message: err?.message || 'Failed to link browser workspace',
      });
    } finally {
      setCheckingPath(false);
    }
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    setSubmitting(true);
    try {
      const latestPathResult = await checkProjectPath();
      if (latestPathResult?.canCreate === false) {
        throw new Error('Project path exists but is not a directory');
      }
      const payload = {
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
        locationType: projectLocationType,
      };

      if (projectLocationType === 'ssh') {
        payload.serverId = projectServerId;
        payload.projectPath = latestPathResult?.projectPath || projectPath.trim();
      } else if (projectLocationType === 'client' && projectClientMode === 'agent') {
        payload.clientMode = 'agent';
        payload.clientDeviceId = projectClientDeviceId;
        payload.projectPath = latestPathResult?.projectPath || projectPath.trim();
      } else if (projectLocationType === 'client' && projectClientMode === 'browser') {
        payload.clientMode = 'browser';
        payload.clientWorkspaceId = projectClientWorkspaceId;
        payload.clientWorkspaceMeta = {
          displayName: projectClientWorkspaceName || 'Linked workspace',
        };
      } else {
        payload.projectPath = latestPathResult?.projectPath || projectPath.trim();
      }

      const response = await axios.post(`${apiUrl}/researchops/projects`, {
        ...payload,
      }, { headers });

      if (!response.data?.project?.id) {
        throw new Error('Failed to create project');
      }
      resetProjectDraft();
      setShowCreateProjectModal(false);
      await loadAll();
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err?.response?.data?.error || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateIdea = async (event) => {
    event.preventDefault();
    if (!selectedProjectId || !ideaTitle.trim() || !ideaHypothesis.trim()) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/ideas`, {
        projectId: selectedProjectId,
        title: ideaTitle.trim(),
        hypothesis: ideaHypothesis.trim(),
      }, { headers });
      setIdeaTitle('');
      setIdeaHypothesis('');
      setShowCreateIdeaModal(false);
      await loadAll();
    } catch (err) {
      console.error('Failed to create idea:', err);
      setError(err?.response?.data?.error || 'Failed to create idea');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAddTodo = useCallback(async (event = null) => {
    if (event?.preventDefault) event.preventDefault();
    if (!selectedProjectId || !todoTitle.trim()) return;
    setTodoBusy(true);
    try {
      await axios.post(`${apiUrl}/researchops/ideas`, {
        projectId: selectedProjectId,
        title: todoTitle.trim(),
        hypothesis: todoDetails.trim() || todoTitle.trim(),
        summary: 'User-defined TODO',
        status: 'OPEN',
      }, { headers });
      setTodoTitle('');
      setTodoDetails('');
      setShowTodoModal(false);
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      console.error('Failed to add todo:', err);
      setError(err?.response?.data?.error || 'Failed to add todo');
    } finally {
      setTodoBusy(false);
    }
  }, [apiUrl, headers, loadAll, selectedProjectId, todoDetails, todoTitle]);

  const extractTodoSuggestionsFromGenerator = useCallback((payload = {}) => {
    const dslSteps = Array.isArray(payload?.todoDsl?.steps) ? payload.todoDsl.steps : [];
    if (dslSteps.length > 0) {
      return dslSteps
        .map((step, index) => {
          const titleRaw = String(step?.title || '').trim() || `Step ${index + 1}`;
          const objective = String(step?.objective || '').trim() || titleRaw;
          const acceptance = Array.isArray(step?.acceptance) ? step.acceptance.filter(Boolean) : [];
          const knowledgeRefs = Array.isArray(step?.references?.knowledge) ? step.references.knowledge : [];
          const codeRefs = Array.isArray(step?.references?.codebase) ? step.references.codebase : [];
          const stepPlan = {
            step_id: String(step?.step_id || `step_${String(index + 1).padStart(2, '0')}`),
            kind: String(step?.kind || 'experiment'),
            objective,
            assumptions: Array.isArray(step?.assumptions) ? step.assumptions : [],
            acceptance,
            commands: Array.isArray(step?.commands) ? step.commands : [],
            checks: Array.isArray(step?.checks) ? step.checks : [],
            depends_on: Array.isArray(step?.depends_on) ? step.depends_on : [],
            references: {
              knowledge: knowledgeRefs.map((item) => ({
                id: item?.id,
                title: item?.title,
                source: item?.source,
              })),
              codebase: codeRefs.map((item) => ({
                path: item?.path,
                source: item?.source,
              })),
            },
          };
          const targetHint = acceptance.length ? `Targets: ${acceptance.slice(0, 2).join(' | ')}` : '';
          const refHint = `Refs: ${knowledgeRefs.length} KB, ${codeRefs.length} code`;
          return {
            title: titleRaw.length > 120 ? `${titleRaw.slice(0, 117)}...` : titleRaw,
            hypothesis: [objective, targetHint, refHint].filter(Boolean).join(' '),
            experimentPlan: JSON.stringify(stepPlan, null, 2),
            summarySuffix: refHint,
          };
        })
        .slice(0, 8);
    }

    const plan = payload?.plan || {};
    const rawNodes = Array.isArray(plan.nodes) ? plan.nodes : [];
    return rawNodes
      .map((node, index) => {
        const label = String(node?.label || node?.title || '').trim() || `Planned step ${index + 1}`;
        const detail = String(node?.description || node?.goal || label).trim();
        return {
          title: label.length > 120 ? `${label.slice(0, 117)}...` : label,
          hypothesis: detail,
          experimentPlan: '',
          summarySuffix: 'Refs: 0 KB, 0 code',
        };
      })
      .slice(0, 8);
  }, []);

  const handleGenerateTodos = useCallback(async () => {
    const instruction = todoPrompt.trim();
    if (!selectedProjectId || !instruction) {
      setError('Enter a prompt before generating TODOs.');
      return;
    }
    setTodoBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/plan/generate`,
        { instruction, projectId: selectedProjectId, todoMode: true },
        { headers }
      );
      const suggestions = extractTodoSuggestionsFromGenerator(response.data || {});

      if (suggestions.length === 0) {
        throw new Error('No TODO suggestions were generated from the plan');
      }

      const createdAtIso = new Date().toISOString();
      await Promise.all(suggestions.map((suggestion) => axios.post(
        `${apiUrl}/researchops/ideas`,
        {
          projectId: selectedProjectId,
          title: suggestion.title,
          hypothesis: suggestion.hypothesis,
          summary: `TODO DSL-generated from prompt (${createdAtIso}) · ${suggestion.summarySuffix}`,
          experimentPlan: suggestion.experimentPlan || '',
          status: 'OPEN',
        },
        { headers }
      )));
      setTodoPrompt('');
      setShowTodoModal(false);
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      console.error('Failed to generate todos:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to generate TODOs');
    } finally {
      setTodoBusy(false);
    }
  }, [apiUrl, extractTodoSuggestionsFromGenerator, headers, loadAll, selectedProjectId, todoPrompt]);

  const handleClearCurrentTodos = useCallback(async () => {
    if (!selectedProjectId || todoBusy) return;
    setTodoBusy(true);
    setError('');
    try {
      await axios.post(
        `${apiUrl}/researchops/projects/${selectedProjectId}/todos/clear`,
        { status: 'COMPLETED' },
        { headers }
      );
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      console.error('Failed to clear project todos:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to clear project TODOs');
    } finally {
      setTodoBusy(false);
    }
  }, [apiUrl, headers, loadAll, selectedProjectId, todoBusy]);

  const handleGenerateRootNodeFromCodebase = useCallback(async () => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId || rootBootstrapBusy) return;
    setRootBootstrapBusy(true);
    setError('');
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/root-node`,
        { force: true, attachOrphans: true },
        { headers }
      );
      setTreePlan(response.data?.plan || null);
      setTreeValidation(response.data?.validation || null);
      setTreeRootSummary({
        generated: Boolean(response.data?.generated),
        summary: String(response.data?.summary || ''),
        achievements: Array.isArray(response.data?.achievements) ? response.data.achievements : [],
        rootNodeId: String(response.data?.rootNode?.id || 'baseline_root'),
        snapshot: response.data?.snapshot || null,
      });
      if (response.data?.rootNode?.id) {
        setSelectedNodeId(String(response.data.rootNode.id));
      }
      await loadTreeWorkspace(projectId, { silent: true });
    } catch (err) {
      console.error('Failed to generate root node from codebase:', err);
      const code = String(err?.response?.data?.code || '').trim();
      const message = err?.response?.data?.error || err?.message || 'Failed to generate root node';
      setError(code ? `${code}: ${message}` : message);
    } finally {
      setRootBootstrapBusy(false);
    }
  }, [apiUrl, headers, loadTreeWorkspace, rootBootstrapBusy, selectedProjectId]);

  const openTodoModal = useCallback(() => {
    setError('');
    setShowTodoModal(true);
  }, []);

  const closeTodoModal = useCallback(() => {
    if (todoBusy) return;
    setShowTodoModal(false);
    setTodoTitle('');
    setTodoDetails('');
    setTodoPrompt('');
  }, [todoBusy]);

  const handleUploadProposalAndGenerateTodos = useCallback(async (file, { designMode = false } = {}) => {
    if (!file || !selectedProjectId || proposalUploadBusy) return;
    setProposalUploadBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const url = designMode
        ? `${apiUrl}/researchops/projects/${selectedProjectId}/todos/from-proposal?design=true`
        : `${apiUrl}/researchops/projects/${selectedProjectId}/todos/from-proposal`;
      await axios.post(url, formData, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      await loadAll({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to generate TODOs from proposal');
    } finally {
      setProposalUploadBusy(false);
    }
  }, [apiUrl, headers, loadAll, proposalUploadBusy, selectedProjectId]);

  const handleChooseProposalFileDesign = useCallback(() => {
    if (todoBusy || proposalUploadBusy || !selectedProjectId) return;
    kickoffProposalFileInputRef.current?.click();
  }, [proposalUploadBusy, selectedProjectId, todoBusy]);

  const handleKickoffProposalFileChange = useCallback((event) => {
    const file = event?.target?.files?.[0] || null;
    if (!file) return;
    setShowKickoffPromptGenerate(false);
    handleUploadProposalAndGenerateTodos(file, { designMode: true });
    if (kickoffProposalFileInputRef.current) kickoffProposalFileInputRef.current.value = '';
  }, [handleUploadProposalAndGenerateTodos]);

  const handleKickoffGenerateTodos = useCallback(async () => {
    const instruction = kickoffAiPrompt.trim();
    if (!selectedProjectId || !instruction) {
      setError('Enter a description before generating tasks.');
      return;
    }
    setTodoBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/plan/generate`,
        { instruction, projectId: selectedProjectId, todoMode: true },
        { headers }
      );
      const suggestions = extractTodoSuggestionsFromGenerator(response.data || {});
      if (suggestions.length === 0) {
        throw new Error('No tasks were generated from the description');
      }
      const createdAtIso = new Date().toISOString();
      await Promise.all(suggestions.map((suggestion) => axios.post(
        `${apiUrl}/researchops/ideas`,
        {
          projectId: selectedProjectId,
          title: suggestion.title,
          hypothesis: suggestion.hypothesis,
          summary: `TODO DSL-generated from prompt (${createdAtIso}) · ${suggestion.summarySuffix}`,
          experimentPlan: suggestion.experimentPlan || '',
          status: 'OPEN',
        },
        { headers }
      )));
      setKickoffAiPrompt('');
      setShowKickoffPromptGenerate(false);
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to generate tasks');
    } finally {
      setTodoBusy(false);
    }
  }, [apiUrl, extractTodoSuggestionsFromGenerator, headers, kickoffAiPrompt, loadAll, selectedProjectId]);

  const startAutopilotPoll = useCallback((sessionId) => {
    if (autopilotPollRef.current) clearInterval(autopilotPollRef.current);
    autopilotPollRef.current = setInterval(async () => {
      try {
        const resp = await axios.get(`${apiUrl}/researchops/autopilot/${sessionId}`, { headers });
        const s = resp.data?.session;
        if (s) {
          setAutopilotSession(s);
          if (['completed', 'stopped', 'failed'].includes(s.status)) {
            clearInterval(autopilotPollRef.current);
            autopilotPollRef.current = null;
          }
        }
      } catch {
        // ignore transient poll errors
      }
    }, 5000);
  }, [apiUrl, headers]);

  const handleStartAutopilot = useCallback(async () => {
    if (!selectedProjectId || !autopilotProposal.trim()) {
      setError('Project and proposal are required to start autopilot.');
      return;
    }
    setAutopilotBusy(true);
    setError('');
    try {
      const resp = await axios.post(
        `${apiUrl}/researchops/projects/${selectedProjectId}/autopilot/start`,
        {
          proposal: autopilotProposal.trim(),
          maxIterations: autopilotMaxIter,
          serverId: autopilotServerId,
          skill: autopilotSkill,
        },
        { headers }
      );
      const session = resp.data?.session;
      setAutopilotSession(session);
      setShowAutopilotModal(false);
      startAutopilotPoll(session.id);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to start autopilot');
    } finally {
      setAutopilotBusy(false);
    }
  }, [apiUrl, autopilotMaxIter, autopilotProposal, autopilotServerId, autopilotSkill, headers, selectedProjectId, startAutopilotPoll]);

  const handleStopAutopilot = useCallback(async () => {
    if (!autopilotSession?.id) return;
    try {
      const resp = await axios.post(
        `${apiUrl}/researchops/autopilot/${autopilotSession.id}/stop`,
        {},
        { headers }
      );
      setAutopilotSession(resp.data?.session || { ...autopilotSession, status: 'stopped' });
      if (autopilotPollRef.current) {
        clearInterval(autopilotPollRef.current);
        autopilotPollRef.current = null;
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to stop autopilot');
    }
  }, [apiUrl, autopilotSession, headers]);

  // These must be defined before any useCallback that lists them as dependencies.
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const linkedKnowledgeGroupIds = useMemo(() => {
    if (!Array.isArray(selectedProject?.knowledgeGroupIds)) return [];
    return selectedProject.knowledgeGroupIds.map((id) => Number(id)).filter(Number.isFinite);
  }, [selectedProject]);

  const handleSetKnowledgeBaseFolder = useCallback(() => {
    if (!selectedProjectId || submitting) return;
    setError('');
    const fallbackGroupId = linkedKnowledgeGroupIds[0]
      || (knowledgeGroups[0]?.id ? Number(knowledgeGroups[0].id) : null);
    setKbSetupMode('resource');
    setKbSelectedGroupId(fallbackGroupId ? String(fallbackGroupId) : '');
    setKbSyncJob(null);
    setShowKbFolderModal(true);
  }, [knowledgeGroups, linkedKnowledgeGroupIds, selectedProjectId, submitting]);

  const closeKbFolderModal = useCallback(() => {
    if (kbSyncBusy) return;
    setShowKbFolderModal(false);
  }, [kbSyncBusy]);

  const handleSetupKbFromResource = useCallback(async () => {
    if (!selectedProjectId || kbSyncBusy) return;
    setKbSyncBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${selectedProjectId}/kb/setup-from-resource`,
        {},
        { headers }
      );
      const project = response.data?.project;
      if (project?.id) {
        setProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, ...project } : item)));
      }
      setKbSyncJob({
        status: 'SUCCEEDED',
        message: response.data?.message || 'KB folder linked',
        result: response.data || null,
      });
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      console.error('Failed to setup KB from project resource folder:', err);
      const message = err?.response?.data?.error || 'Failed to setup KB from resource folder';
      setKbSyncJob({
        status: 'FAILED',
        message,
        error: message,
      });
      setError(message);
    } finally {
      setKbSyncBusy(false);
    }
  }, [apiUrl, headers, kbSyncBusy, loadAll, selectedProjectId]);

  const handleStartKbSyncFromGroup = useCallback(async () => {
    if (!selectedProjectId || !kbSelectedGroupId || kbSyncBusy) return;
    setKbSyncBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${selectedProjectId}/kb/sync-group`,
        { groupId: Number(kbSelectedGroupId) },
        { headers }
      );
      const job = response.data?.job || null;
      if (!job?.id) throw new Error('Failed to start KB sync job');
      setKbSyncJob(job);
      setError('');
    } catch (err) {
      console.error('Failed to start KB sync job:', err);
      const message = err?.response?.data?.error || err?.message || 'Failed to start KB sync job';
      setKbSyncJob({
        status: 'FAILED',
        message,
        error: message,
      });
      setError(message);
    } finally {
      setKbSyncBusy(false);
    }
  }, [apiUrl, headers, kbSelectedGroupId, kbSyncBusy, selectedProjectId]);

  const handleOpenPaperList = useCallback(() => {
    if (typeof onOpenPaperLibrary === 'function') {
      onOpenPaperLibrary();
      return;
    }
    window.location.hash = '#library';
  }, [onOpenPaperLibrary]);

  const handleOpenFolderPath = useCallback((relativePath = '') => {
    if (!selectedProjectId) return;
    setProjectFileContent(null);
    setProjectFileContentError('');
    loadProjectFileTree(selectedProjectId, relativePath, { force: true });
  }, [loadProjectFileTree, selectedProjectId]);

  const handleOpenProjectFile = useCallback((relativePath) => {
    if (!selectedProjectId || !relativePath) return;
    setAiEditTarget(`@${relativePath}`);
    loadProjectFileContent(selectedProjectId, relativePath);
  }, [loadProjectFileContent, selectedProjectId]);

  const handleOpenKbFolder = useCallback((relativePath = '') => {
    if (!selectedProjectId) return;
    setKbFileContent(null);
    setKbFileContentError('');
    loadKbFileTree(selectedProjectId, relativePath);
  }, [loadKbFileTree, selectedProjectId]);

  const handleOpenKbFile = useCallback((relativePath) => {
    if (!selectedProjectId || !relativePath) return;
    loadKbFileContent(selectedProjectId, relativePath);
  }, [loadKbFileContent, selectedProjectId]);

  const handleSubmitAiEdit = useCallback(async () => {
    if (!selectedProjectId || aiEditBusy) return;
    const targetPath = String(aiEditTarget || '').trim().replace(/^@+/, '').trim();
    const instruction = String(aiEditInstruction || '').trim();
    if (!targetPath || !instruction) {
      setError('Choose a file with @ and add an augmentation instruction.');
      return;
    }
    setAiEditBusy(true);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${selectedProjectId}/files/augment`,
        {
          filePath: targetPath,
          instruction,
        },
        { headers }
      );
      const runId = response.data?.run?.id;
      setAiEditInstruction('');
      setFileMentionOptions([]);
      if (runId) {
        setError('');
        await loadAll({ silent: true });
      }
    } catch (err) {
      console.error('Failed to queue AI file augmentation:', err);
      setError(err?.response?.data?.error || 'Failed to queue AI file augmentation');
    } finally {
      setAiEditBusy(false);
    }
  }, [aiEditBusy, aiEditInstruction, aiEditTarget, apiUrl, headers, loadAll, selectedProjectId]);

  const applyFileMentionSelection = useCallback((relativePath) => {
    if (!relativePath) return;
    setAiEditTarget(`@${relativePath}`);
    setFileMentionOptions([]);
  }, []);

  const applyPromptMention = useCallback((relativePath) => {
    const textarea = promptTextareaRef.current;
    if (!relativePath || !textarea) return;
    const cursor = promptCursorRef.current;
    const before = runPrompt.slice(0, cursor);
    const after = runPrompt.slice(cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) return;
    const newBefore = before.slice(0, before.length - match[0].length) + `@${relativePath} `;
    setRunPrompt(newBefore + after);
    setPromptMentionOptions([]);
    setPromptMentionIdx(-1);
    const newCursor = newBefore.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursor, newCursor);
      promptCursorRef.current = newCursor;
    });
  }, [runPrompt]);

  const handleToggleTodoStatus = useCallback(async (idea) => {
    if (!idea?.id) return;
    const status = String(idea.status || '').trim().toUpperCase();
    const nextStatus = status === 'DONE' || status === 'COMPLETED' ? 'OPEN' : 'DONE';
    setTodoBusy(true);
    try {
      await axios.patch(`${apiUrl}/researchops/ideas/${idea.id}`, { status: nextStatus }, { headers });
      await loadAll({ silent: true });
      setError('');
    } catch (err) {
      console.error('Failed to update todo status:', err);
      setError(err?.response?.data?.error || 'Failed to update todo status');
    } finally {
      setTodoBusy(false);
    }
  }, [apiUrl, headers, loadAll]);

  const handleEnqueueRun = async (event) => {
    event.preventDefault();
    if (!selectedProjectId || !runServerId.trim()) return;
    setSubmitting(true);
    try {
      let parsedWorkflow = [];
      const defaultProjectCwd = String(selectedProject?.projectPath || '').trim();
      const sourceProjectServerId = String(selectedProject?.serverId || '').trim();
      if (runType === 'EXPERIMENT') {
        if (!runExperimentCommand.trim()) {
          throw new Error('Script command is required');
        }
        parsedWorkflow = [
          {
            id: 'experiment_bash',
            type: 'bash.run',
            inputs: {
              cmd: runExperimentCommand.trim(),
            },
          },
          {
            id: 'report',
            type: 'report.render',
            inputs: { format: 'md+json' },
          },
        ];
      } else {
        parsedWorkflow = [
          {
            id: 'agent_run',
            type: 'agent.run',
            inputs: {
              prompt: runPrompt.trim() || 'Continue with the project objective and produce concise results.',
              provider: 'codex_cli',
            },
          },
          {
            id: 'report',
            type: 'report.render',
            inputs: { format: 'md+json' },
          },
        ];
      }

      const linkedKnowledgeGroupIds = Array.isArray(selectedProject?.knowledgeGroupIds)
        ? [...new Set(
          selectedProject.knowledgeGroupIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )]
        : [];
      const pinIds = [...new Set((pinnedAssetIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];

      const payload = {
        projectId: selectedProjectId,
        serverId: runServerId.trim(),
        runType,
        provider: runType === 'AGENT' ? 'codex_cli' : undefined,
        schemaVersion: '2.0',
        mode: 'headless',
        workflow: parsedWorkflow,
        contextRefs: {
          ...(linkedKnowledgeGroupIds.length > 0 ? { knowledgeGroupIds: linkedKnowledgeGroupIds } : {}),
          ...(pinIds.length > 0 ? { insightAssetIds: pinIds, knowledgeAssetIds: pinIds } : {}),
        },
        outputContract: {
          summaryRequired: true,
          requiredArtifacts: ['result_manifest', 'run_summary_md'],
        },
        metadata: {
          sourceType: 'custom',
          sourceLabel: 'Custom',
          ...(runType === 'AGENT' ? { prompt: runPrompt.trim() || undefined } : {}),
          ...(runType === 'EXPERIMENT' ? { experimentCommand: runExperimentCommand.trim() || undefined } : {}),
          ...(defaultProjectCwd ? { cwd: defaultProjectCwd } : {}),
          ...(sourceProjectServerId ? { cwdSourceServerId: sourceProjectServerId } : {}),
          ...(pinIds.length > 0 ? { pinnedAssetIds: pinIds } : {}),
        },
      };
      await axios.post(`${apiUrl}/researchops/runs/enqueue-v2`, payload, { headers });
      setRunPrompt('');
      setRunExperimentCommand('');
      setLauncherContinuationChips([]);
      setShowEnqueueRunModal(false);
      await loadAll();
    } catch (err) {
      console.error('Failed to enqueue run:', err);
      setError(err?.response?.data?.error || 'Failed to enqueue run');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncSkills = useCallback(async () => {
    setError('');
    setSyncingSkills(true);
    try {
      await axios.post(`${apiUrl}/researchops/skills/sync`, {}, { headers });
      await loadAll();
      if (selectedProjectRef.current) {
        await loadProjectInsights(selectedProjectRef.current, { silent: true });
      }
    } catch (err) {
      console.error('Failed to sync skills:', err);
      setError(err?.response?.data?.error || 'Failed to sync skills');
    } finally {
      setSyncingSkills(false);
    }
  }, [apiUrl, headers, loadAll, loadProjectInsights]);

  const handleCheckpointDecision = useCallback(async (checkpointId, decision, extraPayload = null) => {
    if (!selectedRunId || !checkpointId) return;
    setCheckpointActionLoadingId(String(checkpointId));
    try {
      await axios.post(
        `${apiUrl}/researchops/runs/${selectedRunId}/checkpoints/${checkpointId}/decision`,
        {
          decision,
          ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {}),
        },
        { headers }
      );
      await Promise.all([
        loadAll({ silent: true }),
        loadRunReport(selectedRunId, { silent: true }),
      ]);
    } catch (err) {
      console.error('Failed to decide checkpoint:', err);
      setError(err?.response?.data?.error || 'Failed to update checkpoint decision');
    } finally {
      setCheckpointActionLoadingId(null);
    }
  }, [apiUrl, headers, selectedRunId, loadAll, loadRunReport]);

  const handleCheckpointEdit = useCallback((checkpointId) => {
    setCheckpointEditId(checkpointId);
    setCheckpointEditNote('Adjusting execution plan before approval.');
    setCheckpointEditJson('');
    setCheckpointEditJsonError('');
    setShowCheckpointEditModal(true);
  }, []);

  const handleCheckpointEditSubmit = useCallback(async () => {
    if (!checkpointEditNote.trim()) return;
    let edits = null;
    if (checkpointEditJson.trim()) {
      try {
        edits = JSON.parse(checkpointEditJson);
      } catch (parseError) {
        setCheckpointEditJsonError(`Invalid JSON: ${parseError.message}`);
        return;
      }
    }
    setShowCheckpointEditModal(false);
    await handleCheckpointDecision(checkpointEditId, 'EDIT', {
      note: checkpointEditNote.trim(),
      ...(edits && typeof edits === 'object' ? { edits } : {}),
    });
  }, [checkpointEditId, checkpointEditJson, checkpointEditNote, handleCheckpointDecision]);

  const handleRetryRun = useCallback(async () => {
    if (!selectedRunId) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/runs/${selectedRunId}/retry`, {}, { headers });
      await loadAll();
    } catch (err) {
      console.error('Failed to retry run:', err);
      setError(err?.response?.data?.error || 'Failed to retry run');
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, loadAll, selectedRunId]);

  const handleAbortRun = useCallback(async () => {
    if (!selectedRunId) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/runs/${selectedRunId}/cancel`, {}, { headers });
      await Promise.all([
        loadAll(),
        loadRunReport(selectedRunId, { silent: true }),
      ]);
    } catch (err) {
      console.error('Failed to abort run:', err);
      setError(err?.response?.data?.error || 'Failed to abort run');
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, loadAll, loadRunReport, selectedRunId]);

  const handleInsertWorkflowStep = useCallback(() => {
    if (!selectedRunId) return;
    setInsertStepJson(JSON.stringify({
      id: 'extra_step',
      type: 'agent.run',
      inputs: { prompt: 'Analyze latest artifacts and emit concise summary.' },
      retryPolicy: { maxRetries: 1, onFailure: 'abort' },
    }, null, 2));
    setShowInsertStepModal(true);
  }, [selectedRunId]);

  const handleInsertWorkflowStepSubmit = useCallback(async () => {
    let step = null;
    try {
      step = JSON.parse(insertStepJson);
    } catch (parseError) {
      setError(`Invalid step JSON: ${parseError.message}`);
      return;
    }
    setShowInsertStepModal(false);
    setSubmitting(true);
    try {
      await axios.post(
        `${apiUrl}/researchops/runs/${selectedRunId}/workflow/insert`,
        { step },
        { headers }
      );
      await Promise.all([
        loadAll(),
        loadRunReport(selectedRunId, { silent: true }),
      ]);
    } catch (err) {
      console.error('Failed to insert workflow step:', err);
      setError(err?.response?.data?.error || 'Failed to insert workflow step');
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, insertStepJson, loadAll, loadRunReport, selectedRunId]);

  const runTreeNodeStep = useCallback(async (nodeId, options = {}) => {
    const projectId = String(selectedProjectId || '').trim();
    const safeNodeId = String(nodeId || '').trim();
    if (!projectId || !safeNodeId) return;
    setSubmitting(true);
    setTreeError('');
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/${safeNodeId}/run-step`,
        options,
        { headers }
      );
      if (!options?.preflightOnly) {
        await Promise.all([
          loadAll({ silent: true }),
          loadTreeWorkspace(projectId, { silent: true }),
          loadRunHistoryPage(projectId, { reset: true }),
        ]);
      }
      return response.data || null;
    } catch (err) {
      const code = err?.response?.data?.code;
      const blockedBy = Array.isArray(err?.response?.data?.blockedBy) ? err.response.data.blockedBy : [];
      const message = err?.response?.data?.error || err?.message || 'Failed to run node step';
      if (code === 'NODE_BLOCKED' && blockedBy.length > 0) {
        setTreeError(`${code}: ${message} (${blockedBy.map((item) => item.depId || item.check || item.type).join(', ')})`);
      } else {
        setTreeError(code ? `${code}: ${message}` : message);
      }
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, loadAll, loadRunHistoryPage, loadTreeWorkspace, selectedProjectId]);

  const runTreeAll = useCallback(async (options = {}) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId) return;
    const fromNodeId = String(options?.fromNodeId || selectedNodeId || '').trim();
    setSubmitting(true);
    try {
      await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/run-all`,
        {
          fromNodeId: fromNodeId || undefined,
          scope: runAllScope || 'active_path',
        },
        { headers }
      );
      await Promise.all([
        loadAll({ silent: true }),
        loadTreeWorkspace(projectId, { silent: true }),
        loadRunHistoryPage(projectId, { reset: true }),
      ]);
    } catch (err) {
      const code = err?.response?.data?.code;
      const message = err?.response?.data?.error || err?.message || 'Failed to run all steps';
      setTreeError(code ? `${code}: ${message}` : message);
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, loadAll, loadRunHistoryPage, loadTreeWorkspace, runAllScope, selectedNodeId, selectedProjectId]);

  const handleDeleteRun = useCallback(async (runId) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId) return;
    const previousRuns = runs;
    const previousRunHistoryItems = runHistoryItems;
    const nextState = removeProjectRunsFromState({
      runs: previousRuns,
      runHistoryItems: previousRunHistoryItems,
      projectId,
      runId,
    });
    setRuns(nextState.runs);
    setRunHistoryItems(nextState.runHistoryItems);
    if (cleanString(selectedRunId) === cleanString(runId)) {
      setSelectedRunId('');
      setRunReport(null);
      setRunContextPack(null);
      setShowRunDetailModal(false);
    }
    try {
      await axios.delete(`${apiUrl}/researchops/runs/${runId}`, { headers });
      await Promise.all([
        loadRunHistoryPage(projectId, { reset: true }),
        loadAll({ silent: true }),
      ]);
    } catch (err) {
      console.error('Failed to delete run:', err);
      setRuns(previousRuns);
      setRunHistoryItems(previousRunHistoryItems);
      await Promise.all([
        loadRunHistoryPage(projectId, { reset: true }),
        loadAll({ silent: true }),
      ]);
    }
  }, [apiUrl, headers, loadAll, loadRunHistoryPage, runHistoryItems, runs, selectedProjectId, selectedRunId]);

  const handleClearRuns = useCallback(async (status = '') => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId) return;
    const previousRuns = runs;
    const previousRunHistoryItems = runHistoryItems;
    const nextState = removeProjectRunsFromState({
      runs: previousRuns,
      runHistoryItems: previousRunHistoryItems,
      projectId,
      status,
    });
    setRuns(nextState.runs);
    setRunHistoryItems(nextState.runHistoryItems);
    if (!status || cleanString(selectedRun?.status).toUpperCase() === cleanString(status).toUpperCase()) {
      setSelectedRunId('');
      setRunReport(null);
      setRunContextPack(null);
      setShowRunDetailModal(false);
    }
    try {
      await axios.delete(`${apiUrl}/researchops/projects/${projectId}/runs${status ? `?status=${status}` : ''}`, { headers });
      await Promise.all([
        loadRunHistoryPage(projectId, { reset: true }),
        loadAll({ silent: true }),
      ]);
    } catch (err) {
      console.error('Failed to clear run history:', err);
      setRuns(previousRuns);
      setRunHistoryItems(previousRunHistoryItems);
      await Promise.all([
        loadRunHistoryPage(projectId, { reset: true }),
        loadAll({ silent: true }),
      ]);
    }
  }, [apiUrl, headers, loadAll, loadRunHistoryPage, runHistoryItems, runs, selectedProjectId, selectedRun]);

  const handleRerunRun = useCallback(async (runId) => {
    try {
      const resp = await axios.get(
        `${apiUrl}/researchops/runs/${encodeURIComponent(runId)}`,
        { headers }
      );
      const originalRun = resp.data?.data?.run || resp.data?.run;
      if (!originalRun) return;
      await axios.post(
        `${apiUrl}/researchops/runs/enqueue-v2`,
        {
          projectId: originalRun.projectId,
          serverId: originalRun.serverId,
          runType: originalRun.runType,
          provider: originalRun.provider,
          workflow: originalRun.workflow || [],
          skillRefs: originalRun.skillRefs || [],
          contextRefs: originalRun.contextRefs || {},
          metadata: { ...(originalRun.metadata || {}), rerunOf: runId },
        },
        { headers }
      );
      await loadRunHistoryPage(selectedProjectId, { reset: true });
    } catch (err) {
      console.error('[VibePanel] re-run failed:', err);
    }
  }, [apiUrl, headers, loadRunHistoryPage, selectedProjectId]);

  const setTreeControl = useCallback(async (action) => {
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/projects/${projectId}/tree/control/${action}`, {}, { headers });
      await loadTreeWorkspace(projectId, { silent: true });
    } catch (err) {
      const code = err?.response?.data?.code;
      const message = err?.response?.data?.error || err?.message || `Failed to ${action} queue`;
      setTreeError(code ? `${code}: ${message}` : message);
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, headers, loadTreeWorkspace, selectedProjectId]);

  const handleLoadSearchNode = useCallback(async (nodeId, { refresh = true } = {}) => {
    const projectId = String(selectedProjectId || '').trim();
    const safeNodeId = String(nodeId || '').trim();
    if (!projectId || !safeNodeId) return;
    setSearchLoading(true);
    try {
      const response = await axios.get(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/${safeNodeId}/search`,
        {
          headers,
          params: refresh ? { refresh: true } : {},
        }
      );
      setSearchData(response.data?.search || null);
      return response.data?.search || null;
    } catch (err) {
      setTreeError(err?.response?.data?.error || err?.message || 'Failed to load search node');
      return null;
    } finally {
      setSearchLoading(false);
    }
  }, [apiUrl, headers, selectedProjectId]);

  const promoteSearchWinner = useCallback(async (nodeId) => {
    const projectId = String(selectedProjectId || '').trim();
    const safeNodeId = String(nodeId || '').trim();
    if (!projectId || !safeNodeId) return;
    setSubmitting(true);
    try {
      const latest = await handleLoadSearchNode(safeNodeId, { refresh: true });
      const trials = Array.isArray(latest?.trials) ? latest.trials : [];
      const winner = trials
        .filter((trial) => ['PASSED', 'SUCCEEDED'].includes(String(trial?.status || '').toUpperCase()))
        .sort((a, b) => Number(b.reward || 0) - Number(a.reward || 0))[0];
      if (!winner?.id) {
        setTreeError('No promotable PASSED trial found for this search node.');
        return;
      }
      await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/${safeNodeId}/promote/${winner.id}`,
        {},
        { headers }
      );
      await loadTreeWorkspace(projectId, { silent: true });
    } catch (err) {
      setTreeError(err?.response?.data?.error || err?.message || 'Failed to promote search winner');
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, handleLoadSearchNode, headers, loadTreeWorkspace, selectedProjectId]);

  const handleSelectNode = useCallback((nodeId) => {
    setSelectedNodeId((prev) => (prev === String(nodeId) ? '' : String(nodeId)));
  }, []);

  const handleTreeNodeAction = useCallback(async (action, node) => {
    const nodeId = String(node?.id || '').trim();
    const projectId = String(selectedProjectId || '').trim();
    if (!projectId || !nodeId) return;
    const parentId = String(node?.parent || '').trim();
    const random = () => Math.random().toString(36).slice(2, 8);

    try {
      if (action === 'run_step' || action === 'rerun') {
        await runTreeNodeStep(nodeId, { force: action === 'rerun' });
        return;
      }
      if (action === 'run_step_preflight') {
        await runTreeNodeStep(nodeId, { preflightOnly: true });
        return;
      }
      if (action === 'run_step_force') {
        await runTreeNodeStep(nodeId, { force: true });
        return;
      }
      if (action === 'approve_gate') {
        await axios.post(`${apiUrl}/researchops/projects/${projectId}/tree/nodes/${nodeId}/approve`, {}, { headers });
        await loadTreeWorkspace(projectId, { silent: true });
        return;
      }
      if (action === 'promote') {
        await promoteSearchWinner(nodeId);
        return;
      }
      if (action === 'continue_from') {
        setSelectedNodeId(nodeId);
        await runTreeAll({ fromNodeId: nodeId });
        return;
      }
      if (action === 'create_patch_node') {
        await applyPlanPatches([{
          op: 'add_node',
          node: {
            id: `${nodeId}_patch_${random()}`,
            parent: nodeId,
            title: `Patch for ${node.title || nodeId}`,
            kind: 'patch',
            commands: [],
            checks: [],
            assumption: [],
            target: [],
          },
        }]);
        return;
      }
      if (action === 'add_child') {
        await applyPlanPatches([{
          op: 'add_node',
          node: {
            id: `${nodeId}_child_${random()}`,
            parent: nodeId,
            title: `Child of ${node.title || nodeId}`,
            kind: 'experiment',
            commands: [],
            checks: [],
            assumption: [],
            target: [],
          },
        }]);
        return;
      }
      if (action === 'add_branch') {
        await applyPlanPatches([{
          op: 'add_node',
          node: {
            id: `${nodeId}_branch_${random()}`,
            parent: parentId || undefined,
            title: `Branch from ${node.title || nodeId}`,
            kind: 'experiment',
            commands: [],
            checks: [],
            assumption: [],
            target: [],
          },
        }]);
        return;
      }
      if (action === 'insert') {
        const insertId = `${nodeId}_insert_${random()}`;
        await applyPlanPatches([
          {
            op: 'add_node',
            node: {
              id: insertId,
              parent: parentId || undefined,
              title: `Inserted before ${node.title || nodeId}`,
              kind: 'experiment',
              commands: [],
              checks: [],
              assumption: [],
              target: [],
            },
          },
          {
            op: 'move_node',
            nodeId,
            parentId: insertId,
          },
        ]);
        return;
      }
      if (action === 'duplicate') {
        await applyPlanPatches([{
          op: 'duplicate_node',
          nodeId,
          newNodeId: `${nodeId}_copy_${random()}`,
        }]);
        return;
      }
      if (action === 'convert_search') {
        await applyPlanPatches([{
          op: 'set_field',
          nodeId,
          path: 'kind',
          value: 'search',
        }]);
        return;
      }
    } catch (err) {
      // Error already surfaced by called helper.
    }
  }, [apiUrl, applyPlanPatches, headers, loadTreeWorkspace, promoteSearchWinner, runTreeAll, runTreeNodeStep, selectedProjectId]);

  const handleInsertNodeFromTodo = useCallback(async (node) => {
    await applyPlanPatches([{ op: 'add_node', node }]);
  }, [applyPlanPatches]);

  const openTodoEdit = useCallback((idea) => {
    setTodoEditTarget({ todo: idea });
    setTodoEditTitle(idea.title || '');
    setTodoEditHypothesis(idea.hypothesis || '');
  }, []);

  const handleSaveTodoEdit = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!todoEditTarget || todoEditBusy) return;
    setTodoEditBusy(true);
    try {
      await axios.patch(`${apiUrl}/researchops/ideas/${todoEditTarget.todo.id}`, {
        title: todoEditTitle.trim(),
        hypothesis: todoEditHypothesis.trim(),
      }, { headers });
      setTodoEditTarget(null);
      await loadAll({ silent: true });
    } catch (err) {
      console.error('Failed to update todo:', err);
    } finally {
      setTodoEditBusy(false);
    }
  }, [apiUrl, headers, loadAll, todoEditBusy, todoEditHypothesis, todoEditTarget, todoEditTitle]);

  const handleSaveNodeCommands = useCallback(async (nodeId, commands = []) => {
    try {
      await applyPlanPatches([{
        op: 'set_field',
        nodeId,
        path: 'commands',
        value: commands,
      }]);
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Failed to save commands';
      setTreeError(message);
    }
  }, [applyPlanPatches]);

  const projectStats = useMemo(() => {
    const stats = new Map();
    projects.forEach((project) => {
      stats.set(project.id, { ideas: 0, queued: 0 });
    });
    ideas.forEach((idea) => {
      if (!stats.has(idea.projectId)) stats.set(idea.projectId, { ideas: 0, queued: 0 });
      stats.get(idea.projectId).ideas += 1;
    });
    queue.forEach((run) => {
      if (!stats.has(run.projectId)) stats.set(run.projectId, { ideas: 0, queued: 0 });
      stats.get(run.projectId).queued += 1;
    });
    return stats;
  }, [projects, ideas, queue]);

  const selectedProjectIdeas = useMemo(
    () => ideas.filter((idea) => idea.projectId === selectedProjectId),
    [ideas, selectedProjectId]
  );

  const selectedProjectTodos = useMemo(() => (
    [...selectedProjectIdeas]
      .filter((idea) => {
        const status = String(idea.status || '').trim().toUpperCase();
        return status !== 'DONE' && status !== 'COMPLETED';
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  ), [selectedProjectIdeas]);

  const selectedProjectCompletedTodoCount = useMemo(() => (
    Math.max(selectedProjectIdeas.length - selectedProjectTodos.length, 0)
  ), [selectedProjectIdeas.length, selectedProjectTodos.length]);

  const selectedProjectQueue = useMemo(
    () => queue.filter((run) => run.projectId === selectedProjectId),
    [queue, selectedProjectId]
  );

  const selectedProjectRuns = useMemo(
    () => runs.filter((run) => run.projectId === selectedProjectId),
    [runs, selectedProjectId]
  );
  const observedSessionCards = useMemo(
    () => buildObservedSessionCards(observedSessions).slice(0, 18),
    [observedSessions]
  );
  const observedSessionsByNodeId = useMemo(() => {
    const map = new Map();
    observedSessions.forEach((item) => {
      const nodeId = cleanString(item?.detachedNodeId);
      if (nodeId) map.set(nodeId, item);
    });
    return map;
  }, [observedSessions]);

  const visibleRuns = useMemo(() => (
    runHistoryItems.length > 0 ? runHistoryItems : selectedProjectRuns
  ), [runHistoryItems, selectedProjectRuns]);
  const scopedVisibleRuns = useMemo(
    () => filterRunsForSelectedNode(visibleRuns, selectedNodeId),
    [selectedNodeId, visibleRuns]
  );
  const recentRunCards = useMemo(
    () => buildRecentRunCards(scopedVisibleRuns).slice(0, 18),
    [scopedVisibleRuns]
  );
  const activityFeed = useMemo(
    () => buildActivityFeed({ runCards: recentRunCards, observedSessionCards }),
    [observedSessionCards, recentRunCards]
  );
  const recentRunsScopeLabel = useMemo(() => {
    if (!selectedNodeId) return 'Project scope';
    return scopedVisibleRuns.length !== visibleRuns.length ? 'Node scope' : 'Project scope';
  }, [scopedVisibleRuns.length, selectedNodeId, visibleRuns.length]);
  const selectedRun = useMemo(
    () => visibleRuns.find((run) => run.id === selectedRunId) || null,
    [selectedRunId, visibleRuns]
  );
  const activeRunReport = useMemo(() => (
    runReport?.run?.id === selectedRunId ? runReport : null
  ), [runReport, selectedRunId]);
  const activeRunContextView = useMemo(() => (
    runContextPack?.pack?.runId === selectedRunId
    && runContextPack?.view
    && typeof runContextPack.view === 'object'
      ? runContextPack.view
      : null
  ), [runContextPack, selectedRunId]);
  const effectiveTreeState = useMemo(() => {
    const base = treeState && typeof treeState === 'object' ? treeState : createEmptyTreeState();
    const baseNodes = base?.nodes && typeof base.nodes === 'object' ? base.nodes : {};
    const observedNodes = {};
    observedSessions.forEach((item) => {
      const nodeId = cleanString(item?.detachedNodeId);
      if (!nodeId) return;
      observedNodes[nodeId] = {
        ...(baseNodes[nodeId] && typeof baseNodes[nodeId] === 'object' ? baseNodes[nodeId] : {}),
        status: mapObservedSessionStatus(item?.status),
        observedSessionId: cleanString(item?.id),
        observedProvider: cleanString(item?.provider),
        updatedAt: cleanString(item?.updatedAt),
      };
    });
    return {
      ...base,
      nodes: {
        ...baseNodes,
        ...observedNodes,
      },
    };
  }, [observedSessions, treeState]);
  const shouldShowJumpstartGate = useMemo(() => shouldShowProjectEntryGate({
    project: selectedProject,
    plan: treePlan,
    treeState: effectiveTreeState,
    environmentDetected: treeEnvironmentDetected,
    todoCount: selectedProjectIdeas.length,
    treeWorkspaceReady,
  }), [effectiveTreeState, selectedProject, treePlan, treeEnvironmentDetected, treeWorkspaceReady, selectedProjectIdeas.length]);

  const selectedTreeNode = useMemo(() => {
    if (!selectedNodeId || !Array.isArray(treePlan?.nodes)) return null;
    return treePlan.nodes.find((node) => String(node.id || '').trim() === String(selectedNodeId).trim()) || null;
  }, [selectedNodeId, treePlan]);

  const selectedTreeNodeState = useMemo(() => (
    selectedNodeId && effectiveTreeState?.nodes && typeof effectiveTreeState.nodes === 'object'
      ? (effectiveTreeState.nodes[selectedNodeId] || null)
      : null
  ), [effectiveTreeState, selectedNodeId]);
  const selectedObservedSession = useMemo(() => (
    selectedNodeId ? (observedSessionsByNodeId.get(selectedNodeId) || null) : null
  ), [observedSessionsByNodeId, selectedNodeId]);

  const knowledgeBaseFolder = String(selectedProject?.kbFolderPath || '').trim();

  const projectTreeEntries = useMemo(
    () => (Array.isArray(projectFileTree?.entries) ? projectFileTree.entries : []),
    [projectFileTree]
  );

  const projectCurrentPath = String(projectFileTree?.currentPath || '').trim();
  const projectParentPath = String(projectFileTree?.parentPath || '').trim();
  const projectRootPath = String(projectFileTree?.rootPath || '').trim();

  const kbTreeEntries = useMemo(
    () => (Array.isArray(kbFileTree?.entries) ? kbFileTree.entries : []),
    [kbFileTree]
  );
  const kbCurrentPath = String(kbFileTree?.currentPath || '').trim();
  const kbParentPath = String(kbFileTree?.parentPath || '').trim();
  const treeExecutionSummary = useMemo(
    () => buildTreeExecutionSummary(treePlan || { nodes: [] }, effectiveTreeState || { nodes: {} }),
    [effectiveTreeState, treePlan]
  );
  const nextTreeNode = useMemo(() => {
    const nodes = Array.isArray(treePlan?.nodes) ? treePlan.nodes : [];
    const stateNodes = effectiveTreeState?.nodes && typeof effectiveTreeState.nodes === 'object' ? effectiveTreeState.nodes : {};
    return nodes.find((node) => {
      const status = cleanString(stateNodes?.[node.id]?.status).toUpperCase() || 'PLANNED';
      return ['PLANNED', 'BLOCKED', 'RUNNING', 'QUEUED', 'FAILED'].includes(status);
    }) || null;
  }, [effectiveTreeState, treePlan]);
  const nextTreeNodeAction = useMemo(() => (
    nextTreeNode
      ? getPrimaryTreeAction(nextTreeNode, effectiveTreeState?.nodes?.[nextTreeNode.id] || {})
      : ''
  ), [effectiveTreeState, nextTreeNode]);

  const runReportView = useMemo(() => {
    const activeReport = activeRunReport;
    const manifest = activeReport?.manifest && typeof activeReport.manifest === 'object'
      ? activeReport.manifest
      : null;
    const artifacts = Array.isArray(activeReport?.artifacts) ? activeReport.artifacts : [];
    const byId = new Map(artifacts.map((item) => [String(item.id), item]));
    const enrich = (item = {}) => {
      const artifact = byId.get(String(item.id)) || null;
      return {
        ...item,
        artifact,
        objectUrl: item.objectUrl || artifact?.objectUrl || null,
        inlinePreview: item.inlinePreview || artifact?.metadata?.inlinePreview || '',
      };
    };
    const tables = Array.isArray(manifest?.tables) ? manifest.tables.map(enrich) : [];
    const figures = Array.isArray(manifest?.figures) ? manifest.figures.map(enrich) : [];
    const metrics = Array.isArray(manifest?.metrics) ? manifest.metrics.map(enrich) : [];
    return {
      manifest,
      tables,
      figures,
      metrics,
      sinks: manifest?.observability?.sinks && typeof manifest.observability.sinks === 'object'
        ? manifest.observability.sinks
        : {},
      warnings: Array.isArray(manifest?.observability?.warnings) ? manifest.observability.warnings : [],
      contractValidation: manifest?.contractValidation && typeof manifest.contractValidation === 'object'
        ? manifest.contractValidation
        : null,
    };
  }, [activeRunReport]);

  const openCreateProjectModal = () => {
    setError('');
    setShowCreateProjectModal(true);
    loadSshServers();
    loadClientDevices();
  };

  const closeCreateProjectModal = () => {
    if (submitting) return;
    resetProjectDraft();
    setShowCreateProjectModal(false);
  };

  const openCreateIdeaModal = () => {
    setError('');
    setShowCreateIdeaModal(true);
  };

  const closeCreateIdeaModal = () => {
    if (submitting) return;
    setIdeaTitle('');
    setIdeaHypothesis('');
    setShowCreateIdeaModal(false);
  };

  const TODO_MANAGER_SKILL_PREFIX = 'You are a project TODO management specialist. Focus on task triage, prioritization, actionability, and safe status transitions. If requested, propose the next executable TODO and concise implementation steps.\n\nUser request:\n';
  const RESOURCE_KB_SKILL_PREFIX = [
    'You are a resource-aware research assistant for this project.',
    'Primary source of truth is the project resource repository under `resource/`.',
    'Always start by reading these files if present: `resource/paper_assets_index.md`, `resource/notes.md`, `resource/research_questions.md`.',
    'Then open the most relevant paper folders (README/meta/source snippets) to answer the request.',
    'Return concise findings with explicit file-path citations and mark unknowns clearly.',
    '',
    'User request:',
  ].join('\n');
  const CODE_CHAT_SKILL_PREFIX = [
    'You are a codebase-aware engineering assistant for this project.',
    'Always inspect the auto-located code paths first, then answer with concrete implementation/debug guidance.',
    'If proposing code changes, reference exact file paths and keep edits scoped.',
    'Return concise actionable output and mark unknowns explicitly.',
    '',
    'User request:',
  ].join('\n');

  const handleLaunchAgent = async (event, options = {}) => {
    if (event) event.preventDefault();
    const selectedSkill = cleanString(options?.skill || agentSkill) || DEFAULT_LAUNCHER_SKILL;
    const promptText = cleanString(options?.prompt || runPrompt);
    const sourceType = cleanString(options?.sourceType || 'launcher') || 'launcher';
    if (!selectedProjectId || !promptText) return;
    setSubmitting(true);
    setError('');
    try {
      const defaultCwd = String(selectedProject?.projectPath || '').trim();
      const sourceServerId = String(selectedProject?.serverId || '').trim();
      let locatedKb = { paths: [], items: [] };
      let locatedCode = { paths: [], items: [] };
      if (selectedSkill === 'resource_kb') {
        locatedKb = await locateKbResourcePaths(selectedProjectId, promptText, { limit: 12 });
      }
      if (selectedSkill === 'code_chat') {
        locatedCode = await locateCodePaths(selectedProjectId, promptText, { limit: 12 });
      }
      const prefix = selectedSkill === 'todo_manager'
        ? TODO_MANAGER_SKILL_PREFIX
        : (selectedSkill === 'resource_kb'
          ? RESOURCE_KB_SKILL_PREFIX
          : (selectedSkill === 'code_chat'
            ? CODE_CHAT_SKILL_PREFIX
            : getLauncherPromptPrefix(selectedSkill)));
      const kbAutoLocateBlock = selectedSkill === 'resource_kb'
        ? [
          '',
          'Auto-located resource files for this request (open these first):',
          ...(locatedKb.paths.length
            ? locatedKb.paths.slice(0, 12).map((item) => `- resource/${item}`)
            : KB_RESOURCE_SEED_PATHS.map((item) => `- resource/${item}`)),
        ].join('\n')
        : '';
      const codeAutoLocateBlock = selectedSkill === 'code_chat'
        ? [
          '',
          'Auto-located code files for this request (inspect these first):',
          ...(locatedCode.paths.length
            ? locatedCode.paths.slice(0, 12).map((item) => `- ${item}`)
            : CODE_CHAT_SEED_PATHS.map((item) => `- ${item}`)),
        ].join('\n')
        : '';
      const fullPrompt = `${prefix}${promptText}${kbAutoLocateBlock}${codeAutoLocateBlock}`;
      const selectedSkillRef = selectedSkill === 'todo_manager'
        ? { id: 'project-todo-manager', name: 'project-todo-manager' }
        : (selectedSkill === 'resource_kb'
          ? { id: 'skill_resource-kb-researcher', name: 'resource-kb-researcher' }
          : (selectedSkill === 'code_chat'
            ? { id: 'code_chat', name: 'code_chat' }
            : null));
      const runContextRefs = {
        knowledgeGroupIds: selectedProject?.knowledgeGroupIds || [],
        ...(selectedSkill === 'resource_kb'
          ? {
            kbResourceQuery: promptText,
            kbResourcePaths: locatedKb.paths,
          }
          : {}),
        ...(selectedSkill === 'code_chat'
          ? {
            codeQuery: promptText,
            codePaths: locatedCode.paths,
          }
          : {}),
      };
      const workflow = [
        { id: 'agent_main', type: 'agent.run', inputs: { prompt: fullPrompt, provider: runProvider, ...(runModel ? { model: runModel } : {}), ...(runProvider === 'codex_cli' && runReasoningEffort ? { reasoningEffort: runReasoningEffort } : {}) } },
        { id: 'report', type: 'report.render', inputs: { format: 'md+json' } },
      ];
      let payload = {
        projectId: selectedProjectId,
        serverId: runServerId.trim() || 'local-default',
        runType: 'AGENT',
        provider: runProvider,
        schemaVersion: '2.0',
        mode: 'headless',
        workflow,
        skillRefs: selectedSkillRef ? [selectedSkillRef] : [],
        contextRefs: runContextRefs,
        metadata: {
          prompt: promptText,
          agentSkill: selectedSkill,
          sourceType,
          sourceLabel: sourceType === 'custom' ? 'Custom' : 'Launcher',
          ...(selectedSkill === 'resource_kb'
            ? {
              kbResourceQuery: promptText,
              kbResourcePaths: locatedKb.paths,
              kbResourceLocator: 'auto',
              kbResourceCandidateCount: Array.isArray(locatedKb?.items) ? locatedKb.items.length : 0,
            }
            : {}),
          ...(selectedSkill === 'code_chat'
            ? {
              codeQuery: promptText,
              codePaths: locatedCode.paths,
              codeLocator: 'files/search',
              codeCandidateCount: Array.isArray(locatedCode?.items) ? locatedCode.items.length : 0,
            }
            : {}),
          ...(defaultCwd ? { cwd: defaultCwd } : {}),
          ...(sourceServerId ? { cwdSourceServerId: sourceServerId } : {}),
          ...(pinnedAssetIds.length ? { pinnedAssetIds } : {}),
        },
      };
      payload = buildPayloadWithContinuation(payload, launcherContinuationChips);
      await axios.post(`${apiUrl}/researchops/runs/enqueue-v2`, payload, { headers });
      if (!options?.prompt) {
        setRunPrompt('');
      }
      if (selectedSkill === 'code_chat') {
        setCodeChatPrompt('');
      }
      setLauncherContinuationChips([]);
      await loadAll();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to launch agent');
    } finally {
      setSubmitting(false);
    }
  };

  const openEnqueueRunModal = () => {
    setError('');
    setRunExperimentCommand('');
    loadSshServers();
    setShowEnqueueRunModal(true);
  };

  const closeEnqueueRunModal = () => {
    if (submitting) return;
    setRunPrompt('');
    setRunExperimentCommand('');
    setShowEnqueueRunModal(false);
  };

  const closeSkillsModal = () => {
    if (syncingSkills || submitting) return;
    setShowSkillsModal(false);
    setEditingSkill(null);
    setSkillEditorContent('');
    setSkillEditorError('');
  };

  const openSkillEditor = async (skill) => {
    setEditingSkill(skill);
    setSkillEditorContent('');
    setSkillEditorError('');
    setSkillEditorLoading(true);
    try {
      const res = await axios.get(`${apiUrl}/researchops/skills/${encodeURIComponent(skill.id)}/content`, { headers });
      setSkillEditorContent(res.data.content || '');
    } catch (err) {
      setSkillEditorError(err?.response?.data?.error || 'Failed to load skill content');
    } finally {
      setSkillEditorLoading(false);
    }
  };

  const saveSkillEditor = async () => {
    if (!editingSkill) return;
    setSkillEditorSaving(true);
    setSkillEditorError('');
    try {
      await axios.put(
        `${apiUrl}/researchops/skills/${encodeURIComponent(editingSkill.id)}/content`,
        { content: skillEditorContent },
        { headers },
      );
      setEditingSkill(null);
      setSkillEditorContent('');
    } catch (err) {
      setSkillEditorError(err?.response?.data?.error || 'Failed to save skill');
    } finally {
      setSkillEditorSaving(false);
    }
  };

  const openKnowledgeHubModal = () => {
    setError('');
    setShowKnowledgeHubModal(true);
  };

  const focusLauncherInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = promptTextareaRef.current || document.getElementById('vibe-launcher-input');
      if (input && typeof input.focus === 'function') {
        input.focus();
        if (typeof input.scrollIntoView === 'function') {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }, []);

  const openCodeChatInLauncher = useCallback((promptSeed = '') => {
    const prompt = cleanString(promptSeed);
    setAgentSkill(DEFAULT_LAUNCHER_SKILL);
    if (prompt) {
      setRunPrompt(prompt);
    }
    focusLauncherInput();
  }, [focusLauncherInput]);

  const handleOpenRunDetail = useCallback((runId) => {
    const targetRunId = cleanString(runId);
    if (!targetRunId) return;
    setSelectedRunId(targetRunId);
    setShowRunDetailModal(true);
  }, []);

  const handleOpenObservedSession = useCallback((session) => {
    const detachedNodeId = cleanString(session?.detachedNodeId);
    if (!detachedNodeId) return;
    setSelectedNodeId(detachedNodeId);
  }, []);

  const handleRefreshObservedSession = useCallback(async (sessionId) => {
    const projectId = cleanString(selectedProjectId);
    const targetSessionId = cleanString(sessionId);
    if (!projectId || !targetSessionId) return;
    setObservedSessionRefreshingId(targetSessionId);
    try {
      const response = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/observed-sessions/${encodeURIComponent(targetSessionId)}/refresh`,
        {},
        { headers },
      );
      await loadObservedSessions(projectId, { silent: true });
      await loadTreeWorkspace(projectId, { silent: true, force: true });
      const detachedNodeId = cleanString(response.data?.item?.detachedNodeId);
      if (detachedNodeId) {
        setSelectedNodeId(detachedNodeId);
      }
    } catch (err) {
      console.error('Failed to refresh observed session:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to refresh observed session');
    } finally {
      setObservedSessionRefreshingId('');
    }
  }, [apiUrl, headers, loadObservedSessions, loadTreeWorkspace, selectedProjectId]);

  const handleContinueFromRun = useCallback((run) => {
    const chips = addContinuationChip([], run);
    setLauncherContinuationChips(chips);
    setShowRunDetailModal(false);
    focusLauncherInput();
  }, [focusLauncherInput]);

  const closeKnowledgeHubModal = () => {
    if (submitting) return;
    setShowKnowledgeHubModal(false);
  };

  const loadKnowledgeGroups = useCallback(async () => {
    setKnowledgeGroupsLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/knowledge-groups`, {
        headers,
        params: {
          limit: 100,
          offset: 0,
        },
      });
      const items = response.data?.items || [];
      setKnowledgeGroups(items);
    } catch (err) {
      console.error('Failed to load knowledge groups:', err);
      setError(err?.response?.data?.error || 'Failed to load knowledge groups');
    } finally {
      setKnowledgeGroupsLoading(false);
    }
  }, [apiUrl, headers]);

  useEffect(() => {
    setPathCheckResult(null);
  }, [
    projectClientDeviceId,
    projectClientMode,
    projectClientWorkspaceId,
    projectLocationType,
    projectPath,
    projectServerId,
  ]);

  useEffect(() => {
    if (!selectedProject) return;
    if (
      (selectedProject.locationType === 'ssh' && selectedProject.serverId)
      || (selectedProject.locationType === 'client' && selectedProject.clientMode === 'agent' && selectedProject.serverId)
    ) {
      setRunServerId(String(selectedProject.serverId));
    } else {
      setRunServerId('local-default');
    }
  }, [selectedProject]);

  const handleChangeProjectServer = useCallback(async (newServerId) => {
    if (!selectedProject || !newServerId) return;
    try {
      await axios.patch(
        `${apiUrl}/researchops/projects/${selectedProject.id}`,
        { serverId: newServerId },
        { headers },
      );
      setProjects((prev) => prev.map((p) =>
        p.id === selectedProject.id ? { ...p, serverId: newServerId } : p
      ));
      setRunServerId(newServerId);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to change project server');
    }
  }, [selectedProject, apiUrl, headers]);

  useEffect(() => {
    if (!selectedProjectId) {
      sshPollCooldownRef.current.clear();
      setGitLogLimit(5);
      setGitProgress(null);
      setGitError('');
      setFilesError('');
      setGitLoading(false);
      setFilesLoading(false);
      setProjectFileTree(null);
      setProjectFileTreeLoading(false);
      setProjectFileTreeError('');
      setProjectFileContent(null);
      setProjectFileContentError('');
      setKbFileTree(null);
      setKbFileTreeLoading(false);
      setKbFileTreeError('');
      setKbFileContent(null);
      setKbFileContentError('');
      setTreePlan(null);
      setTreeValidation(null);
      setTreeState(null);
      setTreeEnvironmentDetected(null);
      setTreeWorkspaceReady(false);
      setTreeError('');
      setTreeLoading(false);
      setSelectedNodeId('');
      setSearchData(null);
      setRunHistoryItems([]);
      setObservedSessions([]);
      setObservedSessionsLoading(false);
      setObservedSessionRefreshingId('');
      setRunHistoryCursor('');
      runHistoryCursorRef.current = '';
      setRunHistoryHasMore(false);
      runHistoryHasMoreRef.current = false;
      setRunHistoryLoading(false);
      setRunHistoryLoadingMore(false);
      runHistoryLoadingMoreRef.current = false;
      return;
    }
    setTreeWorkspaceReady(false);
    setGitLogLimit(5);
    loadProjectInsightsRef.current?.(selectedProjectId, { gitLimit: 5, force: true });
    loadProjectFileTreeRef.current?.(selectedProjectId, '', { force: true });
    // Keep workspace refresh silent to avoid persistent loading banner flicker.
    loadTreeWorkspaceRef.current?.(selectedProjectId, { silent: true, force: true });
    loadObservedSessions(selectedProjectId, { silent: true });
    loadRunHistoryPageRef.current?.(selectedProjectId, { reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadObservedSessions, selectedProjectId]);

  useEffect(() => {
    if (bottomLeftTab === 'knowledge' && selectedProjectId && !kbFileTree && !kbFileTreeLoading) {
      loadKbFileTree(selectedProjectId, '');
    }
  }, [bottomLeftTab, selectedProjectId, kbFileTree, kbFileTreeLoading, loadKbFileTree]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedRunId('');
      setRunReport(null);
      setRunContextPack(null);
      setShowRunDetailModal(false);
      return;
    }
    if (visibleRuns.length === 0) {
      setSelectedRunId('');
      setRunReport(null);
      setRunContextPack(null);
      setShowRunDetailModal(false);
      return;
    }
    setSelectedRunId((prev) => (
      prev && visibleRuns.some((run) => run.id === prev)
        ? prev
        : visibleRuns[0].id
    ));
  }, [selectedProjectId, visibleRuns]);

  useEffect(() => {
    if (!vibeUiMode.showTreePlanning || !selectedProject || treeLoading) return;
    if (shouldShowJumpstartGate) {
      setShowJumpstart(true);
      return;
    }
    setShowJumpstart(false);
  }, [selectedProject, shouldShowJumpstartGate, treeLoading, vibeUiMode.showTreePlanning]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunContextPack(null);
      setRunContextPackLoading(false);
      return;
    }
    loadRunReport(selectedRunId);
    loadRunContextPack(selectedRunId);
  }, [loadRunContextPack, loadRunReport, selectedRunId]);

  useEffect(() => {
    if (!selectedTreeNode || selectedTreeNode.kind !== 'search') {
      setSearchData(null);
      return;
    }
    handleLoadSearchNode(selectedTreeNode.id, { refresh: true });
  }, [handleLoadSearchNode, selectedTreeNode]);

  useEffect(() => {
    if (selectedProject) return;
    setShowCreateIdeaModal(false);
    setShowTodoModal(false);
    setShowKbFolderModal(false);
    setShowEnqueueRunModal(false);
    setShowKnowledgeHubModal(false);
    setShowSkillsModal(false);
    setShowRunDetailModal(false);
    setSelectedRunId('');
    setRunReport(null);
    setRunContextPack(null);
    setLauncherContinuationChips([]);
    setProjectFileTree(null);
    setProjectFileContent(null);
    setProjectFileTreeError('');
    setProjectFileContentError('');
    setAiEditTarget('');
    setAiEditInstruction('');
    setCodeChatPrompt('');
    setKbSyncJob(null);
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProjectId) return;
    loadKnowledgeGroups();
  }, [loadKnowledgeGroups, selectedProjectId]);

  useEffect(() => {
    if (!showKbFolderModal || kbSelectedGroupId) return;
    const fallbackGroupId = linkedKnowledgeGroupIds[0]
      || (knowledgeGroups[0]?.id ? Number(knowledgeGroups[0].id) : null);
    if (fallbackGroupId) {
      setKbSelectedGroupId(String(fallbackGroupId));
    }
  }, [kbSelectedGroupId, knowledgeGroups, linkedKnowledgeGroupIds, showKbFolderModal]);

  useEffect(() => {
    if (!selectedProjectId) {
      setFileMentionOptions([]);
      return;
    }
    const match = String(aiEditTarget || '').match(/@([^\s@]*)$/);
    if (!match) {
      setFileMentionOptions([]);
      return;
    }
    const query = String(match[1] || '').trim();
    if (!query) {
      setFileMentionOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      searchProjectFiles(selectedProjectId, query);
    }, 180);
    return () => clearTimeout(timer);
  }, [aiEditTarget, searchProjectFiles, selectedProjectId]);

  // Prompt textarea @ mention detection (with module-level cache)
  useEffect(() => {
    if (!selectedProjectId) { setPromptMentionOptions([]); return; }
    const cursor = promptCursorRef.current;
    const textBefore = runPrompt.slice(0, cursor);
    const match = textBefore.match(/@([^\s@]*)$/);
    if (!match || !match[1]) { setPromptMentionOptions([]); return; }
    const query = match[1];

    // Instant cache hit — no debounce, no network call
    const cached = _mentionGet(selectedProjectId, query) ?? _mentionGetByPrefix(selectedProjectId, query);
    if (cached !== null) {
      setPromptMentionOptions(cached.slice(0, 5));
      setPromptMentionIdx(-1);
      return;
    }

    // Cache miss — debounce then fetch
    const timer = setTimeout(async () => {
      setPromptMentionLoading(true);
      try {
        const res = await axios.get(`${apiUrl}/researchops/projects/${selectedProjectId}/files/search`, {
          headers,
          params: { q: query, limit: 20 },
        });
        if (selectedProjectRef.current !== selectedProjectId) return;
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        _mentionSet(selectedProjectId, query, items);
        setPromptMentionOptions(items.slice(0, 5));
        setPromptMentionIdx(-1);
      } catch {
        setPromptMentionOptions([]);
      } finally {
        setPromptMentionLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPrompt, selectedProjectId]);

  useEffect(() => {
    if (!showKbFolderModal || !selectedProjectId || !kbSyncJob?.id) return;
    if (!['QUEUED', 'RUNNING'].includes(String(kbSyncJob.status || '').toUpperCase())) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await axios.get(
          `${apiUrl}/researchops/projects/${selectedProjectId}/kb/sync-jobs/${kbSyncJob.id}`,
          { headers }
        );
        if (cancelled) return;
        const nextJob = response.data?.job || null;
        if (!nextJob) return;
        setKbSyncJob(nextJob);
        const status = String(nextJob.status || '').toUpperCase();
        if (status === 'SUCCEEDED') {
          const project = nextJob.result?.project || null;
          if (project?.id) {
            setProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, ...project } : item)));
          }
          await loadAll({ silent: true });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to poll KB sync job:', err);
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiUrl, headers, kbSyncJob, loadAll, selectedProjectId, showKbFolderModal]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!vibeUiMode.simplifiedAlphaMode) return;
    setShowSkillsModal(false);
    setEditingSkill(null);
    setShowJumpstart(false);
    setShowQuickBash(false);
    setTodoNodeTarget(null);
    setShowAutopilotModal(false);
    if (!vibeUiMode.showTreePlanning) setSelectedNodeId('');
  }, [vibeUiMode]);

  return (
    <section className="vibe-panel">
      {error && <div className="vibe-error">{error}</div>}

      {selectedProject ? (
        <div className="vibe-workspace">
          <div className="vibe-workspace-header">
            <button
              type="button"
              className="vibe-secondary-btn"
              onClick={() => setSelectedProjectId('')}
              disabled={submitting}
            >
              All Projects
            </button>
            <div className="vibe-workspace-title">
              <h3>{selectedProject.name}</h3>
              <p>{selectedProject.description || 'No project description provided.'}</p>
            </div>
            <div className="vibe-workspace-meta">
              {selectedProject.locationType === 'ssh' ? (
                <select
                  className="vibe-workspace-server-select"
                  value={selectedProject.serverId || ''}
                  onChange={(e) => handleChangeProjectServer(e.target.value)}
                >
                  {sshServers.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name || s.host}</option>
                  ))}
                </select>
              ) : (
                <span className="vibe-workspace-loc">Local project</span>
              )}
            </div>
          </div>

          <div className="vibe-workspace-actions vibe-workspace-actions--neo">
            {vibeUiMode.showSkillMenu && (
              <button
                type="button"
                className="vibe-workspace-chip"
                onClick={() => setShowSkillsModal(true)}
                disabled={submitting || syncingSkills}
              >
                Skills ({skills.length})
              </button>
            )}
            <button
              type="button"
              className="vibe-workspace-chip"
              onClick={() => {
                loadProjectInsights(selectedProject.id, { force: true });
                loadProjectFileTree(selectedProject.id, projectCurrentPath || '', { force: true });
              }}
              disabled={submitting || gitLoading || filesLoading || changedFilesLoading}
            >
              {gitLoading || filesLoading || changedFilesLoading ? 'Refreshing…' : 'Refresh Progress'}
            </button>
          </div>

          <div className="vibe-workspace-statusbar">
            <div className="vibe-status-pill">
              <span>Pipeline</span>
              <strong>{selectedProjectQueue.length > 0 ? 'Running' : 'Idle'}</strong>
            </div>
            <div className="vibe-status-pill">
              <span>Runs</span>
              <strong>{selectedProjectRuns.length}</strong>
            </div>
            <div className="vibe-status-pill">
              <span>Knowledge</span>
              <strong>{selectedProject.knowledgeGroupIds?.length || 0} groups</strong>
            </div>
            <div className="vibe-status-pill">
              <span>Files Changed</span>
              <strong>{changedFiles?.items?.filter((i) => i.status !== 'deleted')?.length || 0}</strong>
            </div>
            <div className="vibe-status-pill">
              <span>Commits</span>
              <strong>{gitProgress?.totalCommits || 0}</strong>
            </div>
          </div>

          <div className="vibe-launcher">
            <p className="vibe-skill-desc">
              One runner. Describe the task and the agent will decide whether this should be handled as an implementation task or an experiment task.
            </p>
            <form onSubmit={handleLaunchAgent} className="vibe-launcher-form">
              <div className="vibe-launcher-mention-wrap">
                {launcherContinuationChips.length > 0 && (
                  <div className="vibe-launcher-context-row">
                    {launcherContinuationChips.map((chip) => (
                      <span key={chip.id} className="vibe-launcher-context-chip">
                        {chip.label}
                        <button
                          type="button"
                          className="vibe-launcher-context-chip-remove"
                          onClick={() => setLauncherContinuationChips([])}
                          aria-label="Remove run context"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {(promptMentionLoading || promptMentionOptions.length > 0) && (
                  <div className="vibe-prompt-mention-dropdown">
                    {promptMentionLoading ? (
                      <span className="vibe-prompt-mention-searching">Searching…</span>
                    ) : (
                      promptMentionOptions.map((item, idx) => (
                        <button
                          key={item}
                          type="button"
                          className={`vibe-prompt-mention-item${idx === promptMentionIdx ? ' is-active' : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); applyPromptMention(item); }}
                        >
                          <span className="vibe-prompt-mention-at">@</span>{item}
                        </button>
                      ))
                    )}
                  </div>
                )}
                <textarea
                  ref={promptTextareaRef}
                  className="vibe-launcher-textarea"
                  id="vibe-launcher-input"
                  placeholder="What should the agent do? It will decide whether to implement or run an experiment. (Enter to launch, Shift+Enter for new line, @ to mention a file)"
                  value={runPrompt}
                  onChange={(e) => {
                    setRunPrompt(e.target.value);
                    promptCursorRef.current = e.target.selectionStart;
                  }}
                  rows={3}
                  onKeyDown={(e) => {
                    if (promptMentionOptions.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setPromptMentionIdx((i) => Math.min(i + 1, promptMentionOptions.length - 1));
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setPromptMentionIdx((i) => Math.max(i - 1, 0));
                        return;
                      }
                      if (e.key === 'Enter' && promptMentionIdx >= 0) {
                        e.preventDefault();
                        applyPromptMention(promptMentionOptions[promptMentionIdx]);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setPromptMentionOptions([]);
                        setPromptMentionIdx(-1);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleLaunchAgent(e);
                    }
                  }}
                  onSelect={(e) => { promptCursorRef.current = e.target.selectionStart; }}
                />
              </div>
              <div className="vibe-launcher-footer">
                <select
                  className="vibe-launcher-server"
                  value={runServerId}
                  onChange={(e) => setRunServerId(e.target.value)}
                >
                  <option value="local-default">Local</option>
                  {sshServers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name || s.host}</option>
                  ))}
                </select>
                <div className="vibe-provider-toggle" title="Select coding agent">
                  <button
                    type="button"
                    className={`vibe-provider-chip${runProvider === 'codex_cli' ? ' is-active' : ''}`}
                    onClick={() => { setRunProvider('codex_cli'); setRunModel(''); }}
                  >
                    Codex
                  </button>
                  <button
                    type="button"
                    className={`vibe-provider-chip${runProvider === 'claude_code_cli' ? ' is-active' : ''}`}
                    onClick={() => { setRunProvider('claude_code_cli'); setRunModel(''); }}
                  >
                    Claude Code
                  </button>
                </div>
                <select
                  className="vibe-launcher-model"
                  value={runModel}
                  onChange={(e) => setRunModel(e.target.value)}
                  title="Model (empty = server default)"
                >
                  <option value="">Default model</option>
                  {runProvider === 'codex_cli' ? (
                    <>
                      <option value="gpt-5.3-codex">GPT-5.3-Codex</option>
                      <option value="gpt-5.3-codex-spark">GPT-5.3-Codex-Spark</option>
                      <option value="gpt-5.2-codex">GPT-5.2-Codex</option>
                      <option value="gpt-5.1-codex-max">GPT-5.1-Codex-Max</option>
                      <option value="gpt-5.2">GPT-5.2</option>
                      <option value="gpt-5.1-codex-mini">GPT-5.1-Codex-Mini</option>
                    </>
                  ) : (
                    <>
                      <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                      <option value="claude-opus-4-6">Opus 4.6</option>
                      <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                    </>
                  )}
                </select>
                {runProvider === 'codex_cli' && (
                  <select
                    className="vibe-launcher-model"
                    value={runReasoningEffort}
                    onChange={(e) => setRunReasoningEffort(e.target.value)}
                    title="Reasoning effort"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="extra-high">Extra High</option>
                  </select>
                )}
                <button
                  type="submit"
                  className="vibe-launch-btn"
                  disabled={submitting || !runPrompt.trim()}
                >
                  {submitting ? 'Launching…' : 'Launch'}
                </button>
              </div>
            </form>
          </div>

          <VibeActivityFeedStrip
            items={activityFeed.items}
            runCount={activityFeed.runCount}
            sessionCount={activityFeed.sessionCount}
            selectedRunId={selectedRunId}
            loadingSessions={observedSessionsLoading}
            onOpenRun={handleOpenRunDetail}
            scopeLabel={recentRunsScopeLabel}
            refreshingSessionId={observedSessionRefreshingId}
            onOpenSession={handleOpenObservedSession}
            onRefreshSession={handleRefreshObservedSession}
          />

          <div className="vibe-tree-layout">
            <section className="vibe-tree-layout-project-row vibe-card vibe-card--neo">
              <div className="vibe-card-head">
                <h3>Project Management</h3>
                <span className="vibe-card-note">
                  {selectedProjectTodos.length} open · {selectedProjectCompletedTodoCount} done
                </span>
              </div>
              <div className={`vibe-pm-row-strip${selectedProjectTodos.length === 0 ? ' is-empty' : ''}`}>
                {selectedProjectTodos.length === 0 ? (
                  <p className="vibe-empty">No open TODOs. Add one or generate from proposal.</p>
                ) : (
                  <>
                    {(todoCardsExpanded ? selectedProjectTodos : selectedProjectTodos.slice(0, 4)).map((idea) => (
                      <article
                        key={idea.id}
                        className="vibe-pm-task-card"
                        onClick={(e) => {
                          if (e.target.closest('button')) return;
                          openTodoEdit(idea);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openTodoEdit(idea); }}
                        title="Click to edit"
                      >
                        <div className="vibe-pm-task-head">
                          <strong title={idea.title}>{idea.title}</strong>
                          <div className="vibe-pm-task-head-right">
                            <code>{String(idea.status || 'OPEN').toUpperCase()}</code>
                            <span className="vibe-pm-edit-hint" aria-hidden="true">✎</span>
                          </div>
                        </div>
                        <p title={idea.hypothesis}>{idea.hypothesis}</p>
                        <div className="vibe-pm-task-actions">
                          <button
                            type="button"
                            className="vibe-secondary-btn vibe-pm-done-btn"
                            onClick={() => handleToggleTodoStatus(idea)}
                            disabled={todoBusy}
                            title="Mark as done"
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            className="vibe-secondary-btn vibe-pm-node-btn"
                            onClick={() => setTodoNodeTarget({ todo: idea })}
                            title="Generate tree node from this TODO"
                            hidden={!vibeUiMode.showTreeActions}
                          >
                            ⚡ Node
                          </button>
                        </div>
                      </article>
                    ))}
                    {selectedProjectTodos.length > 4 && (
                      <button
                        type="button"
                        className="vibe-pm-loadmore-btn"
                        onClick={() => setTodoCardsExpanded((v) => !v)}
                      >
                        {todoCardsExpanded
                          ? `↑ Show less`
                          : `+${selectedProjectTodos.length - 4} more`}
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="vibe-inline-actions vibe-pm-actions">
                <button type="button" className="vibe-secondary-btn" onClick={openTodoModal} disabled={todoBusy}>
                  + New TODO
                </button>
                <button type="button" className="vibe-secondary-btn" onClick={handleClearCurrentTodos} disabled={todoBusy || selectedProjectTodos.length === 0}>
                  {todoBusy ? 'Clearing…' : 'Clear Current TODOs'}
                </button>
                {vibeUiMode.showTreeActions && (
                  <button
                    type="button"
                    className="vibe-secondary-btn"
                    onClick={handleGenerateRootNodeFromCodebase}
                    disabled={rootBootstrapBusy || !selectedProjectId}
                  >
                    {rootBootstrapBusy ? 'Generating…' : 'Summarize Codebase -> Root'}
                  </button>
                )}
                {vibeUiMode.showAutopilotControls && (
                  <button type="button" className="vibe-secondary-btn" onClick={() => setShowAutopilotModal(true)}>
                    Autopilot
                  </button>
                )}
              </div>
              {treeRootSummary?.summary && (
                <p className="vibe-card-note vibe-root-summary" title={treeRootSummary.summary}>
                  {treeRootSummary.summary}
                </p>
              )}
            </section>

            {vibeUiMode.showTreePlanning && (
              <div className="vibe-tree-canvas-workbench-split">
                <section className="vibe-tree-layout-tree-row">
                  <div className="vibe-tree-status-overview">
                    <div className="vibe-tree-status-pill">
                      <span>Running</span>
                      <strong>{treeExecutionSummary.running}</strong>
                    </div>
                    <div className="vibe-tree-status-pill">
                      <span>Needs Review</span>
                      <strong>{treeExecutionSummary.needsReview}</strong>
                    </div>
                    <div className="vibe-tree-status-pill">
                      <span>Done</span>
                      <strong>{treeExecutionSummary.done}</strong>
                    </div>
                    <div className="vibe-tree-status-pill">
                      <span>Failed</span>
                      <strong>{treeExecutionSummary.failed}</strong>
                    </div>
                    {nextTreeNode && (
                      <div className="vibe-tree-next-node">
                        <span>Next</span>
                        <strong>{nextTreeNode.title || nextTreeNode.id}</strong>
                        <em>{nextTreeNodeAction}</em>
                      </div>
                    )}
                  </div>
                  <VibePlanEditor
                    plan={treePlan}
                    validation={treeValidation}
                    mode={planMode}
                    viewMode={planViewMode}
                    queueState={effectiveTreeState?.queue || null}
                    runScope={runAllScope}
                    onModeChange={setPlanMode}
                    onViewModeChange={setPlanViewMode}
                    onRunScopeChange={setRunAllScope}
                    onApplyDsl={savePlanDsl}
                    onValidateDsl={validatePlanDsl}
                    onRunAll={() => runTreeAll()}
                    onPause={() => setTreeControl('pause')}
                    onResume={() => setTreeControl('resume')}
                    onAbort={() => setTreeControl('abort')}
                    onQuickBash={() => setShowQuickBash(true)}
                  />
                  {treeError && <div className="vibe-error">{treeError}</div>}
                  {treeLoading && !treePlan && <div className="vibe-card-note">Loading tree workspace...</div>}
                  {!treeLoading && selectedProjectId && !shouldShowJumpstartGate && (!treePlan || treePlan.nodes.length === 0) && (
                    <div className="vibe-jumpstart-banner">
                      <div className="vibe-jumpstart-banner-icon">🌱</div>
                      <div className="vibe-jumpstart-banner-body">
                        <strong>No plan nodes yet</strong>
                        <span>Jump-start to create the first node — analyze an existing codebase or bootstrap a new environment.</span>
                      </div>
                      <button
                        type="button"
                        className="vibe-launch-btn vibe-jumpstart-banner-btn"
                        onClick={() => setShowJumpstart(true)}
                      >
                        ⚡ Jump-start
                      </button>
                    </div>
                  )}
                  <VibeTreeCanvas
                    plan={treePlan || { nodes: [] }}
                    treeState={effectiveTreeState || { nodes: {} }}
                    mode={planMode}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onNodeAction={handleTreeNodeAction}
                  />
                </section>

                <section className={`vibe-tree-layout-workbench-panel${selectedTreeNode ? ' is-open' : ''}`}>
                  {selectedTreeNode && (
                    <VibeNodeWorkbench
                      node={selectedTreeNode}
                      nodeState={selectedTreeNodeState}
                      observedSession={selectedObservedSession}
                      observedSessionRefreshing={observedSessionRefreshingId === cleanString(selectedObservedSession?.id)}
                      mode={planMode}
                      runReport={runReport}
                      runReportLoading={runReportLoading}
                      runContextView={activeRunContextView}
                      runContextLoading={runContextPackLoading}
                      searchData={searchData}
                      searchLoading={searchLoading}
                      onSaveCommands={handleSaveNodeCommands}
                      onLoadSearch={handleLoadSearchNode}
                      onRefreshObservedSession={handleRefreshObservedSession}
                      apiUrl={apiUrl}
                      headers={headers}
                      projectId={selectedProjectId}
                      onRunStep={runTreeNodeStep}
                    />
                  )}
                </section>
              </div>
            )}
          </div>

          <div className="vibe-tree-bottom">
            <section className="vibe-tree-bottom-left vibe-card vibe-card--neo">
              <div className="vibe-card-head">
                <h3>{bottomLeftTab === 'knowledge' ? 'Knowledge Base' : 'Project Files'}</h3>
                <div className="vibe-inline-actions">
                  <button
                    type="button"
                    className={`vibe-plan-chip${bottomLeftTab === 'knowledge' ? ' is-active' : ''}`}
                    onClick={() => setBottomLeftTab('knowledge')}
                  >
                    Knowledge Base
                  </button>
                  <button
                    type="button"
                    className={`vibe-plan-chip${bottomLeftTab === 'files' ? ' is-active' : ''}`}
                    onClick={() => setBottomLeftTab('files')}
                  >
                    Project Files
                  </button>
                </div>
              </div>

              {bottomLeftTab === 'knowledge' ? (
                <>
                  <div className="vibe-kb-folder-row">
                    <span className="vibe-card-note">KB Folder:</span>
                    <code>{knowledgeBaseFolder || '(not set)'}</code>
                  </div>
                  <div className="vibe-kb-actions">
                    <button type="button" className="vibe-secondary-btn" onClick={handleOpenPaperList} disabled={submitting}>Paper List</button>
                    <button type="button" className="vibe-secondary-btn" onClick={handleSetKnowledgeBaseFolder} disabled={submitting}>Set KB Folder</button>
                    <button type="button" className="vibe-secondary-btn" onClick={openKnowledgeHubModal} disabled={submitting}>Chat with KB</button>
                  </div>
                  {knowledgeBaseFolder ? (
                    <>
                      <div className="vibe-inline-actions vibe-files-actions">
                        <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenKbFolder('')} disabled={kbFileTreeLoading || !kbCurrentPath}>Root</button>
                        <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenKbFolder(kbParentPath)} disabled={kbFileTreeLoading || !kbCurrentPath}>Up</button>
                        <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenKbFolder(kbCurrentPath)} disabled={kbFileTreeLoading}>Refresh</button>
                      </div>
                      <div className="vibe-tree-files-layout">
                        <div className="vibe-tree-files-browser">
                          {kbFileTreeLoading ? (
                            <p className="vibe-empty">Loading KB files...</p>
                          ) : kbFileTreeError ? (
                            <p className="vibe-empty vibe-card-error">{kbFileTreeError}</p>
                          ) : (
                            <div className="vibe-list vibe-git-file-list">
                              {kbTreeEntries.length === 0 ? (
                                <p className="vibe-empty">Folder is empty.</p>
                              ) : (
                                <>
                                  {kbTreeEntries.map((entry) => (
                                    <button
                                      key={`kb-${entry.relativePath}-${entry.type}`}
                                      type="button"
                                      className="vibe-list-item vibe-file-node"
                                      onClick={() => (
                                        entry.type === 'directory'
                                          ? handleOpenKbFolder(entry.relativePath)
                                          : handleOpenKbFile(entry.relativePath)
                                      )}
                                    >
                                      <div className="vibe-list-main">
                                        <strong>{entry.name}</strong>
                                        <span>{entry.type === 'directory' ? 'Directory' : 'File'}</span>
                                      </div>
                                      <code>{entry.type === 'directory' ? 'dir' : 'file'}</code>
                                    </button>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                          {kbFileTree?.truncated && (
                            <p className="vibe-card-note">Showing first {kbTreeEntries.length} items.</p>
                          )}
                        </div>
                        <div className="vibe-tree-files-side">
                          <div className="vibe-git-file-preview">
                            <h4>Preview</h4>
                            {kbFileContentLoading ? (
                              <p className="vibe-empty">Loading file content...</p>
                            ) : kbFileContentError ? (
                              <p className="vibe-empty vibe-card-error">{kbFileContentError}</p>
                            ) : kbFileContent?.relativePath ? (
                              <>
                                <div className="vibe-git-file-preview-head">
                                  <code>{kbFileContent.relativePath}</code>
                                  <span className="vibe-card-note">
                                    {kbFileContent.truncated ? 'Partial preview' : 'Full preview'}
                                  </span>
                                </div>
                                <pre className="vibe-report-pre vibe-report-pre-small vibe-file-preview-content">
                                  {kbFileContent.content || ''}
                                </pre>
                              </>
                            ) : (
                              <p className="vibe-empty">Click a file to read its content.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="vibe-empty">No KB folder configured. Click &quot;Set KB Folder&quot; to sync a paper group or use the existing resource/ folder.</p>
                  )}
                </>
              ) : (
                <>
                  {projectRootPath && <code className="vibe-git-file-root">{projectRootPath}</code>}
                  <div className="vibe-inline-actions vibe-files-actions">
                    <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenFolderPath('')} disabled={projectFileTreeLoading || !projectCurrentPath}>Root</button>
                    <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenFolderPath(projectParentPath)} disabled={projectFileTreeLoading || !projectCurrentPath}>Up</button>
                    <button type="button" className="vibe-secondary-btn" onClick={() => handleOpenFolderPath(projectCurrentPath)} disabled={projectFileTreeLoading}>Refresh</button>
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={() => openCodeChatInLauncher(
                        projectFileContent?.relativePath
                          ? `Analyze this code path and explain what to improve: @${projectFileContent.relativePath}`
                          : ''
                      )}
                      disabled={submitting}
                    >
                      Chat with Code
                    </button>
                  </div>
                  <div className="vibe-tree-files-layout">
                    <div className="vibe-tree-files-browser">
                      {projectFileTreeLoading ? (
                        <p className="vibe-empty">Loading project files...</p>
                      ) : projectFileTreeError ? (
                        <p className="vibe-empty vibe-card-error">{projectFileTreeError}</p>
                      ) : (
                        <div className="vibe-list vibe-git-file-list">
                          {projectTreeEntries.length === 0 ? (
                            <p className="vibe-empty">Folder is empty.</p>
                          ) : (
                            <>
                              {projectTreeEntries.map((entry) => (
                                <button
                                  key={`${entry.relativePath}-${entry.type}`}
                                  type="button"
                                  className="vibe-list-item vibe-file-node"
                                  onClick={() => (
                                    entry.type === 'directory'
                                      ? handleOpenFolderPath(entry.relativePath)
                                      : handleOpenProjectFile(entry.relativePath)
                                  )}
                                >
                                  <div className="vibe-list-main">
                                    <strong>{entry.name}</strong>
                                    <span>{entry.type === 'directory' ? 'Directory' : 'File'}</span>
                                  </div>
                                  <code>{entry.type === 'directory' ? 'dir' : 'file'}</code>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                      {projectFileTree?.truncated && (
                        <p className="vibe-card-note">Showing first {projectTreeEntries.length} items.</p>
                      )}
                    </div>
                    <div className="vibe-tree-files-side">
                      <div className="vibe-git-file-preview">
                        <h4>Preview</h4>
                        {projectFileContentLoading ? (
                          <p className="vibe-empty">Loading file content...</p>
                        ) : projectFileContentError ? (
                          <p className="vibe-empty vibe-card-error">{projectFileContentError}</p>
                        ) : projectFileContent?.relativePath ? (
                          <>
                            <div className="vibe-git-file-preview-head">
                              <code>{projectFileContent.relativePath}</code>
                              <span className="vibe-card-note">
                                {projectFileContent.truncated ? 'Partial preview' : 'Full preview'}
                              </span>
                            </div>
                            <pre className="vibe-report-pre vibe-report-pre-small vibe-file-preview-content">
                              {projectFileContent.content || ''}
                            </pre>
                          </>
                        ) : (
                          <p className="vibe-empty">Click a file to read its content.</p>
                        )}
                      </div>
                      <div className="vibe-git-file-ai">
                        <h4>AI Edit</h4>
                        <input
                          placeholder="@path/to/file.py"
                          value={aiEditTarget}
                          onChange={(event) => setAiEditTarget(event.target.value)}
                        />
                        {(fileMentionLoading || fileMentionOptions.length > 0) && (
                          <div className="vibe-file-mention-list">
                            {fileMentionLoading ? (
                              <span className="vibe-card-note">Searching files...</span>
                            ) : (
                              fileMentionOptions.map((item) => (
                                <button
                                  key={`mention-${item}`}
                                  type="button"
                                  className="vibe-secondary-btn"
                                  onClick={() => applyFileMentionSelection(item)}
                                >
                                  @{item}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        <textarea
                          rows={3}
                          placeholder="Describe one augmentation for this file"
                          value={aiEditInstruction}
                          onChange={(event) => setAiEditInstruction(event.target.value)}
                        />
                        <button
                          type="button"
                          className="vibe-secondary-btn"
                          onClick={handleSubmitAiEdit}
                          disabled={aiEditBusy || !aiEditTarget.trim() || !aiEditInstruction.trim()}
                        >
                          {aiEditBusy ? 'Queuing...' : 'Ask Agent'}
                        </button>
                      </div>
                      <div className="vibe-file-chat">
                        <div className="vibe-file-chat-header">
                          <h4>Chat with Code</h4>
                          <span className="vibe-card-note">Auto-locates relevant files before running.</span>
                        </div>
                        <textarea
                          rows={3}
                          placeholder="Ask code-level questions: architecture, bug root cause, refactor plan, etc."
                          value={codeChatPrompt}
                          onChange={(event) => setCodeChatPrompt(event.target.value)}
                        />
                        <div className="vibe-inline-actions">
                          <button
                            type="button"
                            className="vibe-secondary-btn"
                            onClick={() => handleLaunchAgent(null, { skill: 'code_chat', prompt: codeChatPrompt })}
                            disabled={submitting || !codeChatPrompt.trim()}
                          >
                            {submitting ? 'Launching…' : 'Launch Code Chat'}
                          </button>
                          <button
                            type="button"
                            className="vibe-secondary-btn"
                            onClick={() => openCodeChatInLauncher(codeChatPrompt)}
                            disabled={!codeChatPrompt.trim()}
                          >
                            Open in Launcher
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="vibe-tree-bottom-right">
              <VibeRunHistory
                runs={visibleRuns}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                hasMore={runHistoryHasMore}
                loadingMore={runHistoryLoading || runHistoryLoadingMore}
                onLoadMore={() => loadRunHistoryPage(selectedProjectId, { reset: false })}
                onDeleteRun={handleDeleteRun}
                onClearFailed={() => handleClearRuns('FAILED')}
                onClearAll={() => handleClearRuns()}
                onRerunRun={handleRerunRun}
              />
            </section>
          </div>

          {false && (
          <>
          <div className="vibe-workspace-grid vibe-workspace-grid--neo">
            <article className="vibe-card vibe-card--neo vibe-card--knowledge">
              <div className="vibe-card-head">
                <h3>Knowledge Base</h3>
                <span className="vibe-card-note">{linkedKnowledgeGroupIds.length} linked groups</span>
              </div>
              {linkedKnowledgeGroupIds.length > 0 && (
                <div className="vibe-chip-list">
                  {linkedKnowledgeGroupIds.map((groupId) => {
                    const groupName = knowledgeGroups.find((g) => String(g.id) === String(groupId))?.name;
                    return (
                      <span key={`knowledge-group-${groupId}`} className="vibe-file-chip">
                        {groupName || `Group #${groupId}`}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="vibe-list">
                {knowledgeGroups
                  .filter((group) => linkedKnowledgeGroupIds.includes(Number(group.id)))
                  .slice(0, 6)
                  .map((group) => (
                    <div key={`group-preview-${group.id}`} className="vibe-list-item">
                      <div className="vibe-list-main">
                        <strong>{group.name}</strong>
                        <span>{group.documentCount || 0} papers</span>
                      </div>
                      <code>#{group.id}</code>
                    </div>
                  ))}
                {linkedKnowledgeGroupIds.length === 0 && (
                  <p className="vibe-empty">
                    {knowledgeGroupsLoading
                      ? 'Loading paper groups...'
                      : 'No KB groups linked to this project yet. Use Paper List to create/import a group, then set KB folder.'}
                  </p>
                )}
              </div>
              <div className="vibe-kb-folder-row">
                <span className="vibe-card-note">KB Folder:</span>
                <code>{knowledgeBaseFolder || '(not set)'}</code>
              </div>
              <div className="vibe-kb-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleOpenPaperList}
                  disabled={submitting}
                >
                  Paper List
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleSetKnowledgeBaseFolder}
                  disabled={submitting}
                >
                  Set KB Folder
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={openKnowledgeHubModal}
                  disabled={submitting}
                >
                  Chat with KB
                </button>
              </div>
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--outputs">
              <div className="vibe-card-head">
                <h3>Outputs</h3>
                <span className="vibe-card-note">{runReport?.artifacts?.length || 0} artifacts</span>
              </div>
              {selectedProjectRuns.length === 0 ? (
                <p className="vibe-empty">No runs for this project yet.</p>
              ) : (
                <>
                  <div className="vibe-inline-actions">
                    <select
                      value={selectedRunId}
                      onChange={(e) => setSelectedRunId(e.target.value)}
                    >
                      {selectedProjectRuns.map((run) => {
                        const ts = run.createdAt ? new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                        const prompt = String(run.metadata?.prompt || run.metadata?.experimentCommand || run.runType || '').slice(0, 40);
                        return (
                          <option key={run.id} value={run.id}>
                            {ts ? `${ts} · ` : ''}{run.status} · {prompt || run.id}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={() => selectedRunId && loadRunReport(selectedRunId)}
                      disabled={!selectedRunId || runReportLoading}
                    >
                      {runReportLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  {!runReport ? (
                    <p className="vibe-empty">No run report loaded.</p>
                  ) : (
                    <>
                      <div className="vibe-list">
                        {(runReport?.artifacts || []).slice(0, 8).map((artifact) => (
                          <div key={`artifact-${artifact.id || artifact.path || artifact.kind}`} className="vibe-list-item">
                            <div className="vibe-list-main">
                              <strong>{artifact.title || artifact.path || artifact.kind || `Artifact ${artifact.id}`}</strong>
                              <span>{artifact.mimeType || artifact.kind || 'artifact'}</span>
                            </div>
                            {artifact.objectUrl ? (
                              <a href={artifact.objectUrl} target="_blank" rel="noreferrer" className="vibe-secondary-btn">
                                Open
                              </a>
                            ) : (
                              <code>{artifact.kind || 'asset'}</code>
                            )}
                          </div>
                        ))}
                      </div>
                      {runReport?.summary && (
                        <pre className="vibe-report-pre vibe-report-pre-small">
                          {String(runReport.summary).split('\n').slice(0, 6).join('\n')}
                        </pre>
                      )}
                    </>
                  )}
                </>
              )}
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--deliverables">
              <div className="vibe-card-head">
                <h3>Deliverables</h3>
                <span className="vibe-card-note">{runReportView.figures.length + runReportView.tables.length} files</span>
              </div>
              {runReportView.figures.length === 0 && runReportView.tables.length === 0 ? (
                <p className="vibe-empty">No deliverables yet.</p>
              ) : (
                <div className="vibe-figure-grid">
                  {[...runReportView.figures, ...runReportView.tables].slice(0, 8).map((item) => (
                    <div key={`deliverable-${item.id || item.path || item.title}`} className="vibe-figure-card">
                      <strong>{item.title || item.path || item.id}</strong>
                      {item.objectUrl ? (
                        <a href={item.objectUrl} target="_blank" rel="noreferrer">Open</a>
                      ) : (
                        <span className="vibe-empty">{item.mimeType || 'artifact'}</span>
                      )}
                      {item.objectUrl && String(item.mimeType || '').startsWith('image/') && (
                        <img src={item.objectUrl} alt={item.title || item.path || 'deliverable'} loading="lazy" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--pipeline">
              <div className="vibe-card-head">
                <h3>Execution Pipeline</h3>
                <span className="vibe-card-note">{(runReport?.steps || []).length} steps</span>
              </div>
              <div className="vibe-inline-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleRetryRun}
                  disabled={!selectedRunId || submitting}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleInsertWorkflowStep}
                  disabled={!selectedRunId || submitting}
                >
                  Insert Step
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleAbortRun}
                  disabled={!selectedRunId || submitting}
                >
                  Abort
                </button>
              </div>
              {selectedProjectQueue.length > 0 && (
                <div className="vibe-list">
                  {selectedProjectQueue.slice(0, 4).map((run) => (
                    <div key={`queue-${run.id}`} className="vibe-list-item">
                      <div className="vibe-list-main">
                        <strong>{run.provider || run.runType}</strong>
                        <span>{run.serverId}</span>
                      </div>
                      <code>{run.status}</code>
                    </div>
                  ))}
                </div>
              )}
              <div className="vibe-list">
                {(runReport?.steps || []).slice(0, 10).map((step) => (
                  <div key={step.id || step.stepId} className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>{step.stepId}</strong>
                      <span>{step.moduleType}</span>
                    </div>
                    <code>{step.status}</code>
                  </div>
                ))}
                {(runReport?.steps || []).length === 0 && (
                  <p className="vibe-empty">No step timeline available yet.</p>
                )}
              </div>
              {(runReport?.checkpoints || []).some((item) => item.status === 'PENDING') && (
                <div className="vibe-list">
                  {(runReport?.checkpoints || [])
                    .filter((item) => item.status === 'PENDING')
                    .map((checkpoint) => (
                      <div key={checkpoint.id} className="vibe-list-item">
                        <div className="vibe-list-main">
                          <strong>{checkpoint.title || checkpoint.id}</strong>
                          <span>{checkpoint.message || 'Approval required'}</span>
                        </div>
                        <div className="vibe-inline-actions">
                          <button
                            type="button"
                            className="vibe-secondary-btn"
                            onClick={() => handleCheckpointDecision(checkpoint.id, 'APPROVED')}
                            disabled={String(checkpointActionLoadingId) === String(checkpoint.id)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="vibe-secondary-btn"
                            onClick={() => handleCheckpointEdit(checkpoint.id)}
                            disabled={String(checkpointActionLoadingId) === String(checkpoint.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="vibe-secondary-btn"
                            onClick={() => handleCheckpointDecision(checkpoint.id, 'REJECTED')}
                            disabled={String(checkpointActionLoadingId) === String(checkpoint.id)}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--files">
              <div className="vibe-card-head">
                <h3>Changed Files</h3>
                <span className="vibe-card-note">Git status + line delta (excluding deleted)</span>
              </div>
              {changedFilesLoading ? (
                <p className="vibe-empty">Loading changed files...</p>
              ) : changedFilesError ? (
                <p className="vibe-empty vibe-card-error">{changedFilesError}</p>
              ) : !changedFiles?.isGitRepo ? (
                <p className="vibe-empty">Project path is not a git repository yet.</p>
              ) : !Array.isArray(changedFiles.items) || changedFiles.items.filter((item) => item.status !== 'deleted').length === 0 ? (
                <p className="vibe-empty">No changed files.</p>
              ) : (
                <div className="vibe-list vibe-commit-list">
                  {changedFiles.items.filter((item) => item.status !== 'deleted').slice(0, 24).map((item) => (
                    <div key={`${item.path}-${item.status}`} className="vibe-list-item">
                      <div className="vibe-list-main">
                        <strong>{item.path}</strong>
                        <span>{item.status}</span>
                      </div>
                      <code>{`+${item.added || 0} -${item.deleted || 0}`}</code>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--project">
              <div className="vibe-card-head">
                <h3>Project Management</h3>
                <span className="vibe-card-note">Tasks & Next Steps</span>
                <button
                  type="button"
                  className={`vibe-autopilot-btn ${autopilotSession?.status === 'running' ? 'is-active' : ''}`}
                  onClick={() => setShowAutopilotModal(true)}
                  disabled={!selectedProjectId}
                  title="Start fully automated research loop"
                  hidden={!vibeUiMode.showAutopilotControls}
                >
                  &#9654; Autopilot
                </button>
              </div>
              {autopilotSession && (
                <div className={`vibe-autopilot-status vibe-autopilot-status--${autopilotSession.status}`}>
                  <div className="vibe-autopilot-status-row">
                    <span className="vibe-autopilot-label">
                      {autopilotSession.status === 'running' ? (
                        <>{'\u25b6'} Running \u2014 iter {autopilotSession.currentIteration}/{autopilotSession.maxIterations} \u2014 {autopilotSession.currentPhase}</>
                      ) : autopilotSession.status === 'completed' ? (
                        <>{autopilotSession.goalAchieved ? '\u2713 Goal achieved' : '\u2713 Completed'} ({autopilotSession.currentIteration} iterations)</>
                      ) : autopilotSession.status === 'stopped' ? (
                        <>{'\u25a0'} Stopped at iter {autopilotSession.currentIteration}</>
                      ) : (
                        <>{'\u26a0'} {autopilotSession.status}</>
                      )}
                    </span>
                    {autopilotSession.currentTask && autopilotSession.status === 'running' && (
                      <span className="vibe-autopilot-task">{autopilotSession.currentTask}</span>
                    )}
                    {autopilotSession.status === 'running' && (
                      <button
                        type="button"
                        className="vibe-secondary-btn vibe-autopilot-stop-btn"
                        onClick={handleStopAutopilot}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  {autopilotSession.history?.length > 0 && (
                    <div className="vibe-autopilot-history">
                      {autopilotSession.history.slice(-3).map((h) => (
                        <div key={h.iteration} className="vibe-autopilot-history-item">
                          <span className="vibe-autopilot-iter">#{h.iteration}</span>
                          <span>{h.task}: {h.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="vibe-list vibe-project-todo-list">
                {selectedProjectTodos.length === 0 ? (
                  <div className="vibe-kickoff-panel">
                    <p className="vibe-kickoff-intro">How would you like to get started?</p>
                    <div className="vibe-kickoff-options">
                      <button type="button" className="vibe-kickoff-option" onClick={openTodoModal} disabled={todoBusy}>
                        <span className="vibe-kickoff-icon">&#9999;&#65039;</span>
                        <span>Write a task</span>
                      </button>
                      <button
                        type="button"
                        className="vibe-kickoff-option"
                        onClick={() => setShowKickoffPromptGenerate((v) => !v)}
                        disabled={todoBusy}
                      >
                        <span className="vibe-kickoff-icon">&#10024;</span>
                        <span>Let AI plan</span>
                      </button>
                      <button
                        type="button"
                        className="vibe-kickoff-option"
                        onClick={handleChooseProposalFileDesign}
                        disabled={proposalUploadBusy || todoBusy || !selectedProjectId}
                      >
                        <span className="vibe-kickoff-icon">&#128196;</span>
                        <span>Upload proposal</span>
                      </button>
                    </div>
                    {showKickoffPromptGenerate && (
                      <div className="vibe-kickoff-generate">
                        <textarea
                          className="vibe-kickoff-textarea"
                          placeholder="Describe your research goal or project..."
                          value={kickoffAiPrompt}
                          onChange={(e) => setKickoffAiPrompt(e.target.value)}
                          rows={3}
                        />
                        <button
                          type="button"
                          className="vibe-primary-btn"
                          onClick={handleKickoffGenerateTodos}
                          disabled={todoBusy || !kickoffAiPrompt.trim()}
                        >
                          {todoBusy ? 'Generating...' : 'Generate Tasks'}
                        </button>
                      </div>
                    )}
                    {proposalUploadBusy && (
                      <p className="vibe-kickoff-busy">Analyzing proposal and creating tasks...</p>
                    )}
                    <input
                      type="file"
                      ref={kickoffProposalFileInputRef}
                      style={{ display: 'none' }}
                      accept=".pdf,.md,.txt,.docx,.doc"
                      onChange={handleKickoffProposalFileChange}
                    />
                  </div>
                ) : (
                  selectedProjectTodos.map((idea) => {
                    const status = String(idea.status || '').trim().toUpperCase();
                    const done = status === 'DONE' || status === 'COMPLETED';
                    const autoGenerated = String(idea.summary || '').toLowerCase().includes('auto-generated')
                      || String(idea.summary || '').toLowerCase().includes('llm-generated');
                    return (
                      <div key={idea.id} className={`vibe-list-item vibe-todo-item ${done ? 'is-done' : ''}`}>
                        <div className="vibe-list-main">
                          <strong>{idea.title}</strong>
                          <span>{idea.hypothesis}</span>
                          <div className="vibe-todo-tags">
                            <span className={`vibe-todo-tag ${done ? 'done' : 'open'}`}>
                              {done ? 'DONE' : (status || 'OPEN')}
                            </span>
                            <span className="vibe-todo-tag">{autoGenerated ? 'LLM' : 'USER'}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="vibe-secondary-btn"
                          onClick={() => handleToggleTodoStatus(idea)}
                          disabled={todoBusy}
                        >
                          {done ? 'Reopen' : 'Done'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="vibe-todo-bottom-action">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={openTodoModal}
                  disabled={submitting || todoBusy}
                >
                  + New TODO
                </button>
              </div>
            </article>

            <article className="vibe-card vibe-card--neo vibe-card--gitprogress">
              <div className="vibe-card-head">
                <h3>Git Progress</h3>
                <span className="vibe-card-note">{gitProgress?.branch ? `Branch: ${gitProgress.branch}` : 'Current branch only'}</span>
              </div>
              <div className="vibe-git-columns">
                <div className="vibe-git-pane">
                  {gitLoading ? (
                    <p className="vibe-empty">Loading branch history...</p>
                  ) : gitError ? (
                    <p className="vibe-empty vibe-card-error">{gitError}</p>
                  ) : !gitProgress?.isGitRepo ? (
                    <p className="vibe-empty">Project path is not a git repository yet.</p>
                  ) : (
                    <div className="vibe-list vibe-commit-list">
                      {gitProgress?.commits?.length ? (
                        gitProgress.commits.map((commit) => (
                          <div key={commit.hash} className="vibe-list-item">
                            <div className="vibe-list-main">
                              <strong>{commit.subject || 'No commit title'}</strong>
                              <span>{commit.subtitle}</span>
                            </div>
                            <code>{commit.shortHash}</code>
                          </div>
                        ))
                      ) : (
                        <p className="vibe-empty">No commits found on this branch.</p>
                      )}
                    </div>
                  )}
                  {Number(gitProgress?.totalCommits || 0) > Number(gitProgress?.commits?.length || 0) && (
                    <div className="vibe-todo-bottom-action">
                      <button
                        type="button"
                        className="vibe-secondary-btn"
                        onClick={() => {
                          const nextLimit = Math.min((Number(gitLogLimitRef.current) || 5) + 5, 200);
                          setGitLogLimit(nextLimit);
                          if (selectedProjectId) {
                            loadProjectInsights(selectedProjectId, { gitLimit: nextLimit, force: true });
                          }
                        }}
                        disabled={gitLoading}
                      >
                        {gitLoading ? 'Loading...' : 'Load More'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="vibe-git-pane vibe-git-pane--files">
                  <div className="vibe-card-head vibe-card-head--nested">
                    <h4>Project Files</h4>
                    <span className="vibe-card-note">{Number(projectFileTree?.totalEntries || 0)} items</span>
                  </div>
                  {projectRootPath && (
                    <code className="vibe-git-file-root">{projectRootPath}</code>
                  )}
                  <div className="vibe-inline-actions">
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={() => handleOpenFolderPath('')}
                      disabled={projectFileTreeLoading || !projectCurrentPath}
                    >
                      Root
                    </button>
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={() => handleOpenFolderPath(projectParentPath)}
                      disabled={projectFileTreeLoading || !projectCurrentPath}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={() => handleOpenFolderPath(projectCurrentPath)}
                      disabled={projectFileTreeLoading}
                    >
                      Refresh
                    </button>
                    <span className="vibe-card-note">
                      {projectCurrentPath ? `Folder: /${projectCurrentPath}` : 'Folder: /'}
                    </span>
                  </div>
                  {projectFileTreeLoading || filesLoading ? (
                    <p className="vibe-empty">Loading project files...</p>
                  ) : projectFileTreeError || filesError ? (
                    <p className="vibe-empty vibe-card-error">{projectFileTreeError || filesError}</p>
                  ) : (
                    <div className="vibe-list vibe-git-file-list">
                      {projectTreeEntries.length === 0 ? (
                        <p className="vibe-empty">Folder is empty.</p>
                      ) : (
                        <>
                          {projectTreeEntries.map((entry) => (
                            <button
                              key={`${entry.relativePath}-${entry.type}`}
                              type="button"
                              className="vibe-list-item vibe-file-node"
                              onClick={() => (
                                entry.type === 'directory'
                                  ? handleOpenFolderPath(entry.relativePath)
                                  : handleOpenProjectFile(entry.relativePath)
                              )}
                            >
                              <div className="vibe-list-main">
                                <strong>{entry.name}</strong>
                                <span>{entry.type === 'directory' ? 'Directory' : 'File'}</span>
                              </div>
                              <code>{entry.type === 'directory' ? 'dir' : 'file'}</code>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  {projectFileTree?.truncated && (
                    <p className="vibe-card-note">
                      Showing first {projectTreeEntries.length} items.
                    </p>
                  )}
                  <div className="vibe-git-file-preview">
                    <h4>Preview</h4>
                    {projectFileContentLoading ? (
                      <p className="vibe-empty">Loading file content...</p>
                    ) : projectFileContentError ? (
                      <p className="vibe-empty vibe-card-error">{projectFileContentError}</p>
                    ) : projectFileContent?.relativePath ? (
                      <>
                        <div className="vibe-git-file-preview-head">
                          <code>{projectFileContent.relativePath}</code>
                          <span className="vibe-card-note">
                            {projectFileContent.truncated ? 'Partial preview' : 'Full preview'}
                          </span>
                        </div>
                        <pre className="vibe-report-pre vibe-report-pre-small vibe-file-preview-content">
                          {projectFileContent.content || ''}
                        </pre>
                      </>
                    ) : (
                      <p className="vibe-empty">Click a file to read its content.</p>
                    )}
                  </div>
                  <div className="vibe-git-file-ai">
                    <h4>AI Edit</h4>
                    <input
                      placeholder="@path/to/file.py"
                      value={aiEditTarget}
                      onChange={(event) => setAiEditTarget(event.target.value)}
                    />
                    {(fileMentionLoading || fileMentionOptions.length > 0) && (
                      <div className="vibe-file-mention-list">
                        {fileMentionLoading ? (
                          <span className="vibe-card-note">Searching files...</span>
                        ) : (
                          fileMentionOptions.map((item) => (
                            <button
                              key={`mention-${item}`}
                              type="button"
                              className="vibe-secondary-btn"
                              onClick={() => applyFileMentionSelection(item)}
                            >
                              @{item}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    <textarea
                      rows={3}
                      placeholder="Describe one augmentation for this file"
                      value={aiEditInstruction}
                      onChange={(event) => setAiEditInstruction(event.target.value)}
                    />
                    <button
                      type="button"
                      className="vibe-secondary-btn"
                      onClick={handleSubmitAiEdit}
                      disabled={aiEditBusy || !aiEditTarget.trim() || !aiEditInstruction.trim()}
                    >
                      {aiEditBusy ? 'Queuing...' : 'Ask Agent'}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <VibeRunHistory
            runs={selectedProjectRuns}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onDeleteRun={handleDeleteRun}
            onClearFailed={() => handleClearRuns('FAILED')}
            onClearAll={() => handleClearRuns()}
            onRerunRun={handleRerunRun}
          />
          </>
          )}
        </div>
      ) : (
        <VibeHomeView
          loading={loading}
          projects={projects}
          projectStats={projectStats}
          onCreateProject={openCreateProjectModal}
          onSelectProject={setSelectedProjectId}
          submitting={submitting}
          skills={skills}
          onSyncSkills={handleSyncSkills}
          syncingSkills={syncingSkills}
          showSkillMenu={vibeUiMode.showSkillMenu}
        />
      )}

      <VibeRunDetailModal
        open={showRunDetailModal && Boolean(selectedRun)}
        run={selectedRun}
        runReport={activeRunReport}
        loading={runReportLoading}
        onClose={() => setShowRunDetailModal(false)}
        onContinue={handleContinueFromRun}
        onRefresh={() => selectedRunId && loadRunReport(selectedRunId)}
      />

      {vibeUiMode.showSkillMenu && showSkillsModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={editingSkill ? undefined : closeSkillsModal}>
          <article
            className={`vibe-modal vibe-skills-modal${editingSkill ? ' vibe-skills-modal--editing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-project-skills-title"
            onClick={(event) => event.stopPropagation()}
          >
            {!editingSkill ? (
              <>
                <div className="vibe-skill-header">
                  <h3 id="vibe-project-skills-title">Merged Skills ({skills.length})</h3>
                  <button
                    type="button"
                    className="vibe-secondary-btn"
                    onClick={handleSyncSkills}
                    disabled={syncingSkills || submitting}
                  >
                    {syncingSkills ? 'Syncing…' : 'Sync Remote Skills'}
                  </button>
                </div>
                <div className="vibe-skill-list vibe-skill-list-modal">
                  {skills.length === 0 ? (
                    <p className="vibe-empty">No skills found. Sync from object storage or add local `skills/*/SKILL.md`.</p>
                  ) : (
                    skills.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        className="vibe-skill-chip vibe-skill-chip--clickable"
                        title={`${skill.source || 'unknown'}${skill.version ? ` · v${skill.version}` : ''} — click to view/edit`}
                        onClick={() => openSkillEditor(skill)}
                      >
                        {skill.name}
                      </button>
                    ))
                  )}
                </div>
                <div className="vibe-modal-actions">
                  <button
                    type="button"
                    className="vibe-secondary-btn"
                    onClick={closeSkillsModal}
                    disabled={syncingSkills || submitting}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="vibe-skill-header">
                  <div className="vibe-skill-editor-title-row">
                    <button
                      type="button"
                      className="vibe-skill-back-btn"
                      onClick={() => { setEditingSkill(null); setSkillEditorContent(''); setSkillEditorError(''); }}
                      disabled={skillEditorSaving}
                    >
                      ← Back
                    </button>
                    <h3 className="vibe-skill-editor-name">{editingSkill.name} / SKILL.md</h3>
                  </div>
                </div>
                <div className="vibe-skill-editor-body">
                  {skillEditorLoading ? (
                    <p className="vibe-skill-editor-loading">Loading…</p>
                  ) : (
                    <textarea
                      className="vibe-skill-editor-textarea"
                      value={skillEditorContent}
                      onChange={(e) => setSkillEditorContent(e.target.value)}
                      spellCheck={false}
                      disabled={skillEditorSaving}
                    />
                  )}
                  {skillEditorError && <p className="vibe-skill-editor-error">{skillEditorError}</p>}
                </div>
                <div className="vibe-modal-actions">
                  <button
                    type="button"
                    className="vibe-secondary-btn"
                    onClick={() => { setEditingSkill(null); setSkillEditorContent(''); setSkillEditorError(''); }}
                    disabled={skillEditorSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vibe-launch-btn"
                    onClick={saveSkillEditor}
                    disabled={skillEditorSaving || skillEditorLoading}
                  >
                    {skillEditorSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </article>
        </div>
      )}

      <VibeKnowledgeHubModal
        open={showKnowledgeHubModal && Boolean(selectedProject)}
        onClose={closeKnowledgeHubModal}
        apiUrl={apiUrl}
        headers={headers}
        selectedProject={selectedProject}
        pinnedAssetIds={pinnedAssetIds}
        onPinnedAssetIdsChange={setPinnedAssetIds}
      />

      {vibeUiMode.showAutopilotControls && showAutopilotModal && (
        <div className="vibe-modal-backdrop" onClick={() => !autopilotBusy && setShowAutopilotModal(false)}>
          <article className="vibe-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vibe-modal-header">
              <h3>&#9654; Autopilot Mode</h3>
              <button type="button" className="vibe-modal-close" onClick={() => !autopilotBusy && setShowAutopilotModal(false)}>&times;</button>
            </div>
            <div className="vibe-modal-body">
              <p className="vibe-modal-desc">
                Autopilot runs a fully automatic research loop: it designs tasks, implements them, runs experiments, analyzes results, and repeats — stopping when the goal is achieved or max iterations is reached.
              </p>
              <label className="vibe-modal-label">
                Research goal / proposal
                <textarea
                  className="vibe-kickoff-textarea"
                  placeholder="Describe the research goal or paste a proposal..."
                  value={autopilotProposal}
                  onChange={(e) => setAutopilotProposal(e.target.value)}
                  rows={5}
                />
              </label>
              <div className="vibe-modal-row">
                <label className="vibe-modal-label">
                  Max iterations
                  <input
                    type="number"
                    className="vibe-modal-input"
                    min={1}
                    max={50}
                    value={autopilotMaxIter}
                    onChange={(e) => setAutopilotMaxIter(Number(e.target.value) || 10)}
                  />
                </label>
                <label className="vibe-modal-label">
                  Server
                  <select
                    className="vibe-modal-select"
                    value={autopilotServerId}
                    onChange={(e) => setAutopilotServerId(e.target.value)}
                  >
                    <option value="local-default">Local</option>
                    {sshServers.map((srv) => (
                      <option key={srv.id} value={srv.id}>{srv.name || srv.host}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="vibe-modal-footer">
              <button
                type="button"
                className="vibe-secondary-btn"
                onClick={() => setShowAutopilotModal(false)}
                disabled={autopilotBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vibe-primary-btn"
                onClick={handleStartAutopilot}
                disabled={autopilotBusy || !autopilotProposal.trim()}
              >
                {autopilotBusy ? 'Starting...' : 'Start Autopilot'}
              </button>
            </div>
          </article>
        </div>
      )}

      {showCreateProjectModal && (
        <div className="vibe-modal-backdrop" onClick={closeCreateProjectModal}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-create-project-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="vibe-create-project-title">Create New Project</h3>
            <form onSubmit={handleCreateProject} className="vibe-form">
              <input
                placeholder="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
              />
              <textarea
                placeholder="Optional description"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                rows={4}
              />
              <select
                value={projectLocationType}
                onChange={(e) => setProjectLocationType(e.target.value)}
              >
                <option value="local">Local backend host</option>
                <option value="ssh">SSH server</option>
                <option value="client">Local client device</option>
              </select>
              {projectLocationType === 'ssh' && (
                <select
                  value={projectServerId}
                  onChange={(e) => setProjectServerId(e.target.value)}
                  required
                >
                  <option value="">{loadingSsh ? 'Loading SSH servers…' : 'Select SSH server'}</option>
                  {sshServers.map((server) => (
                    <option key={server.id} value={String(server.id)}>
                      {server.name} ({server.user}@{server.host}:{server.port || 22})
                    </option>
                  ))}
                </select>
              )}
              {projectLocationType === 'client' && (
                <>
                  <label className="vibe-form-label">
                    Connection mode
                    <select
                      value={projectClientMode}
                      onChange={(e) => setProjectClientMode(e.target.value)}
                    >
                      <option value="agent">Desktop agent</option>
                      <option value="browser">Browser file access</option>
                    </select>
                  </label>
                  {projectClientMode === 'agent' ? (
                    <>
                      <select
                        value={projectClientDeviceId}
                        onChange={(e) => setProjectClientDeviceId(e.target.value)}
                        required
                      >
                        <option value="">
                          {loadingClientDevices ? 'Loading client devices…' : 'Select client device'}
                        </option>
                        {clientDevices.map((device) => (
                          <option key={device.id} value={String(device.id)}>
                            {device.hostname} ({device.status || 'UNKNOWN'})
                          </option>
                        ))}
                      </select>
                      <div className="vibe-inline-actions">
                        <button
                          type="button"
                          className="vibe-secondary-btn"
                          onClick={() => {
                            setClientBootstrapOpen((current) => !current);
                            if (!clientBootstrapRequestedHostname.trim()) {
                              ensureClientBootstrapHostname();
                            }
                          }}
                          disabled={clientBootstrapBusy || submitting}
                        >
                          {clientBootstrapOpen ? 'Hide Connect Panel' : 'Connect this device'}
                        </button>
                        {clientBootstrapMessage && (
                          <span className="vibe-path-status ok">
                            {clientBootstrapMessage}
                          </span>
                        )}
                      </div>
                      <p className="vibe-empty">
                        Desktop agent mode supports full local execution, path creation, and git initialization on the client device.
                      </p>
                      {clientBootstrapOpen && (
                        <div className="vibe-client-browser-box">
                          <p className="vibe-empty">
                            First-time setup still needs one local shell command. After that, the client processing server registers itself automatically.
                          </p>
                          <input
                            placeholder="Device name"
                            value={clientBootstrapRequestedHostname}
                            onChange={(e) => setClientBootstrapRequestedHostname(e.target.value)}
                          />
                          <div className="vibe-inline-actions">
                            <button
                              type="button"
                              className="vibe-secondary-btn"
                              onClick={handleStartClientBootstrap}
                              disabled={clientBootstrapBusy || submitting}
                            >
                              {clientBootstrapBusy ? 'Preparing…' : 'Generate Connect Command'}
                            </button>
                            {clientBootstrapData?.expiresAt && (
                              <span className="vibe-path-status ok">
                                Expires {new Date(clientBootstrapData.expiresAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {clientBootstrapData?.installCommand && (
                            <>
                              <textarea
                                rows={6}
                                readOnly
                                value={clientBootstrapData.installCommand}
                              />
                              <div className="vibe-inline-actions">
                                <button
                                  type="button"
                                  className="vibe-secondary-btn"
                                  onClick={handleCopyClientBootstrapCommand}
                                >
                                  Copy install command
                                </button>
                                <button
                                  type="button"
                                  className="vibe-secondary-btn"
                                  onClick={handleDownloadClientBootstrapFile}
                                >
                                  Download bootstrap file
                                </button>
                                <button
                                  type="button"
                                  className="vibe-secondary-btn"
                                  onClick={() => refreshClientBootstrapStatus()}
                                  disabled={clientBootstrapBusy}
                                >
                                  Refresh device status
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="vibe-client-browser-box">
                      <p className="vibe-empty">
                        Browser file access links a local folder in Chrome or Edge. It supports local file-backed projects, but not unattended backend execution.
                      </p>
                      <div className="vibe-inline-actions">
                        <button
                          type="button"
                          className="vibe-secondary-btn"
                          onClick={handleLinkClientWorkspace}
                          disabled={checkingPath || submitting}
                        >
                          {checkingPath ? 'Linking…' : (projectClientWorkspaceId ? 'Re-link Folder' : 'Link Folder')}
                        </button>
                        {projectClientWorkspaceName && (
                          <span className="vibe-path-status ok">
                            {projectClientWorkspaceName}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              {projectLocationType !== 'client' || projectClientMode === 'agent' ? (
                <input
                  placeholder={projectLocationType === 'ssh'
                    ? '/home/ubuntu/projects/my-research-project'
                    : '/Users/you/projects/my-research-project'}
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  required
                />
              ) : null}
              <div className="vibe-inline-actions">
                {projectLocationType === 'client' && projectClientMode === 'browser' ? null : (
                  <button
                    type="button"
                    className="vibe-secondary-btn"
                    onClick={handleCheckProjectPath}
                    disabled={checkingPath || submitting}
                  >
                    {checkingPath ? 'Checking…' : 'Check Path'}
                  </button>
                )}
                {pathCheckResult?.message && (
                  <span className={`vibe-path-status ${pathCheckResult.canCreate === false ? 'bad' : 'ok'}`}>
                    {pathCheckResult.message}
                  </span>
                )}
              </div>
              <div className="vibe-modal-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={closeCreateProjectModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting}>Create Project</button>
              </div>
            </form>
          </article>
        </div>
      )}

      {showCreateIdeaModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={closeCreateIdeaModal}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-create-idea-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="vibe-create-idea-title">Add Idea</h3>
            <form onSubmit={handleCreateIdea} className="vibe-form">
              <input
                placeholder="Idea title"
                value={ideaTitle}
                onChange={(e) => setIdeaTitle(e.target.value)}
                required
              />
              <textarea
                placeholder="Hypothesis"
                value={ideaHypothesis}
                onChange={(e) => setIdeaHypothesis(e.target.value)}
                rows={4}
                required
              />
              <div className="vibe-modal-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={closeCreateIdeaModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting}>Create Idea</button>
              </div>
            </form>
          </article>
        </div>
      )}

      {showTodoModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={closeTodoModal}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-todo-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="vibe-todo-modal-title">New TODO</h3>
            <form onSubmit={handleQuickAddTodo} className="vibe-form">
              <input
                placeholder="Set a user TODO step"
                value={todoTitle}
                onChange={(e) => setTodoTitle(e.target.value)}
                required
              />
              <textarea
                placeholder="Optional detail/context"
                value={todoDetails}
                onChange={(e) => setTodoDetails(e.target.value)}
                rows={3}
              />
              <div className="vibe-report-section">
                <h4>Generate TODOs From LLM</h4>
                <textarea
                  rows={3}
                  placeholder="Describe what you want to achieve next, then generate TODOs"
                  value={todoPrompt}
                  onChange={(e) => setTodoPrompt(e.target.value)}
                />
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleGenerateTodos}
                  disabled={todoBusy || !todoPrompt.trim()}
                >
                  {todoBusy ? 'Generating…' : 'Generate TODOs'}
                </button>
              </div>
              <div className="vibe-modal-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={closeTodoModal}
                  disabled={todoBusy}
                >
                  Cancel
                </button>
                <button type="submit" disabled={todoBusy || !todoTitle.trim()}>
                  {todoBusy ? 'Saving…' : 'Add TODO'}
                </button>
              </div>
            </form>
          </article>
        </div>
      )}

      {showKbFolderModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={closeKbFolderModal}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-kb-folder-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="vibe-kb-folder-modal-title">Set Knowledge Base</h3>
            <div className="vibe-form">
              <div className="vibe-inline-actions">
                <button
                  type="button"
                  className={`vibe-secondary-btn ${kbSetupMode === 'resource' ? 'is-active' : ''}`}
                  onClick={() => setKbSetupMode('resource')}
                  disabled={kbSyncBusy}
                >
                  Use Existing resource/
                </button>
                <button
                  type="button"
                  className={`vibe-secondary-btn ${kbSetupMode === 'group' ? 'is-active' : ''}`}
                  onClick={() => setKbSetupMode('group')}
                  disabled={kbSyncBusy}
                >
                  Sync From Paper Group
                </button>
              </div>

              {kbSetupMode === 'resource' ? (
                <>
                  <p className="vibe-empty">
                    Check <code>{`${getProjectPathLabel(selectedProject)}/resource`}</code> and validate it as a paper resource folder.
                  </p>
                  <button
                    type="button"
                    onClick={handleSetupKbFromResource}
                    disabled={kbSyncBusy}
                  >
                    {kbSyncBusy ? 'Checking...' : 'Validate and Set KB'}
                  </button>
                </>
              ) : (
                <>
                  <select
                    value={kbSelectedGroupId}
                    onChange={(event) => setKbSelectedGroupId(event.target.value)}
                    disabled={kbSyncBusy}
                  >
                    <option value="">Select a paper group</option>
                    {knowledgeGroupsLoading && (
                      <option value="" disabled>Loading groups...</option>
                    )}
                    {knowledgeGroups.map((group) => (
                      <option key={`kb-group-${group.id}`} value={String(group.id)}>
                        {group.name} ({group.documentCount || 0} papers)
                      </option>
                    ))}
                  </select>
                  <p className="vibe-empty">
                    Selected papers will sync to <code>{`${getProjectPathLabel(selectedProject)}/resource`}</code> in background.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartKbSyncFromGroup}
                    disabled={kbSyncBusy || !kbSelectedGroupId}
                  >
                    {kbSyncBusy ? 'Starting...' : 'Start Background Sync'}
                  </button>
                </>
              )}

              {kbSyncJob && (
                <div className="vibe-report-section">
                  <h4>Sync Status</h4>
                  <p className="vibe-empty">
                    {kbSyncJob.status || 'UNKNOWN'} · {kbSyncJob.message || 'Waiting...'}
                  </p>
                  {kbSyncJob?.result?.resourcePath && (
                    <code>{kbSyncJob.result.resourcePath}</code>
                  )}
                  {kbSyncJob?.error && (
                    <p className="vibe-empty vibe-card-error">{kbSyncJob.error}</p>
                  )}
                </div>
              )}

              <div className="vibe-modal-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={closeKbFolderModal}
                  disabled={kbSyncBusy}
                >
                  Close
                </button>
              </div>
            </div>
          </article>
        </div>
      )}

      {showEnqueueRunModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={closeEnqueueRunModal}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-enqueue-run-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="vibe-enqueue-run-title">Add Run</h3>
            <form onSubmit={handleEnqueueRun} className="vibe-form">
              <p className="vibe-empty">Headless mode only.</p>
              <input
                placeholder="Server ID"
                value={runServerId}
                onChange={(e) => setRunServerId(e.target.value)}
                required
              />
              <select value={runType} onChange={(e) => setRunType(e.target.value)}>
                <option value="AGENT">Agent Process</option>
                <option value="EXPERIMENT">Script (tmux)</option>
              </select>
              {runType === 'AGENT' && (
                <textarea
                  placeholder="Agent prompt (optional)"
                  value={runPrompt}
                  onChange={(e) => setRunPrompt(e.target.value)}
                  rows={5}
                />
              )}
              {runType === 'EXPERIMENT' && (
                <textarea
                  placeholder="Script command (required) · this will run in tmux"
                  value={runExperimentCommand}
                  onChange={(e) => setRunExperimentCommand(e.target.value)}
                  rows={4}
                  required
                />
              )}
              <p className="vibe-empty">Knowledge assets pinned: {pinnedAssetIds.length}</p>
              <div className="vibe-modal-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={closeEnqueueRunModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting}>
                  Enqueue Run
                </button>
              </div>
            </form>
          </article>
        </div>
      )}
      {showInsertStepModal && (
        <div className="vibe-modal-backdrop" onClick={() => setShowInsertStepModal(false)}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-insert-step-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="vibe-insert-step-title">Insert Workflow Step</h3>
            <p className="vibe-card-note">Edit the JSON below then confirm. Must be a single step object.</p>
            <textarea
              className="vibe-form-textarea-code"
              rows={12}
              value={insertStepJson}
              onChange={(e) => setInsertStepJson(e.target.value)}
              spellCheck={false}
            />
            <div className="vibe-modal-actions">
              <button type="button" className="vibe-secondary-btn" onClick={() => setShowInsertStepModal(false)}>
                Cancel
              </button>
              <button type="button" className="vibe-primary-btn" onClick={handleInsertWorkflowStepSubmit} disabled={submitting}>
                {submitting ? 'Inserting…' : 'Insert Step'}
              </button>
            </div>
          </article>
        </div>
      )}

      {showCheckpointEditModal && (
        <div className="vibe-modal-backdrop" onClick={() => setShowCheckpointEditModal(false)}>
          <article
            className="vibe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-checkpoint-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="vibe-checkpoint-edit-title">Edit Checkpoint</h3>
            <label className="vibe-form-label">Review note (required)</label>
            <textarea
              className="vibe-form-textarea"
              rows={3}
              value={checkpointEditNote}
              onChange={(e) => setCheckpointEditNote(e.target.value)}
              placeholder="Describe the adjustment…"
            />
            <label className="vibe-form-label">JSON edits payload (optional)</label>
            <textarea
              className="vibe-form-textarea-code"
              rows={6}
              value={checkpointEditJson}
              onChange={(e) => { setCheckpointEditJson(e.target.value); setCheckpointEditJsonError(''); }}
              placeholder='{"changes":["adjust timeout"],"reason":"manual review edit"}'
              spellCheck={false}
            />
            {checkpointEditJsonError && (
              <p className="vibe-card-error" style={{ fontSize: '0.82rem', margin: '4px 0' }}>{checkpointEditJsonError}</p>
            )}
            <div className="vibe-modal-actions">
              <button type="button" className="vibe-secondary-btn" onClick={() => setShowCheckpointEditModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="vibe-primary-btn"
                onClick={handleCheckpointEditSubmit}
                disabled={!checkpointEditNote.trim()}
              >
                Submit Edit
              </button>
            </div>
          </article>
        </div>
      )}

      {vibeUiMode.showTreePlanning && showQuickBash && (
        <QuickBashModal
          apiUrl={apiUrl}
          headers={headers}
          projectId={selectedProjectId}
          serverId={selectedProject?.serverId || 'local-default'}
          onClose={() => setShowQuickBash(false)}
        />
      )}

      {vibeUiMode.showTreePlanning && showJumpstart && (
        <JumpstartModal
          apiUrl={apiUrl}
          headers={headers}
          projectId={selectedProjectId}
          projectMode={selectedProject?.projectMode || 'new_project'}
          projectTemplates={projectTemplates}
          onClose={() => setShowJumpstart(false)}
          onCreated={(payload) => {
            if (!payload?.autoRunError) {
              setShowJumpstart(false);
            }
            if (payload?.plan) setTreePlan(payload.plan);
            setTreeState((prev) => applyOptimisticJumpstartTreeState({ treeState: prev, payload }));
            loadTreeWorkspace(selectedProjectId, { silent: true });
          }}
        />
      )}

      {todoEditTarget && (
        <div className="vibe-modal-backdrop" onClick={() => setTodoEditTarget(null)}>
          <article
            className="vibe-modal vibe-todo-edit-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Edit TODO</h3>
            <form onSubmit={handleSaveTodoEdit} className="vibe-form">
              <label className="vibe-form-label">Title</label>
              <input
                value={todoEditTitle}
                onChange={(e) => setTodoEditTitle(e.target.value)}
                required
                autoFocus
              />
              <label className="vibe-form-label">Description</label>
              <textarea
                value={todoEditHypothesis}
                onChange={(e) => setTodoEditHypothesis(e.target.value)}
                rows={3}
              />
              <div className="vibe-modal-actions">
                <button type="button" className="vibe-secondary-btn" onClick={() => setTodoEditTarget(null)} disabled={todoEditBusy}>
                  Cancel
                </button>
                <button type="submit" disabled={todoEditBusy || !todoEditTitle.trim()}>
                  {todoEditBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </article>
        </div>
      )}

      {vibeUiMode.showTreeActions && todoNodeTarget && (
        <TodoNodeModal
          apiUrl={apiUrl}
          headers={headers}
          projectId={selectedProjectId}
          todo={todoNodeTarget.todo}
          onInsertNode={handleInsertNodeFromTodo}
          onClose={() => setTodoNodeTarget(null)}
        />
      )}
    </section>
  );
}

export default VibeResearcherPanel;
