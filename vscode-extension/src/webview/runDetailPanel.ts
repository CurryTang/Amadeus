import * as vscode from 'vscode';

import type { ArisRunDetail } from '../aris/types';
import { renderRunDetailHtml } from './templates/runDetailHtml';

type RunDetailPanelActions = {
  onRetry(): Promise<void>;
  onCopyRunId(): Promise<void>;
};

export class RunDetailPanel {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: RunDetailPanelActions
  ) {}

  show(run: ArisRunDetail): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'aris.runDetail',
        `ARIS Run ${run.id}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        }
      );
      this.panel.onDidDispose(() => {
        this.panel = null;
      });
      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'retry') {
          await this.actions.onRetry();
        }
        if (message?.type === 'copy-run-id') {
          await this.actions.onCopyRunId();
        }
      });
    }

    this.panel.title = `ARIS Run ${run.id}`;
    const html = renderRunDetailHtml(run).replace('</body>', `<script>
const vscode = acquireVsCodeApi();
for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: button.dataset.action });
  });
}
</script></body>`);
    this.panel.webview.html = html;
    this.panel.reveal(vscode.ViewColumn.One, true);
  }
}
