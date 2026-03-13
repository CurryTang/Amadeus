import type { ArisStore } from '../state/store';

type CopyRunIdDeps = {
  store: Pick<ArisStore, 'selectedRunId'>;
  clipboard: {
    writeText(value: string): Promise<void> | Thenable<void>;
  };
};

export async function runCopyRunIdCommand(deps: CopyRunIdDeps): Promise<void> {
  if (!deps.store.selectedRunId) {
    return;
  }
  await deps.clipboard.writeText(deps.store.selectedRunId);
}
