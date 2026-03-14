export const COMMAND_IDS = {
  refreshTrackedPapers: 'tracker.refresh',
  saveTrackedPaper: 'tracker.savePaper',
  refreshLibrary: 'library.refresh',
  markPaperRead: 'library.markRead',
  markPaperUnread: 'library.markUnread',
  queueReader: 'library.queueReader',
  newRun: 'aris.newRun',
  refresh: 'aris.refresh',
  retryRun: 'aris.retryRun',
  copyRunId: 'aris.copyRunId',
} as const;

export type CommandHandlers = {
  refreshTrackedPapers: () => unknown | Promise<unknown>;
  saveTrackedPaper: () => unknown | Promise<unknown>;
  refreshLibrary: () => unknown | Promise<unknown>;
  markPaperRead: () => unknown | Promise<unknown>;
  markPaperUnread: () => unknown | Promise<unknown>;
  queueReader: () => unknown | Promise<unknown>;
  newRun: () => unknown | Promise<unknown>;
  refresh: () => unknown | Promise<unknown>;
  retryRun: () => unknown | Promise<unknown>;
  copyRunId: () => unknown | Promise<unknown>;
};

type CommandRegistrar = {
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  };
};

type ExtensionContextLike = {
  subscriptions: { dispose(): void }[];
};

export function registerCommandDefinitions(
  vscodeApi: CommandRegistrar,
  context: ExtensionContextLike,
  handlers: CommandHandlers
): void {
  context.subscriptions.push(
    vscodeApi.commands.registerCommand(COMMAND_IDS.refreshTrackedPapers, handlers.refreshTrackedPapers),
    vscodeApi.commands.registerCommand(COMMAND_IDS.saveTrackedPaper, handlers.saveTrackedPaper),
    vscodeApi.commands.registerCommand(COMMAND_IDS.refreshLibrary, handlers.refreshLibrary),
    vscodeApi.commands.registerCommand(COMMAND_IDS.markPaperRead, handlers.markPaperRead),
    vscodeApi.commands.registerCommand(COMMAND_IDS.markPaperUnread, handlers.markPaperUnread),
    vscodeApi.commands.registerCommand(COMMAND_IDS.queueReader, handlers.queueReader),
    vscodeApi.commands.registerCommand(COMMAND_IDS.newRun, handlers.newRun),
    vscodeApi.commands.registerCommand(COMMAND_IDS.refresh, handlers.refresh),
    vscodeApi.commands.registerCommand(COMMAND_IDS.retryRun, handlers.retryRun),
    vscodeApi.commands.registerCommand(COMMAND_IDS.copyRunId, handlers.copyRunId)
  );
}
