'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const documentPlanService = require('../document-plan.service');

test('extractDocumentPlanResult parses structured planner trailer blocks', () => {
  const raw = [
    'Planning complete.',
    'DOCUMENT_PLAN_RESULT',
    JSON.stringify({
      planId: 'docplan_alpha',
      title: 'Alpha Plan',
      documentPath: 'docs/exp.md',
      steps: [
        { id: 'step_1', title: 'Collect baseline', kind: 'analysis' },
      ],
    }),
    'END_DOCUMENT_PLAN_RESULT',
  ].join('\n');

  const result = documentPlanService.extractDocumentPlanResult(raw);

  assert.equal(result.planId, 'docplan_alpha');
  assert.equal(result.documentPath, 'docs/exp.md');
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].id, 'step_1');
});

test('normalizeDocumentPlanResult rejects planner output without steps', () => {
  assert.throws(
    () => documentPlanService.normalizeDocumentPlanResult({
      planId: 'docplan_empty',
      title: 'Empty',
      documentPath: 'docs/exp.md',
      steps: [],
    }),
    /at least one step/i
  );
});

test('materializeDocumentPlanTree creates a root node and dependency-linked step nodes', () => {
  const currentPlan = {
    version: 1,
    project: 'Demo',
    vars: {},
    nodes: [
      {
        id: 'init',
        title: 'Project bootstrap',
        kind: 'setup',
        assumption: [],
        target: [],
        commands: [],
        checks: [],
      },
    ],
  };

  const materialized = documentPlanService.materializeDocumentPlanTree({
    projectName: 'Demo',
    currentPlan,
    documentPlan: {
      planId: 'docplan_alpha',
      title: 'Alpha Plan',
      documentPath: 'docs/exp.md',
      steps: [
        {
          id: 'step_1',
          title: 'Collect baseline',
          kind: 'analysis',
          objective: 'Collect baseline evidence',
          dependsOn: [],
          todoId: 'todo:step_1',
          allowedMarkers: ['step:step_1', 'todo:step_1'],
        },
        {
          id: 'step_2',
          title: 'Write conclusion',
          kind: 'experiment',
          objective: 'Write the conclusion section',
          dependsOn: ['step_1'],
          todoId: 'todo:step_2',
          allowedMarkers: ['step:step_2', 'todo:step_2'],
        },
      ],
    },
  });

  const rootNode = materialized.plan.nodes.find((node) => node.id === 'docplan_alpha');
  const stepOne = materialized.plan.nodes.find((node) => node.id === 'docplan_alpha__step_1');
  const stepTwo = materialized.plan.nodes.find((node) => node.id === 'docplan_alpha__step_2');

  assert.ok(rootNode);
  assert.ok(stepOne);
  assert.ok(stepTwo);
  assert.equal(stepOne.parent, 'docplan_alpha');
  assert.deepEqual(stepTwo.evidenceDeps, ['docplan_alpha__step_1']);
  assert.equal(stepOne.ui.documentPlanStep.stepId, 'step_1');
  assert.equal(stepOne.ui.documentPlanStep.documentPath, 'docs/exp.md');
  assert.equal(materialized.state.nodes['docplan_alpha__step_1'].status, 'IDLE');
});
