'use strict';

const { buildContextPackView } = require('./context-pack-view.service');

function buildContextPackPayload({ pack = {}, mode = '' } = {}) {
  const view = buildContextPackView({ pack, mode });
  return {
    pack,
    mode: view.mode,
    view,
    submitHints: {
      contextPack: {
        query: {
          transport: '"http"|"daemon-task"',
        },
      },
    },
  };
}

module.exports = {
  buildContextPackPayload,
};
