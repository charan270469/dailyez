// Pure-function tests for the classification-pipeline verification agent
// (server/agents/verificationAgent.js) — the parts that can break without making
// a live Groq call. The live end-to-end behavior (medium/low confidence triggers
// verification, finalMatched overrides the classification result, high confidence
// skips it entirely) is verified by the manual smoke test described in the task.
// Run with: node server/tests/verificationAgent.test.js
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// verificationAgent.js instantiates its Groq client at import time, so the API
// key must be loaded BEFORE the module graph is imported.
const { buildVerificationPrompt, normalizeVerificationResult } = await import('../agents/verificationAgent.js');

const message = { from: 'Naukri <alerts@naukri.com>', subject: 'Tech jobs', content: 'latest tech openings' };
const signal = { _id: 'sig1', context: 'jobs from my college placement cell' };
const initialResult = { matched: true, confidence: 'low', reasoning: 'both mention tech so likely a match' };

// ─── buildVerificationPrompt: critique framing, carries context + message + verdict ───
{
  const prompt = buildVerificationPrompt(message, signal, initialResult);
  for (const expected of [
    'CRITIQUE', 'SUPERFICIAL', "USER'S SIGNAL", 'jobs from my college placement cell',
    'alerts@naukri.com', 'Tech jobs', 'latest tech openings',
    'INITIAL CLASSIFICATION VERDICT', 'matched: true', 'confidence: low',
    'both mention tech so likely a match',
    '"verified"', '"finalMatched"', '"verificationReasoning"',
    'CONFIRM', 'OVERTURN',
  ]) {
    assert.ok(prompt.includes(expected), `verification prompt missing "${expected}"`);
  }
  // Message body is capped like the classification/extraction calls.
  const longMessage = { from: 'x@y.com', subject: 's', content: 'z'.repeat(20000) };
  assert.ok(buildVerificationPrompt(longMessage, signal, initialResult).length < 10000, 'body must be capped');
}

// ─── normalizeVerificationResult: valid JSON → canonical shape ───
{
  const v = normalizeVerificationResult(JSON.stringify({
    verified: false,
    finalMatched: false,
    verificationReasoning: '  Shared word "tech" is superficial — sender domain is a job board, not the college.  ',
  }));
  assert.equal(v.verified, false);
  assert.equal(v.finalMatched, false);
  assert.ok(v.verificationReasoning.includes('superficial'), 'reasoning kept (trimmed)');
}

// ─── normalizeVerificationResult: garbage → null (orchestrator keeps initial result) ───
{
  assert.equal(normalizeVerificationResult('not json at all'), null);
  assert.equal(normalizeVerificationResult('[1,2,3]'), null, 'array is not an object');
  assert.equal(normalizeVerificationResult('null'), null);
  assert.equal(normalizeVerificationResult(undefined), null);
  assert.equal(normalizeVerificationResult(''), null);
  assert.equal(
    normalizeVerificationResult('{"verified":"true","finalMatched":false,"verificationReasoning":"x"}'),
    null,
    'booleans must be real booleans'
  );
  assert.equal(
    normalizeVerificationResult('{"verified":true,"finalMatched":true,"verificationReasoning":""}'),
    null,
    'reasoning is required'
  );
}

console.log('verification agent tests passed');