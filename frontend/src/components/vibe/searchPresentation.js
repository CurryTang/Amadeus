function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSearchTrialRows(search = {}, options = {}) {
  const limit = Math.max(Number(options?.limit) || 8, 0);
  if (!limit) return [];
  const trials = Array.isArray(search?.trials) ? search.trials : [];
  return trials
    .filter((trial) => trial && typeof trial === 'object' && cleanString(trial.id))
    .slice()
    .sort((a, b) => cleanNumber(b?.reward) - cleanNumber(a?.reward))
    .slice(0, limit)
    .map((trial) => ({
      id: cleanString(trial.id),
      title: cleanString(trial.id),
      meta: `${cleanString(trial.status).toUpperCase() || 'UNKNOWN'} · reward ${cleanNumber(trial.reward).toFixed(3)}`,
      code: cleanString(trial.runId) || '-',
    }));
}

function buildSearchSummaryRows(search = {}) {
  const trials = Array.isArray(search?.trials)
    ? search.trials.filter((trial) => trial && typeof trial === 'object' && cleanString(trial.id))
    : [];
  if (trials.length === 0) return [];
  const passedCount = trials.filter((trial) => cleanString(trial.status).toUpperCase() === 'PASSED').length;
  const bestReward = trials.reduce((best, trial) => Math.max(best, cleanNumber(trial.reward)), 0);
  return [
    { label: 'Trials', value: `${trials.length} total` },
    { label: 'Passed', value: `${passedCount} passed` },
    { label: 'Best', value: `${bestReward.toFixed(3)} reward` },
  ];
}

export {
  buildSearchSummaryRows,
  buildSearchTrialRows,
};
