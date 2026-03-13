import type { ArisRunDetail } from '../aris/types';
import type { ArisStore } from '../state/store';

type RetryRunDeps = {
  client: {
    retryRun(runId: string): Promise<ArisRunDetail>;
  };
  store: Pick<ArisStore, 'selectedRunId' | 'refresh' | 'selectRun'>;
};

export async function runRetryRunCommand(deps: RetryRunDeps): Promise<void> {
  if (!deps.store.selectedRunId) {
    return;
  }

  const retried = await deps.client.retryRun(deps.store.selectedRunId);
  await deps.store.refresh();
  if (retried.id) {
    await deps.store.selectRun(retried.id);
  }
}
