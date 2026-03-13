import type { ArisRunDetail } from '../../aris/types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderRunDetailHtml(run: ArisRunDetail): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ARIS Run</title>
    <style>
      body { font-family: sans-serif; padding: 16px; color: #d4d4d4; background: #1e1e1e; }
      .meta { margin-bottom: 16px; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #0e639c; }
      pre { white-space: pre-wrap; background: #252526; padding: 12px; border-radius: 8px; }
      .actions { display: flex; gap: 8px; margin-top: 16px; }
      button { background: #3a3d41; color: inherit; border: 1px solid #4f545a; padding: 8px 10px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="meta">
      <div class="pill">${escapeHtml(run.status)}</div>
      <h1>${escapeHtml(run.title || run.prompt || run.workflowType)}</h1>
      <p>${escapeHtml(run.workflowType)} on ${escapeHtml(run.runnerHost || 'unknown runner')}</p>
      <p>${escapeHtml(run.summary || 'No summary available')}</p>
      <p>Project: ${escapeHtml(run.projectId)}</p>
      <p>Downstream: ${escapeHtml(run.downstreamServerName || 'n/a')}</p>
      <p>Run dir: ${escapeHtml(run.runDirectory || 'n/a')}</p>
    </div>
    <h2>Prompt</h2>
    <pre>${escapeHtml(run.prompt)}</pre>
    <div class="actions">
      <button data-action="retry">Retry Run</button>
      <button data-action="copy-run-id">Copy Run ID</button>
    </div>
  </body>
</html>`;
}
