'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseJudgeResponse,
  decideJudgeNextAction,
} = require('../tree-node-judge.service');

test('parseJudgeResponse extracts structured revise verdicts', () => {
  const result = parseJudgeResponse('{"verdict":"revise","summary":"Need stronger evidence","issues":["Missing final comparison"],"refinementPrompt":"Add the comparison section.","confidence":0.73}');

  assert.deepEqual(result, {
    verdict: 'revise',
    summary: 'Need stronger evidence',
    issues: ['Missing final comparison'],
    refinementPrompt: 'Add the comparison section.',
    confidence: 0.73,
    rawText: '{"verdict":"revise","summary":"Need stronger evidence","issues":["Missing final comparison"],"refinementPrompt":"Add the comparison section.","confidence":0.73}',
    technicalFailure: false,
  });
});

test('parseJudgeResponse converts malformed output into technical failure verdict', () => {
  const result = parseJudgeResponse('not-json');

  assert.equal(result.verdict, 'fail');
  assert.equal(result.technicalFailure, true);
  assert.match(result.summary, /failed to parse/i);
  assert.equal(result.rawText, 'not-json');
});

test('decideJudgeNextAction retries revise verdicts only in auto mode before retry cap', () => {
  assert.deepEqual(
    decideJudgeNextAction({ verdict: 'revise', mode: 'auto', iteration: 2, maxIterations: 5 }),
    { action: 'retry', needsReview: false }
  );
  assert.deepEqual(
    decideJudgeNextAction({ verdict: 'revise', mode: 'manual', iteration: 2, maxIterations: 5 }),
    { action: 'needs_review', needsReview: true }
  );
  assert.deepEqual(
    decideJudgeNextAction({ verdict: 'revise', mode: 'auto', iteration: 5, maxIterations: 5 }),
    { action: 'needs_review', needsReview: true }
  );
});
