// Minimal runnable checks for the shared-key Gemini budget counter
// (server/agents/geminiBudget.js). No frameworks, no network.
// Run with: node server/tests/geminiBudget.test.js
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const budget = await import('../agents/geminiBudget.js');

// ─── warning fires once at 80%, limit line at 100%, split tracked ───
process.env.GEMINI_DAILY_LIMIT = '5';
budget._resetGeminiBudgetForTests();
const seen = [];
const origWarn = console.warn;
console.warn = (m, ...rest) => { seen.push(String(m)); origWarn(m, ...rest); };
try {
  budget.noteGeminiCall('pdf-parse');
  budget.noteGeminiCall('pdf-parse');
  budget.noteGeminiCall('match-fallback');
  assert.equal(seen.filter((m) => m.includes('WARNING')).length, 0);
  budget.noteGeminiCall('pdf-parse'); // 4/5 = 80%
  assert.equal(seen.filter((m) => m.includes('WARNING')).length, 1);
  assert.ok(seen.at(-1).includes('pdf-parse=3'), 'warning carries the per-source split');
  assert.ok(seen.at(-1).includes('match-fallback=1'), 'warning carries the per-source split');
  budget.noteGeminiCall('pdf-parse');
  budget.noteGeminiCall('pdf-parse'); // 6/5 — visibility only, still counts
  assert.equal(seen.filter((m) => m.includes('LIMIT REACHED')).length, 2);
  assert.equal(budget.getGeminiUsage(), 6);
  assert.equal(budget.getGeminiUsage('pdf-parse'), 5);
  assert.equal(budget.getGeminiUsage('match-fallback'), 1);
} finally {
  console.warn = origWarn;
}
delete process.env.GEMINI_DAILY_LIMIT;

// ─── default limit is 1500; snapshot shape ───
budget._resetGeminiBudgetForTests();
assert.equal(budget.getGeminiDailyLimit(), 1500);
{
  const snap = budget.getGeminiBudgetSnapshot();
  assert.ok(snap.date, 'snapshot carries the local day');
  assert.equal(snap.used, 0);
  assert.equal(snap.limit, 1500);
  assert.equal(snap.remaining, 1500);
  assert.deepEqual(snap.bySource, {});
}

console.log('gemini budget tests passed');
