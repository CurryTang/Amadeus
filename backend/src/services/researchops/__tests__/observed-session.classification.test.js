'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyObservedSession,
  canMaterializeObservedSession,
} = require('../observed-session.service');

test('classifyObservedSession accepts concrete coding tasks as can_be_node', async () => {
  const result = await classifyObservedSession({
    provider: 'codex',
    title: 'Implement observed session sync',
    promptDigest: 'Implement observed session sync in the runner area and tree',
    latestProgressDigest: 'Reading runner and tree state code to wire passive observed sessions',
  }, {
    classifyFn: async () => ({
      decision: 'can_be_node',
      taskType: 'coding',
      goalSummary: 'Implement observed session sync in the runner area and tree',
      confidence: 0.94,
      reason: 'Concrete implementation task with a clear deliverable',
    }),
  });

  assert.equal(result.decision, 'can_be_node');
  assert.equal(result.taskType, 'coding');
  assert.equal(result.goalSummary, 'Implement observed session sync in the runner area and tree');
  assert.equal(canMaterializeObservedSession(result), true);
});

test('classifyObservedSession accepts concrete research tasks as can_be_node', async () => {
  const result = await classifyObservedSession({
    provider: 'claude_code',
    title: 'Evaluate retrieval quality',
    promptDigest: 'Compare retrieval quality across BM25, embeddings, and hybrid search on the paper corpus',
    latestProgressDigest: 'Collecting evaluation criteria and baseline metrics',
  }, {
    classifyFn: async () => ({
      decision: 'can_be_node',
      taskType: 'research',
      goalSummary: 'Compare retrieval quality across BM25, embeddings, and hybrid search',
      confidence: 0.88,
      reason: 'Concrete research objective with explicit comparison targets',
    }),
  });

  assert.equal(result.decision, 'can_be_node');
  assert.equal(result.taskType, 'research');
  assert.match(result.reason, /Concrete research objective/i);
  assert.equal(canMaterializeObservedSession(result), true);
});

test('classifyObservedSession rejects vague or meta conversations', async () => {
  const result = await classifyObservedSession({
    provider: 'codex',
    title: 'Thinking about tooling',
    promptDigest: 'Maybe we should discuss whether an agent node makes sense here',
    latestProgressDigest: 'Talking through possible ideas',
  }, {
    classifyFn: async () => ({
      decision: 'ignore',
      taskType: 'unknown',
      goalSummary: '',
      confidence: 0.72,
      reason: 'No concrete coding or research task was identified',
    }),
  });

  assert.equal(result.decision, 'ignore');
  assert.equal(result.taskType, 'unknown');
  assert.equal(result.goalSummary, '');
  assert.equal(canMaterializeObservedSession(result), false);
});
