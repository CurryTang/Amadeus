'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');

function buildRunPayload({ run = null } = {}) {
  return {
    run,
    attempt: buildAttemptViewFromRun(run || {}),
  };
}

module.exports = {
  buildRunPayload,
};
