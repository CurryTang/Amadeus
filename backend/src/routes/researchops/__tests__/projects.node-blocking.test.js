'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('getNodeDependencyIds includes parent and evidence deps in order', () => {
  const deps = projectsRouter.getNodeDependencyIds({
    parent: 'node_parent',
    evidenceDeps: ['node_a', 'node_b'],
  });

  assert.deepEqual(deps, ['node_parent', 'node_a', 'node_b']);
});

test('evaluateNodeBlocking reports unmet dependency and manual approval gates', () => {
  const result = projectsRouter.evaluateNodeBlocking(
    {
      id: 'node_eval',
      parent: 'node_parent',
      checks: [{ type: 'manual_approve', name: 'scope_review' }],
    },
    {
      nodes: {
        node_parent: { status: 'FAILED' },
        node_eval: { manualApproved: false },
      },
    }
  );

  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockedBy, [
    {
      type: 'dependency',
      depId: 'node_parent',
      status: 'FAILED',
    },
    {
      type: 'manual_approve',
      check: 'scope_review',
      status: 'PENDING',
    },
  ]);
});

test('evaluateNodeBlocking returns unblocked when dependencies passed and gate approved', () => {
  const result = projectsRouter.evaluateNodeBlocking(
    {
      id: 'node_eval',
      parent: 'node_parent',
      checks: [{ type: 'manual_approve', name: 'scope_review' }],
    },
    {
      nodes: {
        node_parent: { status: 'PASSED' },
        node_eval: { manualApproved: true },
      },
    }
  );

  assert.deepEqual(result, {
    blocked: false,
    blockedBy: [],
  });
});

test('resolveJudgeRouteMode defaults run-step to manual and run-all to auto', () => {
  assert.equal(projectsRouter.resolveJudgeRouteMode({ routeKind: 'run-step' }), 'manual');
  assert.equal(projectsRouter.resolveJudgeRouteMode({ routeKind: 'run-all' }), 'auto');
  assert.equal(projectsRouter.resolveJudgeRouteMode({ routeKind: 'run-step', judgeMode: 'auto' }), 'auto');
});

test('resolveJudgeStateTransition requests auto retry before retry cap and review otherwise', () => {
  assert.deepEqual(
    projectsRouter.resolveJudgeStateTransition({
      verdict: 'revise',
      judgeMode: 'auto',
      iteration: 2,
      maxIterations: 5,
    }),
    {
      action: 'retry',
      judgeStatus: 'running',
      needsReview: false,
    }
  );

  assert.deepEqual(
    projectsRouter.resolveJudgeStateTransition({
      verdict: 'revise',
      judgeMode: 'manual',
      iteration: 2,
      maxIterations: 5,
    }),
    {
      action: 'needs_review',
      judgeStatus: 'needs_review',
      needsReview: true,
    }
  );

  assert.deepEqual(
    projectsRouter.resolveJudgeStateTransition({
      verdict: 'revise',
      judgeMode: 'auto',
      iteration: 5,
      maxIterations: 5,
    }),
    {
      action: 'needs_review',
      judgeStatus: 'needs_review',
      needsReview: true,
    }
  );
});
