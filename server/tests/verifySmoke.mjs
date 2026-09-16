// Live orchestrator gate smoke: prove a real medium/low MATCH gets verified and
// verificationRan=true + reasoning is stored on the message document.
//
// Context (verified this session): the production classifier (gpt-oss-20b) has an
// intermittent TPD budget on this account; when it returns medium/low MATCHES the
// orchestrator gate runs verifyMatch with GROQ_VERIFY_MODEL (qwen/qwen3.6-27b).
// This script inserts PENDING clones (crafted genuine-but-ambiguous JDs + real
// promos), evaluates each through signalMessageMatches (the exact per-message
// pipeline the app uses), persists with the same merge/$set as
// recheckAllMessagesAgainstSignals, and stops at the first stored verified match.
// Run with: node server/tests/verifySmoke.mjs  (live Groq + Mongo)
import * as fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// Test-only pacing boost for this process only; production keeps the .env default.
process.env.GROQ_MATCH_RPM_LIMIT = '12';

const LOG = 'verify-smoke.log';
const line = (s) => console.log(`[${new Date().toISOString()}] ${s}`);
{ const orig = console.log; console.log = (...args) => { orig(...args); fs.appendFileSync(LOG, args.join(' ') + '\n'); }; }

const { MongoClient, ObjectId } = await import('mongodb');
const { signalMessageMatches } = await import('../agents/signalMatching.js');
const SIGNAL_ID = '6a9fdf3b980f360e4c290289';
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db();
const msgCol = db.collection('messages');
const sigCol = db.collection('signals');
const MARKER = '_smokeVerify';

line(`GROQ_VERIFY_MODEL=${process.env.GROQ_VERIFY_MODEL}`);

let insertedIds = [];
let signalBefore = null;
try {
  signalBefore = await sigCol.findOne({ _id: new ObjectId(SIGNAL_ID) });
  line(`signal snapshot: matchCount=${signalBefore?.matchCount}`);
} catch (e) {
  line(`WARN could not snapshot signal: ${e.message}`);
}
try {
  // ── 1. Craft the borderline set (genuine-but-uncertain matches first) ──
  const crafted = [
    {
      from: 'Norlabs Careers <careers@norlabs.example>',
      subject: 'AI Engineer (Freshers) — open role at Norlabs',
      content: 'Norlabs is hiring an AI Engineer for freshers. Build LLM features, work with Python and PyTorch. 0-3 years experience, stipend during training. Apply by Friday.',
      bodyText: 'Norlabs is hiring an AI Engineer for freshers. Build LLM features, work with Python and PyTorch. 0-3 years experience, stipend during training. Apply by Friday. Location Hyderabad.',
    },
    {
      from: 'Placement Group <919876543210@s.whatsapp.net>',
      subject: 'WhatsApp chat',
      content: 'Guys, I heard TechVista is going to open AI Engineer roles for freshers next quarter. Nothing official yet. Will share when the posting is live.',
      bodyText: 'Guys, I heard TechVista is going to open AI Engineer roles for freshers next quarter. Nothing official yet. Will share when the posting is live.',
    },
    {
      from: 'Startup Weekly <newsletter@startupweekly.example>',
      subject: 'AI Engineer roles for freshers — announcement coming',
      content: 'Next week we will announce AI Engineer open roles for freshers at our partner companies. Stay tuned for the official list.',
      bodyText: 'Next week we will announce AI Engineer open roles for freshers at our partner companies. Stay tuned for the official list.',
    },
    {
      from: 'HireFast Jobs <posts@hirefast.example>',
      subject: 'AI Engineer (Freshers) - 2 openings',
      content: 'AI Engineer, freshers, 2 openings. Pune startup. Apply online.',
      bodyText: 'AI Engineer, freshers, 2 openings. Pune startup. Apply online. Details sparse at posting time.',
    },
  ];
  const realCandidates = await msgCol.find({
    source: 'gmail',
    status: { $ne: 'archived' },
    $or: [{ subject: /AI|Engineer|Hiring|Job|freshers|intern/i }, { content: /AI Engineer|freshers/i }],
  }).sort({ timestamp: -1 }).limit(3).toArray();

  const clones = [];
  for (const cr of crafted) {
    clones.push({ from: cr.from, subject: cr.subject, content: cr.content, bodyText: cr.bodyText, source: 'gmail', status: 'active', matched: false, signalMatches: [], keywordSignalMatches: [], lastEvaluatedSignalIds: [], signalChecked: true, timestamp: new Date(), [MARKER]: true });
  }
  for (const r of realCandidates) {
    clones.push({ from: r.from, subject: r.subject, content: r.content || '', bodyText: r.bodyText || r.content || '', source: 'gmail', status: 'active', matched: false, signalMatches: [], keywordSignalMatches: [], lastEvaluatedSignalIds: [], signalChecked: true, timestamp: new Date(), [MARKER]: true });
  }

  line(`inserting ${clones.length} pending clones (${crafted.length} crafted + ${realCandidates.length} real)`);
  const inserted = await msgCol.insertMany(clones);
  insertedIds = Object.values(inserted.insertedIds).map((id) => new ObjectId(id));
  const signal = await sigCol.findOne({ _id: new ObjectId(SIGNAL_ID) });
  line(`signal loaded: "${signal.context}"`);
// ── 2. Evaluate each clone through the app's real per-message pipeline ──
  let verifiedMatches = 0;
  for (let i = 0; i < clones.length; i++) {
    const docId = insertedIds[i];
    const before = clones[i];
    const normalizedMessage = {
      from: before.from || '',
      subject: before.subject || '',
      content: before.bodyText || before.content || '',
      source: 'gmail',
    };
    line(`[${i + 1}/${clones.length}] evaluating subj="${before.subject}"`);
    const result = await signalMessageMatches(normalizedMessage, [signal], []);

    // Mirrors recheckAllMessagesAgainstSignals: merge + $set on the message doc.
    const allMatches = [...(before.signalMatches || []), ...result.matches];
    const mergedKeywordMatches = [...(before.keywordSignalMatches || []), ...result.keywordMatches];
    const mergedEvaluated = [...(before.lastEvaluatedSignalIds || []), ...result.evaluatedSignalIds];
    await msgCol.updateOne(
      { _id: docId },
      {
        $set: {
          matched: allMatches.length > 0,
          signalMatches: allMatches,
          keywordMatched: mergedKeywordMatches.length > 0,
          keywordSignalMatches: mergedKeywordMatches,
          lastEvaluatedSignalIds: mergedEvaluated,
          updatedAt: new Date(),
        },
      }
    );
    for (const match of result.matches) {
      await sigCol.updateOne({ _id: signal._id }, { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } });
    }
    const first = (result.matches || [])[0];
    line(`  -> matches=${result.matches.length} llmCalls=${result.llmCalls}` +
      (first ? ` conf=${first.confidence} vRan=${first.verificationRan}` : ''));

    // Early exit on the first stored verified match.
    const saved = await msgCol.findOne({ _id: docId });
    const savedMatch = (saved.signalMatches || [])[0];
    if (
      savedMatch && savedMatch.verificationRan === true &&
      typeof savedMatch.verificationReasoning === 'string' &&
      savedMatch.verificationReasoning.trim().length > 0
    ) {
      verifiedMatches++;
      line('  >>> verified match persisted — stopping evaluation');
      break;
    }
  }
// ── 3. Read back the stored docs and assert verification was persisted ──
  const stored = await msgCol.find({ [MARKER]: true }).project({ subject: 1, matched: 1, signalMatches: 1 }).toArray();
  for (const m of stored) {
    const sm = (m.signalMatches || [])[0];
    line(`stored: subj="${m.subject}" matched=${m.matched}`);
    if (sm) {
      line(`  conf=${sm.confidence} verificationRan=${sm.verificationRan}`);
      line(`  verificationReasoning=${JSON.stringify(sm.verificationReasoning || '')}`);
      if (sm.verificationRan === true && typeof sm.verificationReasoning === 'string' && sm.verificationReasoning.trim().length > 0) {
        verifiedMatches++;
      }
    } else {
      line('  (no match stored)');
    }
  }

  if (verifiedMatches === 0) {
    line('RESULT_FAIL: no stored match carried verificationRan=true (classifier returned high or unmatched on every clone)');
    await cleanupAndExit(insertedIds, signalBefore, 2);
  }
  line(`RESULT_PASS: ${verifiedMatches} stored match(es) with verificationRan=true + real verificationReasoning`);
  await cleanupAndExit(insertedIds, signalBefore, 0);
} catch (err) {
  line(`ERROR: ${err && err.stack ? err.stack : String(err)}`);
  await cleanupAndExit(insertedIds, signalBefore, 1);
}

async function cleanupAndExit(insertedIds, signalBefore, code) {
  try {
    if (insertedIds.length > 0) {
      const res = await msgCol.deleteMany({ _id: { $in: insertedIds } });
      line(`cleanup: deleted ${res.deletedCount} clone message(s)`);
    }
    if (signalBefore) {
      await sigCol.updateOne({ _id: signalBefore._id }, { $set: { matchCount: signalBefore.matchCount || 0, lastMatched: signalBefore.lastMatched ?? null } });
      line('cleanup: restored signal matchCount/lastMatched');
    }
  } catch (e) {
    line(`cleanup error: ${e.message}`);
  }
  try { await c.close(); } catch { /* ignore */ }
  line(`done exit=${code}`);
  process.exit(code);
}