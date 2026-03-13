import * as vscode from 'vscode';

import { ArisClient } from './aris/client';
import { getAuthToken, storeAuthToken } from './auth';
import { runCopyRunIdCommand } from './commands/copyRunId';
import { runNewRunCommand } from './commands/newRun';
import { runRefreshCommand } from './commands/refresh';
import { runRetryRunCommand } from './commands/retryRun';
import { getArisConfig } from './config';
import { registerCommandDefinitions } from './core/commandRegistry';
import { PollingController } from './polling';
import { ArisStore } from './state/store';
import { ProjectsProvider } from './views/projectsProvider';
import { RunsProvider } from './views/runsProvider';
import { RunDetailPanel } from './webview/runDetailPanel';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ARIS');
  context.subscriptions.push(output);

  const config = getArisConfig(vscode);
  let authPromptPromise: Promise<string | undefined> | null = null;
  let authPromptDismissedAt = 0;
  const client = new ArisClient({
    baseUrl: config.apiBaseUrl,
    getAuthToken: async () => {
      const token = await getAuthToken(context);
      if (token) return token;
      if (Date.now() - authPromptDismissedAt < 5 * 60 * 1000) {
        return undefined;
      }

      if (!authPromptPromise) {
        authPromptPromise = (async () => {
          const enteredToken = await vscode.window.showInputBox({
            title: 'ARIS API Token',
            prompt: 'Enter the API bearer token for the Auto Researcher backend.',
            password: true,
            ignoreFocusOut: true,
          });
          if (enteredToken) {
            await storeAuthToken(context, enteredToken);
            return enteredToken;
          }
          authPromptDismissedAt = Date.now();
          return undefined;
        })().finally(() => {
          authPromptPromise = null;
        });
      }

      return authPromptPromise;
    },
  });
  const store = new ArisStore({ client });
  const projectsProvider = new ProjectsProvider(store);
  const runsProvider = new RunsProvider(store);
  const projectsEmitter = new vscode.EventEmitter<void>();
  const runsEmitter = new vscode.EventEmitter<void>();
  const detailPanel = new RunDetailPanel(context.extensionUri, {
    onRetry: async () => {
      await runRetryRunCommand({ client, store });
      if (store.selectedRunDetail) {
        detailPanel.show(store.selectedRunDetail);
      }
    },
    onCopyRunId: async () => {
      await runCopyRunIdCommand({
        store,
        clipboard: vscode.env.clipboard,
      });
      if (store.selectedRunId) {
        void vscode.window.setStatusBarMessage(`Copied ARIS run id ${store.selectedRunId}`, 2000);
      }
    },
  });

  const treeAdapter = {
    getTreeItem(item: { label: string; description?: string }) {
      return item as unknown as vscode.TreeItem;
    },
  };

  const projectsView = vscode.window.createTreeView('aris.projects', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: projectsEmitter.event,
      getChildren: async () => projectsProvider.getChildren(),
    },
  });
  const runsView = vscode.window.createTreeView('aris.runs', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: runsEmitter.event,
      getChildren: async () => runsProvider.getChildren(),
    },
  });
  context.subscriptions.push(projectsView, runsView);

  context.subscriptions.push(store.subscribe(() => {
    projectsEmitter.fire();
    runsEmitter.fire();
    if (store.selectedRunDetail) {
      detailPanel.show(store.selectedRunDetail);
    }
  }));

  projectsView.onDidChangeSelection((event) => {
    const project = event.selection[0] as { id?: string } | undefined;
    if (project?.id) {
      store.selectProject(project.id);
    }
  });

  runsView.onDidChangeSelection((event) => {
    const run = event.selection[0] as { id?: string } | undefined;
    if (run?.id) {
      void store.selectRun(run.id);
    }
  });

  const refreshStore = async () => {
    try {
      await runRefreshCommand({ store });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[refresh] ${message}`);
      void vscode.window.showErrorMessage(`ARIS refresh failed: ${message}`);
    }
  };

  registerCommandDefinitions(vscode, context, {
    newRun: async () => {
      await runNewRunCommand({
        client,
        store,
        ui: {
          pickProject: async () => {
            const items = (store.context?.projects || []).map((project) => ({
              label: project.name,
              value: project.id,
            }));
            const picked = await vscode.window.showQuickPick(items, {
              title: 'ARIS Project',
              placeHolder: 'Select a project',
            });
            return picked?.value || store.selectedProjectId || config.defaultProjectId;
          },
          pickWorkflow: async () => {
            const items = (store.context?.quickActions || []).map((action) => ({
              label: action.label,
              value: action.workflowType,
            }));
            const picked = await vscode.window.showQuickPick(items, {
              title: 'ARIS Workflow',
              placeHolder: 'Select a workflow',
            });
            return picked?.value || config.defaultWorkflowType;
          },
          promptForText: async () => vscode.window.showInputBox({
            title: 'ARIS Prompt',
            prompt: 'Describe what ARIS should do.',
            ignoreFocusOut: true,
          }),
        },
      });
    },
    refresh: refreshStore,
    retryRun: async () => {
      await runRetryRunCommand({ client, store });
    },
    copyRunId: async () => {
      await runCopyRunIdCommand({
        store,
        clipboard: vscode.env.clipboard,
      });
    },
  });

  const polling = new PollingController({
    intervalMs: config.refreshIntervalSeconds * 1000,
    isVisible: () => projectsView.visible || runsView.visible,
    refresh: refreshStore,
    log: (message) => output.appendLine(`[poll] ${message}`),
  });
  polling.start();
  context.subscriptions.push({ dispose: () => polling.stop() });

  void refreshStore();
}

export function deactivate(): void {}
