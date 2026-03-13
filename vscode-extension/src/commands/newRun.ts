import type { ArisRunDetail, CreateArisRunInput } from '../aris/types';
import type { ArisStore } from '../state/store';

type NewRunUi = {
  pickProject(): Promise<string | undefined>;
  pickWorkflow(): Promise<string | undefined>;
  promptForText(): Promise<string | undefined>;
};

type NewRunDeps = {
  client: {
    createRun(input: CreateArisRunInput): Promise<ArisRunDetail>;
  };
  store: Pick<ArisStore, 'selectedProjectId' | 'context' | 'refresh' | 'selectRun'>;
  ui: NewRunUi;
};

export async function runNewRunCommand(deps: NewRunDeps): Promise<void> {
  const projectId = await deps.ui.pickProject();
  const workflowType = await deps.ui.pickWorkflow();
  const prompt = await deps.ui.promptForText();

  if (!projectId || !workflowType || !prompt?.trim()) {
    return;
  }

  const run = await deps.client.createRun({
    projectId,
    workflowType,
    prompt: prompt.trim(),
  });
  await deps.store.refresh();
  if (run.id) {
    await deps.store.selectRun(run.id);
  }
}
