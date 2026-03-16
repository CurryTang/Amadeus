const path = require('path');
const { getDb } = require('../db');
const sshTransport = require('./ssh-transport.service');
const { createArisProjectFilesService } = require('./arisProjectFiles.service');

const ARIS_WORKFLOW_TYPES = [
  'literature_review',
  'idea_discovery',
  'run_experiment',
  'auto_review_loop',
  'paper_writing',
  'paper_improvement',
  'full_pipeline',
  'monitor_experiment',
];

const ARIS_CUSTOM_WORKFLOW_TYPE = 'custom_run';
const ARIS_ACTION_TYPES = [
  'continue',
  'run_experiment',
  'monitor',
  'review',
  'retry',
];

const quickActions = [
  { id: 'custom_run', label: 'Custom Run', workflowType: 'custom_run', prefillPrompt: 'Run this custom ARIS workflow on the selected project target:' },
  { id: 'literature_review', label: 'Literature Review', workflowType: 'literature_review', prefillPrompt: 'Survey the literature and related work for:' },
  { id: 'idea_discovery', label: 'Idea Discovery', workflowType: 'idea_discovery', prefillPrompt: 'Discover promising research ideas around:' },
  { id: 'run_experiment', label: 'Run Experiment', workflowType: 'run_experiment', prefillPrompt: 'Run the following experiment on the persistent remote workspace:' },
  { id: 'auto_review_loop', label: 'Auto Review Loop', workflowType: 'auto_review_loop', prefillPrompt: 'Start an autonomous review loop for this research direction:' },
  { id: 'paper_writing', label: 'Paper Writing', workflowType: 'paper_writing', prefillPrompt: 'Turn the current narrative into a paper draft for:' },
  { id: 'paper_improvement', label: 'Paper Improvement', workflowType: 'paper_improvement', prefillPrompt: 'Improve the current paper draft in the remote ARIS workspace:' },
  { id: 'full_pipeline', label: 'Full Pipeline', workflowType: 'full_pipeline', prefillPrompt: 'Run the full ARIS research pipeline for:' },
  { id: 'monitor_experiment', label: 'Monitor Experiment', workflowType: 'monitor_experiment', prefillPrompt: 'Monitor the current experiment and summarize progress for:' },
];

const DEFAULT_REMOTE_AGENT_BIN = process.env.ARIS_REMOTE_AGENT_BIN || 'claude';
const DEFAULT_REMOTE_AGENT_ARGS = ['--print', '--dangerously-skip-permissions'];
// Skill-based workflows run interactively (no --print) so Claude can loop
const SKILL_AGENT_ARGS = ['--dangerously-skip-permissions'];

// Workflows that should use the /skill-name invocation pattern instead of preamble.
// These run Claude interactively so it can follow the multi-step skill instructions.
const SKILL_BASED_WORKFLOWS = {
  auto_review_loop: '/auto-review-loop',
  paper_improvement: '/auto-paper-improvement-loop',
  full_pipeline: '/research-pipeline',
  literature_review: '/research-lit',
  idea_discovery: '/idea-discovery',
  run_experiment: '/run-experiment',
  paper_writing: '/paper-writing',
  monitor_experiment: '/monitor-experiment',
};
const projectStore = [];
const targetStore = [];
const launchStore = [];
const actionStore = [];
const arisProjectFilesService = createArisProjectFilesService();

function isNonEmpty(value) {
  return String(value || '').trim().length > 0;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildDefaultWorkspacePath(projectId, username = 'default') {
  const root = process.env.ARIS_REMOTE_WORKSPACE_ROOT || `/home/${username}/auto-researcher/aris`;
  return path.posix.join(root, String(projectId || 'default-project'));
}

function buildRunDirectory(remoteWorkspacePath, runId) {
  return path.posix.join(String(remoteWorkspacePath || ''), '.auto-researcher', 'aris-runs', String(runId || 'pending-run'));
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_) {
      return value.split(',').map((item) => String(item).trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeProject(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name ?? 'Untitled Project',
    clientWorkspaceId: row.clientWorkspaceId ?? row.client_workspace_id ?? '',
    localProjectPath: row.localProjectPath ?? row.local_project_path ?? '',
    localFullPath: row.localFullPath ?? row.local_full_path ?? '',
    syncExcludes: normalizeJsonArray(row.syncExcludes ?? row.sync_excludes_json ?? row.sync_excludes),
    createdAt: toIsoOrNull(row.createdAt ?? row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt ?? row.updated_at) ?? null,
  };
}

function normalizeTarget(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id ?? '',
    sshServerId: row.sshServerId ?? row.ssh_server_id ?? null,
    sshServerName: row.sshServerName ?? row.ssh_server_name ?? '',
    remoteProjectPath: row.remoteProjectPath ?? row.remote_project_path ?? '',
    remoteDatasetRoot: row.remoteDatasetRoot ?? row.remote_dataset_root ?? '',
    remoteCheckpointRoot: row.remoteCheckpointRoot ?? row.remote_checkpoint_root ?? '',
    remoteOutputRoot: row.remoteOutputRoot ?? row.remote_output_root ?? '',
    sharedFsGroup: row.sharedFsGroup ?? row.shared_fs_group ?? '',
    createdAt: toIsoOrNull(row.createdAt ?? row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt ?? row.updated_at) ?? null,
  };
}

function normalizeLaunch(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id ?? '',
    projectName: row.projectName ?? row.project_name ?? '',
    targetId: row.targetId ?? row.target_id ?? null,
    targetName: row.targetName ?? row.target_name ?? '',
    localProjectPath: row.localProjectPath ?? row.local_project_path ?? '',
    workflowType: row.workflowType ?? row.workflow_type ?? '',
    prompt: row.prompt ?? '',
    title: row.title ?? '',
    runnerServerId: row.runnerServerId ?? row.runner_server_id ?? null,
    runnerHost: row.runnerHost ?? row.runner_host ?? '',
    downstreamServerId: row.downstreamServerId ?? row.downstream_server_id ?? null,
    downstreamServerName: row.downstreamServerName ?? row.downstream_server_name ?? '',
    remoteWorkspacePath: row.remoteWorkspacePath ?? row.remote_workspace_path ?? '',
    datasetRoot: row.datasetRoot ?? row.dataset_root ?? '',
    requiresUpload: Boolean(row.requiresUpload ?? row.requires_upload),
    status: row.status ?? 'queued',
    activePhase: row.activePhase ?? row.active_phase ?? 'queued',
    latestScore: row.latestScore ?? row.latest_score ?? null,
    latestVerdict: row.latestVerdict ?? row.latest_verdict ?? '',
    summary: row.summary ?? '',
    syncStrategy: row.syncStrategy ?? row.sync_strategy ?? '',
    startedAt: toIsoOrNull(row.startedAt ?? row.started_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt ?? row.updated_at) ?? toIsoOrNull(row.startedAt ?? row.started_at) ?? null,
    remotePid: row.remotePid ?? row.remote_pid ?? null,
    logPath: row.logPath ?? row.log_path ?? '',
    runDirectory: row.runDirectory ?? row.run_directory ?? '',
    retryOfRunId: row.retryOfRunId ?? row.retry_of_run_id ?? null,
    maxIterations: row.maxIterations ?? row.max_iterations ?? null,
    reviewerModel: row.reviewerModel ?? row.reviewer_model ?? null,
  };
}

function normalizeAction(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    runId: row.runId ?? row.run_id ?? '',
    actionType: row.actionType ?? row.action_type ?? 'continue',
    prompt: row.prompt ?? '',
    status: row.status ?? 'queued',
    activePhase: row.activePhase ?? row.active_phase ?? 'queued',
    downstreamServerId: row.downstreamServerId ?? row.downstream_server_id ?? null,
    downstreamServerName: row.downstreamServerName ?? row.downstream_server_name ?? '',
    summary: row.summary ?? '',
    createdAt: toIsoOrNull(row.createdAt ?? row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt ?? row.updated_at) ?? toIsoOrNull(row.createdAt ?? row.created_at) ?? null,
    logPath: row.logPath ?? row.log_path ?? '',
  };
}

function isRunnerCandidate(server = {}) {
  const name = String(server.name || '').toLowerCase();
  const host = String(server.host || '').trim();
  const role = String(server.runner_role || server.role || '').toLowerCase();
  return role === 'aris_wsl'
    || /wsl|local|executor/.test(name)
    || host === '127.0.0.1'
    || host === 'localhost';
}

function toRunnerSummary(server = {}) {
  return {
    id: server.id ?? null,
    name: server.name || server.host || 'wsl-default',
    host: server.host || '127.0.0.1',
    user: server.user || process.env.ARIS_WSL_RUNNER_USER || 'czk',
    type: 'wsl',
    status: server.status || 'configured',
  };
}

function toDownstreamSummary(server = {}) {
  return {
    id: server.id ?? null,
    name: server.name || server.host || 'compute',
    host: server.host || '',
    user: server.user || '',
    status: server.status || 'configured',
  };
}

function toSshServerSummary(server = {}) {
  return {
    id: server.id ?? null,
    name: server.name || server.host || 'server',
    host: server.host || '',
    user: server.user || '',
    port: server.port || 22,
    sharedFsEnabled: Number(server.shared_fs_enabled || 0) === 1,
    sharedFsGroup: server.shared_fs_group || '',
  };
}

function listRunnerServers(servers = []) {
  const explicit = servers.filter((server) => isRunnerCandidate(server));
  if (explicit.length > 0) return explicit.map((server) => toRunnerSummary(server));
  if (servers.length > 0) return [toRunnerSummary(pickRunnerServer(servers))];
  return [toRunnerSummary(pickRunnerServer([]))];
}

function listDownstreamServers(servers = [], runnerServerId = null) {
  return servers
    .filter((server) => String(server.id) !== String(runnerServerId))
    .filter((server) => !isRunnerCandidate(server))
    .map((server) => toDownstreamSummary(server));
}

function inferSyncStrategy(project = {}, target = {}, server = {}) {
  if (Number(server.shared_fs_enabled || 0) === 1 || isNonEmpty(target.sharedFsGroup)) {
    return 'shared_filesystem';
  }
  if (project.clientWorkspaceId) {
    return 'incremental_rsync';
  }
  return 'remote_workspace_only';
}

function describeSyncStrategy(syncStrategy = '') {
  if (syncStrategy === 'shared_filesystem') {
    return 'Sync plan: shared filesystem reuse, no copy unless path remap is needed.';
  }
  if (syncStrategy === 'incremental_rsync') {
    return 'Sync plan: incremental rsync from linked client workspace; unchanged files are skipped.';
  }
  return 'Sync plan: use the existing remote workspace directly.';
}

// Workflow role preambles used instead of /skill-name prefixes.
// Claude --print mode doesn't support slash-command skill invocations,
// so we inline the workflow context as a system-level preamble.
const WORKFLOW_PREAMBLES = {
  custom_run: '',
  literature_review: 'You are an ARIS research assistant performing a literature review. Survey the relevant field, identify key papers, trends, and gaps. Provide a structured summary.',
  idea_discovery: 'You are an ARIS research assistant performing idea discovery. Analyze the current state of the field and propose novel, actionable research ideas with clear motivation and feasibility assessment.',
  run_experiment: 'You are an ARIS research assistant running an experiment. Write code, execute it, analyze results, and iterate. Use the project environment and save outputs to the results directory.',
  auto_review_loop: 'You are an ARIS research assistant performing an iterative self-review loop. Execute the task, review your own output critically, and iterate to improve quality.',
  paper_writing: 'You are an ARIS research assistant writing a paper draft. Organize findings into sections (intro, related work, method, experiments, conclusion) with proper academic tone.',
  paper_improvement: 'You are an ARIS research assistant improving an existing paper. Read the current draft, identify weaknesses, and make targeted improvements.',
  full_pipeline: 'You are an ARIS research assistant running a full research pipeline. Plan the research, implement experiments, analyze results, and document findings.',
  monitor_experiment: 'You are an ARIS research assistant monitoring a running experiment. Check status, report progress, and flag any issues.',
};

function isSkillBasedWorkflow(workflowType) {
  return Boolean(SKILL_BASED_WORKFLOWS[workflowType]);
}

function buildWorkflowInvocation(launch = {}) {
  const prompt = String(launch.prompt || '').trim();
  const skillCommand = SKILL_BASED_WORKFLOWS[launch.workflowType];

  let invocation;
  if (skillCommand) {
    // Skill-based: use /skill-name as the prompt (Claude will load the SKILL.md)
    const extraArgs = [];
    if (launch.maxIterations) extraArgs.push(`--max-rounds ${launch.maxIterations}`);
    if (launch.reviewerModel) extraArgs.push(`--reviewer-model ${launch.reviewerModel}`);
    invocation = `${skillCommand} ${prompt}${extraArgs.length ? ' ' + extraArgs.join(' ') : ''}`.trim();
  } else {
    const preamble = WORKFLOW_PREAMBLES[launch.workflowType] || WORKFLOW_PREAMBLES.full_pipeline || '';
    invocation = preamble ? `${preamble}\n\n${prompt}` : prompt;
  }
  const lines = [invocation];

  if (isNonEmpty(launch.datasetRoot)) {
    lines.push('');
    lines.push(`Dataset root: ${launch.datasetRoot}`);
    lines.push('Use this as a remote path reference. Do not upload the dataset from the client.');
  }

  if (isNonEmpty(launch.downstreamServerName)) {
    lines.push(`Preferred experiment server: ${launch.downstreamServerName}`);
  }

  lines.push(`Remote workspace: ${launch.remoteWorkspacePath}`);
  return lines.join('\n');
}

function buildRemoteLaunchScript({ launch, invocationPrompt, remoteAgentBin = DEFAULT_REMOTE_AGENT_BIN }) {
  const runDirectory = buildRunDirectory(launch.remoteWorkspacePath, launch.id);
  const promptPath = path.posix.join(runDirectory, 'prompt.txt');
  const logPath = path.posix.join(runDirectory, 'run.log');
  const commandPath = path.posix.join(runDirectory, 'launch.sh');
  const useSkillMode = isSkillBasedWorkflow(launch.workflowType);
  const agentArgs = useSkillMode ? SKILL_AGENT_ARGS : DEFAULT_REMOTE_AGENT_ARGS;

  // Environment variables for skill-based workflows
  const envExports = [];
  if (useSkillMode) {
    if (launch.maxIterations) envExports.push(`export ARIS_MAX_ROUNDS=${sshTransport.shellEscape(String(launch.maxIterations))}`);
    if (launch.reviewerModel) envExports.push(`export REVIEW_MODEL=${sshTransport.shellEscape(launch.reviewerModel)}`);
  }
  const envBlock = envExports.length > 0 ? envExports.join('\n') + '\n' : '';

  return `
set -euo pipefail

WORKSPACE=${sshTransport.shellEscape(launch.remoteWorkspacePath)}
RUN_DIR=${sshTransport.shellEscape(runDirectory)}
PROMPT_FILE=${sshTransport.shellEscape(promptPath)}
LOG_FILE=${sshTransport.shellEscape(logPath)}
COMMAND_FILE=${sshTransport.shellEscape(commandPath)}
REMOTE_AGENT_BIN=${sshTransport.shellEscape(remoteAgentBin)}

mkdir -p "$WORKSPACE" "$RUN_DIR"

cat > "$PROMPT_FILE" <<'EOF_PROMPT'
${invocationPrompt}
EOF_PROMPT

cat > "$COMMAND_FILE" <<'EOF_COMMAND'
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE=${sshTransport.shellEscape(launch.remoteWorkspacePath)}
PROMPT_FILE=${sshTransport.shellEscape(promptPath)}
REMOTE_AGENT_BIN=${sshTransport.shellEscape(remoteAgentBin)}
${envBlock}
cd "$WORKSPACE"

# Auto-install ARIS skills if not present
if [ ! -f ".claude/skills/research-lit/SKILL.md" ] && [ ! -f ".claude/skills/research-pipeline/SKILL.md" ]; then
  echo "[ARIS] Skills not found — auto-installing from upstream repo..." >&2
  SKILLS_REPO="\${ARIS_SKILLS_REPO:-https://github.com/CurryTang/Auto-claude-code-research-in-sleep.git}"
  SKILLS_CACHE="\$HOME/.cache/auto-researcher/aris-skills"
  if [ -d "\$SKILLS_CACHE/.git" ]; then
    git -C "\$SKILLS_CACHE" pull --depth 1 origin main 2>/dev/null || true
  else
    mkdir -p "\$(dirname "\$SKILLS_CACHE")"
    git clone --depth 1 "\$SKILLS_REPO" "\$SKILLS_CACHE" 2>/dev/null
  fi
  if [ -d "\$SKILLS_CACHE/skills" ]; then
    mkdir -p .claude/skills
    cp -r "\$SKILLS_CACHE/skills/"* .claude/skills/ 2>/dev/null || true
    echo "[ARIS] Skills installed successfully" >&2
  else
    echo "[ARIS] WARNING: Could not find skills in cache, continuing anyway..." >&2
  fi
fi

# Install review adapter for auto-review-loop workflows
ADAPTER_SRC="\$HOME/.cache/auto-researcher/aris-skills/review-adapter.py"
if [ ! -f "\$ADAPTER_SRC" ]; then
  # Try the overlay location from the auto-researcher repo
  for candidate in \\
    "\$HOME/.cache/auto-researcher/review-adapter.py" \\
    "/tmp/aris-review-adapter.py"; do
    [ -f "\$candidate" ] && ADAPTER_SRC="\$candidate" && break
  done
fi
if [ -f "\$ADAPTER_SRC" ]; then
  mkdir -p .claude
  cp "\$ADAPTER_SRC" .claude/review-adapter.py 2>/dev/null || true
fi

# Ensure openai Python package is available for the review adapter
python3 -c "import openai" 2>/dev/null || pip3 install --user openai 2>/dev/null || true

if ! command -v "$REMOTE_AGENT_BIN" >/dev/null 2>&1; then
  echo "Required ARIS runner binary '$REMOTE_AGENT_BIN' is not installed on the WSL runner" >&2
  exit 127
fi

PROMPT="$(cat "$PROMPT_FILE")"
exec "$REMOTE_AGENT_BIN" ${agentArgs.map((arg) => sshTransport.shellEscape(arg)).join(' ')} "$PROMPT"
EOF_COMMAND

chmod +x "$COMMAND_FILE"
nohup "$COMMAND_FILE" > "$LOG_FILE" 2>&1 < /dev/null &
PID=$!

printf '%s|%s|%s\n' "$PID" "$LOG_FILE" "$RUN_DIR"
`.trim();
}

function parseRemoteLaunchOutput(stdout = '') {
  const [pid, logPath, runDir] = String(stdout || '').trim().split('|');
  return {
    remotePid: Number(pid) || null,
    logPath: logPath || '',
    runDirectory: runDir || '',
  };
}

function pickRunnerServer(servers = []) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return {
      id: null,
      host: '127.0.0.1',
      user: process.env.ARIS_WSL_RUNNER_USER || 'czk',
      name: process.env.ARIS_WSL_RUNNER_NAME || 'wsl-default',
      type: 'wsl',
      status: 'assumed-online',
    };
  }

  const explicitId = String(process.env.ARIS_WSL_RUNNER_ID || '').trim();
  if (explicitId) {
    const byId = servers.find((server) => String(server.id) === explicitId);
    if (byId) {
      return { ...byId, type: 'wsl', status: 'configured' };
    }
  }

  const preferred = servers.find((server) => /wsl|local|executor/i.test(String(server.name || '')))
    || servers.find((server) => String(server.host || '') === '127.0.0.1')
    || servers[0];

  return {
    ...preferred,
    type: 'wsl',
    status: 'configured',
  };
}

function pickDownstreamServer(servers = [], runnerServerId = null) {
  const candidate = servers.find((server) => String(server.id) !== String(runnerServerId));
  if (!candidate) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    host: candidate.host,
  };
}

async function defaultListServers() {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: 'SELECT * FROM ssh_servers ORDER BY name ASC',
      args: [],
    });
    return result.rows || [];
  } catch (_) {
    return [];
  }
}

async function defaultListProjects() {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          name,
          client_workspace_id,
          local_project_path,
          local_full_path,
          sync_excludes_json,
          created_at,
          updated_at
        FROM aris_projects
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
      `,
      args: [],
    });
    return (result.rows || []).map(normalizeProject).filter(Boolean);
  } catch (_) {
    return projectStore.map((project) => ({ ...project }));
  }
}

async function defaultGetProjectById(projectId) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          name,
          client_workspace_id,
          local_project_path,
          local_full_path,
          sync_excludes_json,
          created_at,
          updated_at
        FROM aris_projects
        WHERE id = ?
        LIMIT 1
      `,
      args: [projectId],
    });
    return normalizeProject(result.rows?.[0]);
  } catch (_) {
    return projectStore.find((project) => project.id === projectId) || null;
  }
}

async function defaultSaveProject(project) {
  const normalized = normalizeProject(project);
  try {
    const db = getDb();
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO aris_projects (
          id,
          name,
          client_workspace_id,
          local_project_path,
          local_full_path,
          sync_excludes_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        normalized.id,
        normalized.name,
        normalized.clientWorkspaceId,
        normalized.localProjectPath,
        normalized.localFullPath || '',
        JSON.stringify(normalized.syncExcludes),
        normalized.createdAt,
        normalized.updatedAt || normalized.createdAt,
      ],
    });
  } catch (_) {
    const index = projectStore.findIndex((entry) => entry.id === normalized.id);
    if (index >= 0) projectStore.splice(index, 1);
    projectStore.unshift({ ...normalized });
  }
}

async function defaultListTargets(projectId = '') {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
          ssh_server_id,
          ssh_server_name,
          remote_project_path,
          remote_dataset_root,
          remote_checkpoint_root,
          remote_output_root,
          shared_fs_group,
          created_at,
          updated_at
        FROM aris_project_targets
        ${projectId ? 'WHERE project_id = ?' : ''}
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
      `,
      args: projectId ? [projectId] : [],
    });
    return (result.rows || []).map(normalizeTarget).filter(Boolean);
  } catch (_) {
    return targetStore
      .filter((target) => !projectId || target.projectId === projectId)
      .map((target) => ({ ...target }));
  }
}

async function defaultGetTargetById(targetId) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
          ssh_server_id,
          ssh_server_name,
          remote_project_path,
          remote_dataset_root,
          remote_checkpoint_root,
          remote_output_root,
          shared_fs_group,
          created_at,
          updated_at
        FROM aris_project_targets
        WHERE id = ?
        LIMIT 1
      `,
      args: [targetId],
    });
    return normalizeTarget(result.rows?.[0]);
  } catch (_) {
    return targetStore.find((target) => target.id === targetId) || null;
  }
}

async function defaultSaveTarget(target) {
  const normalized = normalizeTarget(target);
  try {
    const db = getDb();
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO aris_project_targets (
          id,
          project_id,
          ssh_server_id,
          ssh_server_name,
          remote_project_path,
          remote_dataset_root,
          remote_checkpoint_root,
          remote_output_root,
          shared_fs_group,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        normalized.id,
        normalized.projectId,
        normalized.sshServerId,
        normalized.sshServerName,
        normalized.remoteProjectPath,
        normalized.remoteDatasetRoot,
        normalized.remoteCheckpointRoot,
        normalized.remoteOutputRoot,
        normalized.sharedFsGroup,
        normalized.createdAt,
        normalized.updatedAt || normalized.createdAt,
      ],
    });
  } catch (dbErr) {
    console.error('[ARIS] saveTarget DB error (falling back to memory):', dbErr.message || dbErr);
    const index = targetStore.findIndex((entry) => entry.id === normalized.id);
    if (index >= 0) targetStore.splice(index, 1);
    targetStore.unshift({ ...normalized });
  }
}

async function defaultDeleteProject(projectId) {
  try {
    const db = getDb();
    await db.execute({
      sql: 'DELETE FROM aris_projects WHERE id = ?',
      args: [projectId],
    });
  } catch (_) {
    const projectIndex = projectStore.findIndex((entry) => entry.id === projectId);
    if (projectIndex >= 0) projectStore.splice(projectIndex, 1);
    for (let index = targetStore.length - 1; index >= 0; index -= 1) {
      if (String(targetStore[index].projectId) === String(projectId)) {
        targetStore.splice(index, 1);
      }
    }
  }
}

async function defaultDeleteTarget(targetId) {
  try {
    const db = getDb();
    await db.execute({
      sql: 'DELETE FROM aris_project_targets WHERE id = ?',
      args: [targetId],
    });
  } catch (_) {
    const targetIndex = targetStore.findIndex((entry) => entry.id === targetId);
    if (targetIndex >= 0) targetStore.splice(targetIndex, 1);
  }
}

async function defaultListLaunches() {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
          project_name,
          target_id,
          target_name,
          local_project_path,
          workflow_type,
          prompt,
          runner_server_id,
          runner_host,
          downstream_server_id,
          downstream_server_name,
          remote_workspace_path,
          dataset_root,
          requires_upload,
          status,
          active_phase,
          latest_score,
          latest_verdict,
          summary,
          sync_strategy,
          started_at,
          updated_at,
          remote_pid,
          log_path,
          run_directory,
          retry_of_run_id
        FROM aris_runs
        ORDER BY datetime(COALESCE(updated_at, started_at)) DESC
        LIMIT 50
      `,
      args: [],
    });
    return (result.rows || []).map(normalizeLaunch).filter(Boolean);
  } catch (_) {
    return launchStore.map((launch) => ({ ...launch }));
  }
}

async function defaultListRunActions(runId) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          run_id,
          action_type,
          prompt,
          status,
          active_phase,
          downstream_server_id,
          downstream_server_name,
          summary,
          created_at,
          updated_at,
          log_path
        FROM aris_run_actions
        WHERE run_id = ?
        ORDER BY datetime(created_at) ASC
      `,
      args: [runId],
    });
    return (result.rows || []).map(normalizeAction).filter(Boolean);
  } catch (_) {
    return actionStore
      .filter((action) => action.runId === runId)
      .map((action) => ({ ...action }));
  }
}

async function defaultGetLaunchById(runId) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
          project_name,
          target_id,
          target_name,
          local_project_path,
          workflow_type,
          prompt,
          runner_server_id,
          runner_host,
          downstream_server_id,
          downstream_server_name,
          remote_workspace_path,
          dataset_root,
          requires_upload,
          status,
          active_phase,
          latest_score,
          latest_verdict,
          summary,
          sync_strategy,
          started_at,
          updated_at,
          remote_pid,
          log_path,
          run_directory,
          retry_of_run_id
        FROM aris_runs
        WHERE id = ?
        LIMIT 1
      `,
      args: [runId],
    });
    return normalizeLaunch(result.rows?.[0]);
  } catch (_) {
    return launchStore.find((launch) => launch.id === runId) || null;
  }
}

async function defaultSaveLaunch(launch) {
  const normalized = normalizeLaunch(launch);
  try {
    const db = getDb();
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO aris_runs (
          id,
          project_id,
          project_name,
          target_id,
          target_name,
          local_project_path,
          workflow_type,
          prompt,
          runner_server_id,
          runner_host,
          downstream_server_id,
          downstream_server_name,
          remote_workspace_path,
          dataset_root,
          requires_upload,
          status,
          active_phase,
          latest_score,
          latest_verdict,
          summary,
          sync_strategy,
          started_at,
          updated_at,
          remote_pid,
          log_path,
          run_directory,
          retry_of_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        normalized.id,
        normalized.projectId,
        normalized.projectName,
        normalized.targetId,
        normalized.targetName,
        normalized.localProjectPath,
        normalized.workflowType,
        normalized.prompt,
        normalized.runnerServerId,
        normalized.runnerHost,
        normalized.downstreamServerId,
        normalized.downstreamServerName,
        normalized.remoteWorkspacePath,
        normalized.datasetRoot,
        normalized.requiresUpload ? 1 : 0,
        normalized.status,
        normalized.activePhase,
        normalized.latestScore,
        normalized.latestVerdict,
        normalized.summary,
        normalized.syncStrategy,
        normalized.startedAt,
        normalized.updatedAt || normalized.startedAt,
        normalized.remotePid,
        normalized.logPath,
        normalized.runDirectory,
        normalized.retryOfRunId,
      ],
    });
  } catch (_) {
    const existingIndex = launchStore.findIndex((entry) => entry.id === normalized.id);
    if (existingIndex >= 0) launchStore.splice(existingIndex, 1);
    launchStore.unshift({ ...normalized });
    if (launchStore.length > 50) launchStore.length = 50;
  }
}

async function defaultSaveRunAction(action) {
  const normalized = normalizeAction(action);
  try {
    const db = getDb();
    await db.execute({
      sql: `
        INSERT OR REPLACE INTO aris_run_actions (
          id,
          run_id,
          action_type,
          prompt,
          status,
          active_phase,
          downstream_server_id,
          downstream_server_name,
          summary,
          created_at,
          updated_at,
          log_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        normalized.id,
        normalized.runId,
        normalized.actionType,
        normalized.prompt,
        normalized.status,
        normalized.activePhase,
        normalized.downstreamServerId,
        normalized.downstreamServerName,
        normalized.summary,
        normalized.createdAt,
        normalized.updatedAt || normalized.createdAt,
        normalized.logPath,
      ],
    });
  } catch (_) {
    const existingIndex = actionStore.findIndex((entry) => entry.id === normalized.id);
    if (existingIndex >= 0) actionStore.splice(existingIndex, 1);
    actionStore.push({ ...normalized });
  }
}

async function defaultDispatchLaunch({ launch, runner }) {
  if (!runner?.host || !runner?.user) {
    throw new Error('ARIS WSL runner is not configured in SSH servers');
  }

  const invocationPrompt = buildWorkflowInvocation(launch);
  const scriptBody = buildRemoteLaunchScript({ launch, invocationPrompt });
  const result = await sshTransport.script(runner, scriptBody, [], { timeoutMs: 30000 });
  return parseRemoteLaunchOutput(result.stdout);
}

async function defaultDispatchRunAction({ run, action, runner }) {
  if (!runner?.host || !runner?.user) {
    throw new Error('ARIS WSL runner is not configured in SSH servers');
  }

  const actionDirectory = path.posix.join(
    buildRunDirectory(run.remoteWorkspacePath, run.id),
    'actions',
    String(action.id)
  );
  const promptPath = path.posix.join(actionDirectory, 'prompt.txt');
  const logPath = path.posix.join(actionDirectory, 'action.log');
  const commandPath = path.posix.join(actionDirectory, 'launch-action.sh');
  const actionPrompt = [
    `Parent run: ${run.id}`,
    `Action type: ${action.actionType}`,
    `Parent workflow: ${run.workflowType}`,
    `Workspace: ${run.remoteWorkspacePath}`,
    run.datasetRoot ? `Dataset root: ${run.datasetRoot}` : '',
    action.downstreamServerName ? `Preferred experiment server: ${action.downstreamServerName}` : '',
    '',
    action.prompt,
  ].filter(Boolean).join('\n');

  const scriptBody = `
set -euo pipefail

ACTION_DIR=${sshTransport.shellEscape(actionDirectory)}
PROMPT_FILE=${sshTransport.shellEscape(promptPath)}
LOG_FILE=${sshTransport.shellEscape(logPath)}
COMMAND_FILE=${sshTransport.shellEscape(commandPath)}
REMOTE_AGENT_BIN=${sshTransport.shellEscape(DEFAULT_REMOTE_AGENT_BIN)}
WORKSPACE=${sshTransport.shellEscape(run.remoteWorkspacePath)}

mkdir -p "$ACTION_DIR"

cat > "$PROMPT_FILE" <<'EOF_PROMPT'
${actionPrompt}
EOF_PROMPT

cat > "$COMMAND_FILE" <<'EOF_COMMAND'
#!/usr/bin/env bash
set -euo pipefail
REMOTE_AGENT_BIN=${sshTransport.shellEscape(DEFAULT_REMOTE_AGENT_BIN)}
PROMPT_FILE=${sshTransport.shellEscape(promptPath)}
cd ${sshTransport.shellEscape(run.remoteWorkspacePath)}
PROMPT="$(cat ${sshTransport.shellEscape(promptPath)})"
exec "$REMOTE_AGENT_BIN" ${DEFAULT_REMOTE_AGENT_ARGS.map((arg) => sshTransport.shellEscape(arg)).join(' ')} "$PROMPT"
EOF_COMMAND

chmod +x "$COMMAND_FILE"
nohup "$COMMAND_FILE" > "$LOG_FILE" 2>&1 < /dev/null &
printf '%s\n' "$LOG_FILE"
`.trim();

  const result = await sshTransport.script(runner, scriptBody, [], { timeoutMs: 30000 });
  return {
    status: 'queued',
    activePhase: 'queued',
    summary: 'Queued on the parent run workspace',
    logPath: String(result.stdout || '').trim(),
  };
}

async function defaultBuildProjectFiles({ projectName = '', localProjectPath = '' } = {}) {
  return arisProjectFilesService.buildProjectFiles({ projectName, localProjectPath });
}

function createArisService(overrides = {}) {
  const deps = {
    listServers: overrides.listServers || defaultListServers,
    listProjects: overrides.listProjects || defaultListProjects,
    getProjectById: overrides.getProjectById || defaultGetProjectById,
    saveProject: overrides.saveProject || defaultSaveProject,
    deleteProject: overrides.deleteProject || defaultDeleteProject,
    listTargets: overrides.listTargets || defaultListTargets,
    getTargetById: overrides.getTargetById || defaultGetTargetById,
    saveTarget: overrides.saveTarget || defaultSaveTarget,
    deleteTarget: overrides.deleteTarget || defaultDeleteTarget,
    listLaunches: overrides.listLaunches || defaultListLaunches,
    getLaunchById: overrides.getLaunchById || defaultGetLaunchById,
    dispatchLaunch: overrides.dispatchLaunch || defaultDispatchLaunch,
    saveLaunch: overrides.saveLaunch || defaultSaveLaunch,
    listRunActions: overrides.listRunActions || defaultListRunActions,
    saveRunAction: overrides.saveRunAction || defaultSaveRunAction,
    dispatchRunAction: overrides.dispatchRunAction || defaultDispatchRunAction,
    buildProjectFiles: overrides.buildProjectFiles || defaultBuildProjectFiles,
    materializeProjectFiles: overrides.materializeProjectFiles || arisProjectFilesService.materializeProjectFiles,
  };

  async function reconcileProjectTargets(projectId, payload = {}) {
    const endpointIntent = Object.prototype.hasOwnProperty.call(payload, 'remoteEndpoints')
      || Object.prototype.hasOwnProperty.call(payload, 'noRemote');
    if (!endpointIntent) {
      return null;
    }

    const noRemote = payload.noRemote === true;
    const remoteEndpoints = noRemote
      ? []
      : (Array.isArray(payload.remoteEndpoints) ? payload.remoteEndpoints : []).map((endpoint) => ({
        id: endpoint?.id || '',
        sshServerId: endpoint?.sshServerId ?? null,
        remoteProjectPath: String(endpoint?.remoteProjectPath || '').trim(),
        remoteDatasetRoot: String(endpoint?.remoteDatasetRoot || '').trim(),
        remoteCheckpointRoot: String(endpoint?.remoteCheckpointRoot || '').trim(),
        remoteOutputRoot: String(endpoint?.remoteOutputRoot || '').trim(),
      }));

    if (!noRemote && remoteEndpoints.length === 0) {
      throw new Error('remoteEndpoints are required when noRemote is false');
    }

    const servers = await deps.listServers();
    const existingTargets = (await deps.listTargets(projectId))
      .filter((target) => String(target.projectId) === String(projectId));
    const keptTargetIds = new Set();
    const savedTargets = [];

    for (let index = 0; index < remoteEndpoints.length; index += 1) {
      const endpoint = remoteEndpoints[index];
      if (!endpoint.sshServerId) {
        throw new Error(`remoteEndpoints[${index}].sshServerId is required`);
      }
      if (!endpoint.remoteProjectPath) {
        throw new Error(`remoteEndpoints[${index}].remoteProjectPath is required`);
      }

      const server = servers.find((item) => String(item.id) === String(endpoint.sshServerId));
      if (!server) {
        throw new Error(`remoteEndpoints[${index}] SSH server not found`);
      }

      const existingTarget = endpoint.id
        ? existingTargets.find((target) => String(target.id) === String(endpoint.id))
        : null;
      if (endpoint.id && !existingTarget) {
        // Stale id (e.g. target was in-memory and lost after restart) — treat as new
        console.warn(`[ARIS] reconcile: endpoint[${index}] id=${endpoint.id} not found in DB, treating as new`);
      }

      const now = new Date().toISOString();
      const target = normalizeTarget({
        ...existingTarget,
        id: existingTarget?.id || `aris_target_${Date.now()}_${index}`,
        projectId,
        sshServerId: server.id,
        sshServerName: server.name || server.host || '',
        remoteProjectPath: endpoint.remoteProjectPath,
        remoteDatasetRoot: endpoint.remoteDatasetRoot,
        remoteCheckpointRoot: endpoint.remoteCheckpointRoot,
        remoteOutputRoot: endpoint.remoteOutputRoot,
        sharedFsGroup: server.shared_fs_group || existingTarget?.sharedFsGroup || '',
        createdAt: existingTarget?.createdAt || now,
        updatedAt: now,
      });

      await deps.saveTarget(target);
      keptTargetIds.add(String(target.id));
      savedTargets.push(target);
    }

    for (const target of existingTargets) {
      if (!keptTargetIds.has(String(target.id))) {
        await deps.deleteTarget(target.id);
      }
    }

    return savedTargets;
  }

  async function buildLaunchFromPayload(payload = {}, { username = 'czk', retryOfRunId = null } = {}) {
    const workflowType = String(payload.workflowType || '').trim();
    const prompt = String(payload.prompt || '').trim();
    const projectId = String(payload.projectId || '').trim();
    const targetId = String(payload.targetId || '').trim();

    if (![ARIS_CUSTOM_WORKFLOW_TYPE, ...ARIS_WORKFLOW_TYPES].includes(workflowType)) {
      throw new Error('Invalid workflowType');
    }
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!prompt) {
      throw new Error('prompt is required');
    }

    const servers = await deps.listServers();
    let resolvedProject = null;
    let resolvedTarget = null;
    let runner = null;
    let downstreamServer = null;

    if (targetId) {
      resolvedProject = await deps.getProjectById(projectId);
      if (!resolvedProject) {
        throw new Error('Project not found');
      }
      resolvedTarget = await deps.getTargetById(targetId);
      if (!resolvedTarget || String(resolvedTarget.projectId) !== String(projectId)) {
        throw new Error('Target not found');
      }
      const server = servers.find((item) => String(item.id) === String(resolvedTarget.sshServerId));
      if (!server) {
        throw new Error('Target SSH server not found');
      }
      runner = {
        id: server.id,
        name: server.name || server.host || '',
        host: server.host,
        user: server.user,
        port: server.port,
        proxy_jump: server.proxy_jump || '',
        ssh_key_path: server.ssh_key_path || '',
      };
    } else {
      const runners = listRunnerServers(servers);
      const requestedRunnerId = payload.runnerServerId ?? null;
      runner = requestedRunnerId
        ? (runners.find((server) => String(server.id) === String(requestedRunnerId)) || null)
        : (runners[0] || null);
      if (!runner) {
        throw new Error('runnerServerId is required');
      }
      const downstreamServers = listDownstreamServers(servers, runner.id);
      const downstreamServerId = payload.downstreamServerId ?? null;
      downstreamServer = downstreamServerId
        ? downstreamServers.find((server) => String(server.id) === String(downstreamServerId))
        : (downstreamServers[0] || null);
    }

    const serverForSync = resolvedTarget
      ? servers.find((item) => String(item.id) === String(resolvedTarget.sshServerId))
      : null;
    const syncStrategy = inferSyncStrategy(resolvedProject || {}, resolvedTarget || {}, serverForSync || {});

    return {
      launch: {
        id: `aris_run_${Date.now()}`,
        projectId,
        projectName: resolvedProject?.name || '',
        targetId: resolvedTarget?.id || null,
        targetName: resolvedTarget?.sshServerName || '',
        localProjectPath: resolvedProject?.localProjectPath || '',
        workflowType,
        prompt,
        title: String(payload.title || '').trim(),
        runnerServerId: runner.id,
        runnerHost: runner.name || runner.host || '',
        downstreamServerId: downstreamServer?.id ?? null,
        downstreamServerName: downstreamServer?.name ?? '',
        remoteWorkspacePath: String(
          resolvedTarget?.remoteProjectPath
          || payload.remoteWorkspacePath
          || buildDefaultWorkspacePath(projectId, username)
        ).trim(),
        datasetRoot: String(
          resolvedTarget?.remoteDatasetRoot
          || payload.datasetRoot
          || process.env.ARIS_REMOTE_DATASET_ROOT
          || ''
        ).trim(),
        requiresUpload: false,
        status: 'queued',
        activePhase: 'queued',
        latestScore: null,
        latestVerdict: '',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: describeSyncStrategy(syncStrategy),
        syncStrategy,
        remotePid: null,
        logPath: '',
        runDirectory: '',
        retryOfRunId,
        // Loop config (for auto_review_loop and similar skill-based workflows)
        maxIterations: Number(payload.maxIterations) || null,
        reviewerModel: String(payload.reviewerModel || '').trim() || null,
      },
      runner,
      downstreamServer,
    };
  }

  async function dispatchAndPersistLaunch(launch, runner, downstreamServer) {
    const dispatchResult = await deps.dispatchLaunch({
      launch,
      runner,
      downstreamServer,
    });

    launch.status = 'running';
    launch.activePhase = 'running_on_wsl';
    launch.remotePid = dispatchResult?.remotePid ?? null;
    launch.logPath = dispatchResult?.logPath || '';
    launch.runDirectory = dispatchResult?.runDirectory || buildRunDirectory(launch.remoteWorkspacePath, launch.id);
    const summaryParts = [launch.summary || '', launch.logPath ? `Remote log: ${launch.logPath}` : ''].filter(Boolean);
    launch.summary = summaryParts.join('\n');
    launch.updatedAt = new Date().toISOString();

    await deps.saveLaunch(launch);
    return normalizeLaunch(launch);
  }

  return {
    async getWorkspaceContext({ username = 'czk' } = {}) {
      const servers = await deps.listServers();
      const projects = await deps.listProjects();
      const targets = await deps.listTargets();
      const availableSshServers = servers.map((server) => toSshServerSummary(server));
      const defaultProject = projects[0] || null;
      const defaultTarget = defaultProject
        ? targets.find((target) => String(target.projectId) === String(defaultProject.id)) || null
        : null;

      return {
        projects: projects.map((project) => ({
          ...project,
          targetCount: targets.filter((target) => String(target.projectId) === String(project.id)).length,
          noRemote: !targets.some((target) => String(target.projectId) === String(project.id)),
        })),
        targets,
        availableSshServers,
        quickActions,
        continueWhenOffline: true,
        defaultSelections: {
          projectId: defaultProject?.id || '',
          targetId: defaultTarget?.id || '',
        },
      };
    },

    async listProjects() {
      const projects = await deps.listProjects();
      const targets = await deps.listTargets();
      return projects.map((project) => ({
        ...project,
        targetCount: targets.filter((target) => String(target.projectId) === String(project.id)).length,
        noRemote: !targets.some((target) => String(target.projectId) === String(project.id)),
      }));
    },

    async createProject(payload = {}) {
      const name = String(payload.name || '').trim();
      const clientWorkspaceId = String(payload.clientWorkspaceId || '').trim();
      const localProjectPath = String(payload.localProjectPath || '').trim();
      if (!name) throw new Error('name is required');

      const project = normalizeProject({
        id: `aris_project_${Date.now()}`,
        name,
        clientWorkspaceId,
        localProjectPath,
        localFullPath: String(payload.localFullPath || '').trim(),
        syncExcludes: payload.syncExcludes || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await deps.saveProject(project);
      const targets = await reconcileProjectTargets(project.id, payload);
      const projectFiles = await deps.buildProjectFiles({
        projectName: project.name,
        localProjectPath: project.localProjectPath,
      });
      // Auto-install skills to local project path if it exists
      if (project.localProjectPath && deps.materializeProjectFiles) {
        deps.materializeProjectFiles(project.localProjectPath, projectFiles).catch((err) => {
          console.error(`[ARIS] Failed to auto-install skills to local path ${project.localProjectPath}:`, err.message);
        });
      }
      const responseProject = targets ? { ...project, targets } : project;
      return {
        ...responseProject,
        projectFiles,
      };
    },

    async updateProject(projectId, payload = {}) {
      const existing = await deps.getProjectById(projectId);
      if (!existing) throw new Error('Project not found');
      const updated = normalizeProject({
        ...existing,
        ...payload,
        id: existing.id,
        clientWorkspaceId: payload.clientWorkspaceId ?? existing.clientWorkspaceId,
        localProjectPath: payload.localProjectPath ?? existing.localProjectPath,
        localFullPath: payload.localFullPath ?? existing.localFullPath ?? '',
        syncExcludes: payload.syncExcludes ?? existing.syncExcludes,
        updatedAt: new Date().toISOString(),
      });
      await deps.saveProject(updated);
      const targets = await reconcileProjectTargets(updated.id, payload);
      const projectFiles = await deps.buildProjectFiles({
        projectName: updated.name,
        localProjectPath: updated.localProjectPath,
      });
      // Auto-install skills to local project path if it exists
      if (updated.localProjectPath && deps.materializeProjectFiles) {
        deps.materializeProjectFiles(updated.localProjectPath, projectFiles).catch((err) => {
          console.error(`[ARIS] Failed to auto-install skills to local path ${updated.localProjectPath}:`, err.message);
        });
      }
      const responseProject = targets ? { ...updated, targets } : updated;
      return {
        ...responseProject,
        projectFiles,
      };
    },

    async listTargets(projectId = '') {
      return deps.listTargets(projectId);
    },

    async createTarget(projectId, payload = {}) {
      const existingProject = await deps.getProjectById(projectId);
      if (!existingProject) throw new Error('Project not found');
      const sshServerId = payload.sshServerId ?? null;
      if (!sshServerId) throw new Error('sshServerId is required');
      const remoteProjectPath = String(payload.remoteProjectPath || '').trim();
      if (!remoteProjectPath) throw new Error('remoteProjectPath is required');
      const servers = await deps.listServers();
      const server = servers.find((item) => String(item.id) === String(sshServerId));
      if (!server) throw new Error('SSH server not found');

      const target = normalizeTarget({
        id: `aris_target_${Date.now()}`,
        projectId,
        sshServerId: server.id,
        sshServerName: server.name || server.host || '',
        remoteProjectPath,
        remoteDatasetRoot: payload.remoteDatasetRoot || '',
        remoteCheckpointRoot: payload.remoteCheckpointRoot || '',
        remoteOutputRoot: payload.remoteOutputRoot || '',
        sharedFsGroup: server.shared_fs_group || payload.sharedFsGroup || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await deps.saveTarget(target);
      return target;
    },

    async updateTarget(targetId, payload = {}) {
      const existing = await deps.getTargetById(targetId);
      if (!existing) throw new Error('Target not found');
      const servers = await deps.listServers();
      const sshServerId = payload.sshServerId ?? existing.sshServerId;
      const server = servers.find((item) => String(item.id) === String(sshServerId));
      if (!server) throw new Error('SSH server not found');
      const updated = normalizeTarget({
        ...existing,
        ...payload,
        id: existing.id,
        projectId: existing.projectId,
        sshServerId: server.id,
        sshServerName: server.name || server.host || '',
        sharedFsGroup: server.shared_fs_group || payload.sharedFsGroup || existing.sharedFsGroup || '',
        updatedAt: new Date().toISOString(),
      });
      await deps.saveTarget(updated);
      return updated;
    },

    async deleteTarget(targetId) {
      const existing = await deps.getTargetById(targetId);
      if (!existing) throw new Error('Target not found');
      await deps.deleteTarget(existing.id);
      return existing;
    },

    async deleteProject(projectId) {
      const existing = await deps.getProjectById(projectId);
      if (!existing) throw new Error('Project not found');
      await deps.deleteProject(existing.id);
      return existing;
    },

    async createLaunchRequest(payload = {}, { username = 'czk' } = {}) {
      const { launch, runner, downstreamServer } = await buildLaunchFromPayload(payload, { username });
      return dispatchAndPersistLaunch(launch, runner, downstreamServer);
    },

    async listRuns() {
      const launches = await deps.listLaunches();
      return launches.map((launch) => {
        const normalized = normalizeLaunch(launch);
        return {
          id: normalized.id,
          projectId: normalized.projectId,
          targetId: normalized.targetId,
          workflowType: normalized.workflowType,
          title: normalized.title,
          prompt: normalized.prompt,
          status: normalized.status,
          runnerHost: normalized.runnerHost,
          activePhase: normalized.activePhase,
          downstreamServerName: normalized.downstreamServerName,
          latestScore: normalized.latestScore,
          latestVerdict: normalized.latestVerdict,
          summary: normalized.summary,
          startedAt: normalized.startedAt,
          updatedAt: normalized.updatedAt,
          logPath: normalized.logPath,
          retryOfRunId: normalized.retryOfRunId,
        };
      });
    },

    async getRun(runId) {
      const launch = await deps.getLaunchById(runId);
      if (!launch) return null;
      const normalized = normalizeLaunch(launch);
      const actions = await deps.listRunActions(runId);
      return {
        ...normalized,
        actions,
      };
    },

    async retryRun(runId, { username = 'czk' } = {}) {
      const existing = await deps.getLaunchById(runId);
      if (!existing) {
        throw new Error('Run not found');
      }

      const { launch, runner, downstreamServer } = await buildLaunchFromPayload({
        projectId: existing.projectId,
        targetId: existing.targetId,
        workflowType: existing.workflowType,
        prompt: existing.prompt,
        title: existing.title,
        remoteWorkspacePath: existing.remoteWorkspacePath,
        datasetRoot: existing.datasetRoot,
        downstreamServerId: existing.downstreamServerId,
        maxIterations: existing.maxIterations,
        reviewerModel: existing.reviewerModel,
      }, {
        username,
        retryOfRunId: existing.id,
      });

      return dispatchAndPersistLaunch(launch, runner, downstreamServer);
    },

    async createRunAction(runId, payload = {}, { username = 'czk' } = {}) {
      const existing = await deps.getLaunchById(runId);
      if (!existing) {
        throw new Error('Run not found');
      }

      const actionType = String(payload.actionType || '').trim();
      const prompt = String(payload.prompt || '').trim();
      if (!ARIS_ACTION_TYPES.includes(actionType)) {
        throw new Error('Invalid actionType');
      }
      if (!prompt) {
        throw new Error('prompt is required');
      }

      const servers = await deps.listServers();
      const runners = listRunnerServers(servers);
      const runner = runners.find((server) => String(server.id) === String(existing.runnerServerId))
        || runners[0]
        || toRunnerSummary(pickRunnerServer([], username));
      const downstreamServers = listDownstreamServers(servers, runner.id);
      const downstreamServer = payload.downstreamServerId
        ? downstreamServers.find((server) => String(server.id) === String(payload.downstreamServerId))
        : downstreamServers.find((server) => String(server.id) === String(existing.downstreamServerId))
          || null;

      const action = {
        id: `aris_action_${Date.now()}`,
        runId: existing.id,
        actionType,
        prompt,
        status: 'queued',
        activePhase: 'queued',
        downstreamServerId: downstreamServer?.id ?? null,
        downstreamServerName: downstreamServer?.name ?? '',
        summary: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        logPath: '',
      };

      const dispatchResult = await deps.dispatchRunAction({
        run: existing,
        action,
        runner,
        username,
      });

      action.status = dispatchResult?.status || action.status;
      action.activePhase = dispatchResult?.activePhase || action.activePhase;
      action.summary = dispatchResult?.summary || action.summary;
      action.logPath = dispatchResult?.logPath || '';
      action.updatedAt = new Date().toISOString();
      await deps.saveRunAction(action);
      return normalizeAction(action);
    },
  };
}

module.exports = {
  ARIS_ACTION_TYPES,
  ARIS_CUSTOM_WORKFLOW_TYPE,
  ARIS_WORKFLOW_TYPES,
  createArisService,
};
