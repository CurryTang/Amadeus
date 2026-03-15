import type { ArisProjectDetail, ArisProjectRecentRun } from '../../aris/types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderRecentRun(run: ArisProjectRecentRun): string {
  return `
    <article class="run-card">
      <div class="run-card-top">
        <div>
          <h4>${escapeHtml(run.workflowLabel || run.title)}</h4>
          <p>${escapeHtml(run.statusLabel)}</p>
        </div>
        <span class="meta-chip">${escapeHtml(run.id)}</span>
      </div>
      <div class="run-meta">
        <span>${escapeHtml(run.runnerLabel)}</span>
        <span>${escapeHtml(run.destinationLabel)}</span>
        ${run.startedAt ? `<span>${escapeHtml(new Date(run.startedAt).toLocaleString())}</span>` : ''}
      </div>
      ${run.summary ? `<p class="run-summary">${escapeHtml(run.summary)}</p>` : ''}
    </article>
  `;
}

export function renderProjectDetailHtml(project: ArisProjectDetail): string {
  const quickActions = project.quickActionLabels.length > 0
    ? project.quickActionLabels.map((label) => `<span class="chip">${escapeHtml(label)}</span>`).join('')
    : '<span class="empty-copy">No quick actions available.</span>';
  const recentRuns = project.recentRuns.length > 0
    ? project.recentRuns.map(renderRecentRun).join('')
    : '<div class="empty-card">No runs yet for this project.</div>';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ARIS Project</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, #caa86a 8%) 0%, var(--vscode-editor-background) 100%);
        margin: 0;
        padding: 20px;
      }
      .hero, .section, .empty-card, .run-card {
        border: 1px solid var(--vscode-panel-border);
        background: color-mix(in srgb, var(--vscode-editor-background) 84%, #caa86a 16%);
        border-radius: 14px;
      }
      .hero, .section {
        padding: 16px;
        margin-bottom: 16px;
      }
      .hero-top, .run-card-top, .context-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      h1, h2, h4, p {
        margin: 0;
      }
      h1 {
        font-size: 22px;
        margin-top: 8px;
      }
      h2 {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.8;
        margin-bottom: 12px;
      }
      h4 {
        font-size: 14px;
      }
      .status-pill, .chip, .meta-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
      }
      .status-pill {
        background: #9f7a2f;
        color: #1f1403;
        font-weight: 700;
      }
      .chip, .meta-chip {
        background: color-mix(in srgb, var(--vscode-button-background) 28%, transparent);
        border: 1px solid color-mix(in srgb, var(--vscode-button-background) 55%, transparent);
      }
      .hero-copy {
        margin-top: 10px;
        line-height: 1.5;
        opacity: 0.9;
      }
      .context-list {
        display: grid;
        gap: 12px;
      }
      .context-row {
        border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
        padding-top: 12px;
      }
      .context-row:first-child {
        border-top: none;
        padding-top: 0;
      }
      .context-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.75;
      }
      .context-value {
        font-weight: 600;
      }
      .context-subtext {
        margin-top: 4px;
        opacity: 0.8;
        line-height: 1.4;
      }
      .chip-row, .runs-list, .run-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .run-card {
        padding: 14px;
        margin-bottom: 12px;
      }
      .run-card p {
        margin-top: 4px;
        opacity: 0.8;
      }
      .run-summary {
        margin-top: 10px;
        line-height: 1.5;
      }
      .empty-copy {
        opacity: 0.7;
      }
      .empty-card {
        padding: 16px;
      }
    </style>
  </head>
  <body>
    <section class="hero">
      <div class="hero-top">
        <div>
          <span class="status-pill">${escapeHtml(project.runnerStatus)}</span>
          <h1>${escapeHtml(project.projectLabel)}</h1>
        </div>
        <span class="meta-chip">${escapeHtml(project.runnerLabel)}</span>
      </div>
      <p class="hero-copy">Run Context mirrors the frontend pattern: project selection should immediately show the active runner, remote workspace defaults, and the recent run history for this project.</p>
    </section>

    <section class="section">
      <h2>Run Context</h2>
      <div class="context-list">
        <div class="context-row">
          <div>
            <div class="context-label">Runner</div>
            <div class="context-value">${escapeHtml(project.runnerLabel)}</div>
            <div class="context-subtext">${escapeHtml(project.runnerSummary)}</div>
          </div>
        </div>
        <div class="context-row">
          <div>
            <div class="context-label">Workspace</div>
            <div class="context-value">${escapeHtml(project.workspaceLabel)}</div>
          </div>
        </div>
        <div class="context-row">
          <div>
            <div class="context-label">Dataset</div>
            <div class="context-value">${escapeHtml(project.datasetLabel)}</div>
          </div>
        </div>
        <div class="context-row">
          <div>
            <div class="context-label">Experiment Target</div>
            <div class="context-value">${escapeHtml(project.destinationLabel)}</div>
            <div class="context-subtext">${escapeHtml(project.targetSummary)}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Quick Actions</h2>
      <div class="chip-row">${quickActions}</div>
    </section>

    <section class="section">
      <h2>Recent Runs</h2>
      <div class="runs-list">${recentRuns}</div>
    </section>
  </body>
</html>`;
}
