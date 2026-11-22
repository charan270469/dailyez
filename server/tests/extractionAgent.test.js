// Pure-function tests for the classification-pipeline fact extraction agent
// (server/agents/extractionAgent.js) and the matchSignal.js prompt wiring — the
// parts that can break without making a live Groq call. The live end-to-end
// behavior (extraction fires before classification, sender-intent/alert signals
// skip it, match quality) is verified by the manual smoke test in the task.
// Run with: node server/tests/extractionAgent.test.js
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// extractionAgent.js and matchSignal.js instantiate their Groq clients at import
// time, so the API key must be loaded BEFORE the module graph is imported.
const { buildExtractPrompt, normalizeExtractedFacts } = await import('../agents/extractionAgent.js');
const { buildSignalMatchPrompt } = await import('../agents/matchSignal.js');

// ─── buildExtractPrompt: asks for every required fact and carries the message ───
{
  const prompt = buildExtractPrompt({
    from: 'Acme <noreply@acme.com>',
    subject: 'Interview',
    content: 'Please attend on 2026-10-01. Stipend: $500.',
  });
  for (const expected of [
    '"displayName"', '"domain"', '"dates"', '"amounts"', '"companies"',
    '"roles"', '"people"', '"summary"', 'noreply@acme.com', 'Interview', '2026-10-01', '$500',
  ]) {
    assert.ok(prompt.includes(expected), `extraction prompt missing "${expected}"`);
  }
}

// ─── normalizeExtractedFacts: valid JSON → canonical shape ───
{
  const f = normalizeExtractedFacts(JSON.stringify({
    sender: { displayName: 'Acme HR', domain: 'ACME.com' },
    dates: ['2026-10-01', '', 42],
    amounts: ['$500'],
    entities: { companies: ['Acme'], roles: ['SDE'], people: ['Ravi'] },
    summary: 'Invites the candidate to an interview at Acme on 2026-10-01.',
  }));
  assert.deepEqual(f.sender, { displayName: 'Acme HR', domain: 'acme.com' }, 'domain lowercased');
  assert.deepEqual(f.dates, ['2026-10-01'], 'non-string array entries dropped');
  assert.deepEqual(f.amounts, ['$500']);
  assert.deepEqual(f.entities, { companies: ['Acme'], roles: ['SDE'], people: ['Ravi'] });
  assert.ok(f.summary.includes('interview'));
}
// missing optional fields → empty strings/arrays (partial model output is usable)
{
  const f = normalizeExtractedFacts('{"sender":{"displayName":"","domain":""},"dates":[],"amounts":[],"entities":{},"summary":"Just a hello."}');
  assert.deepEqual(f.sender, { displayName: '', domain: '' });
  assert.deepEqual(f.dates, []);
  assert.deepEqual(f.entities, { companies: [], roles: [], people: [] });
}
// ─── normalizeExtractedFacts: garbage → null (the fall-back contract ───
// ─── that keeps classification alive on the raw message) ───
{
  assert.equal(normalizeExtractedFacts('not json at all'), null);
  assert.equal(normalizeExtractedFacts('[1,2,3]'), null, 'array is not an object');
  assert.equal(normalizeExtractedFacts('null'), null);
  assert.equal(normalizeExtractedFacts('{"s":"x"}'), null, 'missing summary is fatal');
  assert.equal(normalizeExtractedFacts(undefined), null);
  assert.equal(normalizeExtractedFacts(''), null);
}

// ─── buildSignalMatchPrompt: facts appear ABOVE the raw message; absent when null ───
{
  const facts = {
    sender: { displayName: '', domain: '' },
    dates: ['2026-10-01'],
    amounts: [],
    entities: { companies: [], roles: [], people: [] },
    summary: 'Invites the candidate to an interview.',
  };
  const withFacts = buildSignalMatchPrompt({ from: 'a@b.com', subject: 'hi', content: 'raw body text' }, { context: 'hiring intern' }, facts);
  assert.ok(
    withFacts.indexOf('EXTRACTED MESSAGE FACTS') < withFacts.indexOf('MESSAGE:'),
    'facts block must be placed above the raw MESSAGE block'
  );
  assert.ok(withFacts.includes('raw body text'), 'raw message content is still in the prompt');
  assert.ok(withFacts.includes('"summary"'));

  const without = buildSignalMatchPrompt({ from: 'a@b.com', subject: 'hi', content: 'raw body text' }, { context: 'hiring intern' }, null);
  assert.ok(!without.includes('EXTRACTED MESSAGE FACTS'), 'no facts block when extraction failed');
  assert.ok(without.includes('raw body text'));
}

console.log('extraction agent / prompt wiring tests passed');