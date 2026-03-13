type Disposable = {
  dispose(): void;
};

type PollingControllerDeps = {
  intervalMs: number;
  isVisible: () => boolean;
  refresh: () => Promise<void>;
  log: (message: string) => void;
  schedule?: (handler: () => void | Promise<void>, intervalMs: number) => Disposable;
};

export class PollingController {
  private readonly scheduleImpl: (handler: () => void | Promise<void>, intervalMs: number) => Disposable;

  private disposable: Disposable | null = null;

  constructor(private readonly deps: PollingControllerDeps) {
    this.scheduleImpl = deps.schedule || ((handler, intervalMs) => {
      const handle = setInterval(() => {
        void handler();
      }, intervalMs);
      return {
        dispose() {
          clearInterval(handle);
        },
      };
    });
  }

  start(): void {
    if (this.disposable) return;
    this.disposable = this.scheduleImpl(() => {
      void this.tick();
    }, this.deps.intervalMs);
  }

  stop(): void {
    this.disposable?.dispose();
    this.disposable = null;
  }

  async tick(): Promise<void> {
    if (!this.deps.isVisible()) {
      this.deps.log('Skipping ARIS refresh because the view is hidden.');
      return;
    }
    await this.deps.refresh();
  }
}
