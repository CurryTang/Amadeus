function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPlanActionMessage(action = '', payload = {}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedAction === 'patch') {
    const appliedCount = Array.isArray(payload?.applied) ? payload.applied.length : 0;
    const summary = payload?.impact?.summary && typeof payload.impact.summary === 'object'
      ? payload.impact.summary
      : {};
    const bits = [];
    const added = cleanNumber(summary.added);
    const removed = cleanNumber(summary.removed);
    const changed = cleanNumber(summary.changed);
    if (added > 0) bits.push(`${added} added`);
    if (removed > 0) bits.push(`${removed} removed`);
    if (changed > 0) bits.push(`${changed} changed`);
    return `Applied ${appliedCount} plan patch${appliedCount === 1 ? '' : 'es'}.${bits.length ? ` Impact: ${bits.join(', ')}.` : ''}`;
  }
  if (normalizedAction === 'validate') {
    return payload?.valid ? 'Plan validation passed.' : 'Plan validation finished.';
  }
  if (normalizedAction === 'save') {
    return 'Tree plan saved.';
  }
  return '';
}

export {
  buildPlanActionMessage,
};
