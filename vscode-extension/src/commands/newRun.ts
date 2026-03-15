import type { ArisRunDetail, ArisTarget, CreateArisRunInput } from '../aris/types';
import type { ArisStore } from '../state/store';

type NewRunUi = {
  pickProject(): Promise<string | undefined>;
  pickTarget(projectId: string): Promise<string | undefined>;
  pickWorkflow(): Promise<string | undefined>;
  promptForText(options?: { getRemoteFiles?: () => Promise<string[]> }): Promise<string | undefined>;
};

type NewRunDeps = {
  client: {
    createRun(input: CreateArisRunInput): Promise<ArisRunDetail>;
    listTargets(projectId: string): Promise<ArisTarget[]>;
    lsRemoteFiles(serverId: string | number, projectPath: string, query?: string): Promise<string[]>;
  };
  store: Pick<ArisStore, 'selectedProjectId' | 'context' | 'refresh' | 'selectRun'>;
  ui: NewRunUi;
};

export async function runNewRunCommand(deps: NewRunDeps): Promise<void> {
  const projectId = await deps.ui.pickProject();
  if (!projectId) return;

  const targetId = await deps.ui.pickTarget(projectId);
  const workflowType = await deps.ui.pickWorkflow();

  // Look up selected target for file reference support
  let selectedTarget: ArisTarget | undefined;
  if (targetId) {
    try {
      const targets = await deps.client.listTargets(projectId);
      selectedTarget = targets.find((t) => t.id === targetId);
    } catch {
      // Non-critical — proceed without file references
    }
  }

  let getRemoteFiles: (() => Promise<string[]>) | undefined;
  if (selectedTarget?.sshServerId && selectedTarget?.remoteProjectPath) {
    const serverId = selectedTarget.sshServerId;
    const projectPath = selectedTarget.remoteProjectPath;
    getRemoteFiles = () => deps.client.lsRemoteFiles(serverId, projectPath);
  }

  const prompt = await deps.ui.promptForText({ getRemoteFiles });

  if (!workflowType || !prompt?.trim()) {
    return;
  }

  const run = await deps.client.createRun({
    projectId,
    targetId,
    workflowType,
    prompt: prompt.trim(),
  });
  await deps.store.refresh();
  if (run.id) {
    await deps.store.selectRun(run.id);
  }
}
