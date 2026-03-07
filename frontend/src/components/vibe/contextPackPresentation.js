function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildContextPackSummary(view = {}) {
  const rows = [];
  const mode = cleanString(view?.mode);
  if (mode) rows.push({ label: 'Mode', value: mode });

  if (mode === 'routed') {
    const goalTitle = cleanString(view?.goalTitle);
    if (goalTitle) rows.push({ label: 'Goal', value: goalTitle });
    const selectedItemCount = cleanNumber(view?.selectedItemCount);
    if (selectedItemCount > 0) rows.push({ label: 'Selected', value: `${selectedItemCount} items` });
    const topBuckets = Array.isArray(view?.topBuckets)
      ? view.topBuckets.map((item) => cleanString(item)).filter(Boolean)
      : [];
    if (topBuckets.length > 0) rows.push({ label: 'Buckets', value: topBuckets.join(', ') });
    const budgets = [
      ['runner', cleanNumber(view?.roleBudgetTokens?.runner)],
      ['coder', cleanNumber(view?.roleBudgetTokens?.coder)],
      ['analyst', cleanNumber(view?.roleBudgetTokens?.analyst)],
      ['writer', cleanNumber(view?.roleBudgetTokens?.writer)],
    ].filter(([, value]) => value > 0);
    if (budgets.length > 0) {
      rows.push({
        label: 'Budgets',
        value: budgets.map(([label, value]) => `${label} ${value}`).join(' · '),
      });
    }
    return rows;
  }

  const knowledgeBits = [];
  const groupCount = cleanNumber(view?.groupCount);
  const documentCount = cleanNumber(view?.documentCount);
  const assetCount = cleanNumber(view?.assetCount);
  if (groupCount > 0) knowledgeBits.push(`${groupCount} groups`);
  if (documentCount > 0) knowledgeBits.push(`${documentCount} docs`);
  if (assetCount > 0) knowledgeBits.push(`${assetCount} assets`);
  if (knowledgeBits.length > 0) {
    rows.push({ label: 'Knowledge', value: knowledgeBits.join(' · ') });
  }
  const resourcePathCount = cleanNumber(view?.resourcePathCount);
  if (resourcePathCount > 0) rows.push({ label: 'Hints', value: `${resourcePathCount} paths` });
  return rows;
}

export {
  buildContextPackSummary,
};
