export const COMMAND_IDS = {
  newRun: 'aris.newRun',
  refresh: 'aris.refresh',
  retryRun: 'aris.retryRun',
  copyRunId: 'aris.copyRunId',
} as const;

export type CommandHandlers = {
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
    vscodeApi.commands.registerCommand(COMMAND_IDS.newRun, handlers.newRun),
    vscodeApi.commands.registerCommand(COMMAND_IDS.refresh, handlers.refresh),
    vscodeApi.commands.registerCommand(COMMAND_IDS.retryRun, handlers.retryRun),
    vscodeApi.commands.registerCommand(COMMAND_IDS.copyRunId, handlers.copyRunId)
  );
}
