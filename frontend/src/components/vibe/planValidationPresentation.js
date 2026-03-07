function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPlanValidationIssues(validation, { limit = 4 } = {}) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  return [
    ...errors.map((item) => ({
      severity: 'error',
      code: cleanString(item?.code),
      message: cleanString(item?.message),
    })),
    ...warnings.map((item) => ({
      severity: 'warning',
      code: cleanString(item?.code),
      message: cleanString(item?.message),
    })),
  ]
    .filter((item) => item.message)
    .slice(0, Math.max(Number(limit) || 0, 0));
}

export {
  buildPlanValidationIssues,
};
