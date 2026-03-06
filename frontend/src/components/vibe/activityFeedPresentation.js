export function buildActivityFeed({
  runCards = [],
  observedSessionCards = [],
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
  };
}
