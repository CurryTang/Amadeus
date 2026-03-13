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

const launchStore = [];
const DEFAULT_REMOTE_AGENT_BIN = process.env.ARIS_REMOTE_AGENT_BIN || 'claude';
const DEFAULT_REMOTE_AGENT_ARGS = ['--print', '--dangerously-skip-permissions'];

function isNonEmpty(value) {
  return String(value || '').trim().length > 0;
}

function buildDefaultWorkspacePath(projectId, username = 'default') {
  const root = process.env.ARIS_REMOTE_WORKSPACE_ROOT || `/home/${username}/auto-researcher/aris`;
  return path.posix.join(root, String(projectId || 'default-project'));
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

function buildRunDirectory(remoteWorkspacePath, runId) {
  return path.posix.join(String(remoteWorkspacePath || ''), '.auto-researcher', 'aris-runs', String(runId || 'pending-run'));
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

async function defaultDispatchLaunch({ launch, runner }) {
  if (!runner?.host || !runner?.user) {
    throw new Error('ARIS WSL runner is not configured in SSH servers');
  }

  const invocationPrompt = buildWorkflowInvocation(launch);
  const scriptBody = buildRemoteLaunchScript({ launch, invocationPrompt });
  const result = await sshTransport.script(runner, scriptBody, [], { timeoutMs: 30000 });
  return parseRemoteLaunchOutput(result.stdout);
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
          remote_pid,
          log_path,
          run_directory
        FROM aris_runs
        ORDER BY started_at DESC
        LIMIT 25
      `,
      args: [],
    });
    return (result.rows || []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      workflowType: row.workflow_type,
      prompt: row.prompt,
      runnerServerId: row.runner_server_id,
      runnerHost: row.runner_host,
      downstreamServerId: row.downstream_server_id,
      downstreamServerName: row.downstream_server_name,
      remoteWorkspacePath: row.remote_workspace_path,
      datasetRoot: row.dataset_root,
      requiresUpload: Boolean(row.requires_upload),
      status: row.status,
      activePhase: row.active_phase,
      latestScore: row.latest_score,
      latestVerdict: row.latest_verdict,
      summary: row.summary,
      startedAt: row.started_at,
      remotePid: row.remote_pid,
      logPath: row.log_path,
      runDirectory: row.run_directory,
    }));
  } catch (_) {
    return [...launchStore];
  }
}

async function defaultSaveLaunch(launch) {
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
          remote_pid,
          log_path,
          run_directory,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        launch.id,
        launch.projectId,
        launch.workflowType,
        launch.prompt,
        launch.runnerServerId,
        launch.runnerHost,
        launch.downstreamServerId,
        launch.downstreamServerName,
        launch.remoteWorkspacePath,
        launch.datasetRoot,
        launch.requiresUpload ? 1 : 0,
        launch.status,
        launch.activePhase,
        launch.latestScore,
        launch.latestVerdict,
        launch.summary,
        launch.startedAt,
        launch.remotePid,
        launch.logPath,
        launch.runDirectory,
      ],
    });
  } catch (_) {
    launchStore.unshift({ ...launch });
    if (launchStore.length > 25) launchStore.length = 25;
  }
}

function pickRunnerServer(servers = []) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return {
      id: null,
      name: process.env.ARIS_WSL_RUNNER_NAME || 'wsl-default',
      type: 'wsl',
      status: 'assumed-online',
    };
  }

  const explicitId = String(process.env.ARIS_WSL_RUNNER_ID || '').trim();
  if (explicitId) {
    const byId = servers.find((server) => String(server.id) === explicitId);
    if (byId) {
      return { id: byId.id, name: byId.name, type: 'wsl', status: 'configured' };
    }
  }

  const preferred = servers.find((server) => /wsl|local|executor/i.test(String(server.name || '')))
    || servers.find((server) => String(server.host || '') === '127.0.0.1')
    || servers[0];

  return {
    id: preferred.id,
    name: preferred.name,
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

function createArisService(overrides = {}) {
  const deps = {
    listServers: overrides.listServers || defaultListServers,
    listLaunches: overrides.listLaunches || defaultListLaunches,
    dispatchLaunch: overrides.dispatchLaunch || defaultDispatchLaunch,
    saveLaunch: overrides.saveLaunch || defaultSaveLaunch,
  };

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

      const launch = {
        id: `aris_run_${Date.now()}`,
        projectId,
        workflowType,
        prompt,
        runnerServerId: runner.id,
        runnerHost: runner.name,
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
        summary: '',
      };

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

      await deps.saveLaunch(launch);
      return launch;
    },

    async listRuns() {
      const launches = await deps.listLaunches();
      return launches.map((launch) => ({
        id: launch.id,
        workflowType: launch.workflowType,
        title: launch.title || '',
        status: launch.status,
        runnerHost: launch.runnerHost,
        activePhase: launch.activePhase,
        downstreamServerName: launch.downstreamServerName,
        latestScore: launch.latestScore,
        latestVerdict: launch.latestVerdict,
        summary: launch.summary,
        startedAt: launch.startedAt,
        logPath: launch.logPath || '',
      }));
    },
  };
}

module.exports = {
  ARIS_WORKFLOW_TYPES,
  createArisService,
};
