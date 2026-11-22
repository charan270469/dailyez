#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { config } from '../server/config/env.js';

const DEFAULT_LIMIT = 120;
const MIN_LIMIT = 100;
const MAX_LIMIT = 150;
const LABELS = new Set(['TP', 'FP', 'TN', 'FN']);
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
const PREFILTER_MARKER = 'keyword pre-filter';

function senderDomain(sender) {
  const address = String(sender || '').match(/[\w.+-]+@([\w.-]+\.[a-z]{2,})/i);
  return address ? address[1].toLowerCase() : '';
}

function timestampValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isPrefilterEvaluation(row) {
  return row.prefilter_blocked === true ||
    String(row.evaluation_path || '').toLowerCase().includes(PREFILTER_MARKER);
}

function isLlmEvaluation(row) {
  return String(row.evaluation_path || '').toLowerCase().includes('(llm)');
}

export function stratifiedSample(rows, limit = DEFAULT_LIMIT) {
  const groups = new Map();
  const domains = new Set();
  for (const row of rows) {
    if (!row.message_id || !row.signal_id || !row.sender_domain) continue;
    if (!groups.has(row.signal_id)) groups.set(row.signal_id, []);
    groups.get(row.signal_id).push(row);
    domains.add(row.sender_domain);
  }

  if (groups.size < 2) {
    throw new Error(`Need evaluations for at least 2 Signals; found ${groups.size}.`);
  }
  if (domains.size < 2) {
    throw new Error(`Need evaluations from at least 2 sender domains; found ${domains.size}.`);
  }

  for (const candidates of groups.values()) {
    candidates.sort((a, b) => timestampValue(b.evaluated_at) - timestampValue(a.evaluated_at));
  }

  const selectedPerSignal = new Map();
  const selectedPerDomain = new Map();
  const selectedMessageIds = new Set();
  const selected = [];
  while (selected.length < limit) {
    const availableGroups = [...groups.entries()]
      .filter(([, candidates]) => candidates.some((row) => !selectedMessageIds.has(row.message_id)))
      .sort((a, b) => {
        const selectedDiff = (selectedPerSignal.get(a[0]) || 0) - (selectedPerSignal.get(b[0]) || 0);
        return selectedDiff || a[0].localeCompare(b[0]);
      });
    if (availableGroups.length === 0) break;

    const [signalId, candidates] = availableGroups[0];
    candidates.sort((a, b) => {
      const domainDiff = (selectedPerDomain.get(a.sender_domain) || 0) -
        (selectedPerDomain.get(b.sender_domain) || 0);
      return domainDiff || timestampValue(b.evaluated_at) - timestampValue(a.evaluated_at);
    });
    const candidateIndex = candidates.findIndex((row) => !selectedMessageIds.has(row.message_id));
    const [row] = candidates.splice(candidateIndex, 1);
    selected.push(row);
    selectedMessageIds.add(row.message_id);
    selectedPerSignal.set(signalId, (selectedPerSignal.get(signalId) || 0) + 1);
    selectedPerDomain.set(row.sender_domain, (selectedPerDomain.get(row.sender_domain) || 0) + 1);
  }
  return selected;
}

function emptyCounts() {
  return { tp: 0, fp: 0, tn: 0, fn: 0, total: 0 };
}

function metrics(counts) {
  const precision = counts.tp + counts.fp > 0
    ? counts.tp / (counts.tp + counts.fp)
    : null;
  const recall = counts.tp + counts.fn > 0
    ? counts.tp / (counts.tp + counts.fn)
    : null;
  const f1Denominator = (2 * counts.tp) + counts.fp + counts.fn;
  return {
    precision,
    recall,
    f1: f1Denominator > 0 ? (2 * counts.tp) / f1Denominator : null,
  };
}

export function scoreRows(rows) {
  const overall = emptyCounts();
  const perSignal = new Map();
  const errors = { fp: [], fn: [] };
  const confidenceBreakdown = {
    fp: Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, 0])),
    fn: Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, 0])),
  };
  let labeled = 0;
  let unlabeled = 0;

  for (const row of rows) {
    const label = String(row.ground_truth_label || '').trim().toUpperCase();
    if (!label) {
      unlabeled++;
      continue;
    }
    if (!LABELS.has(label)) {
      throw new Error(`Invalid ground_truth_label "${label}" for message ${row.message_id || '(unknown)'}. Use TP, FP, TN, or FN.`);
    }
    const verdict = row.system_verdict;
    if ((label === 'TP' || label === 'FP') && verdict !== 'relevant') {
      throw new Error(`${label} conflicts with system_verdict "${verdict}" for message ${row.message_id}.`);
    }
    if ((label === 'TN' || label === 'FN') && verdict !== 'not-relevant') {
      throw new Error(`${label} conflicts with system_verdict "${verdict}" for message ${row.message_id}.`);
    }

    const key = label.toLowerCase();
    const signalKey = row.signal_id || row.signal_name || '(unknown signal)';
    if (!perSignal.has(signalKey)) {
      perSignal.set(signalKey, { signalName: row.signal_name || signalKey, counts: emptyCounts() });
    }
    const counts = perSignal.get(signalKey).counts;
    counts[key]++;
    counts.total++;
    overall[key]++;
    overall.total++;
    labeled++;

    if (label === 'FP' || label === 'FN') {
      const confidence = String(row.system_confidence || '').toLowerCase();
      if (confidenceBreakdown[key][confidence] === undefined) {
        confidenceBreakdown[key][confidence] = 0;
      }
      confidenceBreakdown[key][confidence]++;
      errors[key].push(row);
    }
  }

  return {
    overall: { counts: overall, metrics: metrics(overall) },
    perSignal: [...perSignal.entries()].map(([signalId, value]) => ({
      signalId,
      signalName: value.signalName,
      counts: value.counts,
      metrics: metrics(value.counts),
    })),
    errors,
    confidenceBreakdown,
    labeled,
    unlabeled,
  };
}

function percent(value) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

function escapeTableCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function errorExample(row) {
  const title = `${row.signal_name} — ${row.message_id} (${row.system_confidence || 'unknown'} confidence)`;
  const reasoning = String(row.system_reasoning || '').replace(/```/g, '\\`\\`\\`');
  const prefilterDetails = row.prefilter_reason
    ? `\n- Prefilter block reason: ${row.prefilter_reason}`
    : '';
  const verifier = row.system_verification_reasoning
    ? `\n\nVerification reasoning:\n\`\`\`text\n${String(row.system_verification_reasoning).replace(/```/g, '\\`\\`\\`')}\n\`\`\``
    : '';
  return `#### ${title}\n- Sender: ${row.sender || '(unknown)'}\n- Subject: ${row.subject || '(no subject)'}\n- System verdict: ${row.system_verdict}\n- Confidence: ${row.system_confidence || 'unknown'}\n- Evaluation path: ${row.evaluation_path || 'unknown'}${prefilterDetails}\n\nSystem reasoning:\n\`\`\`text\n${reasoning}\n\`\`\`${verifier}`;
}

export function formatReport(scored, generatedAt = new Date()) {
  const signalRows = scored.perSignal
    .map((signal) => `| ${escapeTableCell(signal.signalName)} | ${signal.counts.total} | ${percent(signal.metrics.precision)} | ${percent(signal.metrics.recall)} | ${percent(signal.metrics.f1)} |`)
    .join('\n');
  const confidenceRows = ['fp', 'fn'].map((type) => (
    `| ${type.toUpperCase()} | ${CONFIDENCE_LEVELS.map((level) => scored.confidenceBreakdown[type][level] || 0).join(' | ')} |`
  )).join('\n');
  const prefilterFalseNegatives = scored.errors.fn.filter(isPrefilterEvaluation);
  const llmFalseNegatives = scored.errors.fn.filter((row) => !isPrefilterEvaluation(row) && isLlmEvaluation(row));
  const otherFalseNegatives = scored.errors.fn.filter((row) => !isPrefilterEvaluation(row) && !isLlmEvaluation(row));
  const prefilterRows = prefilterFalseNegatives.length
    ? prefilterFalseNegatives.slice(0, 3).map(errorExample).join('\n\n')
    : 'None in the labeled sample.';
  const otherFnRows = otherFalseNegatives.length
    ? otherFalseNegatives.slice(0, 3).map(errorExample).join('\n\n')
    : 'None in the labeled sample.';

  return `# DailyEz Triage Evaluation Results

- Generated: ${generatedAt.toISOString()}
- Labeled evaluations: ${scored.labeled}
- Unlabeled evaluations skipped: ${scored.unlabeled}

## Precision, recall, and F1

| Signal | Labeled evaluations | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
${signalRows || '| No labeled evaluations | 0 | N/A | N/A | N/A |'}
| **Overall** | **${scored.overall.counts.total}** | **${percent(scored.overall.metrics.precision)}** | **${percent(scored.overall.metrics.recall)}** | **${percent(scored.overall.metrics.f1)}** |

## Confusion matrix

| System verdict | Actual relevant | Actual not relevant |
|---|---:|---:|
| Relevant | TP: ${scored.overall.counts.tp} | FP: ${scored.overall.counts.fp} |
| Not relevant | FN: ${scored.overall.counts.fn} | TN: ${scored.overall.counts.tn} |

## Error confidence breakdown

| Error | High | Medium | Low |
|---|---:|---:|---:|
${confidenceRows}

## False negatives: prefilter blocks vs. matcher misses

Keyword-prefilter blocks below did not reach the LLM. Their saved block reason is included as the system reasoning.

### Prefilter-blocked false negatives (${prefilterFalseNegatives.length} total; showing up to 3)

${prefilterRows}

### LLM false negatives (${llmFalseNegatives.length} total; showing up to 3)

${llmFalseNegatives.length ? llmFalseNegatives.slice(0, 3).map(errorExample).join('\n\n') : 'None in the labeled sample.'}

### Deterministic/other false negatives (${otherFalseNegatives.length} total; showing up to 3)

${otherFnRows}

## Example false positives

${scored.errors.fp.length === 0 ? 'None in the labeled sample.' : scored.errors.fp.slice(0, 3).map(errorExample).join('\n\n')}

`;
}

function flattenDocuments(documents, activeSignalIds) {
  const rows = [];
  for (const message of documents) {
    const messageId = message.id || String(message._id);
    const domain = senderDomain(message.from);
    if (!domain) continue;
    for (const evaluation of message.signalEvaluations || []) {
      const signalId = String(evaluation.signalId || '');
      if (!activeSignalIds.has(signalId)) continue;
      if (evaluation.verdict !== 'relevant' && evaluation.verdict !== 'not-relevant') continue;
      rows.push({
        message_id: messageId,
        sender: message.from || '',
        subject: message.subject || '',
        snippet: message.content || '',
        signal_id: signalId,
        signal_name: evaluation.signalName || '',
        sender_domain: domain,
        system_verdict: evaluation.verdict,
        system_confidence: evaluation.confidence || '',
        system_reasoning: evaluation.reasoning || '',
        system_verification_reasoning: evaluation.verificationReasoning || '',
        evaluation_path: evaluation.evaluationPath || '',
        prefilter_blocked: evaluation.prefilterBlocked === true,
        prefilter_reason: evaluation.prefilterReason || '',
        evaluated_at: evaluation.evaluatedAt || message.timestamp || message.createdAt || null,
        ground_truth_label: '',
      });
    }
  }
  return rows;
}

async function exportLabels({ limit, output }) {
  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not defined. Set it in the app environment before exporting.');
  }
  const client = new MongoClient(config.mongodbUri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 10,
    ...(config.mongodbUri.includes('retryWrites=') ? {} : { retryWrites: true }),
  });
  try {
    await client.connect();
    const db = client.db();
    const signals = await db.collection('signals').find({}, { projection: { _id: 1 } }).toArray();
    const activeSignalIds = new Set(signals.map((signal) => String(signal._id)));
    const messages = await db.collection('messages')
      .find(
        { source: 'gmail', signalEvaluations: { $exists: true, $ne: [] } },
        { projection: { id: 1, from: 1, subject: 1, content: 1, timestamp: 1, createdAt: 1, signalEvaluations: 1 } },
      )
      .sort({ timestamp: -1 })
      .limit(limit * 25)
      .toArray();

    const rows = flattenDocuments(messages, activeSignalIds);
    rows.sort((a, b) => timestampValue(b.evaluated_at) - timestampValue(a.evaluated_at));
    const sample = stratifiedSample(rows, limit);
    await writeFile(resolve(output), `${JSON.stringify(sample, null, 2)}\n`, 'utf8');

    const signalsSampled = new Set(sample.map((row) => row.signal_id)).size;
    const domainsSampled = new Set(sample.map((row) => row.sender_domain)).size;
    console.log(`Exported ${sample.length} Gmail message × Signal evaluations across ${signalsSampled} Signals and ${domainsSampled} sender domains to ${resolve(output)}.`);
    if (sample.length < MIN_LIMIT) {
      console.warn(`Only ${sample.length} labeled rows are currently available; the requested sample is approximately ${MIN_LIMIT}-${MAX_LIMIT}.`);
    }
    console.log('Fill ground_truth_label with TP, FP, TN, or FN, then run: node scripts/eval-triage.js score');
    console.log('Use TP=system relevant + actually relevant, FP=system relevant + actually irrelevant, TN=system not-relevant + actually irrelevant, FN=system not-relevant + actually relevant.');
  } finally {
    await client.close();
  }
}

async function scoreFile({ input, output }) {
  const rows = JSON.parse(await readFile(resolve(input), 'utf8'));
  if (!Array.isArray(rows)) throw new Error('The evaluation JSON must contain an array of rows.');
  const scored = scoreRows(rows);
  if (scored.labeled === 0) {
    throw new Error(`No labels found in ${resolve(input)}. Fill ground_truth_label with TP, FP, TN, or FN.`);
  }
  const report = formatReport(scored);
  await writeFile(resolve(output), report, 'utf8');
  console.log(report);
  console.log(`Wrote ${resolve(output)}.`);
}

function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {
    limit: DEFAULT_LIMIT,
    output: command === 'score' ? 'eval-results.md' : 'eval-labels.json',
    input: 'eval-labels.json',
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--limit' || flag === '--out' || flag === '--input') {
      const value = rest[++i];
      if (!value) throw new Error(`Missing value after ${flag}.`);
      if (flag === '--limit') options.limit = Number(value);
      if (flag === '--out') options.output = value;
      if (flag === '--input') options.input = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (command === 'export' && (!Number.isInteger(options.limit) || options.limit < MIN_LIMIT || options.limit > MAX_LIMIT)) {
    throw new Error(`--limit must be an integer from ${MIN_LIMIT} to ${MAX_LIMIT}.`);
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'export') return exportLabels(options);
  if (command === 'score') return scoreFile(options);
  throw new Error('Usage: node scripts/eval-triage.js export [--limit 120] [--out eval-labels.json] | score [--input eval-labels.json] [--out eval-results.md]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Triage evaluation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
