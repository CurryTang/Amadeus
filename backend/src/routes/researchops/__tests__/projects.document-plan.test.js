'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('buildDocumentPlanGenerationPrompt instructs the remote agent to emit a structured trailer', () => {
  const prompt = projectsRouter.buildDocumentPlanGenerationPrompt({
    instruction: 'Plan an experiment for model transfer.',
    projectPath: '/remote/project',
  });

  assert.match(prompt, /Plan an experiment for model transfer\./);
  assert.match(prompt, /docs\/exp\.md/);
  assert.match(prompt, /DOCUMENT_PLAN_RESULT/);
  assert.match(prompt, /END_DOCUMENT_PLAN_RESULT/);
});

test('buildDocumentPlanRunPayload creates an SSH-backed agent run payload', () => {
  const payload = projectsRouter.buildDocumentPlanRunPayload({
    project: {
      id: 'proj_1',
      projectPath: '/remote/project',
      serverId: 'ssh_alpha',
    },
    instruction: 'Generate the experiment document.',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.runType, 'AGENT');
  assert.equal(payload.schemaVersion, '2.0');
  assert.equal(payload.serverId, 'ssh_alpha');
  assert.equal(payload.provider, 'codex_cli');
  assert.match(payload.metadata.prompt, /Generate the experiment document\./);
});

test('buildDocumentPlanNodePrompt scopes execution to one document step', () => {
  const prompt = projectsRouter.buildDocumentPlanNodePrompt({
    title: 'Write conclusion',
    ui: {
      documentPlanStep: {
        stepId: 'step_2',
        todoId: 'todo:step_2',
        documentPath: 'docs/exp.md',
        allowedMarkers: ['step:step_2', 'todo:step_2'],
      },
    },
  });

  assert.match(prompt, /step_2/);
  assert.match(prompt, /todo:step_2/);
  assert.match(prompt, /docs\/exp\.md/);
  assert.match(prompt, /STEP_RESULT/);
});
