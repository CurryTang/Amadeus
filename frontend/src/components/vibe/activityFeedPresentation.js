export function buildActivityFeed({
  runCards = [],
  observedSessionCards = [],
  runReviewSummary = null,
} = {}) {
  const runs = (Array.isArray(runCards) ? runCards : []).map((card) => ({
    id: card?.id || '',
    kind: 'run',
    card,
  }));
  const sessions = (Array.isArray(observedSessionCards) ? observedSessionCards : []).map((card) => ({
    id: card?.id || '',
    kind: 'session',
    card,
  }));

  return {
    items: [...runs, ...sessions],
    runCount: runs.length,
    sessionCount: sessions.length,
    runReviewSummary: runReviewSummary && typeof runReviewSummary === 'object' ? runReviewSummary : null,
  };
}

export function buildRunCardMetaLabels(card = {}) {
  const values = [
    card?.executionLabel,
    card?.executionRuntimeLabel,
    card?.executionIsolationLabel,
    card?.transportLabel,
    card?.snapshotLabel,
    card?.contractLabel,
    card?.readinessLabel,
    card?.warningsLabel,
    card?.sinkProvidersLabel,
    card?.summaryLabel,
    card?.finalOutputLabel,
  ];
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}
