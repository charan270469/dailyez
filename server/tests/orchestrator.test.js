// Orchestrator routing tests — deterministic branches and the sender-domain
// prefilter only. The classification pipeline's LLM stage (checkSignalMatch) makes a live
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
  matchAlertTarget,
  normalizeAlertTarget,
  messageForSignal,
  checkSenderDomainBlocklist,
} = await import('../agents/orchestrator.js');

const alertSignal = {
  _id: 'alert1',
  context: 'Alerts for messages from X',
  alertEnabled: true,
  alertTarget: 'admissions@icfaiuniversity.in',
  alertPlatform: 'gmail',
};
const senderSignal = { _id: 'src1', context: 'emails from ICFAI', isSenderIntent: true, entityName: 'ICFAI' };

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

// ─── Sender-domain blocklist is independent of signal wording ───
{
  const knownSpamDomains = new Set(['spam.example']);
  const collection = {
    findOne: async (query) => {
      const domain = query.domain.$in.find(candidate => knownSpamDomains.has(candidate));
      return domain ? { domain } : null;
    },
  };
  const examples = [
    { from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>', subject: 'Actively recruiting' },
    { from: 'Internshala <student@internshala.com>', subject: 'Web Development internships' },
    { from: 'Manvendra from HackCulture <manvendra@hackculture.net>', subject: 'Bharat1.ai Buildathons' },
  ];
  for (const message of examples) {
    assert.equal(await checkSenderDomainBlocklist(message, collection), null);
  }
  assert.equal(
    await checkSenderDomainBlocklist({ from: 'Offers <mail@news.spam.example>' }, collection),
    'blocked: sender domain on known-spam list (spam.example)'
  );
  assert.equal(await checkSenderDomainBlocklist({ from: 'unknown sender' }, collection), null);
}

// ─── normalizeAlertTarget preserves its contract after the move ───
assert.equal(normalizeAlertTarget('whatsapp', '919876543210@s.whatsapp.net'), '919876543210');
assert.equal(normalizeAlertTarget('whatsapp', '1234567890-123456@g.US'), '1234567890-123456@g.us');
assert.equal(normalizeAlertTarget('gmail', 'ICFAI <admissions@icfaiuniversity.in>'), 'admissions@icfaiuniversity.in');
assert.equal(matchAlertTarget({ from: 'x@y.com' }, { alertEnabled: false, alertTarget: 'x@y.com', alertPlatform: 'gmail' }).matched, false);

// ─── signalMessageMatches still returns the same merged shape (deterministic only) ───
{
  const { signalMessageMatches, getPendingSignals, hasLegacyKeywordPrefilterEvaluation } =
    await import('../agents/signalMatching.js');
  const res = await signalMessageMatches(
    { from: 'ICFAI <noreply@icfaiuniversity.in>', subject: 'hi', content: 'hello', source: 'gmail' },
    [senderSignal, alertSignal]
  );
  assert.equal(res.llmCalls, 0, 'no LLM calls for deterministic/mismatched signals');
  assert.equal(res.matches.length, 1, 'only the sender-intent signal matches');
  assert.equal(String(res.matches[0].matchedSignalId), 'src1');
  assert.equal(res.matches[0].confidence, 'high');
  assert.equal(res.matched, true);
  assert.deepEqual(res.evaluatedSignalIds.map(String).sort(), ['alert1', 'src1'].sort());

  const legacySignal = {
    _id: 'legacy',
    context: 'emails from ICFAI',
    isSenderIntent: true,
    entityName: 'ICFAI',
  };
  const oldKeywordBlock = {
    signalId: 'legacy',
    evaluationPath: 'classification-pipeline (LLM skipped: keyword pre-filter)',
    prefilterBlocked: true,
    prefilterReason: 'Keyword pre-filter: message shares no term with the signal context',
  };
  assert.equal(hasLegacyKeywordPrefilterEvaluation([oldKeywordBlock], [legacySignal]), true);
  assert.deepEqual(
    getPendingSignals([legacySignal], ['legacy'], [oldKeywordBlock]),
    [legacySignal],
    'legacy keyword-prefiltered pairs are retried despite their saved evaluated id'
  );
  const retried = await signalMessageMatches(
    { from: 'ICFAI <noreply@icfaiuniversity.in>', subject: 'hi', content: 'hello', source: 'gmail' },
    [legacySignal],
    ['legacy'],
    [oldKeywordBlock]
  );
  assert.deepEqual(retried.evaluatedSignalIds, ['legacy']);
  assert.equal(retried.matches.length, 1);

  const senderDomainBlock = {
    signalId: 'legacy',
    evaluationPath: 'classification-pipeline (LLM skipped: sender-domain blocklist)',
    prefilterBlocked: true,
    prefilterReason: 'blocked: sender domain on known-spam list (spam.example)',
  };
  assert.equal(hasLegacyKeywordPrefilterEvaluation([senderDomainBlock], [legacySignal]), false);
  assert.deepEqual(
    getPendingSignals([legacySignal], ['legacy'], [senderDomainBlock]),
    [],
    'valid sender-domain blocks are not retried'
  );
}

console.log('orchestrator routing tests passed');

// ─── messageForSignal: per-signal PDF scoping (pure, no LLM) ───
// A message parsed because one signal required it must stay PDF-free for a
// signal that did not opt in.
{
  const msg = { from: 'a@b.com', subject: 'resume', content: 'see attached', pdfContent: { text: 'React Node Postgres' } };
  const on = messageForSignal(msg, { pdfParsingEnabled: true });
  assert.ok(on.content.includes('React Node Postgres'), 'opted-in signal sees PDF text');
  assert.ok(!msg.content.includes('React Node Postgres'), 'input message not mutated');
  assert.equal(messageForSignal(msg, { pdfParsingEnabled: false }), msg, 'opted-out signal gets message untouched');
  assert.equal(messageForSignal(msg, {}), msg, 'missing flag defaults to untouched');
  const noPdf = { content: 'x' };
  assert.equal(messageForSignal(noPdf, { pdfParsingEnabled: true }), noPdf, 'no-pdf message passes through');
  const bodyMsg = { content: 'see attached', body: 'short body', pdfContent: { text: 'ZEBRA-UNIQUE-SKILL' } };
  const bodyOn = messageForSignal(bodyMsg, { pdfParsingEnabled: true });
  assert.ok(bodyOn.body.includes('ZEBRA-UNIQUE-SKILL') && bodyOn.content.includes('ZEBRA-UNIQUE-SKILL'), 'body carriers mirror PDF onto body and content');
  console.log('messageForSignal PDF scoping checks passed');
}