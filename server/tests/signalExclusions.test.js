import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const [{ buildSignalMatchPrompt }, { buildVerificationPrompt }] = await Promise.all([
  import('../agents/matchSignal.js'),
  import('../agents/verificationAgent.js'),
]);

const excludedCriteria = 'Exclude job listings without a specific, working application link.';
const signal = {
  context: 'Find genuine AI engineer job postings',
  excludedCriteria,
};
const message = {
  from: 'Recruiting <jobs@example.com>',
  subject: 'AI engineer roles now open',
  content: 'Apply today.',
};
const initialResult = {
  matched: true,
  confidence: 'medium',
  reasoning: 'The message advertises AI engineer roles.',
};

for (const [name, prompt] of [
  ['classification', buildSignalMatchPrompt(message, signal)],
  ['verification', buildVerificationPrompt(message, signal, initialResult)],
]) {
  assert.ok(prompt.includes(excludedCriteria), `${name} prompt includes user exclusions`);
  assert.match(prompt, /STRICT USER EXCLUSIONS/, `${name} prompt marks exclusions as strict`);
}

assert.doesNotMatch(
  buildSignalMatchPrompt(message, { context: signal.context }),
  /STRICT USER EXCLUSIONS/,
  'signals without exclusions keep the existing prompt behavior',
);

console.log('signal exclusion prompt tests passed');
