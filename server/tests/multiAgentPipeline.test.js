// Regression: ICFAI Foundation vs MountBlue Technologies false-positive drift.
//
// Documented pattern: a sender-intent signal "gather all mails from ICFAI
// Foundation for Higher Education" must NOT match an unrelated MountBlue
// Technologies email (shared generic vocabulary like "tech"/"education" once
// caused thematic-similarity drift), while a genuine ICFAI-domain email must
// still match.
//
// Coverage is via orchestrateMatch() — the full multi-agent entry point — so
// this proves the new architecture routes the pair correctly end to end.
// ponytail: sender-intent signals route deterministically (no Groq call), so
// this stays a fast offline check; a classification-pipeline LLM variant would
// need a live key and would be flaky in CI — upgrade path is a live
// runClassificationPipeline case once a stable mocked-Groq harness exists.
// Run with: node server/tests/multiAgentPipeline.test.js
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// orchestrator.js pulls in matchSignal.js which instantiates Groq at import
// time, so the key must load BEFORE the module graph is imported.
const { orchestrateMatch } = await import('../agents/orchestrator.js');
const { parseSignalEntity } = await import('../agents/parseSignalEntity.js');

// ─── same signal text as the earlier manual test ───
const signalContext = 'gather all mails from ICFAI Foundation for Higher Education';
const parsed = parseSignalEntity(signalContext);
assert.equal(parsed.isSenderIntent, true, 'signal must parse as sender-intent');
assert.ok(parsed.entityName.includes('ICFAI'), 'entity must contain ICFAI');
const signal = {
  _id: 'icfai-regression',
  context: signalContext,
  isSenderIntent: parsed.isSenderIntent,
  entityName: parsed.entityName,
};

// ─── same MountBlue Technologies test email shape as manual testing ───
// Third-party tech-hiring sender sharing generic "technologies/education"
// vocabulary with the signal — the exact drift trigger.
const mountBlueMail = {
  from: 'MountBlue Technologies <hr@mountblue.io>',
  subject: 'Software Development Engineer Trainee — next steps',
  content:
    'Hi, following up on your application for the technology trainee program. ' +
    'Complete the coding assignment covering computer science fundamentals.',
  source: 'gmail',
};

// ─── genuine ICFAI mail — must keep matching ───
const icfaiMail = {
  from: 'ICFAI Admissions <admissions@icfaiuniversity.in>',
  subject: 'Semester fee payment and exam schedule',
  content: 'Dear student, your semester fee deadline and exam schedule are now published.',
  source: 'gmail',
};

// False-positive prevention: MountBlue must NOT match the ICFAI signal.
{
  const o = await orchestrateMatch(mountBlueMail, signal);
  assert.equal(o.path, 'source-intent (deterministic)');
  assert.equal(o.result.matched, false, 'MountBlue mail must not match the ICFAI signal');
}

// Legitimate matches still work: genuine ICFAI mail MUST match.
{
  const o = await orchestrateMatch(icfaiMail, signal);
  assert.equal(o.path, 'source-intent (deterministic)');
  assert.equal(o.result.matched, true, 'genuine ICFAI mail must match the ICFAI signal');
}

console.log('multiAgentPipeline regression tests passed');
