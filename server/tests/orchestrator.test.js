// Orchestrator routing tests — deterministic branches and the pre-filter skip
// only. The classification pipeline's LLM stage (checkSignalMatch) makes a live
// Groq call, so it is deliberately NOT exercised here; the LLM-fired path is
// verified by the manual smoke test described in the task (trigger a sync or
// re-check and read the `[pipeline]` logs).
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// orchestrator.js instantiates the Groq client at import time (via matchSignal.js),
// so the API key must be loaded BEFORE the module graph is imported.
const {
  orchestrateMatch,
  runClassificationPipeline,
  matchAlertTarget,
  normalizeAlertTarget,
} = await import('../agents/orchestrator.js');

const alertSignal = {
  _id: 'alert1',
  context: 'Alerts for messages from X',
  alertEnabled: true,
  alertTarget: 'admissions@icfaiuniversity.in',
  alertPlatform: 'gmail',
};
const senderSignal = { _id: 'src1', context: 'emails from ICFAI', isSenderIntent: true, entityName: 'ICFAI' };
const topicSignal = { _id: 'top1', context: 'notify me about hiring internship interviews' };

// ─── alert-target routing (deterministic, no LLM) ───
{
  const o = await orchestrateMatch({ from: 'Admissions <admissions@icfaiuniversity.in>', source: 'gmail' }, alertSignal);
  assert.equal(o.path, 'alert-target (deterministic)');
  assert.equal(o.result.matched, true);
  assert.equal(o.result.summary, 'Email from admissions@icfaiuniversity.in.');
}
{
  const o = await orchestrateMatch({ from: 'Other <other@x.com>', source: 'gmail' }, alertSignal);
  assert.equal(o.path, 'alert-target (deterministic)');
  assert.equal(o.result.matched, false);
}
// disabled alert stays fully silent and is routed to the alert path (never intent/LLM)
{
  const o = await orchestrateMatch({ from: 'x@y.com', source: 'gmail' }, { alertEnabled: false, alertTarget: 'x@y.com', alertPlatform: 'gmail' });
  assert.equal(o.path, 'alert-target (deterministic)');
  assert.equal(o.result.matched, false);
}
// alert flavor takes precedence even if the signal is also sender-intent — same
// ordering as the pre-orchestrator pipeline, so behavior is unchanged
{
  const o = await orchestrateMatch({ from: 'Other <other@x.com>', source: 'gmail' }, { ...alertSignal, isSenderIntent: true, entityName: 'X' });
  assert.equal(o.path, 'alert-target (deterministic)');
}

// ─── sender-intent routing (deterministic, no LLM) ───
{
  const o = await orchestrateMatch({ from: 'ICFAI <noreply@icfaiuniversity.in>' }, senderSignal);
  assert.equal(o.path, 'source-intent (deterministic)');
  assert.equal(o.result.matched, true);
}
{
  const o = await orchestrateMatch({ from: 'Internshala <x@internshala.com>' }, senderSignal);
  assert.equal(o.path, 'source-intent (deterministic)');
  assert.equal(o.result.matched, false);
}

// ─── topic/event signal → classification pipeline (pre-filter skip path) ───
// The message shares no term with the signal context, so the pipeline's first
// stage skips the LLM and reports the skip — no Groq call, no budget spent.
{
  const o = await orchestrateMatch({ from: 'a@b.com', subject: 'lunch menu', content: 'pizza friday' }, topicSignal);
  assert.equal(o.path, 'classification-pipeline (LLM skipped: keyword pre-filter)');
  assert.equal(o.result.matched, false);
}
{
  const p = await runClassificationPipeline({ from: 'a@b.com', subject: 'lunch menu', content: 'pizza friday' }, topicSignal);
  assert.equal(p.path, 'classification-pipeline (LLM skipped: keyword pre-filter)');
  assert.equal(p.result.matched, false);
}

// ─── normalizeAlertTarget preserves its contract after the move ───
assert.equal(normalizeAlertTarget('whatsapp', '919876543210@s.whatsapp.net'), '919876543210');
assert.equal(normalizeAlertTarget('whatsapp', '1234567890-123456@g.US'), '1234567890-123456@g.us');
assert.equal(normalizeAlertTarget('gmail', 'ICFAI <admissions@icfaiuniversity.in>'), 'admissions@icfaiuniversity.in');
assert.equal(matchAlertTarget({ from: 'x@y.com' }, { alertEnabled: false, alertTarget: 'x@y.com', alertPlatform: 'gmail' }).matched, false);

// ─── signalMessageMatches still returns the same merged shape (deterministic only) ───
{
  const { signalMessageMatches } = await import('../agents/signalMatching.js');
  const res = await signalMessageMatches(
    { from: 'ICFAI <noreply@icfaiuniversity.in>', subject: 'hi', content: 'hello', source: 'gmail' },
    [senderSignal, alertSignal, { _id: 'top2', context: 'xyzzy qquux wibble' }]
  );
  assert.equal(res.llmCalls, 0, 'no LLM calls for deterministic/mismatched signals');
  assert.equal(res.matches.length, 1, 'only the sender-intent signal matches');
  assert.equal(String(res.matches[0].matchedSignalId), 'src1');
  assert.equal(res.matches[0].confidence, 'high');
  assert.equal(res.matched, true);
  assert.deepEqual(res.evaluatedSignalIds.map(String).sort(), ['alert1', 'src1', 'top2'].sort());
}

console.log('orchestrator routing tests passed');