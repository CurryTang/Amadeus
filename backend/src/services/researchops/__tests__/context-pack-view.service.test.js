'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContextPackView } = require('../context-pack-view.service');

test('buildContextPackView normalizes routed context packs into a stable read model', () => {
  const view = buildContextPackView({
    pack: {
      runId: 'run_123',
      run_intent: {
        goal: {
          nodeId: 'node_eval',
          title: 'Evaluation branch',
        },
      },
      selected_items: [
        { bucket: 'same_step_history', source_type: 'run', source_id: 'run_old' },
        { bucket: 'relevant_papers_and_notes', source_type: 'knowledge_asset', source_id: 'asset_1' },
      ],
      budget_report: {
        role_budget_tokens: {
          runner: 4200,
          coder: 4200,
          analyst: 2400,
          writer: 1200,
        },
      },
      rationale: 'Context was routed from prior similar runs and knowledge assets.',
    },
  });

  assert.deepEqual(view, {
    mode: 'routed',
    runId: 'run_123',
    nodeId: 'node_eval',
    goalTitle: 'Evaluation branch',
    selectedItemCount: 2,
    groupCount: 0,
    documentCount: 0,
    assetCount: 0,
    resourcePathCount: 0,
    topBuckets: ['same_step_history', 'relevant_papers_and_notes'],
    roleBudgetTokens: {
      runner: 4200,
      coder: 4200,
      analyst: 2400,
      writer: 1200,
    },
    rationale: 'Context was routed from prior similar runs and knowledge assets.',
  });
});

test('buildContextPackView normalizes legacy knowledge packs without inventing routed fields', () => {
  const view = buildContextPackView({
    mode: 'legacy',
    pack: {
      runId: 'run_legacy',
      groups: [{ id: 1 }],
      documents: [{ id: 11 }, { id: 12 }],
      assets: [{ id: 21 }],
      resourceHints: {
        paths: ['docs/README.md', 'notes.md'],
      },
    },
  });

  assert.deepEqual(view, {
    mode: 'legacy',
    runId: 'run_legacy',
    nodeId: '',
    goalTitle: '',
    selectedItemCount: 0,
    groupCount: 1,
    documentCount: 2,
    assetCount: 1,
    resourcePathCount: 2,
    topBuckets: [],
    roleBudgetTokens: {
      runner: 0,
      coder: 0,
      analyst: 0,
      writer: 0,
    },
    rationale: '',
  });
});
