import * as vscode from 'vscode';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArisClient } from './aris/client';
import { getAuthToken, storeAuthToken } from './auth';
import { runCopyRunIdCommand } from './commands/copyRunId';
import { runMarkPaperReadCommand } from './commands/markPaperRead';
import { runMarkPaperUnreadCommand } from './commands/markPaperUnread';
import { runNewRunCommand } from './commands/newRun';
import { runOpenLibraryPdfCommand } from './commands/openLibraryPdf';
import { runQueueReaderCommand } from './commands/queueReader';
import { runRefreshCommand } from './commands/refresh';
import { runRetryRunCommand } from './commands/retryRun';
import { runSaveTrackedPaperCommand } from './commands/saveTrackedPaper';
import { getArisConfig } from './config';
import { registerCommandDefinitions } from './core/commandRegistry';
import { LibraryClient } from './library/client';
import { LibraryStore } from './library/store';
import { PollingController } from './polling';
import { ArisStore } from './state/store';
import { TrackerClient } from './tracker/client';
import { TrackerStore } from './tracker/store';
import { LibraryProvider } from './views/libraryProvider';
import { ProjectsProvider } from './views/projectsProvider';
import { RunsProvider } from './views/runsProvider';
import { TrackedPapersProvider } from './views/trackedPapersProvider';
import type { TreeViewItem } from './views/types';
import { RunDetailPanel } from './webview/runDetailPanel';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Auto Researcher');
  context.subscriptions.push(output);

  const config = getArisConfig(vscode);
  let authPromptPromise: Promise<string | undefined> | null = null;
  let authPromptDismissedAt = 0;
  const requestAuthToken = async (): Promise<string | undefined> => {
    const token = await getAuthToken(context);
    if (token) return token;
    if (Date.now() - authPromptDismissedAt < 5 * 60 * 1000) {
      return undefined;
    }

    if (!authPromptPromise) {
      authPromptPromise = (async () => {
        const enteredToken = await vscode.window.showInputBox({
          title: 'Auto Researcher API Token',
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
  };
  const client = new ArisClient({
    baseUrl: config.apiBaseUrl,
    getAuthToken: requestAuthToken,
  });
  const trackerClient = new TrackerClient({
    baseUrl: config.apiBaseUrl,
    getAuthToken: requestAuthToken,
  });
  const libraryClient = new LibraryClient({
    baseUrl: config.apiBaseUrl,
    getAuthToken: requestAuthToken,
  });
  const arisStore = new ArisStore({ client });
  const trackerStore = new TrackerStore({ client: trackerClient });
  const libraryStore = new LibraryStore({ client: libraryClient });
  const trackedPapersProvider = new TrackedPapersProvider(trackerStore);
  const libraryProvider = new LibraryProvider(libraryStore);
  const projectsProvider = new ProjectsProvider(arisStore);
  const runsProvider = new RunsProvider(arisStore);
  const trackedPapersEmitter = new vscode.EventEmitter<void>();
  const libraryEmitter = new vscode.EventEmitter<void>();
  const projectsEmitter = new vscode.EventEmitter<void>();
  const runsEmitter = new vscode.EventEmitter<void>();
  const detailPanel = new RunDetailPanel(context.extensionUri, {
    onAction: async (actionType) => {
      if (actionType === 'retry') {
        await runRetryRunCommand({ client, store: arisStore });
        if (arisStore.selectedRunDetail) {
          detailPanel.showSelection({ kind: 'aris-run', item: arisStore.selectedRunDetail });
        }
        return;
      }
      if (actionType === 'copy-run-id') {
        await runCopyRunIdCommand({
          store: arisStore,
          clipboard: vscode.env.clipboard,
        });
        if (arisStore.selectedRunId) {
          void vscode.window.setStatusBarMessage(`Copied ARIS run id ${arisStore.selectedRunId}`, 2000);
        }
        return;
      }
      if (actionType === 'save-tracked-paper') {
        await runSaveTrackedPaperCommand({ client: trackerClient, store: trackerStore });
        await libraryStore.refresh();
        if (trackerStore.selectedPaper) {
          detailPanel.showSelection({ kind: 'tracked-paper', item: trackerStore.selectedPaper });
        }
        return;
      }
      if (actionType === 'mark-paper-read') {
        await runMarkPaperReadCommand({ client: libraryClient, store: libraryStore });
        if (libraryStore.selectedPaperDetail) {
          detailPanel.showSelection({ kind: 'library-paper', item: libraryStore.selectedPaperDetail });
        }
        return;
      }
      if (actionType === 'mark-paper-unread') {
        await runMarkPaperUnreadCommand({ client: libraryClient, store: libraryStore });
        if (libraryStore.selectedPaperDetail) {
          detailPanel.showSelection({ kind: 'library-paper', item: libraryStore.selectedPaperDetail });
        }
        return;
      }
      if (actionType === 'open-library-pdf') {
        await openLibraryPdf();
        return;
      }
      if (actionType === 'queue-reader') {
        await runQueueReaderCommand({ client: libraryClient, store: libraryStore });
        if (libraryStore.selectedPaperDetail) {
          detailPanel.showSelection({ kind: 'library-paper', item: libraryStore.selectedPaperDetail });
        }
      }
    },
  });

  const treeAdapter = {
    getTreeItem(item: TreeViewItem) {
      const treeItem = new vscode.TreeItem(item.label);
      treeItem.id = item.id;
      treeItem.description = item.description;
      return treeItem;
    },
  };

  const trackedPapersView = vscode.window.createTreeView('autoResearcher.trackedPapers', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: trackedPapersEmitter.event,
      getChildren: async () => trackedPapersProvider.getChildren(),
    },
  });
  const libraryView = vscode.window.createTreeView('autoResearcher.library', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: libraryEmitter.event,
      getChildren: async () => libraryProvider.getChildren(),
    },
  });
  const projectsView = vscode.window.createTreeView('autoResearcher.arisProjects', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: projectsEmitter.event,
      getChildren: async () => projectsProvider.getChildren(),
    },
  });
  const runsView = vscode.window.createTreeView('autoResearcher.arisRuns', {
    treeDataProvider: {
      ...treeAdapter,
      onDidChangeTreeData: runsEmitter.event,
      getChildren: async () => runsProvider.getChildren(),
    },
  });
  context.subscriptions.push(trackedPapersView, libraryView, projectsView, runsView);

  context.subscriptions.push(trackerStore.subscribe(() => {
    trackedPapersEmitter.fire();
  }));
  context.subscriptions.push(libraryStore.subscribe(() => {
    libraryEmitter.fire();
  }));
  context.subscriptions.push(arisStore.subscribe(() => {
    projectsEmitter.fire();
    runsEmitter.fire();
    if (arisStore.selectedRunDetail) {
      detailPanel.showSelection({ kind: 'aris-run', item: arisStore.selectedRunDetail });
    }
  }));

  trackedPapersView.onDidChangeSelection((event) => {
    const paper = event.selection[0] as { id?: string } | undefined;
    if (paper?.id) {
      trackerStore.selectPaper(paper.id);
      if (trackerStore.selectedPaper) {
        detailPanel.showSelection({ kind: 'tracked-paper', item: trackerStore.selectedPaper });
      }
    }
  });

  libraryView.onDidChangeSelection((event) => {
    const paper = event.selection[0] as { id?: string } | undefined;
    if (paper?.id) {
      void libraryStore.selectPaper(Number(paper.id)).then(() => {
        if (libraryStore.selectedPaperDetail) {
          detailPanel.showSelection({ kind: 'library-paper', item: libraryStore.selectedPaperDetail });
        }
      });
    }
  });

  projectsView.onDidChangeSelection((event) => {
    const project = event.selection[0] as { id?: string } | undefined;
    if (project?.id) {
      arisStore.selectProject(project.id);
    }
  });

  runsView.onDidChangeSelection((event) => {
    const run = event.selection[0] as { id?: string } | undefined;
    if (run?.id) {
      void arisStore.selectRun(run.id);
    }
  });

  const refreshTrackedPapers = async () => {
    try {
      await trackerStore.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[tracked-papers] ${message}`);
      void vscode.window.showErrorMessage(`Tracked papers refresh failed: ${message}`);
    }
  };

  const refreshLibrary = async () => {
    try {
      await libraryStore.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[library] ${message}`);
      void vscode.window.showErrorMessage(`Library refresh failed: ${message}`);
    }
  };

  const refreshAris = async () => {
    try {
      await runRefreshCommand({ store: arisStore });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[aris] ${message}`);
      void vscode.window.showErrorMessage(`ARIS refresh failed: ${message}`);
    }
  };

  const downloadPdfToTempFile = async (url: string, title: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`PDF download failed with status ${response.status}`);
    }

    const pdfDir = join(tmpdir(), 'auto-researcher-vscode');
    await mkdir(pdfDir, { recursive: true });
    const safeTitle = title
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'paper';
    const filePath = join(pdfDir, `${safeTitle}-${Date.now()}.pdf`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);
    return filePath;
  };

  const openPdfInVscode = async (filePath: string): Promise<void> => {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
  };

  const openLibraryPdf = async () => {
    try {
      await runOpenLibraryPdfCommand({
        client: libraryClient,
        store: libraryStore,
        downloadPdf: downloadPdfToTempFile,
        openPdf: openPdfInVscode,
        openExternalUrl: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[library-pdf] ${message}`);
      void vscode.window.showErrorMessage(`Open PDF failed: ${message}`);
    }
  };

  registerCommandDefinitions(vscode, context, {
    refreshTrackedPapers,
    saveTrackedPaper: async () => {
      await runSaveTrackedPaperCommand({ client: trackerClient, store: trackerStore });
      await libraryStore.refresh();
    },
    refreshLibrary,
    markPaperRead: async () => {
      await runMarkPaperReadCommand({ client: libraryClient, store: libraryStore });
    },
    markPaperUnread: async () => {
      await runMarkPaperUnreadCommand({ client: libraryClient, store: libraryStore });
    },
    openLibraryPdf,
    queueReader: async () => {
      await runQueueReaderCommand({ client: libraryClient, store: libraryStore });
    },
    newRun: async () => {
      await runNewRunCommand({
        client,
        store: arisStore,
        ui: {
          pickProject: async () => {
            const items = (arisStore.context?.projects || []).map((project) => ({
              label: project.name,
              value: project.id,
            }));
            const picked = await vscode.window.showQuickPick(items, {
              title: 'ARIS Project',
              placeHolder: 'Select a project',
            });
            return picked?.value || arisStore.selectedProjectId || config.defaultProjectId;
          },
          pickWorkflow: async () => {
            const items = (arisStore.context?.quickActions || []).map((action) => ({
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
    refresh: refreshAris,
    retryRun: async () => {
      await runRetryRunCommand({ client, store: arisStore });
    },
    copyRunId: async () => {
      await runCopyRunIdCommand({
        store: arisStore,
        clipboard: vscode.env.clipboard,
      });
    },
  });

  const polling = new PollingController({
    intervalMs: config.refreshIntervalSeconds * 1000,
    isVisible: () => projectsView.visible || runsView.visible,
    refresh: refreshAris,
    log: (message) => output.appendLine(`[poll] ${message}`),
  });
  polling.start();
  context.subscriptions.push({ dispose: () => polling.stop() });

  void refreshTrackedPapers();
  void refreshLibrary();
  void refreshAris();
}

export function deactivate(): void {}
