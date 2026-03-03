'use strict';

/**
 * Attaches res.ok(data) and res.fail(code, message, status, details) helpers.
 * Also exports HTTP error code → status mappings for routes to use.
 */

const ERROR_STATUS = {
  RUN_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  QUEUE_FULL: 429,
  RUN_NOT_QUEUED: 409,
  RUN_ALREADY_RUNNING: 409,
  CHECKPOINT_REQUIRED: 409,
  CHECKPOINT_EXPIRED: 410,
  SSH_UNREACHABLE: 503,
  SSH_AUTH_FAILED: 401,
  ARTIFACT_NOT_FOUND: 404,
  ARTIFACT_EXPIRED: 410,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INTERNAL_ERROR: 500,
};

function resHelpers(req, res, next) {
  res.ok = function ok(data, meta = {}) {
    return this.json({
      ok: true,
      data: data ?? null,
      meta: { ts: new Date().toISOString(), v: 2, ...meta },
    });
  };

  res.fail = function fail(code, message, httpStatus, details = {}) {
    const status = httpStatus ?? ERROR_STATUS[code] ?? 400;
    return this.status(status).json({
      ok: false,
      error: { code, message: message || code, details },
    });
  };

  next();
}

module.exports = resHelpers;
module.exports.ERROR_STATUS = ERROR_STATUS;
