const path = require('path');
const { getDb } = require('../db');
const sshTransport = require('./ssh-transport.service');

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

const quickActions = [
  { id: 'literature_review', label: 'Literature Review', workflowType: 'literature_review' },
  { id: 'idea_discovery', label: 'Idea Discovery', workflowType: 'idea_discovery' },
  { id: 'run_experiment', label: 'Run Experiment', workflowType: 'run_experiment' },
  { id: 'auto_review_loop', label: 'Auto Review Loop', workflowType: 'auto_review_loop' },
  { id: 'paper_writing', label: 'Paper Writing', workflowType: 'paper_writing' },
  { id: 'paper_improvement', label: 'Paper Improvement', workflowType: 'paper_improvement' },
  { id: 'full_pipeline', label: 'Full Pipeline', workflowType: 'full_pipeline' },
  { id: 'monitor_experiment', label: 'Monitor Experiment', workflowType: 'monitor_experiment' },
];

const DEFAULT_REMOTE_AGENT_BIN = process.env.ARIS_REMOTE_AGENT_BIN || 'claude';
const DEFAULT_REMOTE_AGENT_ARGS = ['--print', '--dangerously-skip-permissions'];
const launchStore = [];

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

function normalizeLaunch(row = {}) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    projectId: row.projectId ?? row.project_id ?? '',
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
    startedAt: toIsoOrNull(row.startedAt ?? row.started_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updatedAt ?? row.updated_at) ?? toIsoOrNull(row.startedAt ?? row.started_at) ?? null,
    remotePid: row.remotePid ?? row.remote_pid ?? null,
    logPath: row.logPath ?? row.log_path ?? '',
    runDirectory: row.runDirectory ?? row.run_directory ?? '',
    retryOfRunId: row.retryOfRunId ?? row.retry_of_run_id ?? null,
  };
}

function buildWorkflowInvocation(launch = {}) {
  const prompt = String(launch.prompt || '').trim();
  const commands = {
    literature_review: '/research-lit',
    idea_discovery: '/idea-discovery',
    run_experiment: '/run-experiment',
    auto_review_loop: '/auto-review-loop',
    paper_writing: '/paper-writing',
    paper_improvement: '/auto-paper-improvement-loop',
    full_pipeline: '/research-pipeline',
    monitor_experiment: '/monitor-experiment',
  };
  const skillCommand = commands[launch.workflowType] || '/research-pipeline';
  const lines = [`${skillCommand} ${prompt}`.trim()];

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

cd "$WORKSPACE"

if [ ! -d ".claude/skills/aris" ] && [ ! -d ".claude/skills" ]; then
  echo "ARIS skills are not installed in $WORKSPACE/.claude/skills" >&2
  exit 1
fi

if ! command -v "$REMOTE_AGENT_BIN" >/dev/null 2>&1; then
  echo "Required ARIS runner binary '$REMOTE_AGENT_BIN' is not installed on the WSL runner" >&2
  exit 127
fi

PROMPT="$(cat "$PROMPT_FILE")"
exec "$REMOTE_AGENT_BIN" ${DEFAULT_REMOTE_AGENT_ARGS.map((arg) => sshTransport.shellEscape(arg)).join(' ')} "$PROMPT"
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

async function defaultListLaunches() {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
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

async function defaultGetLaunchById(runId) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT
          id,
          project_id,
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
          started_at,
          updated_at,
          remote_pid,
          log_path,
          run_directory,
          retry_of_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        normalized.id,
        normalized.projectId,
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

async function defaultDispatchLaunch({ launch, runner }) {
  if (!runner?.host || !runner?.user) {
    throw new Error('ARIS WSL runner is not configured in SSH servers');
  }

  const invocationPrompt = buildWorkflowInvocation(launch);
  const scriptBody = buildRemoteLaunchScript({ launch, invocationPrompt });
  const result = await sshTransport.script(runner, scriptBody, [], { timeoutMs: 30000 });
  return parseRemoteLaunchOutput(result.stdout);
}

function createArisService(overrides = {}) {
  const deps = {
    listServers: overrides.listServers || defaultListServers,
    listLaunches: overrides.listLaunches || defaultListLaunches,
    getLaunchById: overrides.getLaunchById || defaultGetLaunchById,
    dispatchLaunch: overrides.dispatchLaunch || defaultDispatchLaunch,
    saveLaunch: overrides.saveLaunch || defaultSaveLaunch,
  };

  async function buildLaunchFromPayload(payload = {}, { username = 'czk', retryOfRunId = null } = {}) {
    const workflowType = String(payload.workflowType || '').trim();
    const prompt = String(payload.prompt || '').trim();
    const projectId = String(payload.projectId || '').trim();

    if (!ARIS_WORKFLOW_TYPES.includes(workflowType)) {
      throw new Error('Invalid workflowType');
    }
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!prompt) {
      throw new Error('prompt is required');
    }

    const servers = await deps.listServers();
    const runner = pickRunnerServer(servers);
    const downstreamServerId = payload.downstreamServerId ?? null;
    const downstreamServer = downstreamServerId
      ? servers.find((server) => String(server.id) === String(downstreamServerId))
      : pickDownstreamServer(servers, runner.id);

    return {
      launch: {
        id: `aris_run_${Date.now()}`,
        projectId,
        workflowType,
        prompt,
        title: String(payload.title || '').trim(),
        runnerServerId: runner.id,
        runnerHost: runner.name || runner.host || '',
        downstreamServerId: downstreamServer?.id ?? null,
        downstreamServerName: downstreamServer?.name ?? '',
        remoteWorkspacePath: String(payload.remoteWorkspacePath || buildDefaultWorkspacePath(projectId, username)).trim(),
        datasetRoot: String(payload.datasetRoot || process.env.ARIS_REMOTE_DATASET_ROOT || '').trim(),
        requiresUpload: false,
        status: 'queued',
        activePhase: 'queued',
        latestScore: null,
        latestVerdict: '',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: '',
        remotePid: null,
        logPath: '',
        runDirectory: '',
        retryOfRunId,
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
    launch.summary = launch.logPath ? `Remote log: ${launch.logPath}` : '';
    launch.updatedAt = new Date().toISOString();

    await deps.saveLaunch(launch);
    return normalizeLaunch(launch);
  }

  return {
    async getWorkspaceContext({ username = 'czk' } = {}) {
      const servers = await deps.listServers();
      const runner = pickRunnerServer(servers);
      const downstreamServer = pickDownstreamServer(servers, runner.id);
      const projectId = 'default-project';

      return {
        projects: [
          {
            id: projectId,
            name: 'Default Project',
          },
        ],
        quickActions,
        runner,
        downstreamServer,
        remoteWorkspacePath: buildDefaultWorkspacePath(projectId, username),
        datasetRoot: process.env.ARIS_REMOTE_DATASET_ROOT || '',
        continueWhenOffline: true,
      };
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
      return normalizeLaunch(launch);
    },

    async retryRun(runId, { username = 'czk' } = {}) {
      const existing = await deps.getLaunchById(runId);
      if (!existing) {
        throw new Error('Run not found');
      }

      const { launch, runner, downstreamServer } = await buildLaunchFromPayload({
        projectId: existing.projectId,
        workflowType: existing.workflowType,
        prompt: existing.prompt,
        title: existing.title,
        remoteWorkspacePath: existing.remoteWorkspacePath,
        datasetRoot: existing.datasetRoot,
        downstreamServerId: existing.downstreamServerId,
      }, {
        username,
        retryOfRunId: existing.id,
      });

      return dispatchAndPersistLaunch(launch, runner, downstreamServer);
    },
  };
}

module.exports = {
  ARIS_WORKFLOW_TYPES,
  createArisService,
};
