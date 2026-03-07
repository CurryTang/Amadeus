import { buildContextPackSummary } from './contextPackPresentation.js';

function buildAgentSessionContextSummary(view = {}) {
  return buildContextPackSummary(view)
    .filter((row) => row?.label !== 'Mode')
    .slice(0, 4);
}

export {
  buildAgentSessionContextSummary,
};
