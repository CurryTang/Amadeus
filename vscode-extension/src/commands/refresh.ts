import type { ArisStore } from '../state/store';

type RefreshDeps = {
  store: Pick<ArisStore, 'refresh'>;
};

export async function runRefreshCommand(deps: RefreshDeps): Promise<void> {
  await deps.store.refresh();
}
