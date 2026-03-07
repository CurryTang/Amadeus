function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPlanImpactRows(impact = {}) {
  if (!impact || typeof impact !== 'object') return [];
  const rows = [];
  const summary = impact.summary && typeof impact.summary === 'object' ? impact.summary : {};
  const changeBits = [];
  const added = Number(summary.added || 0);
  const removed = Number(summary.removed || 0);
  const changed = Number(summary.changed || 0);
  if (added > 0) changeBits.push(`${added} added`);
  if (removed > 0) changeBits.push(`${removed} removed`);
  if (changed > 0) changeBits.push(`${changed} changed`);
  if (changeBits.length > 0) {
    rows.push({ label: 'Changes', value: changeBits.join(' · ') });
  }

  const blocked = Array.isArray(impact.blocked) ? impact.blocked : [];
  if (blocked.length > 0) {
    const first = blocked[0];
    rows.push({
      label: 'Blocked',
      value: `${blocked.length} node${blocked.length === 1 ? '' : 's'} · ${cleanString(first?.nodeId)} by ${cleanString(first?.blockedBy)}`,
    });
  }

  const immutableTouched = Array.isArray(impact.immutableTouched) ? impact.immutableTouched : [];
  if (immutableTouched.length > 0) {
    const first = immutableTouched[0];
    rows.push({
      label: 'Immutable',
      value: `${immutableTouched.length} touched · ${cleanString(first?.nodeId)} (${cleanString(first?.status)})`,
    });
  }

  return rows;
}

export {
  buildPlanImpactRows,
};
