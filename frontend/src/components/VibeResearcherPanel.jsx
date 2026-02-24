import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import GitLogEntry from '../models/GitLogEntry';
import VibeKnowledgeHubModal from './VibeKnowledgeHubModal';

function VibeResearcherPanel({ apiUrl, getAuthHeaders, onOpenPaperLibrary }) {
  const [projects, setProjects] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [queue, setQueue] = useState([]);
  const [runs, setRuns] = useState([]);
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

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectLocationType, setProjectLocationType] = useState('local'); // local | ssh
  const [projectServerId, setProjectServerId] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [pathCheckResult, setPathCheckResult] = useState(null);

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
  const [agentSkill, setAgentSkill] = useState('implement');

  const [selectedRunId, setSelectedRunId] = useState('');
  const [runReport, setRunReport] = useState(null);
  const [runReportLoading, setRunReportLoading] = useState(false);
  const [checkpointActionLoadingId, setCheckpointActionLoadingId] = useState(null);

  const [knowledgeGroups, setKnowledgeGroups] = useState([]);
  const [knowledgeGroupsLoading, setKnowledgeGroupsLoading] = useState(false);
  const [projectFileTree, setProjectFileTree] = useState(null);
  const [projectFileTreeLoading, setProjectFileTreeLoading] = useState(false);
  const [projectFileTreeError, setProjectFileTreeError] = useState('');
  const [projectFileContent, setProjectFileContent] = useState(null);
  const [projectFileContentLoading, setProjectFileContentLoading] = useState(false);
  const [projectFileContentError, setProjectFileContentError] = useState('');
  const [aiEditTarget, setAiEditTarget] = useState('');
  const [aiEditInstruction, setAiEditInstruction] = useState('');
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [fileMentionOptions, setFileMentionOptions] = useState([]);
  const [fileMentionLoading, setFileMentionLoading] = useState(false);

  const headers = useMemo(() => getAuthHeaders?.() || {}, [getAuthHeaders]);
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

  const loadProjectInsights = useCallback(async (projectId, { silent = false, gitLimit = null } = {}) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
    const normalizedGitLimitRaw = Number.isFinite(Number(gitLimit))
      ? Number(gitLimit)
      : Number(gitLogLimitRef.current);
    const normalizedGitLimit = Math.min(Math.max(Math.floor(normalizedGitLimitRaw) || 5, 1), 200);

    if (!silent) {
      setGitLoading(true);
      setChangedFilesLoading(true);
    }
    setGitError('');
    setChangedFilesError('');

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
    } else {
      console.error('Failed to load project git progress:', gitResult.reason);
      setGitProgress(null);
      setGitError(
        gitResult.reason?.response?.data?.error
        || gitResult.reason?.message
        || 'Failed to load git progress'
      );
    }

    if (changedFilesResult.status === 'fulfilled') {
      setChangedFiles(changedFilesResult.value?.data || null);
      setChangedFilesError('');
    } else {
      console.error('Failed to load project changed files:', changedFilesResult.reason);
      setChangedFiles(null);
      setChangedFilesError(
        changedFilesResult.reason?.response?.data?.error
        || changedFilesResult.reason?.message
        || 'Failed to load changed files'
      );
    }

    if (!silent) {
      setGitLoading(false);
      setChangedFilesLoading(false);
    }
  }, [apiUrl, headers]);

  const loadProjectFileTree = useCallback(async (
    projectId,
    relativePath = '',
    { silent = false } = {}
  ) => {
    const targetProjectId = String(projectId || '').trim();
    if (!targetProjectId) return;
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
    } catch (err) {
      console.error('Failed to load project file tree:', err);
      setProjectFileTree(null);
      const message = err?.response?.data?.error || err?.message || 'Failed to load project files';
      setProjectFileTreeError(message);
      setFilesError(message);
    } finally {
      if (!silent) {
        setProjectFileTreeLoading(false);
        setFilesLoading(false);
      }
    }
  }, [apiUrl, headers]);

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
      setProjectFileContentError(err?.response?.data?.error || err?.message || 'Failed to read file');
    } finally {
      setProjectFileContentLoading(false);
    }
  }, [apiUrl, headers]);

  const searchProjectFiles = useCallback(async (projectId, query) => {
    const targetProjectId = String(projectId || '').trim();
    const q = String(query || '').trim();
    if (!targetProjectId || !q) {
      setFileMentionOptions([]);
      return;
    }
    setFileMentionLoading(true);
    try {
      const response = await axios.get(`${apiUrl}/researchops/projects/${targetProjectId}/files/search`, {
        headers,
        params: {
          q,
          limit: 12,
        },
      });
      if (selectedProjectRef.current !== targetProjectId) return;
      setFileMentionOptions(Array.isArray(response.data?.items) ? response.data.items : []);
    } catch (err) {
      console.error('Failed to search project files:', err);
      setFileMentionOptions([]);
    } finally {
      setFileMentionLoading(false);
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
      }
      if (selectedRunId) {
        loadRunReport(selectedRunId, { silent: true });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [
    loadAll,
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

  const resetProjectDraft = useCallback(() => {
    setProjectName('');
    setProjectDescription('');
    setProjectLocationType('local');
    setProjectServerId('');
    setProjectPath('');
    setPathCheckResult(null);
    setCheckingPath(false);
  }, []);

  const checkProjectPath = useCallback(async () => {
    const normalizedPath = projectPath.trim();
    if (!normalizedPath) {
      throw new Error('Project path is required');
    }
    if (projectLocationType === 'ssh' && !projectServerId) {
      throw new Error('Please select an SSH server');
    }
    const payload = {
      locationType: projectLocationType,
      projectPath: normalizedPath,
      serverId: projectLocationType === 'ssh' ? projectServerId : undefined,
    };
    const response = await axios.post(`${apiUrl}/researchops/projects/path-check`, payload, { headers });
    const result = response.data || {};
    setPathCheckResult(result);
    return result;
  }, [apiUrl, headers, projectLocationType, projectPath, projectServerId]);

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

  const handleCreateProject = async (event) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    setSubmitting(true);
    try {
      const latestPathResult = await checkProjectPath();
      if (latestPathResult?.canCreate === false) {
        throw new Error('Project path exists but is not a directory');
      }
      const response = await axios.post(`${apiUrl}/researchops/projects`, {
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
        locationType: projectLocationType,
        serverId: projectLocationType === 'ssh' ? projectServerId : undefined,
        projectPath: latestPathResult?.projectPath || projectPath.trim(),
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

  const handleGenerateTodos = useCallback(async () => {
    const instruction = todoPrompt.trim();
    if (!selectedProjectId || !instruction) {
      setError('Enter a prompt before generating TODOs.');
      return;
    }
    setTodoBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/researchops/plan/generate`, { instruction }, { headers });
      const plan = response.data?.plan || {};
      const rawNodes = Array.isArray(plan.nodes) ? plan.nodes : [];
      const suggestions = rawNodes
        .map((node, index) => {
          const label = String(node?.label || '').trim() || `Planned step ${index + 1}`;
          const detail = String(node?.description || node?.goal || label).trim();
          return {
            title: label.length > 120 ? `${label.slice(0, 117)}...` : label,
            hypothesis: detail,
          };
        })
        .slice(0, 5);

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
          summary: `LLM-generated TODO from prompt (${createdAtIso})`,
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
  }, [apiUrl, headers, loadAll, selectedProjectId, todoPrompt]);

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
    loadProjectFileTree(selectedProjectId, relativePath);
  }, [loadProjectFileTree, selectedProjectId]);

  const handleOpenProjectFile = useCallback((relativePath) => {
    if (!selectedProjectId || !relativePath) return;
    setAiEditTarget(`@${relativePath}`);
    loadProjectFileContent(selectedProjectId, relativePath);
  }, [loadProjectFileContent, selectedProjectId]);

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

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

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
    [...selectedProjectIdeas].sort((a, b) => {
      const aStatus = String(a.status || '').trim().toUpperCase();
      const bStatus = String(b.status || '').trim().toUpperCase();
      const aDone = aStatus === 'DONE' || aStatus === 'COMPLETED';
      const bDone = bStatus === 'DONE' || bStatus === 'COMPLETED';
      if (aDone !== bDone) return aDone ? 1 : -1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
  ), [selectedProjectIdeas]);

  const selectedProjectQueue = useMemo(
    () => queue.filter((run) => run.projectId === selectedProjectId),
    [queue, selectedProjectId]
  );

  const selectedProjectRuns = useMemo(
    () => runs.filter((run) => run.projectId === selectedProjectId),
    [runs, selectedProjectId]
  );

  const linkedKnowledgeGroupIds = useMemo(() => {
    if (!Array.isArray(selectedProject?.knowledgeGroupIds)) return [];
    return selectedProject.knowledgeGroupIds.map((id) => Number(id)).filter(Number.isFinite);
  }, [selectedProject]);

  const knowledgeBaseFolder = String(selectedProject?.kbFolderPath || '').trim();

  const projectTreeEntries = useMemo(
    () => (Array.isArray(projectFileTree?.entries) ? projectFileTree.entries : []),
    [projectFileTree]
  );

  const projectCurrentPath = String(projectFileTree?.currentPath || '').trim();
  const projectParentPath = String(projectFileTree?.parentPath || '').trim();
  const projectRootPath = String(projectFileTree?.rootPath || '').trim();

  const runReportView = useMemo(() => {
    const manifest = runReport?.manifest && typeof runReport.manifest === 'object'
      ? runReport.manifest
      : null;
    const artifacts = Array.isArray(runReport?.artifacts) ? runReport.artifacts : [];
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
  }, [runReport]);

  const openCreateProjectModal = () => {
    setError('');
    setShowCreateProjectModal(true);
    loadSshServers();
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

  const IMPLEMENT_SKILL_PREFIX = 'You are a coding implementation agent working on this project. Implement the following request carefully, following project conventions. Run tests if a test suite exists and report results.\n\n';
  const EXPERIMENT_SKILL_PREFIX = 'You are an experiment planning agent. Based on the request below, determine the exact bash command(s) to run the experiment. Write CONTINUATION.json to $RESEARCHOPS_TMPDIR to schedule the experiment run, then exit. Do NOT run the experiment yourself — only write the plan.\n\nUser request:\n';

  const handleLaunchAgent = async (event) => {
    if (event) event.preventDefault();
    if (!selectedProjectId || !runPrompt.trim()) return;
    if (agentSkill === 'custom') { openEnqueueRunModal(); return; }
    setSubmitting(true);
    setError('');
    try {
      const defaultCwd = String(selectedProject?.projectPath || '').trim();
      const sourceServerId = String(selectedProject?.serverId || '').trim();
      const prefix = agentSkill === 'experiment' ? EXPERIMENT_SKILL_PREFIX : IMPLEMENT_SKILL_PREFIX;
      const fullPrompt = `${prefix}${runPrompt.trim()}`;
      const workflow = [
        { id: 'agent_main', type: 'agent.run', inputs: { prompt: fullPrompt, provider: 'codex_cli' } },
        { id: 'report', type: 'report.render', inputs: { format: 'md+json' } },
      ];
      const payload = {
        projectId: selectedProjectId,
        serverId: runServerId.trim() || 'local-default',
        runType: 'AGENT',
        provider: 'codex_cli',
        schemaVersion: '2.0',
        mode: 'headless',
        workflow,
        contextRefs: { knowledgeGroupIds: selectedProject.knowledgeGroupIds || [] },
        metadata: {
          prompt: runPrompt.trim(),
          agentSkill,
          ...(defaultCwd ? { cwd: defaultCwd } : {}),
          ...(sourceServerId ? { cwdSourceServerId: sourceServerId } : {}),
          ...(pinnedAssetIds.length ? { pinnedAssetIds } : {}),
        },
      };
      await axios.post(`${apiUrl}/researchops/runs`, payload, { headers });
      setRunPrompt('');
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
  };

  const openKnowledgeHubModal = () => {
    setError('');
    setShowKnowledgeHubModal(true);
  };

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
  }, [projectLocationType, projectServerId, projectPath]);

  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.locationType === 'ssh' && selectedProject.serverId) {
      setRunServerId(String(selectedProject.serverId));
    } else {
      setRunServerId('local-default');
    }
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProjectId) {
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
      return;
    }
    setGitLogLimit(5);
    loadProjectInsights(selectedProjectId, { gitLimit: 5 });
    loadProjectFileTree(selectedProjectId, '');
  }, [selectedProjectId, loadProjectInsights, loadProjectFileTree]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedRunId('');
      setRunReport(null);
      return;
    }
    if (selectedProjectRuns.length === 0) {
      setSelectedRunId('');
      setRunReport(null);
      return;
    }
    setSelectedRunId((prev) => (
      prev && selectedProjectRuns.some((run) => run.id === prev)
        ? prev
        : selectedProjectRuns[0].id
    ));
  }, [selectedProjectId, selectedProjectRuns]);

  useEffect(() => {
    if (!selectedRunId) return;
    loadRunReport(selectedRunId);
  }, [selectedRunId, loadRunReport]);

  useEffect(() => {
    if (selectedProject) return;
    setShowCreateIdeaModal(false);
    setShowTodoModal(false);
    setShowKbFolderModal(false);
    setShowEnqueueRunModal(false);
    setShowKnowledgeHubModal(false);
    setShowSkillsModal(false);
    setSelectedRunId('');
    setRunReport(null);
    setProjectFileTree(null);
    setProjectFileContent(null);
    setProjectFileTreeError('');
    setProjectFileContentError('');
    setAiEditTarget('');
    setAiEditInstruction('');
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
              <span className="vibe-workspace-loc">
                {selectedProject.locationType === 'ssh' ? 'SSH project' : 'Local project'}
              </span>
            </div>
          </div>

          <div className="vibe-workspace-actions vibe-workspace-actions--neo">
            <button
              type="button"
              className="vibe-workspace-chip"
              onClick={() => setShowSkillsModal(true)}
              disabled={submitting || syncingSkills}
            >
              Skills ({skills.length})
            </button>
            <button
              type="button"
              className="vibe-workspace-chip"
              onClick={() => {
                loadProjectInsights(selectedProject.id);
                loadProjectFileTree(selectedProject.id, projectCurrentPath || '');
              }}
              disabled={submitting || gitLoading || filesLoading || changedFilesLoading}
            >
              {gitLoading || filesLoading || changedFilesLoading ? 'Refreshing…' : 'Refresh Progress'}
            </button>
            <button
              type="button"
              className="vibe-workspace-chip"
              onClick={openEnqueueRunModal}
              disabled={submitting}
            >
              Advanced Run
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
            <div className="vibe-skill-chips">
              <button
                type="button"
                className={`vibe-skill-chip${agentSkill === 'implement' ? ' is-active' : ''}`}
                onClick={() => setAgentSkill('implement')}
              >
                Implement
              </button>
              <button
                type="button"
                className={`vibe-skill-chip${agentSkill === 'experiment' ? ' is-active' : ''}`}
                onClick={() => setAgentSkill('experiment')}
              >
                Experiment
              </button>
              <button
                type="button"
                className={`vibe-skill-chip${agentSkill === 'custom' ? ' is-active' : ''}`}
                onClick={() => setAgentSkill('custom')}
              >
                Custom
              </button>
            </div>
            <p className="vibe-skill-desc">
              {agentSkill === 'implement' && 'Coding agent implements your request directly in the project.'}
              {agentSkill === 'experiment' && 'Agent plans a bash experiment, schedules it to run, then analyzes results automatically.'}
              {agentSkill === 'custom' && 'Open the advanced run builder to configure a custom workflow.'}
            </p>
            <form onSubmit={handleLaunchAgent} className="vibe-launcher-form">
              <textarea
                className="vibe-launcher-textarea"
                placeholder={
                  agentSkill === 'implement'
                    ? 'What should the agent implement or fix?  (Enter to launch, Shift+Enter for new line)'
                    : agentSkill === 'experiment'
                      ? 'Describe the experiment to run…  (Enter to launch)'
                      : 'Describe the task…'
                }
                value={runPrompt}
                onChange={(e) => setRunPrompt(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleLaunchAgent(e);
                  }
                }}
              />
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
                <button
                  type="submit"
                  className="vibe-launch-btn"
                  disabled={submitting || (agentSkill !== 'custom' && !runPrompt.trim())}
                >
                  {submitting ? 'Launching…' : agentSkill === 'custom' ? 'Open Builder' : 'Launch'}
                </button>
              </div>
            </form>
          </div>

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
                {knowledgeGroups.slice(0, 6).map((group) => (
                  <div key={`group-preview-${group.id}`} className="vibe-list-item">
                    <div className="vibe-list-main">
                      <strong>{group.name}</strong>
                      <span>{group.documentCount || 0} papers</span>
                    </div>
                    <code>#{group.id}</code>
                  </div>
                ))}
                {knowledgeGroups.length === 0 && (
                  <p className="vibe-empty">
                    {knowledgeGroupsLoading
                      ? 'Loading paper groups...'
                      : 'No paper groups found yet. Use Paper List to create/import a group, then set KB folder.'}
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
              </div>
              <div className="vibe-list vibe-project-todo-list">
                {selectedProjectTodos.length === 0 ? (
                  <p className="vibe-empty">No TODOs yet. Click New TODO below.</p>
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
                            loadProjectInsights(selectedProjectId, { gitLimit: nextLimit });
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
                        projectTreeEntries.map((entry) => (
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
                        ))
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

          <div className="vibe-run-history">
            <div className="vibe-run-history-head">
              <h3>Run History</h3>
              <span className="vibe-card-note">{selectedProjectRuns.length} runs</span>
            </div>
            {selectedProjectRuns.length === 0 ? (
              <p className="vibe-empty">No runs yet. Launch an agent above to get started.</p>
            ) : (
              <div className="vibe-run-history-list">
                {selectedProjectRuns.slice(0, 30).map((run) => {
                  const isActive = run.id === selectedRunId;
                  const ts = run.createdAt ? new Date(run.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                  const prompt = String(run.metadata?.prompt || run.metadata?.experimentCommand || '').slice(0, 80);
                  const skill = run.metadata?.agentSkill || run.runType?.toLowerCase() || 'agent';
                  const parentId = run.metadata?.parentRunId;
                  const statusClass = {
                    SUCCEEDED: 'vibe-run-status--ok',
                    FAILED: 'vibe-run-status--fail',
                    RUNNING: 'vibe-run-status--running',
                    QUEUED: 'vibe-run-status--queued',
                    CANCELLED: 'vibe-run-status--cancel',
                  }[run.status] || '';
                  return (
                    <button
                      key={run.id}
                      type="button"
                      className={`vibe-run-row${isActive ? ' is-active' : ''}`}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span className={`vibe-run-status ${statusClass}`}>{run.status}</span>
                      <span className="vibe-run-skill">{skill}</span>
                      <span className="vibe-run-prompt">{prompt || run.id}</span>
                      <span className="vibe-run-ts">{ts}</span>
                      {parentId && <span className="vibe-run-chain" title={`Continuation of ${parentId}`}>↩</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="vibe-home">
          <div className="vibe-home-head">
            <h3>Project Workspace</h3>
            <p>Select an existing project to enter its workspace. New project opens in this view until you click it.</p>
          </div>

          <div className="vibe-project-grid" role="list" aria-label="Projects">
            <button
              type="button"
              className="vibe-project-card vibe-project-create"
              onClick={openCreateProjectModal}
              disabled={submitting}
              aria-label="Add new project"
            >
              <span className="vibe-project-plus">+</span>
              <strong>Add New Project</strong>
              <span>Create project details after click</span>
            </button>

            {projects.map((project) => {
              const stats = projectStats.get(project.id) || { ideas: 0, queued: 0 };
              return (
                <button
                  key={project.id}
                  type="button"
                  className="vibe-project-card"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <div className="vibe-project-card-top">
                    <h3>{project.name}</h3>
                    <code>{project.id}</code>
                  </div>
                  <p>{project.description || 'No description provided yet.'}</p>
                  <div className="vibe-project-metrics">
                    <span>{stats.ideas} ideas</span>
                    <span>{stats.queued} queued</span>
                    <span>{project.locationType === 'ssh' ? 'SSH' : 'Local'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {projects.length === 0 && (
            <div className="vibe-select-project-hint">
              No projects yet. Click "Add New Project" to create your first one.
            </div>
          )}

          <article className="vibe-card vibe-skill-card">
            <div className="vibe-skill-header">
              <h3>Merged Skills ({skills.length})</h3>
              <button
                type="button"
                className="vibe-secondary-btn"
                onClick={handleSyncSkills}
                disabled={syncingSkills || submitting}
              >
                {syncingSkills ? 'Syncing…' : 'Sync Remote Skills'}
              </button>
            </div>
            <div className="vibe-skill-list">
              {skills.length === 0 ? (
                <p className="vibe-empty">No skills found. Sync from object storage or add local `skills/*/SKILL.md`.</p>
              ) : (
                skills.map((skill) => (
                  <span
                    key={skill.id}
                    className="vibe-skill-chip"
                    title={`${skill.source || 'unknown'}${skill.version ? ` · v${skill.version}` : ''}`}
                  >
                    {skill.name}
                  </span>
                ))
              )}
            </div>
          </article>
        </div>
      )}

      {showSkillsModal && selectedProject && (
        <div className="vibe-modal-backdrop" onClick={closeSkillsModal}>
          <article
            className="vibe-modal vibe-skills-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-project-skills-title"
            onClick={(event) => event.stopPropagation()}
          >
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
                  <span
                    key={skill.id}
                    className="vibe-skill-chip"
                    title={`${skill.source || 'unknown'}${skill.version ? ` · v${skill.version}` : ''}`}
                  >
                    {skill.name}
                  </span>
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
              <input
                placeholder={projectLocationType === 'ssh'
                  ? '/home/ubuntu/projects/my-research-project'
                  : '/Users/you/projects/my-research-project'}
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                required
              />
              <div className="vibe-inline-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={handleCheckProjectPath}
                  disabled={checkingPath || submitting}
                >
                  {checkingPath ? 'Checking…' : 'Check Path'}
                </button>
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
                    Check <code>{`${selectedProject.projectPath}/resource`}</code> and validate it as a paper resource folder.
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
                    Selected papers will sync to <code>{`${selectedProject.projectPath}/resource`}</code> in background.
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
    </section>
  );
}

export default VibeResearcherPanel;
