import * as vscode from 'vscode';

import type { ArisRunDetail } from '../aris/types';
import type { DetailSelection } from './detailController';
import { buildDetailView } from './detailController';

type RunDetailPanelActions = {
  onAction(actionType: string): Promise<void>;
};

export class RunDetailPanel {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: RunDetailPanelActions
  ) {}

  showSelection(selection: DetailSelection): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'autoResearcher.detail',
        'Auto Researcher Detail',
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
        if (message?.type) {
          await this.actions.onAction(String(message.type));
        }
      });
    }

    const view = buildDetailView(selection);
    this.panel.title = view.title;
    const html = view.html.replace('</body>', `<script>
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

  show(run: ArisRunDetail): void {
    this.showSelection({ kind: 'aris-run', item: run });
  }
}
