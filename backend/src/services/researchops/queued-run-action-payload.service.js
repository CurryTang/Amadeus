'use strict';

const { buildRunPayload } = require('./run-payload.service');

function buildQueuedRunActionPayload({
  success = true,
  message = '',
  run = null,
} = {}) {
  return {
    success: Boolean(success),
    message: String(message || '').trim(),
    ...buildRunPayload({ run }),
  };
}

module.exports = {
  buildQueuedRunActionPayload,
};
