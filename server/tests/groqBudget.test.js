// Minimal runnable checks for the shared daily Groq budget guard
// (server/agents/groqBudget.js + deferral wiring). No frameworks, no network.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const budget = await import('../agents/groqBudget.js');
const { orchestrateMatch, CLASSIFICATION_DEFERRED_PATH } = await import('../agents/orchestrator.js');
const { signalMessageMatches } = await import('../agents/signalMatching.js');

// ─── limit resolution: documented suffix var just works ───
process.env.GROQ_DAILY_LIMIT_GPT_OSS_20B = '7';
assert.equal(budget.getGroqModelLimit('openai/gpt-oss-20b'), 7);
assert.equal(budget.getGroqModelLimit('openai/gpt-oss-120b'), 1000);
delete process.env.GROQ_DAILY_LIMIT_GPT_OSS_20B;

// ─── soft warning fires once at 80%, hard line at 100% ───
process.env.GROQ_DAILY_LIMIT = '5';
budget._resetGroqBudgetForTests();
const seen = [];
const origWarn = console.warn;
console.warn = (m, ...rest) => { seen.push(String(m)); origWarn(m, ...rest); };
try {
  budget.noteGroqCall('m1');
  budget.noteGroqCall('m1');
  budget.noteGroqCall('m1');
  assert.equal(seen.filter((m) => m.includes('WARNING')).length, 0);
  budget.noteGroqCall('m1'); // 4/5 = 80%
  assert.equal(seen.filter((m) => m.includes('WARNING')).length, 1);
  budget.noteGroqCall('m1'); // 5/5
  assert.equal(seen.filter((m) => m.includes('LIMIT REACHED')).length, 1);
  assert.equal(budget.isGroqBudgetExhausted('m1'), true);
  assert.equal(budget.isGroqBudgetExhausted('other-model'), false);
} finally {
  console.warn = origWarn;
}
delete process.env.GROQ_DAILY_LIMIT;

// ─── hard gate: exhausted EXTRACT/MATCH defers without any Groq call ───
process.env.GROQ_DAILY_LIMIT = '1';
budget._resetGroqBudgetForTests();
budget.noteGroqCall(process.env.GROQ_EXTRACT_MODEL || 'openai/gpt-oss-20b');
const deferred = await orchestrateMatch(
  { from: 'hiring@bigco.com', subject: 'hiring engineers', content: 'we are hiring engineers now' },
  { _id: 'sig-budget', context: 'notify me about hiring engineers' },
);
assert.equal(deferred.path, CLASSIFICATION_DEFERRED_PATH);
assert.equal(deferred.result.deferred, true);
assert.equal(deferred.result.matched, false);

// ─── deferred pairs stay out of evaluated ids → retried next cycle ───
const res = await signalMessageMatches(
  { from: 'hiring@bigco.com', subject: 'hiring engineers', content: 'we are hiring engineers now', source: 'gmail' },
  [{ _id: 'sig-budget', context: 'notify me about hiring engineers' }],
);
assert.deepEqual(res.deferredSignalIds.map(String), ['sig-budget']);
assert.deepEqual(res.evaluatedSignalIds, []);
delete process.env.GROQ_DAILY_LIMIT;
budget._resetGroqBudgetForTests();

// ─── debug route shape: usage per model against its limit ───
{
  const snap = budget.getGroqBudgetSnapshot();
  assert.ok(snap.date, 'snapshot carries the local day');
  const row = snap.models.find((m) => m.model === 'openai/gpt-oss-20b');
  assert.ok(row && typeof row.used === 'number' && typeof row.limit === 'number' && typeof row.remaining === 'number');
}

console.log('groq budget guard tests passed');
