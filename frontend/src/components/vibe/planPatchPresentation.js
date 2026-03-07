function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPlanPatchFeedback(error) {
  const payload = error?.response?.data && typeof error.response.data === 'object'
    ? error.response.data
    : {};
  const code = cleanString(payload.code || error?.code);
  const baseMessage = cleanString(payload.error || error?.message) || 'Failed to apply plan patches';
  const validation = payload.validation && typeof payload.validation === 'object'
    ? payload.validation
    : null;
  const firstValidationError = Array.isArray(validation?.errors) && validation.errors.length > 0
    ? cleanString(validation.errors[0]?.message)
    : '';

  let message = baseMessage;
  if (code === 'PLAN_SCHEMA_INVALID' && firstValidationError) {
    message = `${baseMessage} (${firstValidationError})`;
  }
  if (code) {
    message = `${code}: ${message}`;
  }

  return {
    message,
    validation,
  };
}

export {
  getPlanPatchFeedback,
};
