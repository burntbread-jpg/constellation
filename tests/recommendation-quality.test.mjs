import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRecommendations} from '../scripts/evaluate-recommendations.mjs';

test('30-work recommendation benchmark passes every release quality gate', async () => {
  const report = await evaluateRecommendations();
  assert.equal(report.metrics.cases, 30);
  assert.equal(report.metrics.scenarios, 150);
  assert.equal(report.metrics.recommendations, 450);
  assert.equal(report.passed, true, JSON.stringify({metrics: report.metrics, gates: report.gates}));
  assert.ok(Object.values(report.perMode).every(mode => mode.passRate >= .95));
});
