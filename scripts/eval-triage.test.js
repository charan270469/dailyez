import assert from 'node:assert/strict';
import { formatReport, scoreRows, stratifiedSample } from './eval-triage.js';

const candidates = [
  { message_id: 'm1', signal_id: 'a', sender_domain: 'one.example', evaluated_at: '2026-01-03T00:00:00Z' },
  { message_id: 'm2', signal_id: 'a', sender_domain: 'two.example', evaluated_at: '2026-01-02T00:00:00Z' },
  { message_id: 'm3', signal_id: 'b', sender_domain: 'one.example', evaluated_at: '2026-01-01T00:00:00Z' },
  { message_id: 'm4', signal_id: 'b', sender_domain: 'two.example', evaluated_at: '2025-12-31T00:00:00Z' },
  { message_id: 'm1', signal_id: 'b', sender_domain: 'two.example', evaluated_at: '2025-12-30T00:00:00Z' },
];
const sample = stratifiedSample(candidates, 4);
assert.equal(sample.length, 4);
assert.equal(new Set(sample.map((row) => row.message_id)).size, 4, 'sample contains unique messages');
assert.deepEqual(new Set(sample.map((row) => row.signal_id)), new Set(['a', 'b']));
assert.deepEqual(new Set(sample.map((row) => row.sender_domain)), new Set(['one.example', 'two.example']));
assert.throws(
  () => stratifiedSample(candidates.filter((row) => row.signal_id === 'a'), 2),
  /at least 2 Signals/,
);
assert.throws(
  () => stratifiedSample(candidates.map((row) => ({ ...row, sender_domain: 'one.example' })), 2),
  /at least 2 sender domains/,
);

const rows = [
  { message_id: '1', signal_id: 'a', signal_name: 'Signal A', system_verdict: 'relevant', ground_truth_label: 'TP', system_confidence: 'high' },
  { message_id: '2', signal_id: 'a', signal_name: 'Signal A', system_verdict: 'relevant', ground_truth_label: 'FP', system_confidence: 'low' },
  { message_id: '3', signal_id: 'b', signal_name: 'Signal B', system_verdict: 'not-relevant', ground_truth_label: 'FN', system_confidence: 'medium', prefilter_blocked: true, prefilter_reason: 'No signal terms found.' },
  { message_id: '4', signal_id: 'b', signal_name: 'Signal B', system_verdict: 'not-relevant', ground_truth_label: 'TN', system_confidence: 'high' },
  { message_id: '5', signal_id: 'b', signal_name: 'Signal B', system_verdict: 'not-relevant', ground_truth_label: '', system_confidence: 'high' },
];
const scored = scoreRows(rows);
assert.deepEqual(scored.overall.counts, { tp: 1, fp: 1, tn: 1, fn: 1, total: 4 });
assert.equal(scored.overall.metrics.precision, 0.5);
assert.equal(scored.overall.metrics.recall, 0.5);
assert.equal(scored.overall.metrics.f1, 0.5);
assert.equal(scored.unlabeled, 1);
assert.equal(scored.confidenceBreakdown.fp.low, 1);
const report = formatReport(scored, new Date('2026-01-01T00:00:00Z'));
assert.match(report, /Prefilter-blocked false negatives \(1 total; showing up to 3\)/);
assert.match(report, /Unlabeled evaluations skipped: 1/);
assert.match(report, /Prefilter block reason: No signal terms found\./);
assert.match(
  formatReport(scoreRows([{
    message_id: '7',
    signal_id: 'a',
    signal_name: 'Signal A',
    system_verdict: 'not-relevant',
    ground_truth_label: 'FN',
    evaluation_path: 'classification-pipeline (LLM)',
    system_reasoning: 'The message met the signal requirements.',
  }])),
  /LLM false negatives \(1 total; showing up to 3\)/,
);
assert.throws(
  () => scoreRows([{ message_id: '6', system_verdict: 'not-relevant', ground_truth_label: 'FP' }]),
  /conflicts with system_verdict/,
);

console.log('triage evaluation tests passed');
